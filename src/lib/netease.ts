export type NetEaseAuthStatus =
  | 'unknown'
  | 'checking'
  | 'login-required'
  | 'qr-ready'
  | 'qr-waiting-scan'
  | 'qr-waiting-confirm'
  | 'qr-expired'
  | 'authorized'
  | 'error'

export interface NetEaseProfile {
  userId: number
  nickname: string
  avatarUrl?: string | null
}

export interface NetEasePlaylistSummary {
  id: number
  name: string
  coverImgUrl?: string | null
  trackCount: number
}

export interface NetEaseTrack {
  id: number
  name: string
  artists: string[]
  artistLine: string
  albumName: string
  coverUrl?: string | null
  durationMs: number
  playable: boolean
}

export interface NetEaseSessionSnapshot {
  status: 'authorized' | 'login-required'
  profile?: NetEaseProfile | null
  likedPlaylist?: NetEasePlaylistSummary | null
  message?: string | null
}

export interface NetEaseQrLoginStart {
  key: string
  loginUrl: string
}

export interface NetEaseQrLoginPoll {
  status: 'waiting-scan' | 'waiting-confirm' | 'expired' | 'authorized'
  snapshot?: NetEaseSessionSnapshot | null
  message?: string | null
}

export interface NetEaseLikedTracksPayload {
  playlist: NetEasePlaylistSummary
  tracks: NetEaseTrack[]
}

export interface NetEaseSongSource {
  songId: number
  url?: string | null
  expiresAt?: number | null
  level?: string | null
  message?: string | null
}

export function formatDuration(durationMs: number) {
  return formatPlaybackTime(durationMs / 1000)
}

export function formatPlaybackTime(totalSeconds: number) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '00:00'

  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.floor(totalSeconds % 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}
