import { supabase } from '@/lib/supabase'

export const MUSIC_BUCKET = 'music'
export const MAX_TRACK_BYTES = 30 * 1024 * 1024
export const STORAGE_QUOTA_BYTES = 800 * 1024 * 1024
export const SIGNED_URL_TTL_SECONDS = 60 * 60

export interface MusicTrackRow {
  id: string
  user_id: string
  title: string
  artist: string | null
  album: string | null
  duration_ms: number | null
  size_bytes: number
  audio_path: string
  cover_path: string | null
  sort_order: number
  created_at: string
}

export interface ParsedTrackMetadata {
  title: string
  artist: string | null
  album: string | null
  durationMs: number | null
  cover: { blob: Blob; ext: 'jpg' | 'png' | 'webp' } | null
}

const AUDIO_EXTENSIONS = new Set([
  'mp3', 'm4a', 'mp4', 'aac', 'ogg', 'oga', 'opus', 'wav', 'flac', 'webm',
])

function fileExtension(name: string): string {
  const idx = name.lastIndexOf('.')
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : ''
}

export function isSupportedAudioFile(file: File): boolean {
  const ext = fileExtension(file.name)
  if (AUDIO_EXTENSIONS.has(ext)) return true
  return file.type.startsWith('audio/')
}

export function formatDuration(ms: number | null | undefined): string {
  if (!ms || !Number.isFinite(ms) || ms <= 0) return '--:--'
  const total = Math.round(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function formatPlaybackTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export async function listTracks(userId: string): Promise<MusicTrackRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('music_tracks')
    .select('*')
    .eq('user_id', userId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as MusicTrackRow[]
}

export async function computeUsageBytes(userId: string): Promise<number> {
  if (!supabase) return 0
  const { data, error } = await supabase
    .from('music_tracks')
    .select('size_bytes')
    .eq('user_id', userId)
  if (error) throw error
  return (data ?? []).reduce((sum, row) => sum + (row.size_bytes ?? 0), 0)
}

export interface UploadTrackArgs {
  userId: string
  file: File
  metadata: ParsedTrackMetadata
  sortOrder: number
}

export async function uploadTrack({ userId, file, metadata, sortOrder }: UploadTrackArgs): Promise<MusicTrackRow> {
  if (!supabase) throw new Error('云端未配置')

  const ext = fileExtension(file.name) || 'mp3'
  const trackId = makeId()
  const audioPath = `${userId}/${trackId}.${ext}`

  const audioUpload = await supabase.storage
    .from(MUSIC_BUCKET)
    .upload(audioPath, file, { contentType: file.type || 'audio/mpeg', upsert: false })
  if (audioUpload.error) throw audioUpload.error

  let coverPath: string | null = null
  if (metadata.cover) {
    coverPath = `${userId}/${trackId}.${metadata.cover.ext}`
    const coverUpload = await supabase.storage
      .from(MUSIC_BUCKET)
      .upload(coverPath, metadata.cover.blob, {
        contentType: metadata.cover.blob.type,
        upsert: false,
      })
    if (coverUpload.error) {
      coverPath = null
    }
  }

  const insertRow = {
    user_id: userId,
    title: metadata.title,
    artist: metadata.artist,
    album: metadata.album,
    duration_ms: metadata.durationMs,
    size_bytes: file.size,
    audio_path: audioPath,
    cover_path: coverPath,
    sort_order: sortOrder,
  }

  const { data, error } = await supabase
    .from('music_tracks')
    .insert(insertRow)
    .select('*')
    .single()

  if (error) {
    await supabase.storage.from(MUSIC_BUCKET).remove([audioPath, ...(coverPath ? [coverPath] : [])])
    throw error
  }

  return data as MusicTrackRow
}

export async function deleteTrack(track: MusicTrackRow): Promise<void> {
  if (!supabase) throw new Error('云端未配置')
  const paths = [track.audio_path, ...(track.cover_path ? [track.cover_path] : [])]
  await supabase.storage.from(MUSIC_BUCKET).remove(paths)
  const { error } = await supabase.from('music_tracks').delete().eq('id', track.id)
  if (error) throw error
}

export async function createSignedUrl(path: string, ttl = SIGNED_URL_TTL_SECONDS): Promise<string> {
  if (!supabase) throw new Error('云端未配置')
  const { data, error } = await supabase.storage.from(MUSIC_BUCKET).createSignedUrl(path, ttl)
  if (error) throw error
  return data.signedUrl
}
