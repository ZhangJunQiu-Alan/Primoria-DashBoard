import { useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import {
  Disc3,
  Heart,
  LoaderCircle,
  LogIn,
  LogOut,
  Pause,
  Play,
  RefreshCw,
  ScanLine,
  ShieldAlert,
  SkipBack,
  SkipForward,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatDuration, formatPlaybackTime } from '@/lib/netease'
import { useNetEaseStore } from '@/store/neteaseStore'

interface MusicPlayerWidgetProps {
  widgetId: string
}

let sharedAudio: HTMLAudioElement | null = null

function getSharedAudio() {
  if (!sharedAudio) {
    sharedAudio = new Audio()
    sharedAudio.preload = 'none'
  }

  return sharedAudio
}

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize({ width, height })
    })

    observer.observe(element)
    const rect = element.getBoundingClientRect()
    setSize({ width: rect.width, height: rect.height })

    return () => observer.disconnect()
  }, [])

  return { ref, ...size }
}

function buildAttemptOrder(startIndex: number, direction: 1 | -1, total: number) {
  const order: number[] = []
  for (let offset = 0; offset < total; offset += 1) {
    order.push((startIndex + direction * offset + total * 8) % total)
  }
  return order
}

export function MusicPlayerWidget({ widgetId }: MusicPlayerWidgetProps) {
  void widgetId

  const status = useNetEaseStore((s) => s.status)
  const initialized = useNetEaseStore((s) => s.initialized)
  const restoring = useNetEaseStore((s) => s.restoring)
  const startingLogin = useNetEaseStore((s) => s.startingLogin)
  const pollingLogin = useNetEaseStore((s) => s.pollingLogin)
  const tracksLoading = useNetEaseStore((s) => s.tracksLoading)
  const message = useNetEaseStore((s) => s.message)
  const qrKey = useNetEaseStore((s) => s.qrKey)
  const qrLoginUrl = useNetEaseStore((s) => s.qrLoginUrl)
  const profile = useNetEaseStore((s) => s.profile)
  const likedPlaylist = useNetEaseStore((s) => s.likedPlaylist)
  const tracks = useNetEaseStore((s) => s.tracks)
  const currentTrackId = useNetEaseStore((s) => s.currentTrackId)
  const restoreSession = useNetEaseStore((s) => s.restoreSession)
  const startQrLogin = useNetEaseStore((s) => s.startQrLogin)
  const pollQrLogin = useNetEaseStore((s) => s.pollQrLogin)
  const loadLikedTracks = useNetEaseStore((s) => s.loadLikedTracks)
  const resolveSongSource = useNetEaseStore((s) => s.resolveSongSource)
  const selectTrackByIndex = useNetEaseStore((s) => s.selectTrackByIndex)
  const logout = useNetEaseStore((s) => s.logout)

  const { ref, width, height } = useElementSize<HTMLDivElement>()
  const compact = width > 0 && (width < 290 || height < 205)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const nextTrackRef = useRef<() => Promise<void>>(async () => {})
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [playbackBusy, setPlaybackBusy] = useState(false)
  const [playbackError, setPlaybackError] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [loadedTrackId, setLoadedTrackId] = useState<number | null>(null)

  const currentTrackIndex = tracks.findIndex((track) => track.id === currentTrackId)
  const activeTrack =
    tracks[currentTrackIndex] ??
    (currentTrackId ? tracks.find((track) => track.id === currentTrackId) : null) ??
    tracks[0] ??
    null

  const displayDuration = useMemo(() => {
    if (duration > 0) return duration
    return activeTrack ? activeTrack.durationMs / 1000 : 0
  }, [activeTrack, duration])

  const queuePreview = useMemo(() => {
    if (tracks.length === 0) return []
    const startIndex = currentTrackIndex >= 0 ? currentTrackIndex : 0
    return buildAttemptOrder(startIndex, 1, tracks.length)
      .slice(0, compact ? 3 : 5)
      .map((index) => tracks[index])
  }, [compact, currentTrackIndex, tracks])

  useEffect(() => {
    if (!initialized && !restoring) {
      void restoreSession()
    }
  }, [initialized, restoreSession, restoring])

  useEffect(() => {
    if (!qrLoginUrl) {
      setQrDataUrl(null)
      return
    }

    let cancelled = false

    void QRCode.toDataURL(qrLoginUrl, {
      margin: 1,
      width: compact ? 132 : 220,
      color: {
        dark: '#19140f',
        light: '#FDF8F1',
      },
    }).then((value: string) => {
      if (!cancelled) setQrDataUrl(value)
    }).catch((error: unknown) => {
      console.error('generate netease qr failed', error)
      if (!cancelled) setQrDataUrl(null)
    })

    return () => {
      cancelled = true
    }
  }, [compact, qrLoginUrl])

  useEffect(() => {
    const shouldPoll =
      qrKey &&
      (status === 'qr-ready' || status === 'qr-waiting-scan' || status === 'qr-waiting-confirm')

    if (!shouldPoll) return

    const timeoutId = window.setTimeout(() => {
      void pollQrLogin()
    }, 900)

    const intervalId = window.setInterval(() => {
      void pollQrLogin()
    }, 1800)

    return () => {
      window.clearTimeout(timeoutId)
      window.clearInterval(intervalId)
    }
  }, [pollQrLogin, qrKey, status])

  async function playFromIndex(startIndex: number, direction: 1 | -1 = 1) {
    if (tracks.length === 0) return

    const audio = audioRef.current
    if (!audio) return

    setPlaybackBusy(true)
    setPlaybackError(null)

    const order = buildAttemptOrder(startIndex, direction, tracks.length)
    let skippedTrackName: string | null = null

    try {
      for (const index of order) {
        const candidate = tracks[index]
        if (!candidate) continue

        try {
          const source = await resolveSongSource(candidate.id)
          if (!source.url) {
            skippedTrackName ||= candidate.name
            continue
          }

          selectTrackByIndex(index)

          if (loadedTrackId !== candidate.id || audio.src !== source.url) {
            audio.src = source.url
            audio.load()
            setLoadedTrackId(candidate.id)
            setCurrentTime(0)
            setDuration(candidate.durationMs / 1000)
          }

          await audio.play()
          setPlaybackError(null)

          if (skippedTrackName && skippedTrackName !== candidate.name) {
            toast.warning(`“${skippedTrackName}”当前不可播放，已切到下一首`)
          }

          return
        } catch (error) {
          skippedTrackName ||= candidate.name
          console.error('play track failed', error)
        }
      }

      const message = '当前队列里没有可播放的歌曲'
      setPlaybackError(message)
      setIsPlaying(false)
      toast.error(message)
    } finally {
      setPlaybackBusy(false)
    }
  }

  async function handleNextTrack() {
    if (tracks.length === 0) return
    const startIndex = currentTrackIndex >= 0 ? (currentTrackIndex + 1) % tracks.length : 0
    await playFromIndex(startIndex, 1)
  }

  nextTrackRef.current = handleNextTrack

  useEffect(() => {
    const audio = getSharedAudio()
    audioRef.current = audio

    function handleTimeUpdate() {
      setCurrentTime(audio.currentTime)
    }

    function handleLoadedMetadata() {
      setDuration(audio.duration || 0)
    }

    function handlePlay() {
      setIsPlaying(true)
    }

    function handlePause() {
      setIsPlaying(false)
    }

    function handleEnded() {
      void nextTrackRef.current()
    }

    function handleError() {
      setPlaybackError('当前歌曲播放失败，已尝试切换下一首')
      void nextTrackRef.current()
    }

    audio.addEventListener('timeupdate', handleTimeUpdate)
    audio.addEventListener('loadedmetadata', handleLoadedMetadata)
    audio.addEventListener('play', handlePlay)
    audio.addEventListener('pause', handlePause)
    audio.addEventListener('ended', handleEnded)
    audio.addEventListener('error', handleError)

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate)
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata)
      audio.removeEventListener('play', handlePlay)
      audio.removeEventListener('pause', handlePause)
      audio.removeEventListener('ended', handleEnded)
      audio.removeEventListener('error', handleError)
    }
  }, [])

  useEffect(() => {
    if (status === 'authorized') return

    const audio = audioRef.current
    if (!audio) return

    audio.pause()
    audio.removeAttribute('src')
    audio.load()
    setLoadedTrackId(null)
    setCurrentTime(0)
    setDuration(0)
    setIsPlaying(false)
  }, [status])

  async function handleStartLogin() {
    await startQrLogin()
  }

  async function handleRefreshTracks() {
    try {
      await loadLikedTracks()
      toast.success('已刷新我喜欢的音乐')
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : '刷新喜欢歌单失败'
      toast.error(nextMessage)
    }
  }

  async function handleTogglePlayback() {
    const audio = audioRef.current
    if (!audio || tracks.length === 0) return

    if (activeTrack && loadedTrackId === activeTrack.id && audio.src) {
      try {
        if (audio.paused) {
          await audio.play()
        } else {
          audio.pause()
        }
      } catch (error) {
        const nextMessage = error instanceof Error ? error.message : '播放失败'
        setPlaybackError(nextMessage)
        toast.error(nextMessage)
      }
      return
    }

    const startIndex = currentTrackIndex >= 0 ? currentTrackIndex : 0
    await playFromIndex(startIndex, 1)
  }

  async function handlePreviousTrack() {
    if (tracks.length === 0) return
    const startIndex =
      currentTrackIndex >= 0 ? (currentTrackIndex - 1 + tracks.length) % tracks.length : 0
    await playFromIndex(startIndex, -1)
  }

  async function handleLogout() {
    try {
      await logout()
      toast.success('已退出网易云登录')
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : '退出网易云失败'
      toast.error(nextMessage)
    }
  }

  function handleSeek(nextTime: number) {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = nextTime
    setCurrentTime(nextTime)
  }

  return (
    <div ref={ref} className="h-full overflow-hidden">
      <div className={`flex h-full min-h-0 flex-col ${compact ? 'gap-3' : 'gap-4'}`}>
        {status === 'unknown' || status === 'checking' ? (
          <LoadingState compact={compact} />
        ) : status === 'login-required' || status === 'qr-ready' || status === 'qr-waiting-scan' || status === 'qr-waiting-confirm' || status === 'qr-expired' || status === 'error' ? (
          <LoginState
            compact={compact}
            status={status}
            message={message}
            qrDataUrl={qrDataUrl}
            startingLogin={startingLogin}
            pollingLogin={pollingLogin}
            onStartLogin={handleStartLogin}
          />
        ) : (
          <>
            <div className={`flex min-h-0 ${compact ? 'items-center gap-3' : 'gap-4'}`}>
              <RecordVisual
                compact={compact}
                coverUrl={activeTrack?.coverUrl ?? likedPlaylist?.coverImgUrl ?? null}
                spinning={isPlaying}
                title={activeTrack?.name ?? likedPlaylist?.name ?? '我喜欢的音乐'}
                subtitle={activeTrack?.artistLine ?? profile?.nickname ?? '网易云音乐'}
              />

              <div className={`min-w-0 ${compact ? 'flex-1' : 'flex flex-1 flex-col justify-center'}`}>
                <div
                  style={{
                    fontSize: compact ? '11px' : '12px',
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    color: 'var(--text-muted)',
                  }}
                >
                  我喜欢的音乐
                </div>
                <div
                  className="truncate"
                  style={{
                    marginTop: compact ? '2px' : '8px',
                    fontSize: compact ? '14px' : '22px',
                    fontWeight: 600,
                    color: 'var(--text)',
                    lineHeight: 1.24,
                  }}
                >
                  {activeTrack?.name ?? likedPlaylist?.name ?? '网易云音乐'}
                </div>
                <div
                  className="truncate"
                  style={{
                    marginTop: compact ? '3px' : '6px',
                    fontSize: compact ? '11px' : '13px',
                    color: 'var(--text-sub)',
                  }}
                >
                  {activeTrack?.artistLine ?? `${profile?.nickname ?? '你'} 的喜欢歌单`}
                </div>
                {!compact && (
                  <div
                    style={{
                      marginTop: '10px',
                      fontSize: '11px',
                      color: 'var(--text-muted)',
                      lineHeight: 1.6,
                    }}
                  >
                    {likedPlaylist
                      ? `${likedPlaylist.name} · ${likedPlaylist.trackCount} 首`
                      : '正在加载喜欢歌单'}
                  </div>
                )}
              </div>
            </div>

            <div
              className="rounded-[24px] p-3 flex flex-col gap-3"
              style={{
                background: 'linear-gradient(180deg, rgba(247,236,209,0.82), rgba(255,251,244,0.96))',
                border: '1px solid rgba(185, 150, 95, 0.26)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.45)',
              }}
            >
              <div className="flex items-start gap-2">
                <div
                  className="w-9 h-9 rounded-2xl flex items-center justify-center flex-shrink-0"
                  style={{
                    background: 'rgba(92,125,96,0.12)',
                    color: 'var(--primary-dark)',
                  }}
                >
                  {tracksLoading ? <LoaderCircle size={16} className="animate-spin" /> : <Heart size={16} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>
                    {profile ? `${profile.nickname} 的网易云音乐` : '网易云音乐'}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: '1.55' }}>
                    {tracksLoading
                      ? '正在同步“我喜欢的音乐”...'
                      : playbackError ?? message ?? '登录状态已保存在应用内，可以直接播放和切歌。'}
                  </div>
                </div>

                {!compact && (
                  <div className="flex gap-1">
                    <button
                      onClick={handleRefreshTracks}
                      disabled={tracksLoading}
                      className="p-2 rounded-xl transition-all"
                      style={{
                        background: 'rgba(255,255,255,0.66)',
                        color: 'var(--text-sub)',
                        opacity: tracksLoading ? 0.6 : 1,
                      }}
                      title="刷新歌单"
                    >
                      <RefreshCw size={14} className={tracksLoading ? 'animate-spin' : ''} />
                    </button>
                    <button
                      onClick={handleLogout}
                      className="p-2 rounded-xl transition-all"
                      style={{
                        background: 'rgba(255,255,255,0.66)',
                        color: 'var(--text-sub)',
                      }}
                      title="退出登录"
                    >
                      <LogOut size={14} />
                    </button>
                  </div>
                )}
              </div>

              <div
                className="rounded-[22px] p-3"
                style={{
                  background: 'rgba(255,255,255,0.74)',
                  border: '1px solid rgba(193, 160, 104, 0.25)',
                }}
              >
                <div className="flex items-center gap-3">
                  <button
                    onClick={handlePreviousTrack}
                    disabled={tracks.length === 0 || playbackBusy}
                    className="w-9 h-9 rounded-full flex items-center justify-center transition-all"
                    style={{
                      background: 'rgba(49,40,31,0.08)',
                      color: 'var(--text-sub)',
                      opacity: tracks.length === 0 ? 0.45 : 1,
                    }}
                    title="上一首"
                  >
                    <SkipBack size={16} />
                  </button>

                  <button
                    onClick={handleTogglePlayback}
                    disabled={tracks.length === 0 || playbackBusy}
                    className="w-11 h-11 rounded-full flex items-center justify-center transition-all"
                    style={{
                      background: 'var(--text)',
                      color: 'white',
                      opacity: tracks.length === 0 ? 0.45 : 1,
                    }}
                    title={isPlaying ? '暂停' : '播放'}
                  >
                    {playbackBusy ? (
                      <LoaderCircle size={18} className="animate-spin" />
                    ) : isPlaying ? (
                      <Pause size={18} />
                    ) : (
                      <Play size={18} className="translate-x-[1px]" />
                    )}
                  </button>

                  <button
                    onClick={() => void handleNextTrack()}
                    disabled={tracks.length === 0 || playbackBusy}
                    className="w-9 h-9 rounded-full flex items-center justify-center transition-all"
                    style={{
                      background: 'rgba(49,40,31,0.08)',
                      color: 'var(--text-sub)',
                      opacity: tracks.length === 0 ? 0.45 : 1,
                    }}
                    title="下一首"
                  >
                    <SkipForward size={16} />
                  </button>

                  <div className="min-w-0 flex-1">
                    <div className="truncate" style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>
                      {activeTrack?.name ?? '还没有可播放歌曲'}
                    </div>
                    <div className="truncate" style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                      {activeTrack?.artistLine ?? (tracksLoading ? '正在加载歌单...' : '登录后自动进入我喜欢的音乐')}
                    </div>
                  </div>
                </div>

                <div className="mt-3">
                  <input
                    type="range"
                    min={0}
                    max={displayDuration || 1}
                    step={1}
                    value={Math.min(currentTime, displayDuration || 0)}
                    onChange={(event) => handleSeek(Number(event.target.value))}
                    disabled={!activeTrack || playbackBusy}
                    className="w-full accent-[var(--primary)]"
                  />
                  <div className="mt-1.5 flex items-center justify-between" style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                    <span>{formatPlaybackTime(currentTime)}</span>
                    <span>{activeTrack ? formatDuration(activeTrack.durationMs) : '00:00'}</span>
                  </div>
                </div>
              </div>

              {!compact && queuePreview.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  {queuePreview.map((track) => {
                    const isActive = track.id === activeTrack?.id
                    return (
                      <button
                        key={track.id}
                        onClick={() => {
                          const index = tracks.findIndex((item) => item.id === track.id)
                          if (index >= 0) {
                            void playFromIndex(index, 1)
                          }
                        }}
                        className="flex items-center gap-3 rounded-2xl px-3 py-2 text-left transition-all"
                        style={{
                          background: isActive ? 'rgba(92,125,96,0.12)' : 'rgba(255,255,255,0.52)',
                          border: `1px solid ${isActive ? 'rgba(92,125,96,0.18)' : 'transparent'}`,
                        }}
                      >
                        <div
                          className="w-8 h-8 rounded-xl overflow-hidden flex items-center justify-center flex-shrink-0"
                          style={{ background: 'rgba(49,40,31,0.08)' }}
                        >
                          {track.coverUrl ? (
                            <img src={track.coverUrl} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <Disc3 size={14} style={{ color: 'var(--text-muted)' }} />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate" style={{ fontSize: '12px', fontWeight: isActive ? 600 : 500, color: 'var(--text)' }}>
                            {track.name}
                          </div>
                          <div className="truncate" style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                            {track.artistLine}
                          </div>
                        </div>
                        <div style={{ fontSize: '10px', color: track.playable ? 'var(--text-muted)' : '#B65E52' }}>
                          {track.playable ? formatDuration(track.durationMs) : '受限'}
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}

              {compact && (
                <div className="flex items-center justify-between" style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                  <span className="truncate pr-2">{likedPlaylist ? `${likedPlaylist.trackCount} 首喜欢歌曲` : '喜欢歌单'}</span>
                  <button
                    onClick={handleLogout}
                    className="flex items-center gap-1 rounded-full px-2 py-1"
                    style={{ background: 'rgba(255,255,255,0.66)', color: 'var(--text-sub)' }}
                  >
                    <LogOut size={11} />
                    退出
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function LoadingState({ compact }: { compact: boolean }) {
  return (
    <div className={`flex h-full flex-col items-center justify-center ${compact ? 'gap-3' : 'gap-4'}`}>
      <RecordVisual compact={compact} coverUrl={null} spinning={true} title="网易云音乐" subtitle="同步登录状态" />
      <div className="flex items-center gap-2" style={{ color: 'var(--text-muted)', fontSize: compact ? '11px' : '12px' }}>
        <LoaderCircle size={14} className="animate-spin" />
        <span>正在恢复网易云登录状态...</span>
      </div>
    </div>
  )
}

function LoginState({
  compact,
  message,
  onStartLogin,
  pollingLogin,
  qrDataUrl,
  startingLogin,
  status,
}: {
  compact: boolean
  onStartLogin: () => Promise<void>
  pollingLogin: boolean
  qrDataUrl: string | null
  startingLogin: boolean
  status: 'login-required' | 'qr-ready' | 'qr-waiting-scan' | 'qr-waiting-confirm' | 'qr-expired' | 'error'
  message?: string | null
}) {
  const qrVisible = status !== 'login-required' && status !== 'error'
  const title =
    status === 'qr-expired'
      ? '二维码已过期'
      : status === 'qr-waiting-confirm'
        ? '请在网易云 App 确认'
        : status === 'qr-waiting-scan'
          ? '等待扫码登录'
          : status === 'error'
            ? '网易云连接异常'
            : qrVisible
              ? '扫码登录网易云'
              : '登录后开始播放'

  const subtitle =
    message ??
    (status === 'error'
      ? '网易云登录初始化失败，可以重新生成二维码。'
      : status === 'qr-expired'
        ? '重新生成二维码后，用网易云音乐 App 扫码即可。'
        : qrVisible
          ? '扫码成功后会自动同步“我喜欢的音乐”。'
          : '登录完成后，卡片会默认进入“我喜欢的音乐”，支持直接播放和切歌。')

  return (
    <>
      <div className={`flex min-h-0 ${compact ? 'items-center gap-3' : 'flex-col items-center justify-center gap-4'}`}>
        <RecordVisual compact={compact} coverUrl={null} spinning={qrVisible || startingLogin || pollingLogin} title="网易云音乐" subtitle="扫码登录" />
        <div className={`min-w-0 ${compact ? 'flex-1' : 'text-center'}`}>
          <div
            style={{
              fontSize: compact ? '11px' : '12px',
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
            }}
          >
            网易云登录
          </div>
          <div
            style={{
              marginTop: compact ? '2px' : '8px',
              fontSize: compact ? '14px' : '20px',
              fontWeight: 600,
              color: 'var(--text)',
              lineHeight: 1.28,
            }}
          >
            {title}
          </div>
          <div
            style={{
              marginTop: compact ? '4px' : '8px',
              fontSize: compact ? '11px' : '12px',
              color: 'var(--text-sub)',
              lineHeight: 1.6,
            }}
          >
            {subtitle}
          </div>
        </div>
      </div>

      <div
        className={`rounded-[24px] ${compact ? 'p-3' : 'p-4'} flex flex-col ${compact ? 'gap-3' : 'gap-4'}`}
        style={{
          background: 'linear-gradient(180deg, rgba(248,242,231,0.84), rgba(255,251,244,0.96))',
          border: '1px solid rgba(179, 154, 111, 0.24)',
        }}
      >
        {qrVisible ? (
          <div className={`flex ${compact ? 'items-center gap-3' : 'flex-col items-center gap-3'}`}>
            <div
              className="rounded-[22px] p-3"
              style={{
                background: 'rgba(255,255,255,0.82)',
                border: '1px solid rgba(191, 163, 120, 0.25)',
              }}
            >
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt="网易云登录二维码"
                  className={`${compact ? 'w-24 h-24' : 'w-48 h-48'} object-contain rounded-[16px]`}
                />
              ) : (
                <div className={`${compact ? 'w-24 h-24' : 'w-48 h-48'} flex items-center justify-center`}>
                  <LoaderCircle size={24} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
                </div>
              )}
            </div>

            <div className={`min-w-0 ${compact ? 'flex-1' : 'text-center'}`}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>
                打开网易云音乐 App 扫码
              </div>
              <div style={{ marginTop: '6px', fontSize: '11px', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                登录成功后会自动同步到 dashboard，并默认加载“我喜欢的音乐”。
              </div>
              <div className={`flex ${compact ? 'mt-3' : 'mt-4 justify-center'} gap-2`}>
                <button
                  onClick={() => void onStartLogin()}
                  disabled={startingLogin}
                  className="flex items-center justify-center gap-2 rounded-2xl px-3 py-2.5 transition-all"
                  style={{
                    background: 'rgba(255,255,255,0.78)',
                    color: 'var(--text-sub)',
                    opacity: startingLogin ? 0.65 : 1,
                  }}
                >
                  <RefreshCw size={14} className={startingLogin ? 'animate-spin' : ''} />
                  <span style={{ fontSize: '12px', fontWeight: 600 }}>刷新二维码</span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-[22px] p-4" style={{ background: 'rgba(255,255,255,0.72)' }}>
            <div className="flex items-start gap-3">
              <div
                className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0"
                style={{
                  background: status === 'error' ? 'rgba(182,94,82,0.12)' : 'rgba(92,125,96,0.12)',
                  color: status === 'error' ? '#B65E52' : 'var(--primary-dark)',
                }}
              >
                {status === 'error' ? <ShieldAlert size={18} /> : <LogIn size={18} />}
              </div>
              <div className="min-w-0">
                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>
                  用网易云 App 登录
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: 1.6, marginTop: '4px' }}>
                  卡片会在登录后默认进入“我喜欢的音乐”，并且在 dashboard 里直接播放、暂停和切歌。
                </div>
              </div>
            </div>
            <button
              onClick={() => void onStartLogin()}
              disabled={startingLogin}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl py-2.5 transition-all"
              style={{
                background: 'var(--text)',
                color: 'white',
                opacity: startingLogin ? 0.7 : 1,
              }}
            >
              {startingLogin ? <LoaderCircle size={15} className="animate-spin" /> : <ScanLine size={15} />}
              <span style={{ fontSize: '12px', fontWeight: 600 }}>生成登录二维码</span>
            </button>
          </div>
        )}

        {(pollingLogin || status === 'qr-waiting-confirm' || status === 'qr-waiting-scan') && (
          <div className="flex items-center gap-2" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            <LoaderCircle size={14} className="animate-spin" />
            <span>{status === 'qr-waiting-confirm' ? '已扫码，等待手机确认...' : '等待网易云 App 扫码...'}</span>
          </div>
        )}
      </div>
    </>
  )
}

function RecordVisual({
  compact,
  coverUrl,
  spinning,
  subtitle,
  title,
}: {
  compact: boolean
  coverUrl: string | null
  spinning: boolean
  subtitle: string
  title: string
}) {
  const size = compact ? 88 : 184

  return (
    <div
      className="relative flex items-center justify-center"
      style={{
        width: `${size}px`,
        height: `${size + (compact ? 0 : 38)}px`,
        paddingTop: compact ? '0' : '38px',
        flexShrink: 0,
      }}
    >
      {!compact && (
        <>
          <div
            className="absolute top-0 left-1/2 -translate-x-1/2 rounded-b-full"
            style={{
              width: '19px',
              height: '11px',
              background: 'rgba(255,255,255,0.92)',
              boxShadow: '0 2px 10px rgba(61,52,42,0.12)',
            }}
          />
          <div
            className="absolute left-1/2 -translate-x-1/2"
            style={{
              top: '8px',
              width: '4px',
              height: '31px',
              borderRadius: '999px',
              background: 'linear-gradient(180deg, #ffffff, #d7d3ce)',
              boxShadow: '0 0 0 1px rgba(61,52,42,0.04)',
            }}
          />
        </>
      )}

      <div
        className="relative rounded-full"
        style={{
          width: `${size}px`,
          height: `${size}px`,
          background:
            'radial-gradient(circle at 48% 42%, rgba(70,70,70,0.92), rgba(18,18,18,1) 48%, #070707 77%, #1f1f1f 100%)',
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.05), 0 14px 28px rgba(29,23,18,0.18)',
          animation: spinning ? 'spin 10s linear infinite' : undefined,
        }}
      >
        <div
          className="absolute inset-[11%] rounded-full"
          style={{
            background:
              'repeating-radial-gradient(circle, rgba(255,255,255,0.04) 0 2px, rgba(0,0,0,0) 2px 8px)',
            opacity: 0.72,
          }}
        />

        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full overflow-hidden"
          style={{
            width: `${Math.round(size * 0.42)}px`,
            height: `${Math.round(size * 0.42)}px`,
            background: coverUrl
              ? '#F0E4BE'
              : 'linear-gradient(180deg, #DCC57A, #A28B4C)',
            boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.2)',
          }}
        >
          {coverUrl ? (
            <img src={coverUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <div
              className="h-full w-full flex flex-col items-center justify-center text-center"
              style={{ padding: compact ? '8px' : '10px', color: '#17110B' }}
            >
              <div
                style={{
                  fontSize: compact ? '7px' : '8px',
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  opacity: 0.75,
                }}
              >
                NetEase
              </div>
              <div
                style={{
                  marginTop: '4px',
                  fontSize: compact ? '8px' : '9px',
                  fontWeight: 700,
                  lineHeight: 1.15,
                }}
              >
                {title}
              </div>
            </div>
          )}
        </div>

        {!compact && (
          <div
            className="absolute left-1/2 top-[17%] -translate-x-1/2 max-w-[46%] truncate"
            style={{
              fontSize: '8px',
              color: 'rgba(255,255,255,0.58)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            {subtitle}
          </div>
        )}

        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            width: `${Math.max(7, Math.round(size * 0.05))}px`,
            height: `${Math.max(7, Math.round(size * 0.05))}px`,
            background: '#14110D',
            boxShadow: '0 0 0 1px rgba(255,255,255,0.3)',
          }}
        />
      </div>
    </div>
  )
}
