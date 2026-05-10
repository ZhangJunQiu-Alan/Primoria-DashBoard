export interface GeminiFunctionCall {
  id?: string
  name: string
  args?: Record<string, unknown>
}

export interface GeminiPart {
  text?: string
  functionCall?: GeminiFunctionCall
  functionResponse?: {
    id?: string
    name: string
    response: Record<string, unknown>
  }
}

export interface GeminiContent {
  role: 'user' | 'model'
  parts: GeminiPart[]
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

export interface DailyBriefResult {
  agent_trace?: AssistantAgentTraceItem[]
  rag_sources?: AssistantRagSource[]
  summary: string
  recommendation: string
}

export type AssistantReflectionPeriodType = 'daily' | 'weekly'

export type AssistantAgentRole =
  | 'orchestrator'
  | 'dashboard_operator'
  | 'memory_agent'
  | 'rag_retriever'
  | 'reflection_agent'
  | 'briefing_agent'
  | 'memory_curator'
  | 'policy_guard'

export type AssistantAgentTraceStatus = 'success' | 'fallback' | 'skipped' | 'error'

export interface AssistantAgentTraceItem {
  duration_ms?: number
  role: AssistantAgentRole
  sources_count?: number
  status: AssistantAgentTraceStatus
  summary: string
}

export type AssistantMemoryType =
  | 'user_preference'
  | 'work_habit'
  | 'project_fact'
  | 'process_rule'

export interface AssistantMemory {
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

export type AssistantRagSourceType =
  | 'content_item'
  | 'assistant_reflection'
  | 'assistant_memory'

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
  agent_trace?: AssistantAgentTraceItem[]
  cached?: boolean
  completion_summary: string
  evidence: AssistantEvidenceItem[]
  generated_at: string
  habit_signals: AssistantHabitSignal[]
  memory_updates?: AssistantMemoryUpdateSummary
  model: string | null
  period_end: string
  period_start: string
  period_type: AssistantReflectionPeriodType
  priority_items: AssistantPriorityItem[]
  rag_sources?: AssistantRagSource[]
  reflection_key: string
  schema_version: 1
  source_fingerprint: string
  suggestions: string[]
  summary: string
}

export interface PendingActionBase {
  id: string
  label: string
}

export type PendingAction =
  | (PendingActionBase & {
      type: 'moveScheduledTasks'
      widgetId: string
      taskIds: string[]
      toDate: string
    })
  | (PendingActionBase & {
      type: 'addScheduledTask'
      widgetId: string | null
      text: string
      dueDate: string | null
    })
  | (PendingActionBase & {
      type: 'toggleScheduledTask'
      widgetId: string
      taskId: string
      completed: boolean
    })
  | (PendingActionBase & {
      type: 'updateScheduledTask'
      widgetId: string
      taskId: string
      text?: string
      dueDate?: string | null
    })
  | (PendingActionBase & {
      type: 'removeScheduledTask'
      widgetId: string
      taskId: string
    })
  | (PendingActionBase & {
      type: 'createHabit'
      widgetId: string | null
      name: string
    })
  | (PendingActionBase & {
      type: 'updateHabitLog'
      habitId: string
      date: string
      checked: boolean
    })
  | (PendingActionBase & {
      type: 'writeNote'
      widgetId: string | null
      content: string
      mode: 'append' | 'replace'
      target: 'notes' | 'lined-notes'
    })
  | (PendingActionBase & {
      type: 'proposeMemoryWrite'
      memoryType: AssistantMemoryType
      title: string
      body: string
      scope: string
      existingMemoryId: string | null
    })
