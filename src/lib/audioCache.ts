const CACHE_NAME = 'primoria-audio-v1'
const TTL_MS = 10 * 24 * 60 * 60 * 1000  // 10 days
const CACHED_AT_HEADER = 'x-primoria-cached-at'

function supportsCache(): boolean {
  return typeof caches !== 'undefined'
}

function cacheKeyFor(audioPath: string): string {
  return `https://primoria.local/audio/${encodeURIComponent(audioPath)}`
}

async function openCache(): Promise<Cache | null> {
  if (!supportsCache()) return null
  try {
    return await caches.open(CACHE_NAME)
  } catch {
    return null
  }
}

function isFresh(cachedAt: number): boolean {
  return Date.now() - cachedAt < TTL_MS
}

function readCachedAt(response: Response): number {
  const raw = response.headers.get(CACHED_AT_HEADER)
  if (!raw) return 0
  const value = Number(raw)
  return Number.isFinite(value) ? value : 0
}

function withTimestamp(response: Response): Response {
  const headers = new Headers(response.headers)
  headers.set(CACHED_AT_HEADER, String(Date.now()))
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

/**
 * Fetch the audio for a track, serving from cache when fresh.
 * Returns an object URL — caller is responsible for revoking it via revokeAudioObjectUrl.
 */
export async function getCachedAudioUrl(audioPath: string, signedUrlFactory: () => Promise<string>): Promise<string> {
  const cache = await openCache()
  const key = cacheKeyFor(audioPath)

  if (cache) {
    const hit = await cache.match(key)
    if (hit) {
      const ts = readCachedAt(hit)
      if (ts && isFresh(ts)) {
        const blob = await hit.blob()
        return URL.createObjectURL(blob)
      }
      await cache.delete(key)
    }
  }

  const signedUrl = await signedUrlFactory()
  const fetched = await fetch(signedUrl)
  if (!fetched.ok) throw new Error(`音频加载失败 (${fetched.status})`)

  const blob = await fetched.blob()

  if (cache) {
    try {
      await cache.put(key, withTimestamp(new Response(blob, { headers: { 'Content-Type': blob.type } })))
    } catch {
      // Quota exceeded or storage failure — fall back to direct playback
    }
  }

  return URL.createObjectURL(blob)
}

/**
 * Pre-warm the cache for a track without returning a blob URL.
 * Cheap to call repeatedly; no-op if already cached + fresh.
 */
export async function prefetchAudio(audioPath: string, signedUrlFactory: () => Promise<string>): Promise<void> {
  const cache = await openCache()
  if (!cache) return

  const key = cacheKeyFor(audioPath)
  const existing = await cache.match(key)
  if (existing) {
    const ts = readCachedAt(existing)
    if (ts && isFresh(ts)) return
    await cache.delete(key)
  }

  try {
    const signedUrl = await signedUrlFactory()
    const fetched = await fetch(signedUrl)
    if (!fetched.ok) return
    const blob = await fetched.blob()
    await cache.put(key, withTimestamp(new Response(blob, { headers: { 'Content-Type': blob.type } })))
  } catch {
    // Best-effort; ignore failures
  }
}

export async function dropCachedAudio(audioPath: string): Promise<void> {
  const cache = await openCache()
  if (!cache) return
  await cache.delete(cacheKeyFor(audioPath))
}

export async function sweepExpiredAudio(): Promise<void> {
  const cache = await openCache()
  if (!cache) return

  const requests = await cache.keys()
  for (const req of requests) {
    const res = await cache.match(req)
    if (!res) continue
    const ts = readCachedAt(res)
    if (!ts || !isFresh(ts)) {
      await cache.delete(req)
    }
  }
}

export function revokeAudioObjectUrl(url: string | null): void {
  if (!url) return
  if (url.startsWith('blob:')) URL.revokeObjectURL(url)
}
