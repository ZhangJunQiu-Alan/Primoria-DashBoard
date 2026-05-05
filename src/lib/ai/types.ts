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
  summary: string
  recommendation: string
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
