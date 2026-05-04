import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Disc3,
  LoaderCircle,
  LogIn,
  Music2,
  Pause,
  Play,
  Plus,
  SkipBack,
  SkipForward,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { useCloudSync } from '@/components/cloud/cloudSyncContext'
import {
  formatDuration,
  formatPlaybackTime,
  isSupportedAudioFile,
  MAX_TRACK_BYTES,
  parseTrackMetadata,
  STORAGE_QUOTA_BYTES,
  type MusicTrackRow,
} from '@/lib/musicLibrary'
import { useMusicStore } from '@/store/musicStore'

interface MusicPlayerWidgetProps {
  widgetId: string
}

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ob = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize({ width, height })
    })
    ob.observe(el)
    const r = el.getBoundingClientRect()
    setSize({ width: r.width, height: r.height })
    return () => ob.disconnect()
  }, [])
  return { ref, ...size }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export function MusicPlayerWidget({ widgetId }: MusicPlayerWidgetProps) {
  const { user, signIn } = useCloudSync()
  const { ref, width, height } = useElementSize<HTMLDivElement>()
  const compact = width > 0 && (width < 320 || height < 220)

  const tracks = useMusicStore((s) => s.tracks)
  const loaded = useMusicStore((s) => s.loaded)
  const loading = useMusicStore((s) => s.loading)
  const loadError = useMusicStore((s) => s.loadError)
  const usageBytes = useMusicStore((s) => s.usageBytes)
  const refresh = useMusicStore((s) => s.refresh)
  const reset = useMusicStore((s) => s.reset)
  const upload = useMusicStore((s) => s.upload)
  const remove = useMusicStore((s) => s.remove)
  const resolveAudioUrl = useMusicStore((s) => s.resolveAudioUrl)
  const resolveCoverUrl = useMusicStore((s) => s.resolveCoverUrl)
  const currentTrackId = useMusicStore((s) => s.currentTrackByWidget[widgetId] ?? null)
  const setCurrentTrack = useMusicStore((s) => s.setCurrentTrack)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  if (!audioRef.current) audioRef.current = new Audio()
  const audio = audioRef.current

  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [coverUrl, setCoverUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const currentTrack = useMemo(
    () => tracks.find((t) => t.id === currentTrackId) ?? null,
    [tracks, currentTrackId]
  )
  const currentIndex = currentTrack ? tracks.findIndex((t) => t.id === currentTrack.id) : -1

  useEffect(() => {
    if (!user) {
      reset()
      return
    }
    refresh(user.id)
  }, [user, refresh, reset])

  useEffect(() => {
    return () => {
      audio.pause()
      audio.src = ''
    }
  }, [audio])

  useEffect(() => {
    function onTime() { setCurrentTime(audio.currentTime) }
    function onMeta() { setDuration(Number.isFinite(audio.duration) ? audio.duration : 0) }
    function onPlay() { setIsPlaying(true) }
    function onPause() { setIsPlaying(false) }
    function onEnded() {
      setIsPlaying(false)
      const idx = tracks.findIndex((t) => t.id === currentTrackId)
      if (idx >= 0 && idx < tracks.length - 1) {
        setCurrentTrack(widgetId, tracks[idx + 1].id)
        playFlagRef.current = true
      }
    }
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('loadedmetadata', onMeta)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onEnded)
    return () => {
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('loadedmetadata', onMeta)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onEnded)
    }
  }, [audio, tracks, currentTrackId, widgetId, setCurrentTrack])

  const playFlagRef = useRef(false)
  const lastLoadedTrackIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!currentTrack) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      setCurrentTime(0)
      setDuration(0)
      setCoverUrl(null)
      lastLoadedTrackIdRef.current = null
      return
    }

    if (lastLoadedTrackIdRef.current === currentTrack.id) return
    lastLoadedTrackIdRef.current = currentTrack.id

    let cancelled = false
    setCurrentTime(0)
    setDuration(0)

    resolveAudioUrl(currentTrack)
      .then((url) => {
        if (cancelled) return
        audio.src = url
        audio.load()
        if (playFlagRef.current) {
          playFlagRef.current = false
          audio.play().catch(() => {})
        }
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : '播放地址获取失败'
        toast.error(msg)
      })

    setCoverUrl(null)
    if (currentTrack.cover_path) {
      resolveCoverUrl(currentTrack)
        .then((url) => { if (!cancelled) setCoverUrl(url) })
        .catch(() => {})
    }

    return () => { cancelled = true }
  }, [currentTrack, audio, resolveAudioUrl, resolveCoverUrl])

  const togglePlay = useCallback(() => {
    if (!currentTrack && tracks.length > 0) {
      setCurrentTrack(widgetId, tracks[0].id)
      playFlagRef.current = true
      return
    }
    if (audio.paused) audio.play().catch(() => {})
    else audio.pause()
  }, [audio, currentTrack, tracks, widgetId, setCurrentTrack])

  const playTrack = useCallback((trackId: string) => {
    if (currentTrackId === trackId) {
      if (audio.paused) audio.play().catch(() => {})
      else audio.pause()
      return
    }
    setCurrentTrack(widgetId, trackId)
    playFlagRef.current = true
  }, [audio, currentTrackId, widgetId, setCurrentTrack])

  const skipPrev = useCallback(() => {
    if (currentIndex < 0 || tracks.length === 0) return
    const prev = tracks[(currentIndex - 1 + tracks.length) % tracks.length]
    setCurrentTrack(widgetId, prev.id)
    playFlagRef.current = true
  }, [currentIndex, tracks, widgetId, setCurrentTrack])

  const skipNext = useCallback(() => {
    if (currentIndex < 0 || tracks.length === 0) return
    const next = tracks[(currentIndex + 1) % tracks.length]
    setCurrentTrack(widgetId, next.id)
    playFlagRef.current = true
  }, [currentIndex, tracks, widgetId, setCurrentTrack])

  function onSeek(e: React.ChangeEvent<HTMLInputElement>) {
    const v = Number(e.target.value)
    audio.currentTime = v
    setCurrentTime(v)
  }

  async function onUploadFiles(files: FileList | null) {
    if (!user || !files || files.length === 0) return

    const valid: File[] = []
    let pendingBytes = 0
    for (const file of Array.from(files)) {
      if (!isSupportedAudioFile(file)) {
        toast.error(`${file.name}：不是受支持的音频格式`)
        continue
      }
      if (file.size > MAX_TRACK_BYTES) {
        toast.error(`${file.name}：超过 30MB 单文件上限`)
        continue
      }
      pendingBytes += file.size
      valid.push(file)
    }

    if (valid.length === 0) return

    if (usageBytes + pendingBytes > STORAGE_QUOTA_BYTES) {
      toast.error('存储不足，请先删除部分歌曲')
      return
    }

    setUploading(true)
    setUploadProgress({ done: 0, total: valid.length })

    try {
      for (let i = 0; i < valid.length; i++) {
        const file = valid[i]
        try {
          const metadata = await parseTrackMetadata(file)
          await upload(user.id, file, metadata)
        } catch (err) {
          const msg = err instanceof Error ? err.message : '上传失败'
          toast.error(`${file.name}：${msg}`)
        }
        setUploadProgress({ done: i + 1, total: valid.length })
      }
      toast.success(`已上传 ${valid.length} 首`)
    } finally {
      setUploading(false)
      setUploadProgress(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function onRemoveTrack(track: MusicTrackRow) {
    try {
      await remove(track)
    } catch (err) {
      const msg = err instanceof Error ? err.message : '删除失败'
      toast.error(msg)
    }
  }

  if (!user) {
    return (
      <div ref={ref} className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <RecordVisual compact={compact} spinning={false} coverUrl={null} />
        <div style={{ fontSize: '13px', color: 'var(--text-sub)', lineHeight: 1.6, maxWidth: '85%' }}>
          请先登录账号，把 MP3 同步到云端音乐库
        </div>
        <LoginInline onSubmit={async (email, password) => {
          try {
            await signIn(email, password)
          } catch (err) {
            toast.error(err instanceof Error ? err.message : '登录失败')
          }
        }} />
      </div>
    )
  }

  return (
    <div ref={ref} className="flex h-full flex-col gap-2 min-h-0">
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*,.mp3,.m4a,.flac,.ogg,.opus,.wav"
        multiple
        className="hidden"
        onChange={(e) => onUploadFiles(e.target.files)}
      />

      <div className={`flex min-h-0 ${compact ? 'gap-2' : 'gap-3'}`}>
        <RecordVisual compact={compact} spinning={isPlaying} coverUrl={coverUrl} />
        <div className="min-w-0 flex flex-1 flex-col justify-between" style={{ gap: '4px' }}>
          <div className="min-w-0">
            <div
              style={{
                fontSize: compact ? '14px' : '15px',
                fontWeight: 650,
                color: 'var(--text)',
                lineHeight: 1.2,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={currentTrack?.title}
            >
              {currentTrack?.title ?? '未选择歌曲'}
            </div>
            <div
              style={{
                fontSize: '11px',
                color: 'var(--text-muted)',
                marginTop: '3px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={currentTrack?.artist ?? undefined}
            >
              {currentTrack?.artist ?? '—'}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <input
              type="range"
              min={0}
              max={duration > 0 ? duration : 0}
              value={Math.min(currentTime, duration || 0)}
              step={0.5}
              onChange={onSeek}
              disabled={!currentTrack || duration === 0}
              style={{ width: '100%', accentColor: 'var(--primary)' }}
            />
            <div className="flex items-center justify-between" style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
              <span>{formatPlaybackTime(currentTime)}</span>
              <span>{formatPlaybackTime(duration)}</span>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <button
                onClick={skipPrev}
                disabled={tracks.length === 0}
                className="btn-icon-hover rounded-lg p-1.5 transition disabled:opacity-30"
                style={{ color: 'var(--text-sub)' }}
                title="上一首"
              >
                <SkipBack size={14} />
              </button>
              <button
                onClick={togglePlay}
                disabled={tracks.length === 0}
                className="rounded-full p-2 transition disabled:opacity-30"
                style={{ background: 'var(--primary)', color: '#fff' }}
                title={isPlaying ? '暂停' : '播放'}
              >
                {isPlaying ? <Pause size={14} /> : <Play size={14} />}
              </button>
              <button
                onClick={skipNext}
                disabled={tracks.length === 0}
                className="btn-icon-hover rounded-lg p-1.5 transition disabled:opacity-30"
                style={{ color: 'var(--text-sub)' }}
                title="下一首"
              >
                <SkipForward size={14} />
              </button>
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="btn-icon-hover rounded-lg p-1.5 transition disabled:opacity-50"
              style={{ color: 'var(--text-sub)' }}
              title="上传 MP3"
            >
              {uploading ? <LoaderCircle size={14} className="animate-spin" /> : <Plus size={14} />}
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto rounded-lg" style={{ borderTop: '1px solid var(--border)' }}>
        {!loaded && loading && (
          <div className="flex h-full items-center justify-center" style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
            <LoaderCircle size={14} className="animate-spin" />
            <span style={{ marginLeft: '6px' }}>加载音乐库…</span>
          </div>
        )}
        {loaded && loadError && (
          <div className="flex h-full items-center justify-center px-3 text-center" style={{ color: '#C4807A', fontSize: '11px' }}>
            {loadError}
          </div>
        )}
        {loaded && !loadError && tracks.length === 0 && (
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex h-full w-full flex-col items-center justify-center gap-1.5 px-4 text-center transition btn-icon-hover"
            style={{ color: 'var(--text-muted)', fontSize: '12px' }}
          >
            <Music2 size={18} />
            <span>点击上传 MP3 文件</span>
            <span style={{ fontSize: '10px' }}>支持多选，单文件 ≤ 30MB</span>
          </button>
        )}
        {loaded && tracks.length > 0 && (
          <div className="flex flex-col py-1">
            {tracks.map((track) => (
              <TrackRow
                key={track.id}
                track={track}
                isCurrent={track.id === currentTrackId}
                isPlaying={isPlaying && track.id === currentTrackId}
                onPlay={() => playTrack(track.id)}
                onRemove={() => onRemoveTrack(track)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between flex-shrink-0" style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
        {uploadProgress ? (
          <span>上传中 {uploadProgress.done}/{uploadProgress.total}</span>
        ) : (
          <span>{formatBytes(usageBytes)} / {formatBytes(STORAGE_QUOTA_BYTES)}</span>
        )}
        <UsageBar used={usageBytes} total={STORAGE_QUOTA_BYTES} />
      </div>
    </div>
  )
}

function UsageBar({ used, total }: { used: number; total: number }) {
  const pct = Math.min(100, Math.round((used / total) * 100))
  const color = pct >= 100 ? '#C4807A' : pct >= 80 ? 'var(--secondary)' : 'var(--primary)'
  return (
    <div style={{ flex: '0 0 80px', height: '4px', background: 'var(--bg-muted)', borderRadius: '999px', overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, transition: 'width 0.3s' }} />
    </div>
  )
}

function TrackRow({
  track, isCurrent, isPlaying, onPlay, onRemove,
}: {
  track: MusicTrackRow
  isCurrent: boolean
  isPlaying: boolean
  onPlay: () => void
  onRemove: () => void
}) {
  return (
    <div
      className="group flex items-center gap-2 px-2 py-1.5 transition"
      style={{
        background: isCurrent ? 'var(--bg-hover)' : undefined,
        borderLeft: isCurrent ? '2px solid var(--primary)' : '2px solid transparent',
      }}
      onMouseEnter={(e) => { if (!isCurrent) e.currentTarget.style.background = 'var(--bg-muted)' }}
      onMouseLeave={(e) => { if (!isCurrent) e.currentTarget.style.background = '' }}
    >
      <button onClick={onPlay} className="flex flex-1 min-w-0 items-center gap-2 text-left">
        <div
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full"
          style={{ background: isCurrent ? 'var(--primary)' : 'var(--bg-icon)', color: isCurrent ? '#fff' : 'var(--text-sub)' }}
        >
          {isCurrent && isPlaying ? <Pause size={10} /> : <Play size={10} />}
        </div>
        <div className="min-w-0 flex-1">
          <div
            style={{
              fontSize: '12px',
              color: 'var(--text)',
              fontWeight: isCurrent ? 600 : 400,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={track.title}
          >
            {track.title}
          </div>
          {track.artist && (
            <div
              style={{
                fontSize: '10px',
                color: 'var(--text-muted)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={track.artist}
            >
              {track.artist}
            </div>
          )}
        </div>
        <span style={{ fontSize: '10px', color: 'var(--text-muted)', flexShrink: 0 }}>
          {formatDuration(track.duration_ms)}
        </span>
      </button>
      <button
        onClick={onRemove}
        className="opacity-0 group-hover:opacity-100 transition"
        style={{ color: 'var(--text-muted)' }}
        onMouseEnter={(e) => (e.currentTarget.style.color = '#C4807A')}
        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
        title="删除"
      >
        <Trash2 size={11} />
      </button>
    </div>
  )
}

function RecordVisual({
  compact, spinning, coverUrl,
}: {
  compact: boolean
  spinning: boolean
  coverUrl: string | null
}) {
  const size = compact ? 76 : 130
  return (
    <div className="relative flex flex-shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <div
        className={`music-vinyl${spinning ? ' music-vinyl--spinning' : ''}`}
        style={{ width: size, height: size }}
      >
        <div
          className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center overflow-hidden rounded-full"
          style={{
            width: Math.round(size * 0.42),
            height: Math.round(size * 0.42),
            background: coverUrl
              ? `url(${coverUrl}) center/cover no-repeat`
              : 'linear-gradient(180deg, #DCC57A, #A28B4C)',
            boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.2)',
          }}
        >
          {!coverUrl && <Disc3 size={Math.round(size * 0.22)} style={{ color: '#17110B' }} />}
        </div>
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            width: Math.max(6, Math.round(size * 0.05)),
            height: Math.max(6, Math.round(size * 0.05)),
            background: '#14110D',
            boxShadow: '0 0 0 1px rgba(255,255,255,0.3)',
          }}
        />
      </div>
    </div>
  )
}

function LoginInline({ onSubmit }: { onSubmit: (email: string, password: string) => Promise<void> }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        if (busy) return
        setBusy(true)
        try { await onSubmit(email, password) }
        finally { setBusy(false) }
      }}
      className="flex w-full max-w-[240px] flex-col gap-1.5"
    >
      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        type="email"
        placeholder="邮箱"
        autoComplete="email"
        className="rounded-lg px-2.5 py-1.5 outline-none"
        style={{ fontSize: '12px', background: 'var(--bg-muted)', border: '1px solid var(--border)', color: 'var(--text)' }}
        required
      />
      <input
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        type="password"
        placeholder="密码"
        autoComplete="current-password"
        className="rounded-lg px-2.5 py-1.5 outline-none"
        style={{ fontSize: '12px', background: 'var(--bg-muted)', border: '1px solid var(--border)', color: 'var(--text)' }}
        required
      />
      <button
        type="submit"
        disabled={busy}
        className="flex items-center justify-center gap-1.5 rounded-lg py-1.5 transition disabled:opacity-50"
        style={{ background: 'var(--primary)', color: '#fff', fontSize: '12px', fontWeight: 600 }}
      >
        {busy ? <LoaderCircle size={12} className="animate-spin" /> : <LogIn size={12} />}
        登录
      </button>
    </form>
  )
}
