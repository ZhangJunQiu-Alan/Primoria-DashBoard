const CACHE_VERSION = 'primoria-dashboard-v1'
const STATIC_CACHE = `${CACHE_VERSION}:static`
const RUNTIME_CACHE = `${CACHE_VERSION}:runtime`

const APP_SHELL = [
  '/',
  '/index.html',
  '/popout.html',
  '/favicon.svg',
  '/icons.svg',
  '/manifest.webmanifest',
  '/assets/focus-journey/mountain-hero.png',
  '/assets/focus-journey/resting-page.jpg',
  '/assets/focus-journey/path-bg.jpg',
  '/assets/focus-journey/character-idle.png',
  '/assets/focus-journey/trees-overlay.jpg',
  '/assets/focus-journey/focus-end.mp3',
]

function isApiRequest(url) {
  return url.origin === self.location.origin && url.pathname.startsWith('/api/')
}

function isSameOriginGet(request, url) {
  return request.method === 'GET' && url.origin === self.location.origin
}

function isHtmlRequest(request) {
  return request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')
}

function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/assets/') ||
    /\.(css|gif|ico|jpg|js|json|mp3|png|svg|webmanifest|webp|woff2?)$/i.test(url.pathname)
  )
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => undefined)
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !key.startsWith(CACHE_VERSION))
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  )
})

async function networkFirst(request, fallbackUrl = '/index.html') {
  const cache = await caches.open(RUNTIME_CACHE)
  try {
    const response = await fetch(request)
    if (response.ok) await cache.put(request, response.clone())
    return response
  } catch {
    return (
      (await cache.match(request)) ||
      (await caches.match(request)) ||
      (await caches.match(fallbackUrl)) ||
      Response.error()
    )
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request)
  if (cached) return cached

  const response = await fetch(request)
  if (response.ok) {
    const cache = await caches.open(RUNTIME_CACHE)
    await cache.put(request, response.clone())
  }
  return response
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  if (!isSameOriginGet(event.request, url)) return
  if (isApiRequest(url)) return

  if (isHtmlRequest(event.request)) {
    event.respondWith(networkFirst(event.request, '/index.html'))
    return
  }

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(event.request))
    return
  }

  event.respondWith(networkFirst(event.request))
})
