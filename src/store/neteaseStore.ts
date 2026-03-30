import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import type {
  NetEaseAuthStatus,
  NetEaseLikedTracksPayload,
  NetEasePlaylistSummary,
  NetEaseProfile,
  NetEaseQrLoginPoll,
  NetEaseQrLoginStart,
  NetEaseSessionSnapshot,
  NetEaseSongSource,
  NetEaseTrack,
} from '@/lib/netease'

interface CachedSongSource {
  expiresAt?: number | null
  level?: string | null
  message?: string | null
  url?: string | null
}

interface NetEaseStoreState {
  status: NetEaseAuthStatus
  initialized: boolean
  restoring: boolean
  startingLogin: boolean
  pollingLogin: boolean
  tracksLoading: boolean
  message: string | null
  qrKey: string | null
  qrLoginUrl: string | null
  profile: NetEaseProfile | null
  likedPlaylist: NetEasePlaylistSummary | null
  tracks: NetEaseTrack[]
  currentTrackId: number | null
  songSources: Record<number, CachedSongSource>
  restoreSession: () => Promise<void>
  startQrLogin: () => Promise<void>
  pollQrLogin: () => Promise<NetEaseQrLoginPoll | null>
  loadLikedTracks: () => Promise<void>
  resolveSongSource: (songId: number) => Promise<NetEaseSongSource>
  setCurrentTrackId: (trackId: number | null) => void
  selectTrackByIndex: (index: number) => void
  resetPlayerState: () => void
  logout: () => Promise<void>
}

function applySnapshot(
  snapshot: NetEaseSessionSnapshot,
  currentTrackId: number | null,
  tracks: NetEaseTrack[]
) {
  const authorized = snapshot.status === 'authorized'
  return {
    status: authorized ? ('authorized' as const) : ('login-required' as const),
    message: snapshot.message ?? null,
    profile: snapshot.profile ?? null,
    likedPlaylist: snapshot.likedPlaylist ?? null,
    qrKey: null,
    qrLoginUrl: null,
    currentTrackId:
      tracks.length > 0 && currentTrackId && tracks.some((track) => track.id === currentTrackId)
        ? currentTrackId
        : tracks[0]?.id ?? null,
  }
}

export const useNetEaseStore = create<NetEaseStoreState>((set, get) => ({
  status: 'unknown',
  initialized: false,
  restoring: false,
  startingLogin: false,
  pollingLogin: false,
  tracksLoading: false,
  message: null,
  qrKey: null,
  qrLoginUrl: null,
  profile: null,
  likedPlaylist: null,
  tracks: [],
  currentTrackId: null,
  songSources: {},

  restoreSession: async () => {
    if (get().restoring) return

    set((state) => ({
      restoring: true,
      status: state.initialized ? state.status : 'checking',
      message: null,
    }))

    try {
      const snapshot = await invoke<NetEaseSessionSnapshot>('netease_restore_session')
      set((state) => ({
        ...applySnapshot(snapshot, state.currentTrackId, state.tracks),
        initialized: true,
        restoring: false,
      }))

      if (snapshot.status === 'authorized') {
        const shouldLoadTracks =
          get().tracks.length === 0 ||
          (snapshot.likedPlaylist && snapshot.likedPlaylist.id !== get().likedPlaylist?.id)
        if (shouldLoadTracks) {
          await get().loadLikedTracks()
        }
      } else {
        set({ tracks: [], currentTrackId: null, songSources: {} })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '恢复网易云登录状态失败'
      set({
        status: 'error',
        initialized: true,
        restoring: false,
        message,
      })
    }
  },

  startQrLogin: async () => {
    if (get().startingLogin) return

    set({
      startingLogin: true,
      message: null,
    })

    try {
      const payload = await invoke<NetEaseQrLoginStart>('netease_start_qr_login')
      set({
        status: 'qr-ready',
        startingLogin: false,
        qrKey: payload.key,
        qrLoginUrl: payload.loginUrl,
        message: '请使用网易云音乐 App 扫码登录',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : '生成网易云二维码失败'
      set({
        status: 'error',
        startingLogin: false,
        message,
      })
    }
  },

  pollQrLogin: async () => {
    const key = get().qrKey
    if (!key || get().pollingLogin) return null

    set({ pollingLogin: true })

    try {
      const payload = await invoke<NetEaseQrLoginPoll>('netease_poll_qr_login', { key })

      if (payload.status === 'authorized' && payload.snapshot) {
        set((state) => ({
          ...applySnapshot(payload.snapshot!, state.currentTrackId, []),
          tracks: [],
          initialized: true,
          pollingLogin: false,
          songSources: {},
          message: payload.message ?? payload.snapshot?.message ?? null,
        }))
        await get().loadLikedTracks()
      } else {
        const nextStatus =
          payload.status === 'waiting-confirm'
            ? 'qr-waiting-confirm'
            : payload.status === 'expired'
              ? 'qr-expired'
              : 'qr-waiting-scan'

        set({
          status: nextStatus,
          pollingLogin: false,
          message: payload.message ?? null,
        })
      }

      return payload
    } catch (error) {
      const message = error instanceof Error ? error.message : '轮询网易云登录状态失败'
      set({
        status: 'error',
        pollingLogin: false,
        message,
      })
      return null
    }
  },

  loadLikedTracks: async () => {
    if (get().tracksLoading) return

    set({
      tracksLoading: true,
      message: null,
    })

    try {
      const payload = await invoke<NetEaseLikedTracksPayload>('netease_fetch_liked_tracks')
      set((state) => ({
        status: 'authorized',
        tracksLoading: false,
        likedPlaylist: payload.playlist,
        tracks: payload.tracks,
        currentTrackId:
          payload.tracks.find((track) => track.id === state.currentTrackId)?.id ??
          payload.tracks[0]?.id ??
          null,
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : '加载我喜欢的音乐失败'
      const expired = /登录|扫码/.test(message)
      set({
        status: expired ? 'login-required' : 'error',
        tracksLoading: false,
        tracks: expired ? [] : get().tracks,
        currentTrackId: expired ? null : get().currentTrackId,
        songSources: expired ? {} : get().songSources,
        message,
      })
    }
  },

  resolveSongSource: async (songId) => {
    const cached = get().songSources[songId]
    if (cached?.url && (!cached.expiresAt || cached.expiresAt > Date.now() + 15_000)) {
      return {
        songId,
        url: cached.url,
        expiresAt: cached.expiresAt,
        level: cached.level,
        message: cached.message,
      }
    }

    const payload = await invoke<NetEaseSongSource>('netease_get_song_source', { songId })
    set((state) => ({
      songSources: {
        ...state.songSources,
        [songId]: {
          url: payload.url,
          expiresAt: payload.expiresAt,
          level: payload.level,
          message: payload.message,
        },
      },
    }))
    return payload
  },

  setCurrentTrackId: (trackId) => set({ currentTrackId: trackId }),

  selectTrackByIndex: (index) =>
    set((state) => ({
      currentTrackId: state.tracks[index]?.id ?? state.currentTrackId,
    })),

  resetPlayerState: () =>
    set({
      currentTrackId: null,
      songSources: {},
    }),

  logout: async () => {
    await invoke('netease_logout')
    set({
      status: 'login-required',
      initialized: true,
      restoring: false,
      startingLogin: false,
      pollingLogin: false,
      tracksLoading: false,
      message: '已退出网易云登录',
      qrKey: null,
      qrLoginUrl: null,
      profile: null,
      likedPlaylist: null,
      tracks: [],
      currentTrackId: null,
      songSources: {},
    })
  },
}))
