import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Cloud, Database, Download, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { useBehaviorEventSync } from '@/hooks/useBehaviorEventSync'
import { indexAssistantRag } from '@/lib/ai/api'
import { withBehaviorTrackingSuppressed } from '@/lib/behaviorEvents'
import {
  MAX_BACKGROUND_IMAGE_BYTES,
  applyDashboardSnapshot,
  applyWidgetDataSnapshot,
  blobToDataUrl,
  downloadLocalBackup,
  getDashboardSnapshot,
  getLocalSnapshotFingerprint,
  getWidgetDataSnapshot,
  hasLocalPersistedData,
  imageDataUrlToBlob,
} from '@/lib/cloudSnapshots'
import {
  DASHBOARD_ASSETS_BUCKET,
  isSupabaseConfigured,
  supabase,
  type DashboardSnapshotRow,
  type User,
} from '@/lib/supabase'
import { syncUserContentItems } from '@/lib/userContentItems'
import {
  CloudSyncContext,
  type CloudSyncContextValue,
  type SyncStatus,
} from '@/components/cloud/cloudSyncContext'
import { useBackgroundStore } from '@/store/backgroundStore'
import { useDashboardStore } from '@/store/dashboardStore'
import { useWidgetDataStore } from '@/store/widgetDataStore'

interface SyncMeta {
  lastResolvedUserId?: string
  resolvedAt?: string
}

const CLOUD_SYNC_META_KEY = 'primoria-cloud-sync-meta'

function readSyncMeta(): SyncMeta {
  try {
    return JSON.parse(localStorage.getItem(CLOUD_SYNC_META_KEY) ?? '{}') as SyncMeta
  } catch {
    return {}
  }
}

