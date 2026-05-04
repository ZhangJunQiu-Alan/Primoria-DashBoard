import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import {
  computeUsageBytes,
  createSignedUrl,
  deleteTrack as deleteTrackRow,
  listTracks,
  uploadTrack,
  type MusicTrackRow,
  type ParsedTrackMetadata,
} from '@/lib/musicLibrary'

interface SignedUrlEntry {
  url: string
  expiresAt: number
}

const SIGNED_URL_BUFFER_MS = 60_000

interface MusicState {
  tracks: MusicTrackRow[]
  loaded: boolean
  loading: boolean
  loadError: string | null
  usageBytes: number

  audioSignedUrls: Record<string, SignedUrlEntry>
  coverSignedUrls: Record<string, SignedUrlEntry>

  currentTrackByWidget: Record<string, string | null>

  refresh: (userId: string) => Promise<void>
  reset: () => void
  upload: (
    userId: string,
    file: File,
    metadata: ParsedTrackMetadata
  ) => Promise<MusicTrackRow>
  remove: (track: MusicTrackRow) => Promise<void>
  resolveAudioUrl: (track: MusicTrackRow) => Promise<string>
  resolveCoverUrl: (track: MusicTrackRow) => Promise<string | null>
  setCurrentTrack: (widgetId: string, trackId: string | null) => void
}

const PERSIST_KEY = 'primoria-music-state'

export const useMusicStore = create<MusicState>()(
  persist(
    (set, get) => ({
      tracks: [],
      loaded: false,
      loading: false,
      loadError: null,
      usageBytes: 0,
      audioSignedUrls: {},
      coverSignedUrls: {},
      currentTrackByWidget: {},

      refresh: async (userId) => {
        if (get().loading) return
        set({ loading: true, loadError: null })
        try {
          const [tracks, usage] = await Promise.all([
            listTracks(userId),
            computeUsageBytes(userId),
          ])
          set({ tracks, usageBytes: usage, loaded: true, loading: false })
        } catch (error) {
          const message = error instanceof Error ? error.message : '加载音乐库失败'
          set({ loaded: true, loading: false, loadError: message })
        }
      },

      reset: () =>
        set({
          tracks: [],
          loaded: false,
          loading: false,
          loadError: null,
          usageBytes: 0,
          audioSignedUrls: {},
          coverSignedUrls: {},
        }),

      upload: async (userId, file, metadata) => {
        const sortOrder = (get().tracks[get().tracks.length - 1]?.sort_order ?? 0) + 1
        const row = await uploadTrack({ userId, file, metadata, sortOrder })
        set((state) => ({
          tracks: [...state.tracks, row],
          usageBytes: state.usageBytes + row.size_bytes,
        }))
        return row
      },

      remove: async (track) => {
        await deleteTrackRow(track)
        set((state) => {
          const nextCurrents = { ...state.currentTrackByWidget }
          for (const [widgetId, id] of Object.entries(nextCurrents)) {
            if (id === track.id) nextCurrents[widgetId] = null
          }
          const { [track.id]: _audio, ...audioRest } = state.audioSignedUrls
          const { [track.id]: _cover, ...coverRest } = state.coverSignedUrls
          void _audio
          void _cover
          return {
            tracks: state.tracks.filter((t) => t.id !== track.id),
            usageBytes: Math.max(0, state.usageBytes - track.size_bytes),
            audioSignedUrls: audioRest,
            coverSignedUrls: coverRest,
            currentTrackByWidget: nextCurrents,
          }
        })
      },

      resolveAudioUrl: async (track) => {
        const cached = get().audioSignedUrls[track.id]
        if (cached && cached.expiresAt - SIGNED_URL_BUFFER_MS > Date.now()) {
          return cached.url
        }
        const url = await createSignedUrl(track.audio_path)
        const expiresAt = Date.now() + 60 * 60 * 1000
        set((state) => ({
          audioSignedUrls: { ...state.audioSignedUrls, [track.id]: { url, expiresAt } },
        }))
        return url
      },

      resolveCoverUrl: async (track) => {
        if (!track.cover_path) return null
        const cached = get().coverSignedUrls[track.id]
        if (cached && cached.expiresAt - SIGNED_URL_BUFFER_MS > Date.now()) {
          return cached.url
        }
        const url = await createSignedUrl(track.cover_path)
        const expiresAt = Date.now() + 60 * 60 * 1000
        set((state) => ({
          coverSignedUrls: { ...state.coverSignedUrls, [track.id]: { url, expiresAt } },
        }))
        return url
      },

      setCurrentTrack: (widgetId, trackId) =>
        set((state) => ({
          currentTrackByWidget: { ...state.currentTrackByWidget, [widgetId]: trackId },
        })),
    }),
    {
      name: PERSIST_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        currentTrackByWidget: state.currentTrackByWidget,
      }),
    }
  )
)
