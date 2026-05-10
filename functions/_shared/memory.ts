import { generateGeminiContent, getGeminiModel } from './gemini'
import { HttpError, type FunctionEnv } from './http'
import type { AssistantReflectionResult, StoredReflectionRow } from './reflection'

export const ASSISTANT_MEMORY_TYPES = [
  'user_preference',
  'work_habit',
  'project_fact',
  'process_rule',
] as const

export type AssistantMemoryType = typeof ASSISTANT_MEMORY_TYPES[number]

export interface AssistantMemoryRow {
  body: string
  confidence: number
  created_at: string
  evidence: Record<string, unknown>[]
  id: string
  last_seen_at: string
  memory_type: AssistantMemoryType
  schema_version: 1
  scope: string
  source_reflection_keys: string[]
  title: string
  updated_at: string
  user_modified_at: string | null
}

export interface AssistantMemoryUpdateSummary {
  created: number
  extracted: boolean
  skipped: number
  updated: number
}

export type ReflectionWithMemoryState = AssistantReflectionResult | StoredReflectionRow

interface LlmMemoryCandidate {
  body: string
  confidence: number
  evidence: Record<string, unknown>[]
  id: string | null
  memory_type: AssistantMemoryType
  operation: 'create' | 'update'
  scope: string
  title: string
}

interface MemoryMutations {
  createRows: Record<string, unknown>[]
  skipped: number
  updateRows: Array<{ id: string; row: Record<string, unknown> }>
}

const MEMORY_SELECT =
  'id,memory_type,scope,title,body,confidence,evidence,source_reflection_keys,last_seen_at,user_modified_at,created_at,updated_at,schema_version'
const MEMORY_SCHEMA_VERSION = 1
const MIN_MEMORY_CONFIDENCE = 0.6
const MAX_MEMORY_TEXT_LENGTH = 900
const MAX_MEMORY_TITLE_LENGTH = 120
const MAX_MEMORY_EVIDENCE_ITEMS = 12

const MEMORY_SYSTEM_PROMPT = `
你是 Primoria Dashboard 的长期记忆提炼层。你只从反思结果中提炼稳定、长期、有复用价值的记忆。
只输出严格 JSON，不要 Markdown。不要输出短期任务、一次性建议、当天状态或未被证据支持的猜测。
允许的 memory_type 只有 user_preference、work_habit、project_fact、process_rule。
confidence 低于 0.6 的候选不要输出。
`.trim()

function restHeaders(env: FunctionEnv, prefer?: string) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new HttpError(500, 'SUPABASE_SERVICE_ROLE_KEY is not configured')
  }

  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
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

