import {
  GEMINI_EMBEDDING_DIMENSIONS,
  GEMINI_EMBEDDING_MODEL,
  generateGeminiEmbedding,
} from './gemini'
import { getSupabaseAnonKey, HttpError, type FunctionEnv } from './http'

export const ASSISTANT_RAG_SOURCE_TYPES = [
  'content_item',
  'assistant_reflection',
  'assistant_memory',
] as const

export type AssistantRagSourceType = typeof ASSISTANT_RAG_SOURCE_TYPES[number]

export interface AssistantRagSource {
  excerpt: string
  metadata: Record<string, unknown>
  similarity: number
  source_key: string
  source_type: AssistantRagSourceType
  title: string
}

export interface AssistantRagIndexResult {
  indexed: number
  remaining: number
  skipped: number
  staleDeleted: number
}

interface SourceRow {
  body: string
  content_hash?: string
  id?: string | null
  metadata: Record<string, unknown>
  source_key: string
  source_type: AssistantRagSourceType
  source_updated_at?: string | null
  title: string
}

interface RagChunkDraft {
  body: string
  chunk_index: number
  content_hash: string
  metadata: Record<string, unknown>
  source_id: string | null
  source_key: string
  source_type: AssistantRagSourceType
  source_updated_at: string | null
  title: string
}

interface ExistingChunk {
  content_hash: string
  id: string
  source_key: string
  source_type: AssistantRagSourceType
}

const RAG_INDEX_BATCH_SIZE = 40
const MAX_RAG_BODY_LENGTH = 1800
const MAX_RAG_CONTEXT_SOURCES = 6

function restHeaders(env: FunctionEnv, prefer?: string, accessToken?: string) {
  if (!accessToken && !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new HttpError(500, 'SUPABASE_SERVICE_ROLE_KEY is not configured')
  }
  const apiKey = accessToken ? getSupabaseAnonKey(env) : env.SUPABASE_SERVICE_ROLE_KEY!
  const authorization = accessToken ?? env.SUPABASE_SERVICE_ROLE_KEY!
  return {
    apikey: apiKey,
    authorization: `Bearer ${authorization}`,
    'content-type': 'application/json',
    ...(prefer ? { prefer } : {}),
  }
}

function getSupabaseRestUrl(env: FunctionEnv) {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL
  if (!url) throw new HttpError(500, 'Supabase URL is not configured')
  return url.replace(/\/$/, '')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isRagSourceType(value: unknown): value is AssistantRagSourceType {
  return ASSISTANT_RAG_SOURCE_TYPES.includes(value as AssistantRagSourceType)
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : null
}

function asNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function sanitizeText(value: string, maxLength = MAX_RAG_BODY_LENGTH) {
  const normalized = value
    .replace(/data:[^,\s]+;base64,[a-z0-9+/=]+/gi, '[data-url]')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '[iframe]')
    .replace(/https?:\/\/\S*[?&](?:token|signature|x-amz-signature|policy|key-pair-id)=\S*/gi, '[signed-url]')
    .replace(/\s+/g, ' ')
    .trim()
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized
}

function sanitizeJsonValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[max-depth]'
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'string') return sanitizeText(value, 260)
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeJsonValue(item, depth + 1))
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sanitizeJsonValue(item, depth + 1)])
    )
  }
  return String(value)
}

