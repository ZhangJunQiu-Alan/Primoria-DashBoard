import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { AlertTriangle, Cloud, Database, Download, Upload } from 'lucide-react'
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
  getBackgroundSignature,
  getDashboardSnapshot,
  getLocalSnapshotFingerprint,
  getWidgetDataSnapshot,
  hasLocalPersistedData,
  imageDataUrlToBlob,
} from '@/lib/cloudSnapshots'
import { mergeDashboardSnapshots, type DashboardSyncSnapshot, type SnapshotConflict } from '@/lib/snapshotMerge'
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
  baseSnapshot?: DashboardSyncSnapshot
  lastResolvedUserId?: string
  lastSyncedAt?: string
  localDirty?: boolean
  pendingSince?: string
  remoteRevision?: number
  resolvedAt?: string
  version?: 2
}

interface ConflictState {
  conflicts?: SnapshotConflict[]
  kind: 'initial' | 'merge'
  row: DashboardSnapshotRow
}

const CLOUD_SYNC_META_KEY = 'primoria-cloud-sync-meta'

function isOnline() {
  if (typeof navigator === 'undefined') return true
  return navigator.onLine
}

function readSyncMeta(): SyncMeta {
  try {
    return JSON.parse(localStorage.getItem(CLOUD_SYNC_META_KEY) ?? '{}') as SyncMeta
  } catch {
    return {}
  }
}

function writeSyncMeta(meta: SyncMeta) {
  try {
    localStorage.setItem(CLOUD_SYNC_META_KEY, JSON.stringify(meta))
  } catch {
    return
  }
}

function getRemoteRevision(row: DashboardSnapshotRow | null) {
  return Number(row?.sync_revision ?? 0)
}

function buildLocalSyncSnapshot(backgroundPath: string | null): DashboardSyncSnapshot {
  return {
    backgroundPath,
    backgroundSignature: getBackgroundSignature(),
    dashboard: getDashboardSnapshot(),
    widgetData: getWidgetDataSnapshot(),
  }
}

function buildRemoteSyncSnapshot(row: DashboardSnapshotRow): DashboardSyncSnapshot {
  return {
    backgroundPath: row.background_path,
    backgroundSignature: row.background_signature ?? null,
    dashboard: row.dashboard_state ?? { layouts: {}, widgetNames: {}, widgets: [] },
    widgetData: row.widget_data ?? {
      activeAiConversationId: 'default-dashboard-agent',
      aiConversations: {},
      calendarEmbeds: {},
      calendarEventsByDate: {},
      dailyBriefsByDate: {},
      habitLogs: {},
      habitsByWidget: {},
      linedNotesByWidget: {},
      notesByWidget: {},
      pomodoro: { lastSessionDate: new Date().toISOString().slice(0, 10), todaySessions: 0, totalSessions: 0 },
      quickLinks: [],
      scheduledTasksByWidget: {},
      todosByWidget: {},
    },
  }
}

function writeSyncedMeta(userId: string, row: DashboardSnapshotRow) {
  const now = new Date().toISOString()
  writeSyncMeta({
    baseSnapshot: buildLocalSyncSnapshot(row.background_path),
    lastResolvedUserId: userId,
    lastSyncedAt: now,
    localDirty: false,
    remoteRevision: getRemoteRevision(row),
    resolvedAt: now,
    version: 2,
  })
}

function markLocalDirty(userId: string) {
  const meta = readSyncMeta()
  if (meta.lastResolvedUserId && meta.lastResolvedUserId !== userId) return
  writeSyncMeta({
    ...meta,
    lastResolvedUserId: userId,
    localDirty: true,
    pendingSince: meta.pendingSince ?? new Date().toISOString(),
    version: 2,
  })
}