function writeSyncMeta(userId: string) {
  try {
    localStorage.setItem(
      CLOUD_SYNC_META_KEY,
      JSON.stringify({ lastResolvedUserId: userId, resolvedAt: new Date().toISOString() })
    )
  } catch {
    return
  }
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

export function CloudSyncProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [status, setStatus] = useState<SyncStatus>(isSupabaseConfigured ? 'checking' : 'local')
  const [message, setMessage] = useState<string | null>(
    isSupabaseConfigured ? null : '未配置 Supabase，当前使用本地模式'
  )
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [conflictRow, setConflictRow] = useState<DashboardSnapshotRow | null>(null)

  const syncReadyRef = useRef(false)
  const applyingCloudRef = useRef(false)
  const syncingRef = useRef(false)
  const syncTimerRef = useRef<number | null>(null)
  const backgroundPathRef = useRef<string | null>(null)
  const lastUploadedBackgroundRef = useRef<string | null>(null)
  const lastPushedFingerprintRef = useRef<string | null>(null)

  useBehaviorEventSync(user?.id)

  useEffect(() => {
    if (!supabase) return

    let active = true
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return
      if (error) {
        setStatus('error')
        setMessage(error.message)
        return
      }
      setUser(data.session?.user ?? null)
    })

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])

  const ensureBackgroundUploaded = useCallback(async (userId: string) => {
    if (!supabase) return null

    const backgroundImage = useBackgroundStore.getState().backgroundImage
    const previousPath = backgroundPathRef.current

    if (!backgroundImage) {
      if (previousPath) {
        await supabase.storage.from(DASHBOARD_ASSETS_BUCKET).remove([previousPath])
      }
      backgroundPathRef.current = null
      lastUploadedBackgroundRef.current = null
      return null
    }

    if (backgroundImage === lastUploadedBackgroundRef.current && previousPath) {
      return previousPath
    }

    const parsed = imageDataUrlToBlob(backgroundImage)
    if (!parsed) {
      setMessage('数据已同步，但壁纸不是受支持的图片格式，未上传。')
      return previousPath
    }

    if (parsed.blob.size > MAX_BACKGROUND_IMAGE_BYTES) {
      setMessage('数据已同步，但壁纸超过 5MB，未上传到云端。')
      return previousPath
    }

    const nextPath = `${userId}/background.${parsed.extension}`
    const { error } = await supabase.storage
      .from(DASHBOARD_ASSETS_BUCKET)
      .upload(nextPath, parsed.blob, {
        cacheControl: '3600',
        contentType: parsed.mimeType,
        upsert: true,
      })

    if (error) throw error

    if (previousPath && previousPath !== nextPath) {
      await supabase.storage.from(DASHBOARD_ASSETS_BUCKET).remove([previousPath])
    }

    backgroundPathRef.current = nextPath
    lastUploadedBackgroundRef.current = backgroundImage
    return nextPath
  }, [])

  const syncContentIndex = useCallback(async (userId: string) => {
    const result = await syncUserContentItems(userId)
    if (!result.ok) {
      setMessage(`快照已同步，但内容索引失败：${result.error ?? '未知错误'}`)
      return false
    }
    try {
      const ragResult = await indexAssistantRag({ limit: 40, sourceTypes: ['content_item'] })
      if (ragResult.remaining > 0) {
        setMessage(`内容索引已同步，RAG 还有 ${ragResult.remaining} 条将在下次同步继续。`)
      }
    } catch (error) {
      setMessage(`内容索引已同步，但 RAG 索引失败：${getErrorMessage(error, '未知错误')}`)
    }
    return true
  }, [])

  const pushLocalSnapshot = useCallback(async (userId: string) => {
    if (!supabase || syncingRef.current) return false

    syncingRef.current = true
    setStatus('syncing')
    setMessage('正在同步到云端...')

    try {
      const backgroundPath = await ensureBackgroundUploaded(userId)
      const fingerprint = getLocalSnapshotFingerprint(backgroundPath)

      if (fingerprint === lastPushedFingerprintRef.current) {
        const contentSynced = await syncContentIndex(userId)
        setStatus('ready')
        if (contentSynced) setMessage('云同步已是最新')
        return true
      }

      const { data, error } = await supabase
        .from('dashboard_snapshots')
        .upsert(
          {
            user_id: userId,
            dashboard_state: getDashboardSnapshot(),
            widget_data: getWidgetDataSnapshot(),
            background_path: backgroundPath,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        )
        .select()
        .single()

      if (error) throw error

      backgroundPathRef.current = data.background_path
      lastPushedFingerprintRef.current = getLocalSnapshotFingerprint(data.background_path)
      const contentSynced = await syncContentIndex(userId)
      setUpdatedAt(data.updated_at)
      setStatus('ready')
      if (contentSynced) setMessage('已同步到云端')
      return true
    } catch (error) {
      setStatus('error')
      setMessage(getErrorMessage(error, '云同步失败'))
      return false
    } finally {
      syncingRef.current = false
    }
  }, [ensureBackgroundUploaded, syncContentIndex])

  const applyCloudRow = useCallback(async (row: DashboardSnapshotRow) => {
    if (!supabase || !user) return false

    applyingCloudRef.current = true
    setStatus('checking')
    setMessage('正在载入云端数据...')

    try {
      if (row.dashboard_state) {
        withBehaviorTrackingSuppressed(() => applyDashboardSnapshot(row.dashboard_state!))
      }
      if (row.widget_data) {
        withBehaviorTrackingSuppressed(() => applyWidgetDataSnapshot(row.widget_data!))
      }

      backgroundPathRef.current = row.background_path

      if (row.background_path) {
        const { data, error } = await supabase.storage
          .from(DASHBOARD_ASSETS_BUCKET)
          .download(row.background_path)
        if (error) throw error

        const dataUrl = await blobToDataUrl(data)
        withBehaviorTrackingSuppressed(() => {
          useBackgroundStore.getState().setBackgroundImage(dataUrl)
        })
        lastUploadedBackgroundRef.current = dataUrl
      } else {
        withBehaviorTrackingSuppressed(() => {
          useBackgroundStore.getState().setBackgroundImage(null)
        })
        lastUploadedBackgroundRef.current = null
      }

      lastPushedFingerprintRef.current = getLocalSnapshotFingerprint(row.background_path)
      setUpdatedAt(row.updated_at)
      setStatus('ready')
      setMessage('已载入云端数据')
      writeSyncMeta(user.id)
      return true
    } catch (error) {
      setStatus('error')
      setMessage(getErrorMessage(error, '载入云端数据失败'))
      return false
    } finally {
      applyingCloudRef.current = false
    }
  }, [user])

  useEffect(() => {
    if (!supabase || !user) {
      syncReadyRef.current = false
      backgroundPathRef.current = null
      lastUploadedBackgroundRef.current = null
      lastPushedFingerprintRef.current = null
      if (!isSupabaseConfigured) {
        setStatus('local')
        setMessage('未配置 Supabase，当前使用本地模式')
      } else if (!user) {
        setStatus('local')
        setMessage('未登录，当前使用本地模式')
      }
      return
    }

    const client = supabase
    let cancelled = false

    async function bootstrap() {
      setStatus('checking')
      setMessage('正在检查云端数据...')

      const { data, error } = await client
        .from('dashboard_snapshots')
        .select()
        .eq('user_id', user!.id)
        .maybeSingle()

      if (cancelled) return

      if (error) {
        setStatus('error')
        setMessage(error.message)
        return
      }

      const meta = readSyncMeta()
      if (data && hasLocalPersistedData() && meta.lastResolvedUserId !== user!.id) {
        setConflictRow(data)
        setStatus('checking')
        setMessage('本机和云端都有数据，请选择保留哪一份。')
        return
      }

      const synced = data
        ? await applyCloudRow(data)
        : await pushLocalSnapshot(user!.id)

      if (!data && synced) {
        writeSyncMeta(user!.id)
      }

      if (!cancelled && synced) syncReadyRef.current = true
    }

    void bootstrap()

    return () => {
      cancelled = true
      syncReadyRef.current = false
      if (syncTimerRef.current) window.clearTimeout(syncTimerRef.current)
    }
  }, [applyCloudRow, pushLocalSnapshot, user])

  useEffect(() => {
    if (!user) return

    const scheduleSync = () => {
      if (!syncReadyRef.current || applyingCloudRef.current) return
      if (syncTimerRef.current) window.clearTimeout(syncTimerRef.current)
      syncTimerRef.current = window.setTimeout(() => {
        void pushLocalSnapshot(user.id)
      }, 900)
    }

    const unsubscribeDashboard = useDashboardStore.subscribe(scheduleSync)
    const unsubscribeWidgetData = useWidgetDataStore.subscribe(scheduleSync)
    const unsubscribeBackground = useBackgroundStore.subscribe(scheduleSync)

    return () => {
      unsubscribeDashboard()
      unsubscribeWidgetData()
      unsubscribeBackground()
      if (syncTimerRef.current) window.clearTimeout(syncTimerRef.current)
    }
  }, [pushLocalSnapshot, user])

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) throw new Error('Supabase 未配置')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }, [])

  const signUp = useCallback(async (email: string, password: string) => {
    if (!supabase) throw new Error('Supabase 未配置')
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) throw error
    if (!data.session) {
      toast.success('账号已创建，请按 Supabase 邮件提示完成确认后再登录。')
    }
  }, [])

  const signOut = useCallback(async () => {
    if (!supabase) return
    const { error } = await supabase.auth.signOut()
    if (error) throw error
    syncReadyRef.current = false
    setUser(null)
    setStatus('local')
    setMessage('已退出，当前使用本地模式')
  }, [])

  const pushNow = useCallback(async () => {
    if (!user) return false
    return pushLocalSnapshot(user.id)
  }, [pushLocalSnapshot, user])

  const applyCloudVersion = useCallback(async () => {
    if (!conflictRow || !user) return
    const synced = await applyCloudRow(conflictRow)
    if (synced) {
      syncReadyRef.current = true
      writeSyncMeta(user.id)
      setConflictRow(null)
    }
  }, [applyCloudRow, conflictRow, user])

  const uploadLocalVersion = useCallback(async () => {
    if (!user) return
    const synced = await pushLocalSnapshot(user.id)
    if (synced) {
      syncReadyRef.current = true
      writeSyncMeta(user.id)
      setConflictRow(null)
    }
  }, [pushLocalSnapshot, user])

  const value = useMemo<CloudSyncContextValue>(() => ({
    configured: isSupabaseConfigured,
    message,
    pushNow,
    signIn,
    signOut,
    signUp,
    status,
    updatedAt,
    user,
  }), [message, pushNow, signIn, signOut, signUp, status, updatedAt, user])

  return (
    <CloudSyncContext.Provider value={value}>
      {children}
      {conflictRow && (
        <CloudConflictDialog
          updatedAt={conflictRow.updated_at}
          onExport={downloadLocalBackup}
          onUseCloud={() => void applyCloudVersion()}
          onUploadLocal={() => void uploadLocalVersion()}
        />
      )}
    </CloudSyncContext.Provider>
  )
}

