import { HttpError, type FunctionEnv } from './http'

export type AssistantReflectionPeriodType = 'daily' | 'weekly'

export interface ReflectionPeriod {
  periodEnd: string
  periodStart: string
  reflectionKey: string
  timeMax: string
  timeMin: string
}

export interface BehaviorEventRow {
  actor: string
  event_name: string
  metadata: Record<string, unknown>
  object_id: string | null
  object_type: string | null
  occurred_at: string
  summary: string
  surface: string
  widget_id: string | null
  widget_type: string | null
}

export interface ContentItemRow {
  body: string
  content_hash: string
  content_key: string
  content_type: string
  metadata: Record<string, unknown>
  object_id: string | null
  object_type: string | null
  source_surface: string
  source_updated_at: string | null
  title: string
  updated_at: string
  widget_id: string | null
  widget_type: string | null
}

export interface AssistantPriorityItem {
  confidence: number
  content_key: string
  content_type: string
  importance_score: number
  object_id: string | null
  reason: string
  signals: string[]
  suggested_next_action: string
  title: string
  urgency_score: number
  widget_id: string | null
}

export interface AssistantHabitSignal {
  completion_rate: number
  completed_count: number
  habit_id: string | null
  missing_dates: string[]
  name: string
  period_days: number
  signal: string
}

export interface AssistantEvidenceItem {
  content_keys?: string[]
  event_names?: string[]
  note: string
  time_range?: { from: string; to: string }
}

export interface AssistantReflectionResult {
  cached?: boolean
  completion_summary: string
  evidence: AssistantEvidenceItem[]
  generated_at: string
  habit_signals: AssistantHabitSignal[]
  model: string | null
  period_end: string
  period_start: string
  period_type: AssistantReflectionPeriodType
  priority_items: AssistantPriorityItem[]
  reflection_key: string
  schema_version: 1
  source_fingerprint: string
  suggestions: string[]
  summary: string
}

export interface StoredReflectionRow {
  completion_summary: string
  evidence: AssistantEvidenceItem[]
  generated_at: string
  habit_signals: AssistantHabitSignal[]
  model: string | null
  period_end: string
  period_start: string
  period_type: AssistantReflectionPeriodType
  priority_items: AssistantPriorityItem[]
  reflection_key: string
  schema_version: 1
  source_fingerprint: string
  suggestions: string[]
  summary: string
}

export interface ReflectionSourceContext {
  contentItems: ContentItemRow[]
  events: BehaviorEventRow[]
  period: ReflectionPeriod
  periodType: AssistantReflectionPeriodType
}

interface LlmReflectionShape {
  completion_summary?: unknown
  habit_signals?: unknown
  priority_items?: unknown
  suggestions?: unknown
  summary?: unknown
}

const MAX_CONTEXT_TEXT_LENGTH = 520
const MAX_PRIORITY_ITEMS = 8

function parseLocalDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function formatLocalDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function addDaysToDateKey(dateKey: string, amount: number) {
  const date = parseLocalDateKey(dateKey)
  date.setDate(date.getDate() + amount)
  return formatLocalDateKey(date)
}

export function getReflectionPeriod(
  periodType: AssistantReflectionPeriodType,
  dateKey: string
): ReflectionPeriod {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    throw new HttpError(400, 'date must use YYYY-MM-DD')
  }

  const periodStart =
    periodType === 'weekly'
      ? addDaysToDateKey(dateKey, -((parseLocalDateKey(dateKey).getDay() + 6) % 7))
      : dateKey
  const periodEnd = periodType === 'weekly' ? addDaysToDateKey(periodStart, 6) : periodStart
  const periodEndExclusive = addDaysToDateKey(periodEnd, 1)

  return {
    periodEnd,
    periodStart,
    reflectionKey: `${periodType}:${periodStart}`,
    timeMax: parseLocalDateKey(periodEndExclusive).toISOString(),
    timeMin: parseLocalDateKey(periodStart).toISOString(),
  }
}

