import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { getDomainFromUrl, summarizeText, trackBehaviorEvent } from '@/lib/behaviorEvents'
import { formatLocalDateKey } from '@/lib/date'
import type {
  AssistantAgentTraceItem,
  AssistantRagSource,
  CalendarEvent,
  GeminiContent,
  PendingAction,
} from '@/lib/ai/types'

export interface QuickLink {
  id: string
  title: string
  url: string
  iconUrl?: string  // custom icon: local base64 or remote URL
}

export interface TodoItem {
  id: string
  text: string
  done: boolean
  createdAt: number
}

export interface HabitItem {
  id: string
  name: string
}

export interface LinedNotePage {
  id: string
  content: string
}

export interface LinedNotesDocument {
  version: 1
  activePageId: string
  pages: LinedNotePage[]
}

export interface ScheduledTask {
  id: string
  text: string
  dueDate: string | null  // 'YYYY-MM-DD'
  completed: boolean
  completedAt?: string | null
}

export interface PomodoroData {
  totalSessions: number
  todaySessions: number
  lastSessionDate: string
}

export interface DailyBriefData {
  date: string
  summary: string
  recommendation: string
  generatedAt: string
  calendarConnected: boolean
  agentTrace?: AssistantAgentTraceItem[]
  ragSources?: AssistantRagSource[]
  sourceFingerprint: string
}

export interface AiConversationMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: string
  agentTrace?: AssistantAgentTraceItem[]
}

export interface AiToolCallRecord {
  id: string
  name: string
  args: Record<string, unknown>
  result: Record<string, unknown>
  createdAt: string
}

export interface AiConversationState {
  id: string
  title: string
  messages: AiConversationMessage[]
  geminiContents: GeminiContent[]
  toolCalls: AiToolCallRecord[]
  pendingActions: PendingAction[]
  createdAt: string
  updatedAt: string
}

interface WidgetDataState {
  // Quick Links
  quickLinks: QuickLink[]
  addQuickLink: (link: Omit<QuickLink, 'id'>) => void
  removeQuickLink: (id: string) => void

  // Todo — per widget instance
  todosByWidget: Record<string, TodoItem[]>
  addTodo: (widgetId: string, text: string) => void
  toggleTodo: (widgetId: string, id: string) => void
  removeTodo: (widgetId: string, id: string) => void
  renameTodo: (widgetId: string, id: string, text: string) => void
  clearDoneTodos: (widgetId: string) => void
  markAllDone: (widgetId: string) => void
  reorderTodos: (widgetId: string, fromIndex: number, toIndex: number) => void
  moveTodo: (fromWidgetId: string, toWidgetId: string, todoId: string, toIndex: number) => void

  // Habits — per widget instance
  habitsByWidget: Record<string, HabitItem[]>
  habitLogs: Record<string, string[]>  // habitId -> array of 'YYYY-MM-DD' strings
  addHabit: (widgetId: string, name: string) => void
  removeHabit: (widgetId: string, id: string) => void
  renameHabit: (widgetId: string, id: string, name: string) => void
  toggleHabitLog: (habitId: string, date: string) => void

  // Google Calendar embed codes — per widget instance
  calendarEmbeds: Record<string, string>
  setCalendarEmbed: (widgetId: string, code: string) => void

  // Notes — per widget instance
  notesByWidget: Record<string, string>
  setNote: (widgetId: string, content: string) => void
  appendNote: (widgetId: string, content: string) => void

  // Lined notes — per widget instance
  linedNotesByWidget: Record<string, LinedNotesDocument>
  setLinedNotesDocument: (widgetId: string, document: LinedNotesDocument) => void
  appendLinedNote: (widgetId: string, content: string) => void

