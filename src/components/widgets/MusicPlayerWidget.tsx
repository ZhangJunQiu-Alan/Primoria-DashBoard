import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Disc3,
  ListMusic,
  LoaderCircle,
  LogIn,
  Pause,
  Play,
  Plus,
  Repeat,
  Shuffle,
  SkipBack,
  SkipForward,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { useCloudSync } from '@/components/cloud/cloudSyncContext'
import { useMusicUploader } from '@/hooks/useMusicUploader'
import { getCachedAudioUrl, prefetchAudio, revokeAudioObjectUrl } from '@/lib/audioCache'
import { summarizeText, trackBehaviorEvent } from '@/lib/behaviorEvents'
import { formatDuration, formatPlaybackTime, type MusicTrackRow } from '@/lib/musicLibrary'
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

  const tracks = useMusicStore((s) => s.tracks)
  const refresh = useMusicStore((s) => s.refresh)
  const reset = useMusicStore((s) => s.reset)
  const remove = useMusicStore((s) => s.remove)
  const resolveAudioUrl = useMusicStore((s) => s.resolveAudioUrl)
  const resolveCoverUrl = useMusicStore((s) => s.resolveCoverUrl)
  const currentTrackId = useMusicStore((s) => s.currentTrackByWidget[widgetId] ?? null)
  const setCurrentTrack = useMusicStore((s) => s.setCurrentTrack)

  const { handleFiles } = useMusicUploader()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [audio] = useState<HTMLAudioElement>(() => new Audio())

  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [coverUrl, setCoverUrl] = useState<string | null>(null)
  const [shuffleOn, setShuffleOn] = useState(false)
  const [repeatOn, setRepeatOn] = useState(false)
  const [showList, setShowList] = useState(false)

  const currentTrack = useMemo(
    () => tracks.find((t) => t.id === currentTrackId) ?? null,
    [tracks, currentTrackId]
  )
  const currentIndex = currentTrack ? tracks.findIndex((t) => t.id === currentTrack.id) : -1

  const vinylSize = useMemo(() => {
    if (width <= 0 || height <= 0) return 140
    const reservedForControls = 170
    const cap = Math.min(width * 0.7, Math.max(80, height - reservedForControls))
    return Math.max(80, Math.min(220, cap))
  }, [width, height])

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

  const playFlagRef = useRef(false)
  const lastLoadedTrackIdRef = useRef<string | null>(null)

  useEffect(() => {
    function onTime() { setCurrentTime(audio.currentTime) }
    function onMeta() { setDuration(Number.isFinite(audio.duration) ? audio.duration : 0) }
    function onPlay() {
      setIsPlaying(true)
      const track = tracks.find((item) => item.id === currentTrackId)
      trackBehaviorEvent({
        eventName: 'music.playback_started',
        metadata: { title: track ? summarizeText(track.title, 72) : null },
        objectId: currentTrackId,
        objectType: 'music_track',
        summary: track ? `播放音乐：${summarizeText(track.title, 72)}` : '播放音乐',
        surface: 'widget',
        widgetId,
        widgetType: 'music-player',
      })
    }
    function onPause() {
      setIsPlaying(false)
      const track = tracks.find((item) => item.id === currentTrackId)
      trackBehaviorEvent({
        eventName: 'music.playback_paused',
        metadata: {
          currentTimeSec: Math.round(audio.currentTime),
          title: track ? summarizeText(track.title, 72) : null,
        },
        objectId: currentTrackId,
        objectType: 'music_track',
        summary: track ? `暂停音乐：${summarizeText(track.title, 72)}` : '暂停音乐',
        surface: 'widget',
        widgetId,
        widgetType: 'music-player',
      })
    }
    function onEnded() {
      setIsPlaying(false)
      if (tracks.length === 0) return

      if (shuffleOn && tracks.length > 1) {
        let idx = Math.floor(Math.random() * tracks.length)
        if (tracks[idx].id === currentTrackId) idx = (idx + 1) % tracks.length
        setCurrentTrack(widgetId, tracks[idx].id)
         
        playFlagRef.current = true
        return
      }

      const idx = tracks.findIndex((t) => t.id === currentTrackId)
      if (idx < 0) return

      if (idx < tracks.length - 1) {
        setCurrentTrack(widgetId, tracks[idx + 1].id)
         
        playFlagRef.current = true
      } else if (repeatOn) {
        setCurrentTrack(widgetId, tracks[0].id)
         
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
  }, [audio, tracks, currentTrackId, widgetId, setCurrentTrack, shuffleOn, repeatOn])

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
       
      playFlagRef.current = true
      return
    }
    if (audio.paused) audio.play().catch(() => {})
    else audio.pause()
  }, [audio, currentTrack, tracks, widgetId, setCurrentTrack])

  const skipPrev = useCallback(() => {
    if (currentIndex < 0 || tracks.length === 0) return
    let next: MusicTrackRow
    if (shuffleOn && tracks.length > 1) {
      let idx = Math.floor(Math.random() * tracks.length)
      if (tracks[idx].id === currentTrack?.id) idx = (idx + 1) % tracks.length
      next = tracks[idx]
    } else {
      next = tracks[(currentIndex - 1 + tracks.length) % tracks.length]
    }
    setCurrentTrack(widgetId, next.id)
     
    playFlagRef.current = true
  }, [currentIndex, tracks, widgetId, setCurrentTrack, shuffleOn, currentTrack])

  const skipNext = useCallback(() => {
    if (currentIndex < 0 || tracks.length === 0) return
    let next: MusicTrackRow
    if (shuffleOn && tracks.length > 1) {
      let idx = Math.floor(Math.random() * tracks.length)
      if (tracks[idx].id === currentTrack?.id) idx = (idx + 1) % tracks.length
      next = tracks[idx]
    } else {
      next = tracks[(currentIndex + 1) % tracks.length]
    }
    setCurrentTrack(widgetId, next.id)
     
    playFlagRef.current = true
  }, [currentIndex, tracks, widgetId, setCurrentTrack, shuffleOn, currentTrack])

  function onSeek(e: React.ChangeEvent<HTMLInputElement>) {
    const v = Number(e.target.value)
    // eslint-disable-next-line react-hooks/immutability
    audio.currentTime = v
    setCurrentTime(v)
  }

  const playTrackFromList = useCallback((trackId: string) => {
    if (currentTrackId === trackId) {
      if (audio.paused) audio.play().catch(() => {})
      else audio.pause()
      return
    }
    setCurrentTrack(widgetId, trackId)
     
    playFlagRef.current = true
  }, [audio, currentTrackId, widgetId, setCurrentTrack])

  if (!user) {
    return (
      <div ref={ref} className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <RecordVisual size={Math.min(140, vinylSize)} spinning={false} coverUrl={null} title={null} artist={null} />
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

  const disabled = tracks.length === 0
  const playSize = Math.max(36, Math.min(48, vinylSize * 0.24))

  return (
    <div ref={ref} className="relative flex h-full flex-col min-h-0">
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*,.mp3,.m4a,.flac,.ogg,.opus,.wav"
        multiple
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files)
          e.target.value = ''
        }}
      />

      {/* Vinyl */}
      <div className="flex flex-1 items-center justify-center min-h-0" style={{ paddingBottom: '6px' }}>
        <RecordVisual
          size={vinylSize}
          spinning={isPlaying}
          coverUrl={coverUrl}
          title={currentTrack?.title ?? null}
          artist={currentTrack?.artist ?? null}
        />
      </div>

      {/* Gold notch */}
      <div className="flex justify-center" style={{ paddingBottom: '10px' }}>
        <div style={{ width: '24px', height: '3px', borderRadius: '999px', background: 'var(--secondary)' }} />
      </div>

      {/* Title + artist */}
      <div className="flex items-baseline gap-2 px-1 min-w-0" style={{ paddingBottom: '6px' }}>
        <span
          style={{
            fontSize: '15px',
            fontWeight: 700,
            color: 'var(--text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: '60%',
          }}
          title={currentTrack?.title ?? undefined}
        >
          {currentTrack?.title ?? (disabled ? '音乐库为空' : '未选择歌曲')}
        </span>
        <span
          style={{
            fontSize: '12px',
            color: 'var(--text-muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: '1 1 auto',
          }}
          title={currentTrack?.artist ?? undefined}
        >
          {currentTrack?.artist ?? (disabled ? '请从顶栏「上传音乐」' : '—')}
        </span>
      </div>

      {/* Progress */}
      <div className="px-1" style={{ paddingBottom: '6px' }}>
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
        <div className="flex items-center justify-between" style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
          <span>{formatPlaybackTime(currentTime)}</span>
          <span>{formatPlaybackTime(duration)}</span>
        </div>
      </div>

      {/* Five-button transport row */}
      <div className="flex items-center justify-between px-2" style={{ paddingBottom: '8px' }}>
        <ControlButton
          active={shuffleOn}
          onClick={() => setShuffleOn((v) => !v)}
          title={shuffleOn ? '关闭随机' : '随机播放'}
        >
          <Shuffle size={16} />
        </ControlButton>
        <ControlButton onClick={skipPrev} disabled={disabled} title="上一首">
          <SkipBack size={20} />
        </ControlButton>
        <button
          onClick={togglePlay}
          disabled={disabled}
          className="rounded-full transition disabled:opacity-30"
          style={{
            background: 'var(--primary)',
            color: '#fff',
            width: `${playSize}px`,
            height: `${playSize}px`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 10px rgba(92,125,96,0.35)',
          }}
          title={isPlaying ? '暂停' : '播放'}
        >
          {isPlaying ? <Pause size={Math.round(playSize * 0.42)} /> : <Play size={Math.round(playSize * 0.42)} style={{ marginLeft: '2px' }} />}
        </button>
        <ControlButton onClick={skipNext} disabled={disabled} title="下一首">
          <SkipForward size={20} />
        </ControlButton>
        <ControlButton
          active={repeatOn}
          onClick={() => setRepeatOn((v) => !v)}
          title={repeatOn ? '关闭循环' : '列表循环'}
        >
          <Repeat size={16} />
        </ControlButton>
      </div>

      {/* Bottom row: list + add */}
      <div className="flex items-center justify-between px-2">
        <ControlButton
          active={showList}
          onClick={() => setShowList((v) => !v)}
          title="歌曲列表"
        >
          <ListMusic size={16} />
        </ControlButton>
        <ControlButton onClick={() => fileInputRef.current?.click()} title="上传 MP3">
          <Plus size={16} />
        </ControlButton>
      </div>

      {/* Track list overlay */}
      {showList && (
        <TrackListOverlay
          tracks={tracks}
          currentTrackId={currentTrackId}
          isPlaying={isPlaying}
          onClose={() => setShowList(false)}
          onPlay={(id) => playTrackFromList(id)}
          onRemove={async (track) => {
            try { await remove(track) }
            catch (err) { toast.error(err instanceof Error ? err.message : '删除失败') }
          }}
        />
      )}
    </div>
  )
}