function hasLocalChangesSinceBase(meta: SyncMeta, backgroundPath: string | null) {
  if (meta.localDirty) return true
  if (!meta.baseSnapshot) return false
  return JSON.stringify(buildLocalSyncSnapshot(backgroundPath)) !== JSON.stringify(meta.baseSnapshot)
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

function isNetworkError(error: unknown) {
  const message = getErrorMessage(error, '').toLowerCase()
  return (
    !isOnline() ||
    message.includes('failed to fetch') ||
    message.includes('network') ||
    message.includes('load failed') ||
    message.includes('offline')
  )
}

function summarizeConflicts(conflicts: SnapshotConflict[] | undefined) {
  if (!conflicts || conflicts.length === 0) return null
  return conflicts
    .slice(0, 4)
    .map((conflict) => conflict.label)
    .join('、')
}

export function CloudSyncProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [online, setOnline] = useState(isOnline)
  const [status, setStatus] = useState<SyncStatus>(isSupabaseConfigured ? 'checking' : 'local')
  const [message, setMessage] = useState<string | null>(
    isSupabaseConfigured ? null : '未配置 Supabase，当前使用本地模式'
  )
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [conflictState, setConflictState] = useState<ConflictState | null>(null)

  const syncReadyRef = useRef(false)
  const applyingCloudRef = useRef(false)
  const syncingRef = useRef(false)
  const syncTimerRef = useRef<number | null>(null)
  const backgroundPathRef = useRef<string | null>(null)
  const lastUploadedBackgroundRef = useRef<string | null>(null)
  const lastPushedFingerprintRef = useRef<string | null>(null)

  useBehaviorEventSync(online ? user?.id : null)

  useEffect(() => {
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  useEffect(() => {
    if (!supabase) return

    let active = true
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return
      if (error) {
        setStatus(isNetworkError(error) ? 'offline' : 'error')
        setMessage(isNetworkError(error) ? '离线中，本地数据仍可继续编辑。' : error.message)
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

  const fetchRemoteSnapshot = useCallback(async (userId: string) => {
    if (!supabase) return null
    const { data, error } = await supabase
      .from('dashboard_snapshots')
      .select()
      .eq('user_id', userId)
      .maybeSingle()
    if (error) throw error
    return data as DashboardSnapshotRow | null
  }, [])

  const ensureBackgroundUploaded = useCallback(async (userId: string) => {
    if (!supabase) return { path: null, signature: null }

    const backgroundImage = useBackgroundStore.getState().backgroundImage
    const previousPath = backgroundPathRef.current
    const signature = getBackgroundSignature()

    if (!backgroundImage) {
      if (previousPath) {
        await supabase.storage.from(DASHBOARD_ASSETS_BUCKET).remove([previousPath])
      }
      backgroundPathRef.current = null
      lastUploadedBackgroundRef.current = null
      return { path: null, signature: null }
    }

    if (backgroundImage === lastUploadedBackgroundRef.current && previousPath) {
      return { path: previousPath, signature }
    }

    const parsed = imageDataUrlToBlob(backgroundImage)
    if (!parsed) {
      setMessage('数据已同步，但壁纸不是受支持的图片格式，未上传。')
      return { path: previousPath, signature }
    }

    if (parsed.blob.size > MAX_BACKGROUND_IMAGE_BYTES) {
      setMessage('数据已同步，但壁纸超过 5MB，未上传到云端。')
      return { path: previousPath, signature }
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
    return { path: nextPath, signature }
  }, [])

  const syncContentIndex = useCallback(async (userId: string) => {
    if (!online) return false
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
  }, [online])

  const applyRemoteBackground = useCallback(async (row: DashboardSnapshotRow) => {
    if (!supabase) return

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
      return
    }

    withBehaviorTrackingSuppressed(() => {
      useBackgroundStore.getState().setBackgroundImage(null)
    })
    lastUploadedBackgroundRef.current = null
  }, [])

  const applyCloudRow = useCallback(async (row: DashboardSnapshotRow) => {
    if (!supabase || !user) return false

    applyingCloudRef.current = true
    setStatus('checking')
    setMessage('正在载入云端数据...')

    try {
      withBehaviorTrackingSuppressed(() => {
        if (row.dashboard_state) applyDashboardSnapshot(row.dashboard_state)
        if (row.widget_data) applyWidgetDataSnapshot(row.widget_data)
      })

      await applyRemoteBackground(row)

      lastPushedFingerprintRef.current = getLocalSnapshotFingerprint(row.background_path)
      setUpdatedAt(row.updated_at)
      setStatus('ready')
      setMessage('已载入云端数据')
      writeSyncedMeta(user.id, row)
      return true
    } catch (error) {
      setStatus(isNetworkError(error) ? 'offline' : 'error')
      setMessage(isNetworkError(error) ? '离线中，暂时无法载入云端数据。' : getErrorMessage(error, '载入云端数据失败'))
      return false
    } finally {
      applyingCloudRef.current = false
    }
  }, [applyRemoteBackground, user])

  const applyMergedSnapshot = useCallback(async (
    merged: DashboardSyncSnapshot,
    backgroundSource: 'local' | 'remote',
    remoteRow: DashboardSnapshotRow
  ) => {
    applyingCloudRef.current = true
    setStatus('checking')
    setMessage('正在合并本机和云端数据...')

    try {
      withBehaviorTrackingSuppressed(() => {
        applyDashboardSnapshot(merged.dashboard)
        applyWidgetDataSnapshot(merged.widgetData)
      })

      if (backgroundSource === 'remote') {
        await applyRemoteBackground(remoteRow)
      } else {
        backgroundPathRef.current = merged.backgroundPath
      }

      setMessage('已自动合并本机和云端数据，正在上传合并结果...')
      return true
    } catch (error) {
      setStatus(isNetworkError(error) ? 'offline' : 'error')
      setMessage(getErrorMessage(error, '自动合并失败'))
      return false
    } finally {
      applyingCloudRef.current = false
    }
  }, [applyRemoteBackground])

  const reconcileRemoteBeforePush = useCallback(async (
    userId: string,
    pushMergedSnapshot: () => Promise<boolean>
  ): Promise<'blocked' | 'continue' | 'synced'> => {
    if (!online) return 'continue'

    const meta = readSyncMeta()
    if (meta.lastResolvedUserId === userId && meta.baseSnapshot) {
      backgroundPathRef.current = meta.baseSnapshot.backgroundPath
    }
    const remoteRow = await fetchRemoteSnapshot(userId)
    if (!remoteRow) return 'continue'

    const remoteRevision = getRemoteRevision(remoteRow)
    if (!meta.remoteRevision || remoteRevision === meta.remoteRevision) return 'continue'
    const localChanged = hasLocalChangesSinceBase(meta, backgroundPathRef.current)

    if (!localChanged) {
      const synced = await applyCloudRow(remoteRow)
      return synced ? 'synced' : 'blocked'
    }

    if (!meta.baseSnapshot) {
      setConflictState({ kind: 'initial', row: remoteRow })
      setStatus('conflict')
      setMessage('本机和云端都有数据，请选择保留哪一份。')
      return 'blocked'
    }

    const merge = mergeDashboardSnapshots(
      meta.baseSnapshot,
      buildLocalSyncSnapshot(backgroundPathRef.current),
      buildRemoteSyncSnapshot(remoteRow)
    )

    if (merge.conflicts.length > 0) {
      setConflictState({ conflicts: merge.conflicts, kind: 'merge', row: remoteRow })
      setStatus('conflict')
      setMessage(`本机和云端有 ${merge.conflicts.length} 处冲突，请选择全部保留哪一边。`)
      return 'blocked'
    }

    const applied = await applyMergedSnapshot(merge.merged, merge.backgroundSource, remoteRow)
    if (!applied) return 'blocked'
    return (await pushMergedSnapshot()) ? 'synced' : 'blocked'
  }, [applyCloudRow, applyMergedSnapshot, fetchRemoteSnapshot, online])

  const pushLocalSnapshot = useCallback(async (
    userId: string,
    options: { skipRemoteCheck?: boolean } = {}
  ) => {
    if (!supabase || syncingRef.current) return false

    if (!online) {
      markLocalDirty(userId)
      setStatus('offline')
      setMessage('离线中，本地更改会在恢复联网后同步。')
      return false
    }

    syncingRef.current = true
    setStatus('syncing')
    setMessage('正在同步到云端...')

    try {
      syncingRef.current = false
      if (!options.skipRemoteCheck) {
        const remoteState = await reconcileRemoteBeforePush(userId, () =>
          pushLocalSnapshot(userId, { skipRemoteCheck: true })
        )
        if (remoteState !== 'continue') return remoteState === 'synced'
      }
      syncingRef.current = true

      const background = await ensureBackgroundUploaded(userId)
      const fingerprint = getLocalSnapshotFingerprint(background.path)

      if (fingerprint === lastPushedFingerprintRef.current) {
        const contentSynced = await syncContentIndex(userId)
        const meta = readSyncMeta()
        writeSyncMeta({ ...meta, localDirty: false, pendingSince: undefined, version: 2 })
        setStatus('ready')
        if (contentSynced) setMessage('云同步已是最新')
        return true
      }

      const { data, error } = await supabase
        .from('dashboard_snapshots')
        .upsert(
          {
            background_path: background.path,
            background_signature: background.signature,
            dashboard_state: getDashboardSnapshot(),
            updated_at: new Date().toISOString(),
            user_id: userId,
            widget_data: getWidgetDataSnapshot(),
          },
          { onConflict: 'user_id' }
        )
        .select()
        .single()

      if (error) throw error

      const row = data as DashboardSnapshotRow
      backgroundPathRef.current = row.background_path
      lastPushedFingerprintRef.current = getLocalSnapshotFingerprint(row.background_path)
      const contentSynced = await syncContentIndex(userId)
      setUpdatedAt(row.updated_at)
      setStatus('ready')
      if (contentSynced) setMessage('已同步到云端')
      writeSyncedMeta(userId, row)
      return true
    } catch (error) {
      markLocalDirty(userId)
      setStatus(isNetworkError(error) ? 'offline' : 'error')
      setMessage(isNetworkError(error) ? '网络不可用，本地更改已保留，恢复联网后会继续同步。' : getErrorMessage(error, '云同步失败'))
      return false
    } finally {
      syncingRef.current = false
    }
  }, [ensureBackgroundUploaded, online, reconcileRemoteBeforePush, syncContentIndex])

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

    if (!online) {
      syncReadyRef.current = false
      setStatus('offline')
      setMessage('离线中，本地数据仍可继续编辑。')
      return
    }

    const clientUser = user
    let cancelled = false

    async function bootstrap() {
      setStatus('checking')
      setMessage('正在检查云端数据...')

      try {
        const data = await fetchRemoteSnapshot(clientUser.id)
        if (cancelled) return

        const meta = readSyncMeta()
        if (data && hasLocalPersistedData() && meta.lastResolvedUserId !== clientUser.id) {
          setConflictState({ kind: 'initial', row: data })
          setStatus('conflict')
          setMessage('本机和云端都有数据，请选择保留哪一份。')
          return
        }

        if (data && meta.localDirty && !meta.baseSnapshot) {
          setConflictState({ kind: 'initial', row: data })
          setStatus('conflict')
          setMessage('本机和云端都有数据，请选择保留哪一份。')
          return
        }

        if (meta.lastResolvedUserId === clientUser.id && meta.baseSnapshot) {
          backgroundPathRef.current = meta.baseSnapshot.backgroundPath
        }

        if (
          data &&
          meta.baseSnapshot &&
          hasLocalChangesSinceBase(meta, backgroundPathRef.current) &&
          meta.remoteRevision &&
          getRemoteRevision(data) !== meta.remoteRevision
        ) {
          const merge = mergeDashboardSnapshots(
            meta.baseSnapshot,
            buildLocalSyncSnapshot(backgroundPathRef.current),
            buildRemoteSyncSnapshot(data)
          )

          if (merge.conflicts.length > 0) {
            setConflictState({ conflicts: merge.conflicts, kind: 'merge', row: data })
            setStatus('conflict')
            setMessage(`本机和云端有 ${merge.conflicts.length} 处冲突，请选择全部保留哪一边。`)
            return
          }

          const applied = await applyMergedSnapshot(merge.merged, merge.backgroundSource, data)
          if (!applied || cancelled) return
          const synced = await pushLocalSnapshot(clientUser.id, { skipRemoteCheck: true })
          if (!cancelled && synced) syncReadyRef.current = true
          return
        }

        const synced = data
          ? meta.baseSnapshot && hasLocalChangesSinceBase(meta, backgroundPathRef.current)
            ? await pushLocalSnapshot(clientUser.id, { skipRemoteCheck: true })
            : await applyCloudRow(data)
          : await pushLocalSnapshot(clientUser.id, { skipRemoteCheck: true })

        if (!cancelled && synced) syncReadyRef.current = true
      } catch (error) {
        if (cancelled) return
        setStatus(isNetworkError(error) ? 'offline' : 'error')
        setMessage(isNetworkError(error) ? '网络不可用，本地数据仍可继续编辑。' : getErrorMessage(error, '云同步检查失败'))
      }
    }

    void bootstrap()

    return () => {
      cancelled = true
      syncReadyRef.current = false
      if (syncTimerRef.current) window.clearTimeout(syncTimerRef.current)
    }
  }, [applyCloudRow, applyMergedSnapshot, fetchRemoteSnapshot, online, pushLocalSnapshot, user])

  useEffect(() => {
    if (!user) return

    const scheduleSync = () => {
      if (applyingCloudRef.current) return
      markLocalDirty(user.id)

      if (!online) {
        setStatus('offline')
        setMessage('离线中，本地更改会在恢复联网后同步。')
        return
      }

      if (!syncReadyRef.current) {
        setStatus('pending')
        setMessage('有本地更改等待同步。')
        return
      }

      setStatus('pending')
      setMessage('有本地更改等待同步。')
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
  }, [online, pushLocalSnapshot, user])

  const signIn = useCallback(async (email: string, password: string) => {
    if (!online) throw new Error('离线时无法登录，当前可继续使用本地模式。')
    if (!supabase) throw new Error('Supabase 未配置')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }, [online])

  const signUp = useCallback(async (email: string, password: string) => {
    if (!online) throw new Error('离线时无法创建账号，当前可继续使用本地模式。')
    if (!supabase) throw new Error('Supabase 未配置')
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) throw error
    if (!data.session) {
      toast.success('账号已创建，请按 Supabase 邮件提示完成确认后再登录。')
    }
  }, [online])

  const signOut = useCallback(async () => {
    if (!supabase) return
    if (online) {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
    }
    syncReadyRef.current = false
    setUser(null)
    setStatus('local')
    setMessage('已退出，当前使用本地模式')
  }, [online])

  const pushNow = useCallback(async () => {
    if (!user) return false
    return pushLocalSnapshot(user.id)
  }, [pushLocalSnapshot, user])

  const applyCloudVersion = useCallback(async () => {
    if (!conflictState || !user) return
    const synced = await applyCloudRow(conflictState.row)
    if (synced) {
      syncReadyRef.current = true
      setConflictState(null)
    }
  }, [applyCloudRow, conflictState, user])

  const uploadLocalVersion = useCallback(async () => {
    if (!user) return
    const synced = await pushLocalSnapshot(user.id, { skipRemoteCheck: true })
    if (synced) {
      syncReadyRef.current = true
      setConflictState(null)
    }
  }, [pushLocalSnapshot, user])

  const value = useMemo<CloudSyncContextValue>(() => ({
    configured: isSupabaseConfigured,
    message,
    online,
    pushNow,
    signIn,
    signOut,
    signUp,
    status,
    updatedAt,
    user,
  }), [message, online, pushNow, signIn, signOut, signUp, status, updatedAt, user])

  return (
    <CloudSyncContext.Provider value={value}>
      {children}
      {conflictState && (
        <CloudConflictDialog
          conflicts={conflictState.conflicts}
          kind={conflictState.kind}
          updatedAt={conflictState.row.updated_at}
          onExport={downloadLocalBackup}
          onUseCloud={() => void applyCloudVersion()}
          onUploadLocal={() => void uploadLocalVersion()}
        />
      )}
    </CloudSyncContext.Provider>
  )
}

function CloudConflictDialog({
  conflicts,
  kind,
  onExport,
  onUploadLocal,
  onUseCloud,
  updatedAt,
}: {
  conflicts?: SnapshotConflict[]
  kind: 'initial' | 'merge'
  onExport: () => void
  onUploadLocal: () => void
  onUseCloud: () => void
  updatedAt: string | null
}) {
  const conflictSummary = summarizeConflicts(conflicts)

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center px-4" style={{ background: 'rgba(61,52,42,0.24)' }}>
      <div
        className="w-full max-w-[440px] rounded-2xl p-5"
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
            {kind === 'merge' ? <AlertTriangle size={18} /> : <Database size={18} />}
          </div>
          <div className="min-w-0">
            <div style={{ fontSize: '16px', fontWeight: 650, color: 'var(--text)' }}>
              {kind === 'merge' ? '同步冲突' : '选择同步版本'}
            </div>
            <p style={{ marginTop: '6px', fontSize: '13px', color: 'var(--text-muted)', lineHeight: 1.6 }}>
              {kind === 'merge'
                ? `本机和云端修改了同一批数据${conflicts?.length ? `（${conflicts.length} 处）` : ''}。`
                : '本机和云端都有 Dashboard 数据。'}
              云端最后更新时间：{updatedAt ? new Date(updatedAt).toLocaleString() : '未知'}。
            </p>
            {conflictSummary && (
              <p style={{ marginTop: '6px', fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                冲突位置：{conflictSummary}{conflicts && conflicts.length > 4 ? ' 等' : ''}
              </p>
            )}
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-2">
          <button
            onClick={onUseCloud}
            className="flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold"
            style={{ background: 'var(--text)', color: 'white' }}
          >
            <Cloud size={15} />
            全部使用云端数据
          </button>
          <button
            onClick={onUploadLocal}
            className="flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold"
            style={{ background: 'var(--primary)', color: 'white' }}
          >
            <Upload size={15} />
            全部保留本机并覆盖云端
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