function CloudConflictDialog({
  onExport,
  onUploadLocal,
  onUseCloud,
  updatedAt,
}: {
  onExport: () => void
  onUploadLocal: () => void
  onUseCloud: () => void
  updatedAt: string | null
}) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center px-4" style={{ background: 'rgba(61,52,42,0.24)' }}>
      <div
        className="w-full max-w-[420px] rounded-2xl p-5"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          boxShadow: '0 18px 52px rgba(61,52,42,0.18)',
        }}
      >
        <div className="flex items-start gap-3">
          <div
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl"
            style={{ background: 'rgba(92,125,96,0.12)', color: 'var(--primary-dark)' }}
          >
            <Database size={18} />
          </div>
          <div className="min-w-0">
            <div style={{ fontSize: '16px', fontWeight: 650, color: 'var(--text)' }}>选择同步版本</div>
            <p style={{ marginTop: '6px', fontSize: '13px', color: 'var(--text-muted)', lineHeight: 1.6 }}>
              本机和云端都有 Dashboard 数据。云端最后更新时间：
              {updatedAt ? new Date(updatedAt).toLocaleString() : '未知'}。
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-2">
          <button
            onClick={onUseCloud}
            className="flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold"
            style={{ background: 'var(--text)', color: 'white' }}
          >
            <Cloud size={15} />
            使用云端数据
          </button>
          <button
            onClick={onUploadLocal}
            className="flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold"
            style={{ background: 'var(--primary)', color: 'white' }}
          >
            <Upload size={15} />
            上传本机数据覆盖云端
          </button>
          <button
            onClick={onExport}
            className="flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold"
            style={{
              background: 'var(--bg-muted)',
              color: 'var(--text-sub)',
              border: '1px solid var(--border)',
            }}
          >
            <Download size={15} />
            先导出本机备份
          </button>
        </div>
      </div>
    </div>
  )
}
