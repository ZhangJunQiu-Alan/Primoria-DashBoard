function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function isGoogleCalendarEmbedUrl(url: URL) {
  const isGoogleCalendarHost =
    url.hostname === 'calendar.google.com' || url.hostname === 'www.google.com'
  return isGoogleCalendarHost && /\/calendar\/(?:u\/\d+\/)?embed/.test(url.pathname)
}

export function getGoogleCalendarEmbedSrc(input: string) {
  const trimmed = input.trim()
  if (!trimmed) return null

  let candidate: string | null = null

  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('//')) {
    candidate = trimmed
  } else if (typeof document !== 'undefined') {
    const template = document.createElement('template')
    template.innerHTML = trimmed
    candidate = template.content.querySelector('iframe')?.getAttribute('src') ?? null
  } else {
    const match = trimmed.match(/<iframe[^>]*\ssrc=(["'])(.*?)\1/i)
    candidate = match?.[2] ?? null
  }

  if (!candidate) return null

  const decoded = decodeHtmlEntities(candidate.trim())
  const normalized = decoded.startsWith('//') ? `https:${decoded}` : decoded

  try {
    const url = new URL(normalized)
    if (!isGoogleCalendarEmbedUrl(url)) return null
    return url.toString()
  } catch {
    return null
  }
}
