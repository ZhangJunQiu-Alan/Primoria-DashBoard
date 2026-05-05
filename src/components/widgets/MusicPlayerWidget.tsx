import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Disc3, LoaderCircle, LogIn, Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { toast } from 'sonner'
import { useCloudSync } from '@/components/cloud/cloudSyncContext'
import { getCachedAudioUrl, prefetchAudio, revokeAudioObjectUrl } from '@/lib/audioCache'
import { formatPlaybackTime } from '@/lib/musicLibrary'
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

export function MusicPlayerWidget({ widgetId }: MusicPlayerWidgetProps) {
  const { user, signIn } = useCloudSync()
  const { ref, width, height } = useElementSize<HTMLDivElement>()
  const compact = width > 0 && (width < 320 || height < 220)

  const tracks = useMusicStore((s) => s.tracks)
  const refresh = useMusicStore((s) => s.refresh)
  const reset = useMusicStore((s) => s.reset)
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

  const currentObjectUrlRef = useRef<string | null>(null)

  useEffect(() => {
    return () => {
      audio.pause()
      audio.src = ''
      revokeAudioObjectUrl(currentObjectUrlRef.current)
      currentObjectUrlRef.current = null
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
      revokeAudioObjectUrl(currentObjectUrlRef.current)
      currentObjectUrlRef.current = null
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

    const trackForFactory = currentTrack
    getCachedAudioUrl(currentTrack.audio_path, () => resolveAudioUrl(trackForFactory))
      .then((url) => {
        if (cancelled) {
          revokeAudioObjectUrl(url)
          return
        }
        revokeAudioObjectUrl(currentObjectUrlRef.current)
        currentObjectUrlRef.current = url
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

  // Prefetch next track once audio is decoded enough to play, so skip-next is instant.
  useEffect(() => {
    if (!currentTrack || tracks.length < 2) return
    const idx = tracks.findIndex((t) => t.id === currentTrack.id)
    if (idx < 0) return
    const next = tracks[(idx + 1) % tracks.length]
    if (!next || next.id === currentTrack.id) return

    let cancelled = false
    function schedule() {
      if (cancelled) return
      prefetchAudio(next.audio_path, () => resolveAudioUrl(next))
    }
    if (audio.readyState >= 3) {
      schedule()
    } else {
      const handler = () => schedule()
      audio.addEventListener('canplay', handler, { once: true })
      return () => {
        cancelled = true
        audio.removeEventListener('canplay', handler)
      }
    }
    return () => { cancelled = true }
  }, [currentTrack, tracks, audio, resolveAudioUrl])

  const togglePlay = useCallback(() => {
    if (!currentTrack && tracks.length > 0) {
      setCurrentTrack(widgetId, tracks[0].id)
      // eslint-disable-next-line react-hooks/immutability
      playFlagRef.current = true
      return
    }
    if (audio.paused) audio.play().catch(() => {})
    else audio.pause()
  }, [audio, currentTrack, tracks, widgetId, setCurrentTrack])

  const skipPrev = useCallback(() => {
    if (currentIndex < 0 || tracks.length === 0) return
    const prev = tracks[(currentIndex - 1 + tracks.length) % tracks.length]
    setCurrentTrack(widgetId, prev.id)
    // eslint-disable-next-line react-hooks/immutability
    playFlagRef.current = true
  }, [currentIndex, tracks, widgetId, setCurrentTrack])

  const skipNext = useCallback(() => {
    if (currentIndex < 0 || tracks.length === 0) return
    const next = tracks[(currentIndex + 1) % tracks.length]
    setCurrentTrack(widgetId, next.id)
    // eslint-disable-next-line react-hooks/immutability
    playFlagRef.current = true
  }, [currentIndex, tracks, widgetId, setCurrentTrack])

  function onSeek(e: React.ChangeEvent<HTMLInputElement>) {
    const v = Number(e.target.value)
    audio.currentTime = v
    setCurrentTime(v)
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
    <div ref={ref} className="flex h-full flex-col min-h-0 justify-center">
      <div className={`flex min-h-0 ${compact ? 'gap-2' : 'gap-3'}`}>
        <RecordVisual compact={compact} spinning={isPlaying} coverUrl={coverUrl} />
        <div className="min-w-0 flex flex-1 flex-col justify-center" style={{ gap: '8px' }}>
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
              {currentTrack?.title ?? (tracks.length === 0 ? '音乐库为空' : '未选择歌曲')}
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
              {currentTrack?.artist ?? (tracks.length === 0 ? '请从顶栏「上传音乐」添加 MP3' : '—')}
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
        </div>
      </div>
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