  // Scheduled Todo — per widget instance
  scheduledTasksByWidget: Record<string, ScheduledTask[]>
  addScheduledTask: (widgetId: string, text: string, dueDate: string | null) => void
  toggleScheduledTask: (widgetId: string, id: string) => void
  removeScheduledTask: (widgetId: string, id: string) => void
  updateScheduledTask: (widgetId: string, id: string, updates: Partial<Pick<ScheduledTask, 'text' | 'dueDate'>>) => void
  moveTodoToScheduledDate: (
    fromWidgetId: string,
    todoId: string,
    scheduledWidgetId: string,
    dueDate: string | null
  ) => void
  moveScheduledTaskToDate: (widgetId: string, taskId: string, dueDate: string | null) => void
  moveScheduledTaskToTodo: (
    scheduledWidgetId: string,
    taskId: string,
    todoWidgetId: string,
    toIndex: number
  ) => void

  // Pomodoro
  pomodoro: PomodoroData
  incrementPomodoro: () => void

  // Daily Brief
  dailyBriefsByDate: Record<string, DailyBriefData>
  setDailyBrief: (brief: DailyBriefData) => void
  removeDailyBrief: (date: string) => void

  // Calendar read results — per local date
  calendarEventsByDate: Record<string, CalendarEvent[]>
  setCalendarEventsForDate: (date: string, events: CalendarEvent[]) => void

  // AI conversation history
  aiConversations: Record<string, AiConversationState>
  activeAiConversationId: string
  saveAiConversation: (conversation: AiConversationState) => void
  setActiveAiConversation: (conversationId: string) => void
}

