export interface FunctionEnv {
  GEMINI_API_KEY?: string
  GEMINI_FALLBACK_MODELS?: string
  GEMINI_MAX_RETRIES?: string
  GEMINI_MODEL?: string
  GEMINI_REQUEST_TIMEOUT_MS?: string
  GEMINI_RETRY_DELAY_MS?: string
  GOOGLE_OAUTH_CLIENT_ID?: string
  GOOGLE_OAUTH_CLIENT_SECRET?: string
  SUPABASE_ANON_KEY?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
  SUPABASE_URL?: string
  TOKEN_ENCRYPTION_KEY?: string
  VITE_SUPABASE_ANON_KEY?: string
  VITE_SUPABASE_URL?: string
}

export interface PagesContext {
  request: Request
  env: FunctionEnv
}

export interface SupabaseUser {
  id: string
  email?: string
}

export class HttpError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
  })
}

export function errorResponse(error: unknown) {
  if (error instanceof HttpError) {
    return jsonResponse({ error: error.message }, error.status)
  }

  const message = error instanceof Error ? error.message : 'Unexpected server error'
  return jsonResponse({ error: message }, 500)
}

export function getSupabaseUrl(env: FunctionEnv) {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL
  if (!url) throw new HttpError(500, 'Supabase URL is not configured')
  return url.replace(/\/$/, '')
}

export function getServiceRoleKey(env: FunctionEnv) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new HttpError(500, 'SUPABASE_SERVICE_ROLE_KEY is not configured')
  }
  return env.SUPABASE_SERVICE_ROLE_KEY
}

export function getBearerToken(request: Request) {
  const authorization = request.headers.get('authorization') ?? ''
  if (!authorization.startsWith('Bearer ')) {
    throw new HttpError(401, 'Missing bearer token')
  }
  return authorization.slice('Bearer '.length).trim()
}

export async function requireUser(request: Request, env: FunctionEnv) {
  const accessToken = getBearerToken(request)
  const supabaseUrl = getSupabaseUrl(env)
  const serviceRoleKey = getServiceRoleKey(env)
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    throw new HttpError(401, 'Invalid or expired session')
  }

  const user = await response.json() as SupabaseUser
  if (!user.id) throw new HttpError(401, 'Invalid session user')
  return user
}

export async function readJsonBody<T>(request: Request) {
  try {
    return await request.json() as T
  } catch {
    throw new HttpError(400, 'Invalid JSON request body')
  }
}
