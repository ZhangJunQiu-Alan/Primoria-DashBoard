import { supabase, type Session } from '@/lib/supabase'
import { addDaysToDateKey, formatLocalDateKey, parseLocalDateKey } from '@/lib/date'
import type {
  AssistantReflectionPeriodType,
  AssistantReflectionResult,
  AssistantMemory,
  AssistantMemoryType,
  AssistantAgentTraceItem,
  AssistantRagIndexResult,
  AssistantRagSource,
  AssistantRagSourceType,
  CalendarEvent,
  DailyBriefResult,
  GeminiContent,
} from '@/lib/ai/types'

type OAuthSession = Session & {
  provider_token?: string | null
  provider_refresh_token?: string | null
  token_type?: string | null
}

async function getAccessToken() {
  if (!supabase) throw new Error('Supabase 未配置，AI 功能需要登录后使用。')
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  const token = data.session?.access_token
  if (!token) throw new Error('请先登录后再使用 AI 功能。')
  return token
}

async function authedFetch(path: string, init: RequestInit = {}) {
  const token = await getAccessToken()
  const response = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init.headers,
      authorization: `Bearer ${token}`,
    },
  })

  const contentType = response.headers.get('content-type') ?? ''
  const isJson = contentType.includes('application/json')
  const data = isJson ? await response.json() as { error?: string } : null

  if (!response.ok) {
    throw new Error(
      data?.error ||
        `${path} 不可用。若在本地调试 AI，请用 pnpm dev:pages 打开 http://127.0.0.1:8788/。`
    )
  }

  if (!data) {
    throw new Error(
      `${path} 没有返回 JSON。若在本地调试 AI，请用 pnpm dev:pages，而不是只用 pnpm dev。`
    )
  }

  return data
}

export async function sendAgentTurn({ messages }: { messages: GeminiContent[]; toolResults?: unknown[] }) {
  return authedFetch('/api/ai/chat', {
    method: 'POST',
    body: JSON.stringify({ contents: messages, clientDate: formatLocalDateKey() }),
  }) as Promise<{
    agent_trace?: AssistantAgentTraceItem[]
    modelContent: GeminiContent
    text: string
    functionCalls: Array<{ id?: string; name: string; args?: Record<string, unknown> }>
    rag_sources?: AssistantRagSource[]
    usageMetadata: unknown
  }>
}

export async function fetchCalendarEvents({
  timeMax,
  timeMin,
}: {
  timeMax: string
  timeMin: string
}) {
  const params = new URLSearchParams({ timeMax, timeMin })
  return authedFetch(`/api/calendar/events?${params.toString()}`, {
    method: 'GET',
  }) as Promise<{ connected: boolean; events: CalendarEvent[] }>
}

export async function fetchCalendarStatus() {
  return authedFetch('/api/calendar/status', { method: 'GET' }) as Promise<{ connected: boolean }>
}

export async function generateDailyBrief({
  context,
  date,
}: {
  context: unknown
  date: string
  force?: boolean
}) {
  return authedFetch('/api/ai/brief', {
    method: 'POST',
    body: JSON.stringify({ context, date }),
  }) as Promise<DailyBriefResult>
}

function getReflectionRequestRange(periodType: AssistantReflectionPeriodType, date: string) {
  const start =
    periodType === 'weekly'
      ? addDaysToDateKey(date, -((parseLocalDateKey(date).getDay() + 6) % 7))
      : date
  const end = periodType === 'weekly' ? addDaysToDateKey(start, 6) : start
  return {
    timeMax: parseLocalDateKey(addDaysToDateKey(end, 1)).toISOString(),
    timeMin: parseLocalDateKey(start).toISOString(),
  }
}

export async function generateAssistantReflection({
  date = formatLocalDateKey(),
  periodType,
}: {
  date?: string
  periodType: AssistantReflectionPeriodType
}) {
  return authedFetch('/api/ai/reflection', {
    method: 'POST',
    body: JSON.stringify({
      date,
      periodType,
      ...getReflectionRequestRange(periodType, date),
    }),
  }) as Promise<AssistantReflectionResult>
}

export async function fetchAssistantMemories() {
  return authedFetch('/api/ai/memories', { method: 'GET' }) as Promise<{ memories: AssistantMemory[] }>
}

export async function updateAssistantMemory(input: {
  body?: string
  id: string
  memory_type?: AssistantMemoryType
  scope?: string
  title?: string
}) {
  return authedFetch('/api/ai/memories', {
    method: 'PATCH',
    body: JSON.stringify(input),
  }) as Promise<{ memory: AssistantMemory }>
}

export async function deleteAssistantMemory(id: string) {
  const params = new URLSearchParams({ id })
  return authedFetch(`/api/ai/memories?${params.toString()}`, {
    method: 'DELETE',
  }) as Promise<{ deleted: boolean }>
}

export async function indexAssistantRag(input: {
  limit?: number
  sourceTypes?: AssistantRagSourceType[]
} = {}) {
  return authedFetch('/api/ai/rag/index', {
    method: 'POST',
    body: JSON.stringify(input),
  }) as Promise<AssistantRagIndexResult>
}

export async function saveCalendarConnectionFromSession(session: Session | null) {
  const oauthSession = session as OAuthSession | null
  if (!oauthSession?.provider_token) return false

  await authedFetch('/api/calendar/connect', {
    method: 'POST',
    body: JSON.stringify({
      expiresIn: oauthSession.expires_in,
      providerRefreshToken: oauthSession.provider_refresh_token ?? null,
      providerToken: oauthSession.provider_token,
      tokenType: oauthSession.token_type ?? 'Bearer',
    }),
  })

  return true
}

export async function connectGoogleCalendar() {
  if (!supabase) throw new Error('Supabase 未配置，无法连接 Google Calendar。')

  const { data: sessionData } = await supabase.auth.getSession()
  if (!sessionData.session) throw new Error('请先登录后再连接 Google Calendar。')

  const auth = supabase.auth as typeof supabase.auth & {
    linkIdentity: (credentials: {
      provider: 'google'
      options: {
        queryParams: Record<string, string>
        redirectTo: string
        scopes: string
      }
    }) => Promise<{ error: Error | null }>
  }

  const { error } = await auth.linkIdentity({
    provider: 'google',
    options: {
      queryParams: {
        access_type: 'offline',
        prompt: 'consent',
      },
      redirectTo: window.location.origin,
      scopes: 'openid email profile https://www.googleapis.com/auth/calendar.readonly',
    },
  })

  if (error) throw error
}
