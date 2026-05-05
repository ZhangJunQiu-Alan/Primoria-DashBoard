import {
  getServiceRoleKey,
  getSupabaseUrl,
  HttpError,
  type FunctionEnv,
} from './http'
import { decryptToken, encryptToken } from './tokenCrypto'

interface CalendarConnectionRow {
  user_id: string
  provider: 'google'
  access_token_ciphertext: string | null
  refresh_token_ciphertext: string | null
  scope: string | null
  token_type: string | null
  expires_at: string | null
  connected_at: string
  updated_at: string
}

export interface CalendarEvent {
  id: string
  title: string
  start: string
  end: string
  allDay: boolean
  htmlLink?: string
  location?: string
}

interface GoogleTokenResponse {
  access_token?: string
  expires_in?: number
  refresh_token?: string
  scope?: string
  token_type?: string
  error?: string
  error_description?: string
}

interface GoogleEventDate {
  date?: string
  dateTime?: string
}

interface GoogleCalendarEvent {
  id?: string
  summary?: string
  start?: GoogleEventDate
  end?: GoogleEventDate
  htmlLink?: string
  location?: string
}

function restHeaders(env: FunctionEnv) {
  const serviceRoleKey = getServiceRoleKey(env)
  return {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    'content-type': 'application/json',
  }
}

function expiresAtFromSeconds(expiresIn: number | undefined) {
  if (!expiresIn) return null
  return new Date(Date.now() + expiresIn * 1000).toISOString()
}

function isExpired(expiresAt: string | null) {
  if (!expiresAt) return true
  return new Date(expiresAt).getTime() < Date.now() + 60_000
}

async function fetchConnection(userId: string, env: FunctionEnv) {
  const supabaseUrl = getSupabaseUrl(env)
  const response = await fetch(
    `${supabaseUrl}/rest/v1/user_calendar_connections?user_id=eq.${encodeURIComponent(userId)}&select=*`,
    { headers: restHeaders(env) }
  )

  if (!response.ok) throw new HttpError(500, 'Unable to read calendar connection')
  const rows = await response.json() as CalendarConnectionRow[]
  return rows[0] ?? null
}

async function updateConnection(userId: string, env: FunctionEnv, values: Partial<CalendarConnectionRow>) {
  const supabaseUrl = getSupabaseUrl(env)
  const response = await fetch(
    `${supabaseUrl}/rest/v1/user_calendar_connections?user_id=eq.${encodeURIComponent(userId)}`,
    {
      method: 'PATCH',
      headers: {
        ...restHeaders(env),
        prefer: 'return=minimal',
      },
      body: JSON.stringify(values),
    }
  )

  if (!response.ok) throw new HttpError(500, 'Unable to update calendar connection')
}

export async function saveCalendarConnection({
  accessToken,
  env,
  expiresIn,
  refreshToken,
  scope,
  tokenType,
  userId,
}: {
  accessToken: string
  env: FunctionEnv
  expiresIn?: number
  refreshToken?: string | null
  scope?: string | null
  tokenType?: string | null
  userId: string
}) {
  const existing = await fetchConnection(userId, env)
  const supabaseUrl = getSupabaseUrl(env)
  const body = {
    user_id: userId,
    provider: 'google',
    access_token_ciphertext: await encryptToken(accessToken, env.TOKEN_ENCRYPTION_KEY),
    refresh_token_ciphertext: refreshToken
      ? await encryptToken(refreshToken, env.TOKEN_ENCRYPTION_KEY)
      : existing?.refresh_token_ciphertext ?? null,
    scope: scope ?? existing?.scope ?? null,
    token_type: tokenType ?? existing?.token_type ?? 'Bearer',
    expires_at: expiresAtFromSeconds(expiresIn) ?? existing?.expires_at ?? null,
  }

  const response = await fetch(
    `${supabaseUrl}/rest/v1/user_calendar_connections?on_conflict=user_id`,
    {
      method: 'POST',
      headers: {
        ...restHeaders(env),
        prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(body),
    }
  )

  if (!response.ok) throw new HttpError(500, 'Unable to save calendar connection')
}

async function refreshAccessToken(row: CalendarConnectionRow, env: FunctionEnv) {
  const refreshToken = await decryptToken(row.refresh_token_ciphertext, env.TOKEN_ENCRYPTION_KEY)
  if (!refreshToken) throw new HttpError(409, 'Google Calendar needs to be reconnected')
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) {
    throw new HttpError(500, 'Google OAuth credentials are not configured')
  }

  const body = new URLSearchParams({
    client_id: env.GOOGLE_OAUTH_CLIENT_ID,
    client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  })

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
  const data = await response.json() as GoogleTokenResponse

  if (!response.ok || !data.access_token) {
    throw new HttpError(409, data.error_description || data.error || 'Google Calendar needs to be reconnected')
  }

  await updateConnection(row.user_id, env, {
    access_token_ciphertext: await encryptToken(data.access_token, env.TOKEN_ENCRYPTION_KEY),
    refresh_token_ciphertext: data.refresh_token
      ? await encryptToken(data.refresh_token, env.TOKEN_ENCRYPTION_KEY)
      : row.refresh_token_ciphertext,
    scope: data.scope ?? row.scope,
    token_type: data.token_type ?? row.token_type,
    expires_at: expiresAtFromSeconds(data.expires_in),
  })

  return data.access_token
}

export async function getCalendarAccessToken(userId: string, env: FunctionEnv) {
  const row = await fetchConnection(userId, env)
  if (!row) throw new HttpError(404, 'Google Calendar is not connected')

  if (row.access_token_ciphertext && !isExpired(row.expires_at)) {
    const accessToken = await decryptToken(row.access_token_ciphertext, env.TOKEN_ENCRYPTION_KEY)
    if (accessToken) return accessToken
  }

  return refreshAccessToken(row, env)
}

export async function hasCalendarConnection(userId: string, env: FunctionEnv) {
  const row = await fetchConnection(userId, env)
  return Boolean(row)
}

function normalizeCalendarEvent(event: GoogleCalendarEvent): CalendarEvent | null {
  const start = event.start?.dateTime ?? event.start?.date
  const end = event.end?.dateTime ?? event.end?.date
  if (!event.id || !start || !end) return null

  return {
    id: event.id,
    title: event.summary?.trim() || '未命名日程',
    start,
    end,
    allDay: Boolean(event.start?.date),
    htmlLink: event.htmlLink,
    location: event.location,
  }
}

export async function fetchGoogleCalendarEvents({
  env,
  timeMax,
  timeMin,
  userId,
}: {
  env: FunctionEnv
  timeMax: string
  timeMin: string
  userId: string
}) {
  const accessToken = await getCalendarAccessToken(userId, env)
  const params = new URLSearchParams({
    maxResults: '50',
    orderBy: 'startTime',
    singleEvents: 'true',
    timeMax,
    timeMin,
  })

  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
    { headers: { authorization: `Bearer ${accessToken}` } }
  )

  if (!response.ok) {
    if (response.status === 401) throw new HttpError(409, 'Google Calendar needs to be reconnected')
    throw new HttpError(500, 'Unable to fetch Google Calendar events')
  }

  const data = await response.json() as { items?: GoogleCalendarEvent[] }
  return (data.items ?? []).flatMap((event) => {
    const normalized = normalizeCalendarEvent(event)
    return normalized ? [normalized] : []
  })
}