function isMemoryType(value: unknown): value is AssistantMemoryType {
  return ASSISTANT_MEMORY_TYPES.includes(value as AssistantMemoryType)
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

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function sanitizeText(value: string, maxLength = MAX_MEMORY_TEXT_LENGTH) {
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

function extractJsonObject(text: string) {
  const trimmed = text.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) return fenced[1].trim()
  const first = trimmed.indexOf('{')
  const last = trimmed.lastIndexOf('}')
  return first >= 0 && last > first ? trimmed.slice(first, last + 1) : trimmed
}

function normalizeMemoryRow(row: Record<string, unknown>): AssistantMemoryRow {
  return {
    body: sanitizeText(asString(row.body) ?? ''),
    confidence: clamp(asNumber(row.confidence) ?? 0.5, 0, 1),
    created_at: asString(row.created_at) ?? '',
    evidence: Array.isArray(row.evidence)
      ? row.evidence.filter(isRecord).map((item) => sanitizeJsonValue(item) as Record<string, unknown>)
      : [],
    id: asString(row.id) ?? '',
    last_seen_at: asString(row.last_seen_at) ?? '',
    memory_type: isMemoryType(row.memory_type) ? row.memory_type : 'project_fact',
    schema_version: 1,
    scope: sanitizeText(asString(row.scope) ?? 'global', 80) || 'global',
    source_reflection_keys: Array.isArray(row.source_reflection_keys)
      ? row.source_reflection_keys.filter((item): item is string => typeof item === 'string')
      : [],
    title: sanitizeText(asString(row.title) ?? '', MAX_MEMORY_TITLE_LENGTH),
    updated_at: asString(row.updated_at) ?? '',
    user_modified_at: asString(row.user_modified_at),
  }
}

function compactReflection(reflection: ReflectionWithMemoryState) {
  return {
    completion_summary: sanitizeText(reflection.completion_summary, 700),
    evidence: sanitizeJsonValue(reflection.evidence),
    generated_at: reflection.generated_at,
    habit_signals: sanitizeJsonValue(reflection.habit_signals),
    period_end: reflection.period_end,
    period_start: reflection.period_start,
    period_type: reflection.period_type,
    priority_items: sanitizeJsonValue(reflection.priority_items),
    reflection_key: reflection.reflection_key,
    suggestions: sanitizeJsonValue(reflection.suggestions),
    summary: sanitizeText(reflection.summary, 700),
  }
}

function compactMemory(memory: AssistantMemoryRow) {
  return {
    body: sanitizeText(memory.body, 420),
    confidence: memory.confidence,
    id: memory.id,
    memory_type: memory.memory_type,
    scope: memory.scope,
    title: memory.title,
    user_modified: Boolean(memory.user_modified_at),
  }
}

export function buildMemoryExtractionPrompt(
  reflection: ReflectionWithMemoryState,
  existingMemories: AssistantMemoryRow[]
) {
  return JSON.stringify({
    instruction: [
      '从 reflection 中提炼稳定长期记忆；不要提炼一次性任务、当天完成数、临时优先级。',
      '如果是更新已有记忆，operation=update 并提供 existing_memories 中的 id。',
      '如果已有记忆被 user_modified=true 标记，仍可引用该 id，但不要试图改写用户手动维护的事实表述。',
      '只输出 {"memories":[...]}，不要输出 Markdown 或解释。',
    ],
    output_schema: {
      memories: [{
        body: 'string',
        confidence: 'number 0-1, must be >= 0.6',
        evidence: 'array of compact evidence objects',
        id: 'existing memory id for update, otherwise null',
        memory_type: ASSISTANT_MEMORY_TYPES,
        operation: 'create | update',
        scope: 'string, e.g. global | dashboard | project:<name>',
        title: 'short string',
      }],
    },
    allowed_memory_types: ASSISTANT_MEMORY_TYPES,
    confidence_threshold: MIN_MEMORY_CONFIDENCE,
    existing_memories: existingMemories.slice(0, 80).map(compactMemory),
    reflection: compactReflection(reflection),
  })
}

export function parseMemoryExtractionResponse(
  llmText: string,
  existingMemories: AssistantMemoryRow[]
) {
  try {
    const parsed = JSON.parse(extractJsonObject(llmText)) as { memories?: unknown }
    if (!Array.isArray(parsed.memories)) return { candidates: [] as LlmMemoryCandidate[], skipped: 1 }

    const existingIds = new Set(existingMemories.map((memory) => memory.id))
    const candidates = parsed.memories.flatMap((item): LlmMemoryCandidate[] => {
      if (!isRecord(item)) return []
      const operation = item.operation === 'update' ? 'update' : item.operation === 'create' ? 'create' : null
      const memoryType = isMemoryType(item.memory_type) ? item.memory_type : null
      const confidence = asNumber(item.confidence)
      const title = sanitizeText(asString(item.title) ?? '', MAX_MEMORY_TITLE_LENGTH)
      const body = sanitizeText(asString(item.body) ?? '')
      const scope = sanitizeText(asString(item.scope) ?? 'global', 80) || 'global'
      const id = asString(item.id)

      if (!operation || !memoryType || confidence === null || !title || !body) return []
      if (confidence < MIN_MEMORY_CONFIDENCE) return []
      if (operation === 'update' && (!id || !existingIds.has(id))) return []

      return [{
        body,
        confidence: clamp(confidence, 0, 1),
        evidence: Array.isArray(item.evidence)
          ? item.evidence.filter(isRecord).map((evidence) => sanitizeJsonValue(evidence) as Record<string, unknown>)
          : [],
        id: id && existingIds.has(id) ? id : null,
        memory_type: memoryType,
        operation,
        scope,
        title,
      }]
    })

    return { candidates, skipped: parsed.memories.length - candidates.length }
  } catch {
    return { candidates: [] as LlmMemoryCandidate[], skipped: 1 }
  }
}

function normalizedMemoryKey(memory: Pick<AssistantMemoryRow | LlmMemoryCandidate, 'body' | 'memory_type' | 'scope' | 'title'>) {
  return [
    memory.memory_type,
    memory.scope.toLowerCase(),
    memory.title.toLowerCase(),
    memory.body.toLowerCase(),
  ].join('|')
}

function mergeEvidence(
  existing: Record<string, unknown>[],
  candidate: Record<string, unknown>[],
  reflection: ReflectionWithMemoryState
) {
  const sourceEvidence = {
    note: '来自反思层长期记忆提炼。',
    period_end: reflection.period_end,
    period_start: reflection.period_start,
    period_type: reflection.period_type,
    reflection_key: reflection.reflection_key,
  }

  return [...candidate, sourceEvidence, ...existing]
    .map((item) => sanitizeJsonValue(item) as Record<string, unknown>)
    .slice(0, MAX_MEMORY_EVIDENCE_ITEMS)
}

function mergeSourceReflectionKeys(existing: string[], reflectionKey: string) {
  return Array.from(new Set([reflectionKey, ...existing])).slice(0, 20)
}

export function buildMemoryMutations({
  candidates,
  existingMemories,
  now,
  reflection,
  skipped,
  userId,
}: {
  candidates: LlmMemoryCandidate[]
  existingMemories: AssistantMemoryRow[]
  now: string
  reflection: ReflectionWithMemoryState
  skipped: number
  userId: string
}): MemoryMutations {
  const existingById = new Map(existingMemories.map((memory) => [memory.id, memory]))
  const existingByKey = new Map(existingMemories.map((memory) => [normalizedMemoryKey(memory), memory]))
  const createRows: Record<string, unknown>[] = []
  const updateRows: Array<{ id: string; row: Record<string, unknown> }> = []
  let skippedCount = skipped

  for (const candidate of candidates) {
    const exactMatch = existingByKey.get(normalizedMemoryKey(candidate))
    const existing = candidate.id ? existingById.get(candidate.id) : exactMatch

    if (!existing && candidate.operation === 'update') {
      skippedCount += 1
      continue
    }

    if (existing) {
      const evidence = mergeEvidence(existing.evidence, candidate.evidence, reflection)
      const sourceReflectionKeys = mergeSourceReflectionKeys(existing.source_reflection_keys, reflection.reflection_key)
      const row: Record<string, unknown> = existing.user_modified_at
        ? {
            evidence,
            last_seen_at: now,
            source_reflection_keys: sourceReflectionKeys,
          }
        : {
            body: candidate.body,
            confidence: candidate.confidence,
            evidence,
            last_seen_at: now,
            memory_type: candidate.memory_type,
            scope: candidate.scope,
            source_reflection_keys: sourceReflectionKeys,
            title: candidate.title,
          }
      updateRows.push({ id: existing.id, row })
      continue
    }

    createRows.push({
      body: candidate.body,
      confidence: candidate.confidence,
      evidence: mergeEvidence([], candidate.evidence, reflection),
      last_seen_at: now,
      memory_type: candidate.memory_type,
      schema_version: MEMORY_SCHEMA_VERSION,
      scope: candidate.scope,
      source_reflection_keys: [reflection.reflection_key],
      title: candidate.title,
      user_id: userId,
    })
  }

  return { createRows, skipped: skippedCount, updateRows }
}

export async function readAssistantMemories({
  env,
  userId,
}: {
  env: FunctionEnv
  userId: string
}) {
  const supabaseUrl = getSupabaseRestUrl(env)
  const params = new URLSearchParams({
    order: 'last_seen_at.desc,updated_at.desc',
    select: MEMORY_SELECT,
    user_id: `eq.${userId}`,
  })
  const response = await fetch(`${supabaseUrl}/rest/v1/user_assistant_memories?${params.toString()}`, {
    headers: restHeaders(env),
  })

  if (!response.ok) throw new HttpError(500, 'Unable to read assistant memories')
  const rows = await response.json() as Record<string, unknown>[]
  return rows.map(normalizeMemoryRow)
}

async function insertMemoryRows({
  env,
  rows,
}: {
  env: FunctionEnv
  rows: Record<string, unknown>[]
}) {
  if (rows.length === 0) return
  const supabaseUrl = getSupabaseRestUrl(env)
  const response = await fetch(`${supabaseUrl}/rest/v1/user_assistant_memories`, {
    body: JSON.stringify(rows),
    headers: restHeaders(env, 'return=minimal'),
    method: 'POST',
  })
  if (!response.ok) throw new HttpError(500, 'Unable to insert assistant memories')
}

async function patchMemoryRows({
  env,
  rows,
  userId,
}: {
  env: FunctionEnv
  rows: Array<{ id: string; row: Record<string, unknown> }>
  userId: string
}) {
  const supabaseUrl = getSupabaseRestUrl(env)
  for (const item of rows) {
    const params = new URLSearchParams({ id: `eq.${item.id}`, user_id: `eq.${userId}` })
    const response = await fetch(`${supabaseUrl}/rest/v1/user_assistant_memories?${params.toString()}`, {
      body: JSON.stringify(item.row),
      headers: restHeaders(env, 'return=minimal'),
      method: 'PATCH',
    })
    if (!response.ok) throw new HttpError(500, 'Unable to update assistant memory')
  }
}

async function markReflectionMemoryExtracted({
  env,
  reflection,
  summary,
  userId,
}: {
  env: FunctionEnv
  reflection: ReflectionWithMemoryState
  summary: AssistantMemoryUpdateSummary
  userId: string
}) {
  const supabaseUrl = getSupabaseRestUrl(env)
  const params = new URLSearchParams({
    reflection_key: `eq.${reflection.reflection_key}`,
    user_id: `eq.${userId}`,
  })
  const response = await fetch(`${supabaseUrl}/rest/v1/user_assistant_reflections?${params.toString()}`, {
    body: JSON.stringify({
      memory_extracted_at: new Date().toISOString(),
      memory_source_fingerprint: reflection.source_fingerprint,
      memory_update_count: summary.created + summary.updated,
    }),
    headers: restHeaders(env, 'return=minimal'),
    method: 'PATCH',
  })
  if (!response.ok) throw new HttpError(500, 'Unable to mark assistant reflection memory extraction')
}

export async function extractAssistantMemories({
  env,
  reflection,
  userId,
}: {
  env: FunctionEnv
  reflection: ReflectionWithMemoryState
  userId: string
}): Promise<AssistantMemoryUpdateSummary> {
  if (
    reflection.memory_extracted_at &&
    reflection.memory_source_fingerprint === reflection.source_fingerprint
  ) {
    return { created: 0, extracted: false, skipped: 0, updated: 0 }
  }

  const existingMemories = await readAssistantMemories({ env, userId })
  let parsed = { candidates: [] as LlmMemoryCandidate[], skipped: 0 }

  try {
    const generated = await generateGeminiContent({
      contents: [{
        role: 'user',
        parts: [{ text: buildMemoryExtractionPrompt(reflection, existingMemories) }],
      }],
      env,
      systemInstruction: MEMORY_SYSTEM_PROMPT,
    })
    parsed = parseMemoryExtractionResponse(generated.text, existingMemories)
  } catch {
    return { created: 0, extracted: false, skipped: 1, updated: 0 }
  }

  const now = new Date().toISOString()
  const mutations = buildMemoryMutations({
    candidates: parsed.candidates,
    existingMemories,
    now,
    reflection,
    skipped: parsed.skipped,
    userId,
  })

  await insertMemoryRows({ env, rows: mutations.createRows })
  await patchMemoryRows({ env, rows: mutations.updateRows, userId })

  const summary = {
    created: mutations.createRows.length,
    extracted: true,
    skipped: mutations.skipped,
    updated: mutations.updateRows.length,
  }
  await markReflectionMemoryExtracted({ env, reflection, summary, userId })
  return summary
}

export async function createAssistantMemory({
  env,
  input,
  userId,
}: {
  env: FunctionEnv
  input: {
    body?: unknown
    confidence?: unknown
    memory_type?: unknown
    scope?: unknown
    title?: unknown
  }
  userId: string
}) {
  const memoryType = isMemoryType(input.memory_type) ? input.memory_type : null
  if (!memoryType) throw new HttpError(400, 'memory_type is invalid')

  const title = sanitizeText(asString(input.title) ?? '', MAX_MEMORY_TITLE_LENGTH)
  if (!title) throw new HttpError(400, 'title is required')

  const body = sanitizeText(asString(input.body) ?? '')
  if (!body) throw new HttpError(400, 'body is required')

  const scope = sanitizeText(asString(input.scope) ?? 'global', 80) || 'global'
  const confidence = clamp(asNumber(input.confidence) ?? 0.95, 0, 1)
  const now = new Date().toISOString()

  const row = {
    body,
    confidence,
    evidence: [{ note: '由用户在 AI 助手对话中确认写入。', recorded_at: now }],
    last_seen_at: now,
    memory_type: memoryType,
    schema_version: MEMORY_SCHEMA_VERSION,
    scope,
    source_reflection_keys: [],
    title,
    user_id: userId,
    user_modified_at: now,
  }

  const supabaseUrl = getSupabaseRestUrl(env)
  const params = new URLSearchParams({ select: MEMORY_SELECT })
  const response = await fetch(`${supabaseUrl}/rest/v1/user_assistant_memories?${params.toString()}`, {
    body: JSON.stringify(row),
    headers: restHeaders(env, 'return=representation'),
    method: 'POST',
  })

  if (!response.ok) throw new HttpError(500, 'Unable to create assistant memory')
  const rows = await response.json() as Record<string, unknown>[]
  if (!rows[0]) throw new HttpError(500, 'Assistant memory not created')
  return normalizeMemoryRow(rows[0])
}

export async function updateAssistantMemory({
  env,
  input,
  userId,
}: {
  env: FunctionEnv
  input: {
    body?: unknown
    id?: unknown
    memory_type?: unknown
    scope?: unknown
    title?: unknown
  }
  userId: string
}) {
  const id = asString(input.id)
  if (!id) throw new HttpError(400, 'memory id is required')

  const body = input.body === undefined ? undefined : sanitizeText(asString(input.body) ?? '')
  const title = input.title === undefined ? undefined : sanitizeText(asString(input.title) ?? '', MAX_MEMORY_TITLE_LENGTH)
  const scope = input.scope === undefined ? undefined : sanitizeText(asString(input.scope) ?? 'global', 80) || 'global'
  const memoryType = input.memory_type === undefined
    ? undefined
    : isMemoryType(input.memory_type)
      ? input.memory_type
      : null

  if (memoryType === null) throw new HttpError(400, 'memory_type is invalid')
  if (body !== undefined && !body) throw new HttpError(400, 'body cannot be empty')
  if (title !== undefined && !title) throw new HttpError(400, 'title cannot be empty')

  const patch: Record<string, unknown> = { user_modified_at: new Date().toISOString() }
  if (body !== undefined) patch.body = body
  if (title !== undefined) patch.title = title
  if (scope !== undefined) patch.scope = scope
  if (memoryType !== undefined) patch.memory_type = memoryType

  const supabaseUrl = getSupabaseRestUrl(env)
  const params = new URLSearchParams({ id: `eq.${id}`, select: MEMORY_SELECT, user_id: `eq.${userId}` })
  const response = await fetch(`${supabaseUrl}/rest/v1/user_assistant_memories?${params.toString()}`, {
    body: JSON.stringify(patch),
    headers: restHeaders(env, 'return=representation'),
    method: 'PATCH',
  })

  if (!response.ok) throw new HttpError(500, 'Unable to update assistant memory')
  const rows = await response.json() as Record<string, unknown>[]
  if (!rows[0]) throw new HttpError(404, 'Assistant memory not found')
  return normalizeMemoryRow(rows[0])
}

export async function deleteAssistantMemory({
  env,
  id,
  userId,
}: {
  env: FunctionEnv
  id: string | null
  userId: string
}) {
  if (!id) throw new HttpError(400, 'memory id is required')
  const supabaseUrl = getSupabaseRestUrl(env)
  const params = new URLSearchParams({ id: `eq.${id}`, user_id: `eq.${userId}` })
  const response = await fetch(`${supabaseUrl}/rest/v1/user_assistant_memories?${params.toString()}`, {
    headers: restHeaders(env, 'return=minimal'),
    method: 'DELETE',
  })
  if (!response.ok) throw new HttpError(500, 'Unable to delete assistant memory')
  return { deleted: true }
}

export function getAssistantMemoryModel(env: FunctionEnv) {
  return getGeminiModel(env)
}