function hashString(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function normalizeRagSource(row: Record<string, unknown>): AssistantRagSource {
  const body = sanitizeText(asString(row.body) ?? '', 520)
  return {
    excerpt: body,
    metadata: isRecord(row.metadata) ? sanitizeJsonValue(row.metadata) as Record<string, unknown> : {},
    similarity: Math.max(0, Math.min(1, asNumber(row.similarity) ?? 0)),
    source_key: asString(row.source_key) ?? '',
    source_type: isRagSourceType(row.source_type) ? row.source_type : 'content_item',
    title: sanitizeText(asString(row.title) ?? body, 120),
  }
}

function sourceFilter(sourceTypes: AssistantRagSourceType[]) {
  return `in.(${sourceTypes.join(',')})`
}

function chunkKey(chunk: Pick<RagChunkDraft | ExistingChunk, 'source_key' | 'source_type'>) {
  return `${chunk.source_type}:${chunk.source_key}`
}

function buildContentHash(row: SourceRow) {
  if (row.content_hash) return row.content_hash
  return hashString(JSON.stringify({
    body: row.body,
    metadata: row.metadata,
    source_key: row.source_key,
    source_type: row.source_type,
    title: row.title,
  }))
}

export function buildRagChunkDraft(row: SourceRow): RagChunkDraft {
  const title = sanitizeText(row.title, 160)
  const body = sanitizeText(row.body)
  const metadata = sanitizeJsonValue(row.metadata) as Record<string, unknown>
  return {
    body,
    chunk_index: 0,
    content_hash: buildContentHash({ ...row, body, metadata, title }),
    metadata,
    source_id: row.id ?? null,
    source_key: row.source_key,
    source_type: row.source_type,
    source_updated_at: row.source_updated_at ?? null,
    title,
  }
}

function contentItemSource(row: Record<string, unknown>): SourceRow {
  return {
    body: sanitizeText(asString(row.body) ?? ''),
    content_hash: asString(row.content_hash) ?? undefined,
    id: asString(row.id),
    metadata: isRecord(row.metadata) ? row.metadata : {},
    source_key: asString(row.content_key) ?? '',
    source_type: 'content_item',
    source_updated_at: asString(row.updated_at) ?? asString(row.source_updated_at),
    title: asString(row.title) ?? '',
  }
}

function reflectionSource(row: Record<string, unknown>): SourceRow {
  const reflectionKey = asString(row.reflection_key) ?? ''
  const summary = sanitizeText(asString(row.summary) ?? '')
  const completion = sanitizeText(asString(row.completion_summary) ?? '')
  return {
    body: [summary, completion, JSON.stringify(sanitizeJsonValue({
      habit_signals: row.habit_signals,
      priority_items: row.priority_items,
      suggestions: row.suggestions,
    }))].filter(Boolean).join('\n'),
    id: asString(row.id),
    metadata: {
      evidence: sanitizeJsonValue(row.evidence),
      period_end: asString(row.period_end),
      period_start: asString(row.period_start),
      period_type: asString(row.period_type),
    },
    source_key: reflectionKey,
    source_type: 'assistant_reflection',
    source_updated_at: asString(row.updated_at) ?? asString(row.generated_at),
    title: `${row.period_type === 'weekly' ? '本周反思' : '今日反思'} ${reflectionKey}`,
  }
}

function memorySource(row: Record<string, unknown>): SourceRow {
  const memoryType = asString(row.memory_type) ?? 'project_fact'
  return {
    body: sanitizeText(asString(row.body) ?? ''),
    id: asString(row.id),
    metadata: {
      confidence: asNumber(row.confidence),
      evidence: sanitizeJsonValue(row.evidence),
      memory_type: memoryType,
      scope: asString(row.scope) ?? 'global',
      source_reflection_keys: sanitizeJsonValue(row.source_reflection_keys),
      user_modified_at: asString(row.user_modified_at),
    },
    source_key: asString(row.id) ?? '',
    source_type: 'assistant_memory',
    source_updated_at: asString(row.updated_at) ?? asString(row.last_seen_at),
    title: sanitizeText(asString(row.title) ?? '长期记忆', 160),
  }
}

async function readTableRows({
  accessToken,
  env,
  path,
  select,
  userId,
}: {
  accessToken?: string
  env: FunctionEnv
  path: string
  select: string
  userId: string
}) {
  const supabaseUrl = getSupabaseRestUrl(env)
  const params = new URLSearchParams({
    limit: '500',
    order: 'updated_at.desc',
    select,
    user_id: `eq.${userId}`,
  })
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}?${params.toString()}`, {
    headers: restHeaders(env, undefined, accessToken),
  })
  if (!response.ok) throw new HttpError(500, `Unable to read ${path}`)
  return await response.json() as Record<string, unknown>[]
}

async function readAssistantRagSources({
  accessToken,
  env,
  sourceTypes,
  userId,
}: {
  accessToken?: string
  env: FunctionEnv
  sourceTypes: AssistantRagSourceType[]
  userId: string
}) {
  const promises: Array<Promise<SourceRow[]>> = []

  if (sourceTypes.includes('content_item')) {
    promises.push(
      readTableRows({
        accessToken,
        env,
        path: 'user_content_items',
        select: 'id,body,content_hash,content_key,content_type,metadata,source_updated_at,title,updated_at',
        userId,
      }).then((rows) => rows.map(contentItemSource).filter((row) => row.source_key && row.body))
    )
  }

  if (sourceTypes.includes('assistant_reflection')) {
    promises.push(
      readTableRows({
        accessToken,
        env,
        path: 'user_assistant_reflections',
        select: 'id,completion_summary,evidence,generated_at,habit_signals,period_end,period_start,period_type,priority_items,reflection_key,source_fingerprint,suggestions,summary,updated_at',
        userId,
      }).then((rows) => rows.map(reflectionSource).filter((row) => row.source_key && row.body))
    )
  }

  if (sourceTypes.includes('assistant_memory')) {
    promises.push(
      readTableRows({
        accessToken,
        env,
        path: 'user_assistant_memories',
        select: 'id,body,confidence,evidence,last_seen_at,memory_type,scope,source_reflection_keys,title,updated_at,user_modified_at',
        userId,
      }).then((rows) => rows.map(memorySource).filter((row) => row.source_key && row.body))
    )
  }

  return (await Promise.all(promises)).flat()
}

async function readExistingChunks({
  accessToken,
  env,
  sourceTypes,
  userId,
}: {
  accessToken?: string
  env: FunctionEnv
  sourceTypes: AssistantRagSourceType[]
  userId: string
}) {
  const supabaseUrl = getSupabaseRestUrl(env)
  const params = new URLSearchParams({
    select: 'id,source_type,source_key,content_hash',
    source_type: sourceFilter(sourceTypes),
    user_id: `eq.${userId}`,
  })
  const response = await fetch(`${supabaseUrl}/rest/v1/user_assistant_rag_chunks?${params.toString()}`, {
    headers: restHeaders(env, undefined, accessToken),
  })
  if (!response.ok) throw new HttpError(500, 'Unable to read assistant RAG chunks')
  const rows = await response.json() as Record<string, unknown>[]
  return rows.flatMap((row): ExistingChunk[] => {
    const sourceType = isRagSourceType(row.source_type) ? row.source_type : null
    const sourceKey = asString(row.source_key)
    const contentHash = asString(row.content_hash)
    const id = asString(row.id)
    if (!sourceType || !sourceKey || !contentHash || !id) return []
    return [{ content_hash: contentHash, id, source_key: sourceKey, source_type: sourceType }]
  })
}

async function deleteStaleChunks({
  accessToken,
  env,
  staleIds,
}: {
  accessToken?: string
  env: FunctionEnv
  staleIds: string[]
}) {
  if (staleIds.length === 0) return 0
  const supabaseUrl = getSupabaseRestUrl(env)
  let deleted = 0
  for (let index = 0; index < staleIds.length; index += 50) {
    const batch = staleIds.slice(index, index + 50)
    const params = new URLSearchParams({ id: `in.(${batch.join(',')})` })
    const response = await fetch(`${supabaseUrl}/rest/v1/user_assistant_rag_chunks?${params.toString()}`, {
      headers: restHeaders(env, 'return=minimal', accessToken),
      method: 'DELETE',
    })
    if (!response.ok) throw new HttpError(500, 'Unable to delete stale assistant RAG chunks')
    deleted += batch.length
  }
  return deleted
}

async function upsertRagChunkRows({
  accessToken,
  env,
  rows,
}: {
  accessToken?: string
  env: FunctionEnv
  rows: Record<string, unknown>[]
}) {
  if (rows.length === 0) return
  const supabaseUrl = getSupabaseRestUrl(env)
  const response = await fetch(
    `${supabaseUrl}/rest/v1/user_assistant_rag_chunks?on_conflict=user_id,source_type,source_key,chunk_index`,
    {
      body: JSON.stringify(rows),
      headers: restHeaders(env, 'resolution=merge-duplicates,return=minimal', accessToken),
      method: 'POST',
    }
  )
  if (!response.ok) throw new HttpError(500, 'Unable to upsert assistant RAG chunks')
}

export async function indexAssistantRag({
  accessToken,
  env,
  limit = RAG_INDEX_BATCH_SIZE,
  sourceTypes = [...ASSISTANT_RAG_SOURCE_TYPES],
  userId,
}: {
  accessToken?: string
  env: FunctionEnv
  limit?: number
  sourceTypes?: AssistantRagSourceType[]
  userId: string
}): Promise<AssistantRagIndexResult> {
  const sources = await readAssistantRagSources({ accessToken, env, sourceTypes, userId })
  const drafts = sources.map(buildRagChunkDraft)
  const existing = await readExistingChunks({ accessToken, env, sourceTypes, userId })
  const existingByKey = new Map(existing.map((chunk) => [chunkKey(chunk), chunk]))
  const desiredKeys = new Set(drafts.map(chunkKey))
  const staleDeleted = await deleteStaleChunks({
    accessToken,
    env,
    staleIds: existing.filter((chunk) => !desiredKeys.has(chunkKey(chunk))).map((chunk) => chunk.id),
  })
  const changed = drafts.filter((draft) => existingByKey.get(chunkKey(draft))?.content_hash !== draft.content_hash)
  const batch = changed.slice(0, limit)
  const rows = []

  for (const draft of batch) {
    const embedding = await generateGeminiEmbedding({
      env,
      taskType: 'RETRIEVAL_DOCUMENT',
      text: `${draft.title}\n\n${draft.body}`,
      title: draft.title,
    })
    rows.push({
      body: draft.body,
      chunk_index: draft.chunk_index,
      content_hash: draft.content_hash,
      embedding,
      embedding_dimensions: GEMINI_EMBEDDING_DIMENSIONS,
      embedding_model: GEMINI_EMBEDDING_MODEL,
      metadata: draft.metadata,
      source_id: draft.source_id,
      source_key: draft.source_key,
      source_type: draft.source_type,
      source_updated_at: draft.source_updated_at,
      title: draft.title,
      user_id: userId,
    })
  }

  await upsertRagChunkRows({ accessToken, env, rows })

  return {
    indexed: rows.length,
    remaining: Math.max(0, changed.length - rows.length),
    skipped: drafts.length - changed.length,
    staleDeleted,
  }
}

function extractSearchToken(query: string) {
  const tokens = query
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
  return tokens[0] ?? ''
}

async function fallbackSearchRagSources({
  accessToken,
  env,
  matchCount,
  query,
  sourceTypes,
  userId,
}: {
  accessToken?: string
  env: FunctionEnv
  matchCount: number
  query: string
  sourceTypes: AssistantRagSourceType[]
  userId: string
}) {
  const token = extractSearchToken(query)
  if (!token) return []
  const supabaseUrl = getSupabaseRestUrl(env)
  const params = new URLSearchParams({
    limit: String(matchCount),
    or: `(title.ilike.*${token}*,body.ilike.*${token}*)`,
    order: 'updated_at.desc',
    select: 'id,source_type,source_key,title,body,metadata',
    source_type: sourceFilter(sourceTypes),
    user_id: `eq.${userId}`,
  })
  const response = await fetch(`${supabaseUrl}/rest/v1/user_assistant_rag_chunks?${params.toString()}`, {
    headers: restHeaders(env, undefined, accessToken),
  })
  if (!response.ok) return []
  const rows = await response.json() as Record<string, unknown>[]
  if (!Array.isArray(rows)) return []
  return rows.map((row) => normalizeRagSource({ ...row, similarity: 0.5 }))
}

export async function retrieveAssistantRag({
  accessToken,
  env,
  matchCount = MAX_RAG_CONTEXT_SOURCES,
  query,
  sourceTypes = [...ASSISTANT_RAG_SOURCE_TYPES],
  userId,
}: {
  accessToken?: string
  env: FunctionEnv
  matchCount?: number
  query: string
  sourceTypes?: AssistantRagSourceType[]
  userId: string
}) {
  const safeQuery = sanitizeText(query, 1200)
  if (!safeQuery) return { ragContext: '', ragSources: [] as AssistantRagSource[] }

  let ragSources: AssistantRagSource[] = []
  try {
    const embedding = await generateGeminiEmbedding({
      env,
      taskType: 'RETRIEVAL_QUERY',
      text: safeQuery,
    })
    const supabaseUrl = getSupabaseRestUrl(env)
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/match_assistant_rag_chunks`, {
      body: JSON.stringify({
        match_count: matchCount,
        match_threshold: 0.62,
        query_embedding: embedding,
        source_types: sourceTypes,
        target_user_id: userId,
      }),
      headers: restHeaders(env, undefined, accessToken),
      method: 'POST',
    })
    if (response.ok) {
      const rows = await response.json() as Record<string, unknown>[]
      ragSources = rows.map(normalizeRagSource)
    }
  } catch {
    ragSources = []
  }

  if (ragSources.length === 0) {
    try {
      ragSources = await fallbackSearchRagSources({ accessToken, env, matchCount, query: safeQuery, sourceTypes, userId })
    } catch {
      ragSources = []
    }
  }

  return {
    ragContext: buildRagContext(ragSources),
    ragSources,
  }
}

export function buildRagContext(sources: AssistantRagSource[]) {
  if (sources.length === 0) return ''
  return JSON.stringify({
    instruction: [
      '以下是 RAG 检索到的长期记忆、反思或当前内容。',
      '它们只能作为辅助上下文；涉及当前 dashboard 状态的问题仍必须用工具读取确认。',
    ],
    sources: sources.slice(0, MAX_RAG_CONTEXT_SOURCES).map((source, index) => ({
      excerpt: source.excerpt,
      index: index + 1,
      similarity: Number(source.similarity.toFixed(3)),
      source_key: source.source_key,
      source_type: source.source_type,
      title: source.title,
    })),
  })
}