export function datesInPeriod(period: Pick<ReflectionPeriod, 'periodEnd' | 'periodStart'>) {
  const dates: string[] = []
  let current = period.periodStart
  while (current <= period.periodEnd) {
    dates.push(current)
    current = addDaysToDateKey(current, 1)
  }
  return dates
}

function restHeaders(env: FunctionEnv) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new HttpError(500, 'SUPABASE_SERVICE_ROLE_KEY is not configured')
  }
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json',
  }
}

export function getSupabaseRestUrl(env: FunctionEnv) {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL
  if (!url) throw new HttpError(500, 'Supabase URL is not configured')
  return url.replace(/\/$/, '')
}

export async function readReflectionSourceRows({
  env,
  period,
  userId,
}: {
  env: FunctionEnv
  period: ReflectionPeriod
  userId: string
}) {
  const supabaseUrl = getSupabaseRestUrl(env)
  const headers = restHeaders(env)
  const eventParams = new URLSearchParams({
    actor: 'not.is.null',
    occurred_at: `gte.${period.timeMin}`,
    order: 'occurred_at.asc',
    select: 'actor,event_name,metadata,object_id,object_type,occurred_at,summary,surface,widget_id,widget_type',
    user_id: `eq.${userId}`,
    limit: '500',
  })
  eventParams.append('occurred_at', `lt.${period.timeMax}`)

  const contentParams = new URLSearchParams({
    order: 'updated_at.desc',
    select: 'body,content_hash,content_key,content_type,metadata,object_id,object_type,source_surface,source_updated_at,title,updated_at,widget_id,widget_type',
    user_id: `eq.${userId}`,
    limit: '300',
  })

  const [eventsResponse, contentResponse] = await Promise.all([
    fetch(`${supabaseUrl}/rest/v1/user_behavior_events?${eventParams.toString()}`, { headers }),
    fetch(`${supabaseUrl}/rest/v1/user_content_items?${contentParams.toString()}`, { headers }),
  ])

  if (!eventsResponse.ok) throw new HttpError(500, 'Unable to read behavior events')
  if (!contentResponse.ok) throw new HttpError(500, 'Unable to read content items')

  return {
    contentItems: await contentResponse.json() as ContentItemRow[],
    events: await eventsResponse.json() as BehaviorEventRow[],
  }
}

export async function readCachedReflection({
  env,
  reflectionKey,
  userId,
}: {
  env: FunctionEnv
  reflectionKey: string
  userId: string
}) {
  const supabaseUrl = getSupabaseRestUrl(env)
  const params = new URLSearchParams({
    reflection_key: `eq.${reflectionKey}`,
    select: 'completion_summary,evidence,generated_at,habit_signals,model,period_end,period_start,period_type,priority_items,reflection_key,schema_version,source_fingerprint,suggestions,summary',
    user_id: `eq.${userId}`,
  })
  const response = await fetch(`${supabaseUrl}/rest/v1/user_assistant_reflections?${params.toString()}`, {
    headers: restHeaders(env),
  })

  if (!response.ok) throw new HttpError(500, 'Unable to read assistant reflection')
  const rows = await response.json() as StoredReflectionRow[]
  return rows[0] ?? null
}

export async function upsertReflection({
  env,
  result,
  userId,
}: {
  env: FunctionEnv
  result: AssistantReflectionResult
  userId: string
}) {
  const supabaseUrl = getSupabaseRestUrl(env)
  const response = await fetch(
    `${supabaseUrl}/rest/v1/user_assistant_reflections?on_conflict=user_id,reflection_key`,
    {
      body: JSON.stringify({
        completion_summary: result.completion_summary,
        evidence: result.evidence,
        generated_at: result.generated_at,
        habit_signals: result.habit_signals,
        model: result.model,
        period_end: result.period_end,
        period_start: result.period_start,
        period_type: result.period_type,
        priority_items: result.priority_items,
        reflection_key: result.reflection_key,
        schema_version: result.schema_version,
        source_fingerprint: result.source_fingerprint,
        suggestions: result.suggestions,
        summary: result.summary,
        user_id: userId,
      }),
      headers: {
        ...restHeaders(env),
        prefer: 'resolution=merge-duplicates,return=minimal',
      },
      method: 'POST',
    }
  )

  if (!response.ok) throw new HttpError(500, 'Unable to save assistant reflection')
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : null
}

function asBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : null
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function clipText(value: string, maxLength = MAX_CONTEXT_TEXT_LENGTH) {
  const normalized = value
    .replace(/data:[^,\s]+;base64,[a-z0-9+/=]+/gi, '[data-url]')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '[iframe]')
    .replace(/https?:\/\/\S*[?&](?:token|signature|x-amz-signature|policy|key-pair-id)=\S*/gi, '[signed-url]')
    .replace(/\s+/g, ' ')
    .trim()
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized
}

function hashString(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function buildSourceFingerprint(context: ReflectionSourceContext) {
  return hashString(JSON.stringify({
    content: context.contentItems
      .map((item) => [item.content_key, item.content_hash, item.updated_at])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    events: context.events.map((event) => [
      event.occurred_at,
      event.event_name,
      event.object_id,
      event.summary,
    ]),
    period: context.period,
    periodType: context.periodType,
  }))
}

function getRelatedEvents(item: ContentItemRow, events: BehaviorEventRow[]) {
  return events.filter((event) => {
    if (item.object_id && event.object_id === item.object_id) return true
    if (item.widget_id && event.widget_id === item.widget_id && event.summary.includes(item.title)) return true
    return false
  })
}

function getDueDate(item: ContentItemRow) {
  return asString(item.metadata.dueDate)
}

function compareDate(a: string | null, b: string) {
  if (!a) return 0
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

function buildTaskPriorityItem(
  item: ContentItemRow,
  events: BehaviorEventRow[],
  period: ReflectionPeriod
): AssistantPriorityItem | null {
  const relatedEvents = getRelatedEvents(item, events)
  const eventNames = relatedEvents.map((event) => event.event_name)
  const movedCount = eventNames.filter((name) => name === 'scheduled_task.moved' || name === 'todo.moved').length
  const updatedCount = eventNames.filter((name) => name === 'scheduled_task.updated' || name === 'todo.renamed').length
  const dueDate = getDueDate(item)
  const completed = asBoolean(item.metadata.completed) ?? false
  const signals: string[] = []
  let importance = item.content_type === 'pending_action' ? 82 : 55
  let urgency = item.content_type === 'pending_action' ? 78 : 40

  if (item.content_type === 'calendar_event') {
    importance = 62
    urgency = 55
    signals.push('日历事件')
    const start = asString(item.metadata.start)
    if (start?.slice(0, 10) === period.periodStart) urgency += 15
  }

  if (item.content_type === 'pending_action') {
    signals.push('等待用户确认')
  }

  if (completed) {
    signals.push('已完成')
    importance -= 30
    urgency -= 35
  } else if (item.content_type === 'scheduled_task') {
    signals.push('未完成日程任务')
    importance += 12
    urgency += 10
  } else if (item.content_type === 'todo') {
    signals.push('未完成待办')
    importance += 5
    urgency += 5
  }

  if (dueDate) {
    if (compareDate(dueDate, period.periodStart) < 0) {
      signals.push('已逾期')
      importance += 28
      urgency += 45
    } else if (dueDate >= period.periodStart && dueDate <= period.periodEnd) {
      signals.push('本周期到期')
      importance += 22
      urgency += 32
    } else {
      signals.push(`计划日期 ${dueDate}`)
      importance += 5
    }
  }

  if (movedCount > 0) {
    signals.push(movedCount >= 2 ? '多次移动或推迟' : '本周期移动过')
    importance += movedCount >= 2 ? 18 : 10
    urgency += movedCount >= 2 ? 14 : 6
  }

  if (updatedCount > 0) {
    signals.push('本周期编辑过')
    importance += 6
  }

  if (item.content_type === 'ai_message' && item.metadata.role !== 'user') return null

  const text = `${item.title} ${item.body}`.toLowerCase()
  if (/(重要|优先|必须|截止|deadline|urgent|今天|明天|会议)/i.test(text)) {
    signals.push('文本包含优先或截止信号')
    importance += 12
    urgency += 8
  }

  if (
    ![
      'scheduled_task',
      'todo',
      'pending_action',
      'calendar_event',
      'ai_message',
      'note',
      'lined_note_page',
    ].includes(item.content_type)
  ) {
    return null
  }

  if (signals.length === 0 && !item.body.trim()) return null

  const importanceScore = clamp(Math.round(importance), 0, 100)
  const urgencyScore = clamp(Math.round(urgency), 0, 100)
  if (importanceScore < 45 && urgencyScore < 45) return null

  const reason = signals.slice(0, 3).join('，') || '当前内容和本周期行为显示它可能值得关注'
  return {
    confidence: clamp(0.55 + signals.length * 0.07, 0.55, 0.9),
    content_key: item.content_key,
    content_type: item.content_type,
    importance_score: importanceScore,
    object_id: item.object_id,
    reason,
    signals,
    suggested_next_action: completed
      ? '保留为已完成记录，不需要立即处理。'
      : item.content_type === 'pending_action'
        ? '回到 AI 侧边栏确认或取消这项待执行变更。'
        : dueDate && compareDate(dueDate, period.periodStart) < 0
          ? '先决定今天完成、拆小，或移动到新的明确日期。'
          : '安排一个最小下一步，并在今天先推进一次。',
    title: clipText(item.title || item.body, 80),
    urgency_score: urgencyScore,
    widget_id: item.widget_id,
  }
}

export function scorePriorityItems(
  contentItems: ContentItemRow[],
  events: BehaviorEventRow[],
  period: ReflectionPeriod
) {
  return contentItems
    .flatMap((item) => {
      const priorityItem = buildTaskPriorityItem(item, events, period)
      return priorityItem ? [priorityItem] : []
    })
    .sort((a, b) => {
      const aScore = a.importance_score * 0.56 + a.urgency_score * 0.44
      const bScore = b.importance_score * 0.56 + b.urgency_score * 0.44
      return bScore - aScore
    })
    .slice(0, MAX_PRIORITY_ITEMS)
}

export function buildHabitSignals(contentItems: ContentItemRow[], period: ReflectionPeriod) {
  const periodDates = datesInPeriod(period)
  return contentItems
    .filter((item) => item.content_type === 'habit')
    .map<AssistantHabitSignal>((item) => {
      const logDates = new Set(asStringArray(item.metadata.logDates))
      const completedCount = periodDates.filter((date) => logDates.has(date)).length
      const missingDates = periodDates.filter((date) => !logDates.has(date))
      const completionRate = periodDates.length === 0 ? 0 : completedCount / periodDates.length
      return {
        completion_rate: Number(completionRate.toFixed(2)),
        completed_count: completedCount,
        habit_id: item.object_id,
        missing_dates: missingDates,
        name: item.title,
        period_days: periodDates.length,
        signal:
          completionRate >= 0.8
            ? '完成度稳定'
            : completionRate >= 0.4
              ? '有完成记录，但仍有缺口'
              : '本周期完成度偏低',
      }
    })
    .slice(0, 12)
}

function buildEvidence(
  priorityItems: AssistantPriorityItem[],
  events: BehaviorEventRow[],
  period: ReflectionPeriod
): AssistantEvidenceItem[] {
  const eventCounts = new Map<string, number>()
  for (const event of events) {
    eventCounts.set(event.event_name, (eventCounts.get(event.event_name) ?? 0) + 1)
  }
  return [
    {
      content_keys: priorityItems.map((item) => item.content_key),
      note: '优先级来自当前内容索引与规则评分候选。',
    },
    {
      event_names: [...eventCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([name, count]) => `${name}:${count}`),
      note: '本周期行为事件统计。',
      time_range: { from: period.timeMin, to: period.timeMax },
    },
  ]
}

export function buildRuleReflection(context: ReflectionSourceContext): AssistantReflectionResult {
  const priorityItems = scorePriorityItems(context.contentItems, context.events, context.period)
  const habitSignals = buildHabitSignals(context.contentItems, context.period)
  const completedTasks = context.contentItems.filter((item) =>
    ['scheduled_task', 'todo'].includes(item.content_type) && asBoolean(item.metadata.completed) === true
  ).length
  const openTasks = context.contentItems.filter((item) =>
    ['scheduled_task', 'todo'].includes(item.content_type) && asBoolean(item.metadata.completed) !== true
  ).length
  const movedEvents = context.events.filter((event) =>
    event.event_name === 'scheduled_task.moved' || event.event_name === 'todo.moved'
  ).length
  const reflectionLabel = context.periodType === 'daily' ? '今天' : '本周'
  const topTitle = priorityItems[0]?.title

  return {
    completion_summary: `${reflectionLabel}当前有 ${completedTasks} 个已完成任务、${openTasks} 个未完成任务；记录到 ${movedEvents} 次任务移动。`,
    evidence: buildEvidence(priorityItems, context.events, context.period),
    generated_at: new Date().toISOString(),
    habit_signals: habitSignals,
    model: null,
    period_end: context.period.periodEnd,
    period_start: context.period.periodStart,
    period_type: context.periodType,
    priority_items: priorityItems,
    reflection_key: context.period.reflectionKey,
    schema_version: 1,
    source_fingerprint: buildSourceFingerprint(context),
    suggestions: [
      topTitle ? `先处理「${topTitle}」。` : '先从一个最小、明确的任务开始。',
      movedEvents > 0 ? '被移动过的任务建议拆成更小步骤或重新设定日期。' : '保持任务日期清晰，避免无日期任务堆积。',
    ],
    summary: `${reflectionLabel}有 ${context.events.length} 条行为事件和 ${context.contentItems.length} 条内容项可用于反思。`,
  }
}

function buildContentContextItems(contentItems: ContentItemRow[]) {
  const importantTypes = new Set([
    'scheduled_task',
    'todo',
    'habit',
    'calendar_event',
    'pending_action',
    'daily_brief',
  ])
  const compact = contentItems
    .filter((item) => importantTypes.has(item.content_type))
    .slice(0, 80)
    .map((item) => ({
      body: clipText(item.body, 260),
      content_key: item.content_key,
      content_type: item.content_type,
      metadata: item.metadata,
      object_id: item.object_id,
      title: clipText(item.title, 120),
      widget_id: item.widget_id,
    }))

  const noteSnippets = contentItems
    .filter((item) => item.content_type === 'note' || item.content_type === 'lined_note_page')
    .slice(0, 12)
    .map((item) => ({
      body: clipText(item.body, 220),
      content_key: item.content_key,
      content_type: item.content_type,
      title: clipText(item.title, 80),
    }))

  const aiSnippets = contentItems
    .filter((item) => item.content_type === 'ai_message')
    .slice(0, 12)
    .map((item) => ({
      body: clipText(item.body, 220),
      content_key: item.content_key,
      role: item.metadata.role,
      title: clipText(item.title, 80),
    }))

  return { compact, noteSnippets, aiSnippets }
}

export function buildReflectionPrompt(context: ReflectionSourceContext, ruleResult: AssistantReflectionResult) {
  return JSON.stringify({
    instruction: [
      '你是 Personal Dashboard 的反思层，只做总结、重要性判断和低风险建议。',
      '不要输出 Markdown，不要输出 JSON 之外的文字。',
      '不要创建或执行任何 Dashboard 写入动作。',
      'priority_items 只能从 candidate_priority_items 中选择和微调排序，不要编造 content_key。',
      'importance_score 和 urgency_score 均为 0-100，confidence 为 0-1。',
    ],
    output_schema: {
      completion_summary: 'string',
      habit_signals: 'array',
      priority_items: 'array',
      suggestions: 'string[]',
      summary: 'string',
    },
    period: {
      end: context.period.periodEnd,
      start: context.period.periodStart,
      type: context.periodType,
    },
    candidate_priority_items: ruleResult.priority_items,
    content: buildContentContextItems(context.contentItems),
    event_summary: {
      count: context.events.length,
      events: context.events.slice(-160).map((event) => ({
        actor: event.actor,
        event_name: event.event_name,
        object_id: event.object_id,
        occurred_at: event.occurred_at,
        summary: clipText(event.summary, 140),
        widget_id: event.widget_id,
      })),
    },
    rule_result: ruleResult,
  })
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

function normalizeSuggestions(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback
  const suggestions = value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => clipText(item, 180))
    .slice(0, 6)
  return suggestions.length > 0 ? suggestions : fallback
}

function normalizeLlmPriorityItems(
  value: unknown,
  fallback: AssistantPriorityItem[]
): AssistantPriorityItem[] {
  if (!Array.isArray(value)) return fallback
  const fallbackByKey = new Map(fallback.map((item) => [item.content_key, item]))
  const normalized = value.flatMap((item) => {
    if (!isRecord(item)) return []
    const contentKey = asString(item.content_key)
    const base = contentKey ? fallbackByKey.get(contentKey) : null
    if (!base) return []
    return [{
      ...base,
      confidence: clamp(
        typeof item.confidence === 'number' ? item.confidence : base.confidence,
        0,
        1
      ),
      importance_score: clamp(
        typeof item.importance_score === 'number' ? Math.round(item.importance_score) : base.importance_score,
        0,
        100
      ),
      reason: asString(item.reason) ? clipText(asString(item.reason)!, 220) : base.reason,
      signals: Array.isArray(item.signals)
        ? item.signals.filter((signal): signal is string => typeof signal === 'string').slice(0, 8)
        : base.signals,
      suggested_next_action: asString(item.suggested_next_action)
        ? clipText(asString(item.suggested_next_action)!, 220)
        : base.suggested_next_action,
      urgency_score: clamp(
        typeof item.urgency_score === 'number' ? Math.round(item.urgency_score) : base.urgency_score,
        0,
        100
      ),
    }]
  })
  return normalized.length > 0 ? normalized.slice(0, MAX_PRIORITY_ITEMS) : fallback
}

export function mergeLlmReflection(
  llmText: string,
  fallback: AssistantReflectionResult,
  model: string | null
): AssistantReflectionResult {
  try {
    const parsed = JSON.parse(extractJsonObject(llmText)) as LlmReflectionShape
    const summary = typeof parsed.summary === 'string' && parsed.summary.trim()
      ? clipText(parsed.summary, 600)
      : fallback.summary
    const completionSummary =
      typeof parsed.completion_summary === 'string' && parsed.completion_summary.trim()
        ? clipText(parsed.completion_summary, 700)
        : fallback.completion_summary
    return {
      ...fallback,
      completion_summary: completionSummary,
      generated_at: new Date().toISOString(),
      habit_signals: Array.isArray(parsed.habit_signals)
        ? parsed.habit_signals.slice(0, 12) as AssistantHabitSignal[]
        : fallback.habit_signals,
      model,
      priority_items: normalizeLlmPriorityItems(parsed.priority_items, fallback.priority_items),
      suggestions: normalizeSuggestions(parsed.suggestions, fallback.suggestions),
      summary,
    }
  } catch {
    return {
      ...fallback,
      generated_at: new Date().toISOString(),
      model: null,
    }
  }
}

export function formatReflectionForChat(result: AssistantReflectionResult) {
  const title = result.period_type === 'daily' ? '今日反思' : '本周反思'
  const priorities = result.priority_items.length
    ? result.priority_items
        .slice(0, 5)
        .map((item, index) =>
          `${index + 1}. ${item.title}｜重要 ${item.importance_score} / 紧急 ${item.urgency_score}\n   ${item.reason}`
        )
        .join('\n')
    : '暂无明显高优先级事项。'
  const suggestions = result.suggestions.length
    ? result.suggestions.map((item) => `- ${item}`).join('\n')
    : '- 暂无额外建议。'

  return `${title}（${result.period_start} 至 ${result.period_end}）\n\n${result.summary}\n\n${result.completion_summary}\n\n优先级：\n${priorities}\n\n建议：\n${suggestions}`
}
