import { parseBlob } from 'music-metadata'
import type { ParsedTrackMetadata } from '@/lib/musicLibrary'

function stripExtension(name: string): string {
  const idx = name.lastIndexOf('.')
  return idx >= 0 ? name.slice(0, idx) : name
}

export async function parseTrackMetadata(file: File): Promise<ParsedTrackMetadata> {
  let title = stripExtension(file.name).trim() || file.name
  let artist: string | null = null
  let album: string | null = null
  let durationMs: number | null = null
  let cover: ParsedTrackMetadata['cover'] = null

  try {
    const meta = await parseBlob(file)
    if (meta.common.title) title = meta.common.title
    if (meta.common.artists && meta.common.artists.length > 0) artist = meta.common.artists.join(' / ')
    else if (meta.common.artist) artist = meta.common.artist
    if (meta.common.album) album = meta.common.album
    if (meta.format.duration && Number.isFinite(meta.format.duration)) {
      durationMs = Math.round(meta.format.duration * 1000)
    }

    const picture = meta.common.picture?.[0]
    if (picture) {
      const mime = picture.format ?? 'image/jpeg'
      let ext: 'jpg' | 'png' | 'webp' = 'jpg'
      if (mime.includes('png')) ext = 'png'
      else if (mime.includes('webp')) ext = 'webp'
      const ab = picture.data instanceof Uint8Array
        ? picture.data.slice().buffer
        : new Uint8Array(picture.data as ArrayLike<number>).buffer
      cover = { blob: new Blob([ab], { type: mime }), ext }
    }
  } catch {
    // Non-readable / encrypted / unsupported file: fall back to filename.
  }

  return { title, artist, album, durationMs, cover }
}