export const WIDGET_DATA_STORAGE_KEY = 'primoria-widget-data'
export const LINED_NOTES_DOCUMENT_VERSION = 1
export const DEFAULT_AI_CONVERSATION_ID = 'default-dashboard-agent'
const today = () => formatLocalDateKey()
const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const makeLinedNotePageId = () => `lined-note-page-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

function shortText(value: string) {
  return summarizeText(value, 72)
}

export function createLinedNotesDocument(initialContent = ''): LinedNotesDocument {
  const firstPage = { id: makeLinedNotePageId(), content: initialContent }
  return {
    version: LINED_NOTES_DOCUMENT_VERSION,
    activePageId: firstPage.id,
    pages: [firstPage],
  }
}

export function createBlankLinedNotePage(): LinedNotePage {
  return { id: makeLinedNotePageId(), content: '' }
}

export function createAiConversationState(
  id = DEFAULT_AI_CONVERSATION_ID,
  now = new Date().toISOString()
): AiConversationState {
  return {
    createdAt: now,
    geminiContents: [],
    id,
    messages: [],
    pendingActions: [],
    title: 'Dashboard Agent',
    toolCalls: [],
    updatedAt: now,
  }
}

export function normalizeLinedNotesDocument(value: unknown): LinedNotesDocument {
  if (typeof value === 'string') return createLinedNotesDocument(value)

  if (!value || typeof value !== 'object') return createLinedNotesDocument()

  const candidate = value as Partial<LinedNotesDocument>
  const rawPages: unknown[] = Array.isArray(candidate.pages) ? candidate.pages : []
  const pages = rawPages
    .filter((page) => Boolean(page) && typeof page === 'object')
    .map((page) => ({
      id:
        typeof (page as Partial<LinedNotePage>).id === 'string' &&
        (page as Partial<LinedNotePage>).id?.trim()
          ? (page as Partial<LinedNotePage>).id as string
          : makeLinedNotePageId(),
      content:
        typeof (page as Partial<LinedNotePage>).content === 'string'
          ? (page as Partial<LinedNotePage>).content as string
          : '',
    }))

  const ensuredPages = pages.length > 0 ? pages : [createBlankLinedNotePage()]
  const activePageId = ensuredPages.some((page) => page.id === candidate.activePageId)
    ? (candidate.activePageId as string)
    : ensuredPages[0].id

  return {
    version: LINED_NOTES_DOCUMENT_VERSION,
    activePageId,
    pages: ensuredPages,
  }
}

const updateList = (
  map: Record<string, TodoItem[]>,
  widgetId: string,
  fn: (list: TodoItem[]) => TodoItem[]
) => ({ todosByWidget: { ...map, [widgetId]: fn(map[widgetId] ?? []) } })

export const useWidgetDataStore = create<WidgetDataState>()(
  persist(
    (set, get) => ({
      quickLinks: [
        { id: '1', title: 'GitHub', url: 'https://github.com' },
        { id: '2', title: 'Google', url: 'https://google.com' },
      ],
      addQuickLink: (link) => {
        const id = makeId()
        set((s) => ({ quickLinks: [...s.quickLinks, { ...link, id }] }))
        trackBehaviorEvent({
          eventName: 'quick_link.added',
          metadata: {
            domain: getDomainFromUrl(link.url),
            hasCustomIcon: Boolean(link.iconUrl),
            title: shortText(link.title),
          },
          objectId: id,
          objectType: 'quick_link',
          summary: `添加快速链接：${shortText(link.title)}`,
          surface: 'widget',
          widgetType: 'quick-links',
        })
      },
      removeQuickLink: (id) => {
        const link = get().quickLinks.find((item) => item.id === id)
        set((s) => ({ quickLinks: s.quickLinks.filter((l) => l.id !== id) }))
        if (link) {
          trackBehaviorEvent({
            eventName: 'quick_link.removed',
            metadata: {
              domain: getDomainFromUrl(link.url),
              title: shortText(link.title),
            },
            objectId: id,
            objectType: 'quick_link',
            summary: `删除快速链接：${shortText(link.title)}`,
            surface: 'widget',
            widgetType: 'quick-links',
          })
        }
      },

      todosByWidget: {},
      addTodo: (widgetId, text) => {
        const id = makeId()
        set((s) =>
          updateList(s.todosByWidget, widgetId, (list) => [
            ...list,
            { id, text, done: false, createdAt: Date.now() },
          ])
        )
        trackBehaviorEvent({
          eventName: 'todo.added',
          metadata: { textLength: text.length, textSummary: shortText(text) },
          objectId: id,
          objectType: 'todo',
          summary: `新增待办：${shortText(text)}`,
          surface: 'widget',
          widgetId,
          widgetType: 'todo',
        })
      },
      toggleTodo: (widgetId, id) => {
        const todo = get().todosByWidget[widgetId]?.find((item) => item.id === id)
        set((s) =>
          updateList(s.todosByWidget, widgetId, (list) =>
            list.map((t) => (t.id === id ? { ...t, done: !t.done } : t))
          )
        )
        if (todo) {
          trackBehaviorEvent({
            eventName: 'todo.toggled',
            metadata: {
              completed: !todo.done,
              textLength: todo.text.length,
              textSummary: shortText(todo.text),
            },
            objectId: id,
            objectType: 'todo',
            summary: `${todo.done ? '取消完成' : '完成'}待办：${shortText(todo.text)}`,
            surface: 'widget',
            widgetId,
            widgetType: 'todo',
          })
        }
      },
      removeTodo: (widgetId, id) => {
        const todo = get().todosByWidget[widgetId]?.find((item) => item.id === id)
        set((s) =>
          updateList(s.todosByWidget, widgetId, (list) => list.filter((t) => t.id !== id))
        )
        if (todo) {
          trackBehaviorEvent({
            eventName: 'todo.removed',
            metadata: { completed: todo.done, textLength: todo.text.length, textSummary: shortText(todo.text) },
            objectId: id,
            objectType: 'todo',
            summary: `删除待办：${shortText(todo.text)}`,
            surface: 'widget',
            widgetId,
            widgetType: 'todo',
          })
        }
      },
      renameTodo: (widgetId, id, text) => {
        const todo = get().todosByWidget[widgetId]?.find((item) => item.id === id)
        set((s) =>
          updateList(s.todosByWidget, widgetId, (list) =>
            list.map((t) => (t.id === id ? { ...t, text } : t))
          )
        )
        if (todo) {
          trackBehaviorEvent({
            eventName: 'todo.renamed',
            metadata: {
              nextLength: text.length,
              nextSummary: shortText(text),
              previousLength: todo.text.length,
              previousSummary: shortText(todo.text),
            },
            objectId: id,
            objectType: 'todo',
            summary: `编辑待办：${shortText(todo.text)} -> ${shortText(text)}`,
            surface: 'widget',
            widgetId,
            widgetType: 'todo',
          })
        }
      },
      clearDoneTodos: (widgetId) => {
        const doneCount = (get().todosByWidget[widgetId] ?? []).filter((todo) => todo.done).length
        set((s) =>
          updateList(s.todosByWidget, widgetId, (list) => list.filter((t) => !t.done))
        )
        if (doneCount > 0) {
          trackBehaviorEvent({
            eventName: 'todo.cleared_completed',
            metadata: { doneCount },
            objectType: 'todo',
            summary: `清理已完成待办：${doneCount} 项`,
            surface: 'widget',
            widgetId,
            widgetType: 'todo',
          })
        }
      },
      markAllDone: (widgetId) => {
        const openCount = (get().todosByWidget[widgetId] ?? []).filter((todo) => !todo.done).length
        set((s) =>
          updateList(s.todosByWidget, widgetId, (list) =>
            list.map((t) => ({ ...t, done: true }))
          )
        )
        if (openCount > 0) {
          trackBehaviorEvent({
            eventName: 'todo.marked_all_done',
            metadata: { openCount },
            objectType: 'todo',
            summary: `全部完成待办：${openCount} 项`,
            surface: 'widget',
            widgetId,
            widgetType: 'todo',
          })
        }
      },
      reorderTodos: (widgetId, fromIndex, toIndex) => {
        const todo = get().todosByWidget[widgetId]?.[fromIndex]
        set((s) =>
          updateList(s.todosByWidget, widgetId, (list) => {
            const next = [...list]
            const [moved] = next.splice(fromIndex, 1)
            next.splice(toIndex, 0, moved)
            return next
          })
        )
        trackBehaviorEvent({
          eventName: 'todo.reordered',
          metadata: {
            fromIndex,
            textSummary: todo ? shortText(todo.text) : null,
            toIndex,
          },
          objectId: todo?.id ?? null,
          objectType: 'todo',
          summary: todo
            ? `调整待办顺序：${shortText(todo.text)}`
            : `调整待办顺序：${fromIndex + 1} -> ${toIndex + 1}`,
          surface: 'widget',
          widgetId,
          widgetType: 'todo',
        })
      },
      moveTodo: (fromWidgetId, toWidgetId, todoId, toIndex) => {
        const todo = get().todosByWidget[fromWidgetId]?.find((item) => item.id === todoId)
        set((s) => {
          const fromList = [...(s.todosByWidget[fromWidgetId] ?? [])]
          const todo = fromList.find((t) => t.id === todoId)
          if (!todo) return s
          const newFromList = fromList.filter((t) => t.id !== todoId)
          const toList = [...(s.todosByWidget[toWidgetId] ?? [])]
          toList.splice(Math.min(toIndex, toList.length), 0, todo)
          return {
            todosByWidget: {
              ...s.todosByWidget,
              [fromWidgetId]: newFromList,
              [toWidgetId]: toList,
            },
          }
        })
        trackBehaviorEvent({
          eventName: 'todo.moved',
          metadata: {
            fromWidgetId,
            textLength: todo?.text.length ?? 0,
            textSummary: todo ? shortText(todo.text) : null,
            toIndex,
            toWidgetId,
          },
          objectId: todoId,
          objectType: 'todo',
          summary: todo ? `移动待办：${shortText(todo.text)}` : '移动待办',
          surface: 'widget',
          widgetId: toWidgetId,
          widgetType: 'todo',
        })
      },

      habitsByWidget: {},
      habitLogs: {},
      addHabit: (widgetId, name) => {
        const id = makeId()
        set((s) => ({
          habitsByWidget: {
            ...s.habitsByWidget,
            [widgetId]: [...(s.habitsByWidget[widgetId] ?? []), { id, name }],
          },
        }))
        trackBehaviorEvent({
          eventName: 'habit.added',
          metadata: { name: shortText(name) },
          objectId: id,
          objectType: 'habit',
          summary: `新增习惯：${shortText(name)}`,
          surface: 'widget',
          widgetId,
          widgetType: 'habits',
        })
      },
      removeHabit: (widgetId, id) => {
        const habit = get().habitsByWidget[widgetId]?.find((item) => item.id === id)
        set((s) => {
          const habitLogs = { ...s.habitLogs }
          delete habitLogs[id]
          return {
            habitsByWidget: {
              ...s.habitsByWidget,
              [widgetId]: (s.habitsByWidget[widgetId] ?? []).filter((h) => h.id !== id),
            },
            habitLogs,
          }
        })
        if (habit) {
          trackBehaviorEvent({
            eventName: 'habit.removed',
            metadata: { name: shortText(habit.name) },
            objectId: id,
            objectType: 'habit',
            summary: `删除习惯：${shortText(habit.name)}`,
            surface: 'widget',
            widgetId,
            widgetType: 'habits',
          })
        }
      },
      renameHabit: (widgetId, id, name) => {
        const habit = get().habitsByWidget[widgetId]?.find((item) => item.id === id)
        set((s) => ({
          habitsByWidget: {
            ...s.habitsByWidget,
            [widgetId]: (s.habitsByWidget[widgetId] ?? []).map((h) =>
              h.id === id ? { ...h, name } : h
            ),
          },
        }))
        if (habit) {
          trackBehaviorEvent({
            eventName: 'habit.renamed',
            metadata: { nextName: shortText(name), previousName: shortText(habit.name) },
            objectId: id,
            objectType: 'habit',
            summary: `编辑习惯：${shortText(habit.name)} -> ${shortText(name)}`,
            surface: 'widget',
            widgetId,
            widgetType: 'habits',
          })
        }
      },
      toggleHabitLog: (habitId, date) => {
        const existingBefore = get().habitLogs[habitId] ?? []
        const checked = !existingBefore.includes(date)
        set((s) => {
          const existing = s.habitLogs[habitId] ?? []
          const has = existing.includes(date)
          return {
            habitLogs: {
              ...s.habitLogs,
              [habitId]: has ? existing.filter((d) => d !== date) : [...existing, date],
            },
          }
        })
        const habitEntry = Object.entries(get().habitsByWidget).flatMap(([widgetId, habits]) =>
          habits
            .filter((habit) => habit.id === habitId)
            .map((habit) => ({ habit, widgetId }))
        )[0]
        trackBehaviorEvent({
          eventName: 'habit.log_updated',
          metadata: {
            checked,
            date,
            habitName: habitEntry ? shortText(habitEntry.habit.name) : null,
          },
          objectId: habitId,
          objectType: 'habit',
          summary: `${checked ? '完成' : '取消'}习惯打卡：${date}`,
          surface: 'widget',
          widgetId: habitEntry?.widgetId ?? null,
          widgetType: 'habits',
        })
      },

      calendarEmbeds: {},
      setCalendarEmbed: (widgetId, code) => {
        set((s) => ({ calendarEmbeds: { ...s.calendarEmbeds, [widgetId]: code } }))
        trackBehaviorEvent({
          eventName: 'calendar.embed_saved',
          metadata: { embedLength: code.length },
          objectId: widgetId,
          objectType: 'calendar_embed',
          summary: '保存 Google 日历嵌入',
          surface: 'widget',
          widgetId,
          widgetType: 'google-calendar',
        })
      },

      notesByWidget: {},
      setNote: (widgetId, content) =>
        set((s) => ({ notesByWidget: { ...s.notesByWidget, [widgetId]: content } })),
      appendNote: (widgetId, content) => {
        set((s) => {
          const current = s.notesByWidget[widgetId] ?? ''
          const separator = current.trim() && content.trim() ? '\n\n' : ''
          return {
            notesByWidget: {
              ...s.notesByWidget,
              [widgetId]: `${current}${separator}${content}`,
            },
          }
        })
        trackBehaviorEvent({
          eventName: 'note.appended',
          metadata: {
            appendedLength: content.length,
            contentSummary: shortText(content),
          },
          objectId: widgetId,
          objectType: 'note',
          summary: `追加便签：${shortText(content)}`,
          surface: 'widget',
          widgetId,
          widgetType: 'notes',
        })
      },

      linedNotesByWidget: {},
      setLinedNotesDocument: (widgetId, document) =>
        set((s) => ({
          linedNotesByWidget: {
            ...s.linedNotesByWidget,
            [widgetId]: normalizeLinedNotesDocument(document),
          },
        })),
      appendLinedNote: (widgetId, content) => {
        set((s) => {
          const document = normalizeLinedNotesDocument(
            s.linedNotesByWidget[widgetId] ?? createLinedNotesDocument()
          )
          const activePageId = document.activePageId
          return {
            linedNotesByWidget: {
              ...s.linedNotesByWidget,
              [widgetId]: {
                ...document,
                pages: document.pages.map((page) =>
                  page.id === activePageId
                    ? {
                        ...page,
                        content: page.content.trim()
                          ? `${page.content}\n\n${content}`
                          : content,
                      }
                    : page
                ),
              },
            },
          }
        })
        trackBehaviorEvent({
          eventName: 'note.appended',
          metadata: {
            appendedLength: content.length,
            contentSummary: shortText(content),
            target: 'lined-notes',
          },
          objectId: widgetId,
          objectType: 'lined_note',
          summary: `追加格纸笔记：${shortText(content)}`,
          surface: 'widget',
          widgetId,
          widgetType: 'lined-notes',
        })
      },

      scheduledTasksByWidget: {},
      addScheduledTask: (widgetId, text, dueDate) => {
        const id = makeId()
        set((s) => ({
          scheduledTasksByWidget: {
            ...s.scheduledTasksByWidget,
            [widgetId]: [
              ...(s.scheduledTasksByWidget[widgetId] ?? []),
              { id, text, dueDate, completed: false, completedAt: null },
            ],
          },
        }))
        trackBehaviorEvent({
          eventName: 'scheduled_task.added',
          metadata: { dueDate, textLength: text.length, textSummary: shortText(text) },
          objectId: id,
          objectType: 'scheduled_task',
          summary: `新增日程任务：${shortText(text)}`,
          surface: 'widget',
          widgetId,
          widgetType: 'scheduled-todo',
        })
      },
      toggleScheduledTask: (widgetId, id) => {
        const task = get().scheduledTasksByWidget[widgetId]?.find((item) => item.id === id)
        set((s) => {
          const todayStr = today()
          return {
            scheduledTasksByWidget: {
              ...s.scheduledTasksByWidget,
              [widgetId]: (s.scheduledTasksByWidget[widgetId] ?? []).map((t) =>
                t.id === id
                  ? {
                      ...t,
                      completed: !t.completed,
                      completedAt: t.completed ? null : todayStr,
                    }
                  : t
              ),
            },
          }
        })
        if (task) {
          trackBehaviorEvent({
            eventName: 'scheduled_task.toggled',
            metadata: {
              completed: !task.completed,
              dueDate: task.dueDate,
              textLength: task.text.length,
              textSummary: shortText(task.text),
            },
            objectId: id,
            objectType: 'scheduled_task',
            summary: `${task.completed ? '取消完成' : '完成'}日程任务：${shortText(task.text)}`,
            surface: 'widget',
            widgetId,
            widgetType: 'scheduled-todo',
          })
        }
      },
      removeScheduledTask: (widgetId, id) => {
        const task = get().scheduledTasksByWidget[widgetId]?.find((item) => item.id === id)
        set((s) => ({
          scheduledTasksByWidget: {
            ...s.scheduledTasksByWidget,
            [widgetId]: (s.scheduledTasksByWidget[widgetId] ?? []).filter((t) => t.id !== id),
          },
        }))
        if (task) {
          trackBehaviorEvent({
            eventName: 'scheduled_task.removed',
            metadata: {
              completed: task.completed,
              dueDate: task.dueDate,
              textLength: task.text.length,
              textSummary: shortText(task.text),
            },
            objectId: id,
            objectType: 'scheduled_task',
            summary: `删除日程任务：${shortText(task.text)}`,
            surface: 'widget',
            widgetId,
            widgetType: 'scheduled-todo',
          })
        }
      },
      updateScheduledTask: (widgetId, id, updates) => {
        const task = get().scheduledTasksByWidget[widgetId]?.find((item) => item.id === id)
        set((s) => ({
          scheduledTasksByWidget: {
            ...s.scheduledTasksByWidget,
            [widgetId]: (s.scheduledTasksByWidget[widgetId] ?? []).map((t) =>
              t.id === id ? { ...t, ...updates } : t
            ),
          },
        }))
        if (task) {
          trackBehaviorEvent({
            eventName: 'scheduled_task.updated',
            metadata: {
              nextDueDate: updates.dueDate ?? task.dueDate,
              nextTextSummary: updates.text ? shortText(updates.text) : null,
              previousDueDate: task.dueDate,
              previousTextSummary: shortText(task.text),
              updatedFields: Object.keys(updates),
            },
            objectId: id,
            objectType: 'scheduled_task',
            summary: `编辑日程任务：${shortText(task.text)}`,
            surface: 'widget',
            widgetId,
            widgetType: 'scheduled-todo',
          })
        }
      },
      moveTodoToScheduledDate: (fromWidgetId, todoId, scheduledWidgetId, dueDate) => {
        const todo = get().todosByWidget[fromWidgetId]?.find((item) => item.id === todoId)
        const nextTaskId = makeId()
        set((s) => {
          const fromList = [...(s.todosByWidget[fromWidgetId] ?? [])]
          const todo = fromList.find((t) => t.id === todoId)
          if (!todo) return s

          return {
            todosByWidget: {
              ...s.todosByWidget,
              [fromWidgetId]: fromList.filter((t) => t.id !== todoId),
            },
            scheduledTasksByWidget: {
              ...s.scheduledTasksByWidget,
              [scheduledWidgetId]: [
                ...(s.scheduledTasksByWidget[scheduledWidgetId] ?? []),
                {
                  id: nextTaskId,
                  text: todo.text,
                  dueDate,
                  completed: todo.done,
                  completedAt: todo.done ? today() : null,
                },
              ],
            },
          }
        })
        if (todo) {
          trackBehaviorEvent({
            eventName: 'scheduled_task.added',
            metadata: {
              dueDate,
              fromTodoId: todoId,
              fromWidgetId,
              textLength: todo.text.length,
              textSummary: shortText(todo.text),
            },
            objectId: nextTaskId,
            objectType: 'scheduled_task',
            summary: `待办转为日程任务：${shortText(todo.text)}`,
            surface: 'widget',
            widgetId: scheduledWidgetId,
            widgetType: 'scheduled-todo',
          })
        }
      },
      moveScheduledTaskToDate: (widgetId, taskId, dueDate) => {
        const task = get().scheduledTasksByWidget[widgetId]?.find((item) => item.id === taskId)
        set((s) => ({
          scheduledTasksByWidget: {
            ...s.scheduledTasksByWidget,
            [widgetId]: (s.scheduledTasksByWidget[widgetId] ?? []).map((t) =>
              t.id === taskId
                ? { ...t, dueDate, completedAt: t.completed ? dueDate : t.completedAt }
                : t
            ),
          },
        }))
        if (task) {
          trackBehaviorEvent({
            eventName: 'scheduled_task.moved',
            metadata: {
              fromDueDate: task.dueDate,
              textLength: task.text.length,
              textSummary: shortText(task.text),
              toDueDate: dueDate,
            },
            objectId: taskId,
            objectType: 'scheduled_task',
            summary: `移动日程任务：${shortText(task.text)}`,
            surface: 'widget',
            widgetId,
            widgetType: 'scheduled-todo',
          })
        }
      },
      moveScheduledTaskToTodo: (scheduledWidgetId, taskId, todoWidgetId, toIndex) => {
        const task = get().scheduledTasksByWidget[scheduledWidgetId]?.find((item) => item.id === taskId)
        const nextTodoId = makeId()
        set((s) => {
          const fromList = s.scheduledTasksByWidget[scheduledWidgetId] ?? []
          const task = fromList.find((t) => t.id === taskId)
          if (!task) return s

          const targetTodos = [...(s.todosByWidget[todoWidgetId] ?? [])]
          const insertAt = Math.max(0, Math.min(toIndex, targetTodos.length))
          targetTodos.splice(insertAt, 0, {
            id: nextTodoId,
            text: task.text,
            done: task.completed,
            createdAt: Date.now(),
          })

          return {
            scheduledTasksByWidget: {
              ...s.scheduledTasksByWidget,
              [scheduledWidgetId]: fromList.filter((t) => t.id !== taskId),
            },
            todosByWidget: {
              ...s.todosByWidget,
              [todoWidgetId]: targetTodos,
            },
          }
        })
        if (task) {
          trackBehaviorEvent({
            eventName: 'todo.added',
            metadata: {
              fromScheduledTaskId: taskId,
              fromWidgetId: scheduledWidgetId,
              textLength: task.text.length,
              textSummary: shortText(task.text),
              toIndex,
            },
            objectId: nextTodoId,
            objectType: 'todo',
            summary: `日程任务转为待办：${shortText(task.text)}`,
            surface: 'widget',
            widgetId: todoWidgetId,
            widgetType: 'todo',
          })
        }
      },

      pomodoro: { totalSessions: 0, todaySessions: 0, lastSessionDate: today() },
      incrementPomodoro: () => {
        const { pomodoro } = get()
        const todayStr = today()
        const todaySessions =
          pomodoro.lastSessionDate === todayStr ? pomodoro.todaySessions + 1 : 1
        set({ pomodoro: { totalSessions: pomodoro.totalSessions + 1, todaySessions, lastSessionDate: todayStr } })
        trackBehaviorEvent({
          eventName: 'pomodoro.completed',
          metadata: { todaySessions, totalSessions: pomodoro.totalSessions + 1 },
          objectType: 'pomodoro_session',
          summary: '完成一次番茄钟',
          surface: 'widget',
          widgetType: 'focus-journey',
        })
      },

      dailyBriefsByDate: {},
      setDailyBrief: (brief) => {
        set((s) => ({ dailyBriefsByDate: { ...s.dailyBriefsByDate, [brief.date]: brief } }))
        trackBehaviorEvent({
          eventName: 'daily_brief.generated',
          metadata: {
            calendarConnected: brief.calendarConnected,
            date: brief.date,
            recommendationLength: brief.recommendation.length,
            summaryLength: brief.summary.length,
          },
          objectId: brief.date,
          objectType: 'daily_brief',
          summary: `生成每日简报：${brief.date}`,
          surface: 'widget',
          widgetType: 'daily-brief',
        })
      },
      removeDailyBrief: (date) => {
        const existed = Boolean(get().dailyBriefsByDate[date])
        set((s) => {
          const dailyBriefsByDate = { ...s.dailyBriefsByDate }
          delete dailyBriefsByDate[date]
          return { dailyBriefsByDate }
        })
        if (existed) {
          trackBehaviorEvent({
            eventName: 'daily_brief.refresh_requested',
            metadata: { date },
            objectId: date,
            objectType: 'daily_brief',
            summary: `刷新每日简报：${date}`,
            surface: 'widget',
            widgetType: 'daily-brief',
          })
        }
      },

      calendarEventsByDate: {},
      setCalendarEventsForDate: (date, events) => {
        set((s) => ({
          calendarEventsByDate: {
            ...s.calendarEventsByDate,
            [date]: events,
          },
        }))
      },

      aiConversations: {},
      activeAiConversationId: DEFAULT_AI_CONVERSATION_ID,
      saveAiConversation: (conversation) => {
        set((s) => ({
          activeAiConversationId: conversation.id,
          aiConversations: {
            ...s.aiConversations,
            [conversation.id]: conversation,
          },
        }))
      },
      setActiveAiConversation: (conversationId) => {
        set({ activeAiConversationId: conversationId })
      },
    }),
    { name: WIDGET_DATA_STORAGE_KEY }
  )
)