function ControlButton({
  active = false, disabled = false, onClick, title, children,
}: {
  active?: boolean
  disabled?: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="btn-icon-hover rounded-lg p-1.5 transition disabled:opacity-30"
      style={{
        color: active ? 'var(--primary-dark)' : 'var(--text-sub)',
      }}
      title={title}
    >
      {children}
    </button>
  )
}

function TrackListOverlay({
  tracks, currentTrackId, isPlaying, onClose, onPlay, onRemove,
}: {
  tracks: MusicTrackRow[]
  currentTrackId: string | null
  isPlaying: boolean
  onClose: () => void
  onPlay: (id: string) => void
  onRemove: (track: MusicTrackRow) => void | Promise<void>
}) {
  return (
    <div
      className="absolute inset-0 z-10 flex flex-col"
      style={{
        background: 'rgba(254,250,245,0.97)',
        backdropFilter: 'blur(6px)',
        borderRadius: 'inherit',
      }}
    >
      <div
        className="flex items-center justify-between px-3"
        style={{
          paddingTop: '8px',
          paddingBottom: '8px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div style={{ fontSize: '12px', color: 'var(--text-sub)', fontWeight: 600, letterSpacing: '0.08em' }}>
          歌曲列表 · {tracks.length}
        </div>
        <button
          onClick={onClose}
          className="btn-icon-hover rounded-lg p-1 transition"
          style={{ color: 'var(--text-sub)' }}
          title="关闭"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto py-1">
        {tracks.length === 0 ? (
          <div className="flex h-full items-center justify-center px-4 text-center" style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
            音乐库为空
          </div>
        ) : (
          tracks.map((track) => {
            const isCurrent = track.id === currentTrackId
            return (
              <div
                key={track.id}
                className="group flex items-center gap-2 px-2 py-1.5 transition"
                style={{
                  background: isCurrent ? 'var(--bg-hover)' : undefined,
                  borderLeft: isCurrent ? '2px solid var(--primary)' : '2px solid transparent',
                }}
                onMouseEnter={(e) => { if (!isCurrent) e.currentTarget.style.background = 'var(--bg-muted)' }}
                onMouseLeave={(e) => { if (!isCurrent) e.currentTarget.style.background = '' }}
              >
                <button onClick={() => onPlay(track.id)} className="flex flex-1 min-w-0 items-center gap-2 text-left">
                  <div
                    className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full"
                    style={{
                      background: isCurrent ? 'var(--primary)' : 'var(--bg-icon)',
                      color: isCurrent ? '#fff' : 'var(--text-sub)',
                    }}
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
                  onClick={() => onRemove(track)}
                  className="opacity-0 group-hover:opacity-100 transition"
                  style={{ color: 'var(--text-muted)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = '#C4807A')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
                  title="删除"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

function RecordVisual({
  size, spinning, coverUrl, title, artist,
}: {
  size: number
  spinning: boolean
  coverUrl: string | null
  title: string | null
  artist: string | null
}) {
  const labelSize = Math.round(size * 0.42)
  return (
    <div className="relative flex flex-shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <div
        className={`music-vinyl${spinning ? ' music-vinyl--spinning' : ''}`}
        style={{ width: size, height: size }}
      >
        <div
          className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center overflow-hidden rounded-full"
          style={{
            width: labelSize,
            height: labelSize,
            background: coverUrl
              ? `url(${coverUrl}) center/cover no-repeat`
              : 'linear-gradient(180deg, #DCC57A, #A28B4C)',
            boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.2)',
          }}
        >
          {!coverUrl && (
            title || artist ? (
              <div
                className="flex flex-col items-center justify-center text-center px-1"
                style={{ width: '100%', height: '100%', color: '#17110B' }}
              >
                {title && (
                  <div
                    style={{
                      fontSize: `${Math.max(8, Math.round(labelSize * 0.13))}px`,
                      fontWeight: 700,
                      lineHeight: 1.15,
                      maxWidth: '92%',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {title}
                  </div>
                )}
                <div
                  style={{
                    width: '40%',
                    height: '1px',
                    background: '#17110B',
                    opacity: 0.55,
                    margin: '4px 0',
                  }}
                />
                {artist && (
                  <div
                    style={{
                      fontSize: `${Math.max(7, Math.round(labelSize * 0.1))}px`,
                      lineHeight: 1.15,
                      maxWidth: '92%',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {artist}
                  </div>
                )}
              </div>
            ) : (
              <Disc3 size={Math.round(size * 0.22)} style={{ color: '#17110B' }} />
            )
          )}
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
