import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { formatLocalDateKey } from '@/lib/date'

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
  sourceFingerprint: string
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
}

export const WIDGET_DATA_STORAGE_KEY = 'primoria-widget-data'
export const LINED_NOTES_DOCUMENT_VERSION = 1
const today = () => formatLocalDateKey()
const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const makeLinedNotePageId = () => `lined-note-page-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

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
      addQuickLink: (link) =>
        set((s) => ({ quickLinks: [...s.quickLinks, { ...link, id: makeId() }] })),
      removeQuickLink: (id) =>
        set((s) => ({ quickLinks: s.quickLinks.filter((l) => l.id !== id) })),

      todosByWidget: {},
      addTodo: (widgetId, text) =>
        set((s) =>
          updateList(s.todosByWidget, widgetId, (list) => [
            ...list,
            { id: makeId(), text, done: false, createdAt: Date.now() },
          ])
        ),
      toggleTodo: (widgetId, id) =>
        set((s) =>
          updateList(s.todosByWidget, widgetId, (list) =>
            list.map((t) => (t.id === id ? { ...t, done: !t.done } : t))
          )
        ),
      removeTodo: (widgetId, id) =>
        set((s) =>
          updateList(s.todosByWidget, widgetId, (list) => list.filter((t) => t.id !== id))
        ),
      renameTodo: (widgetId, id, text) =>
        set((s) =>
          updateList(s.todosByWidget, widgetId, (list) =>
            list.map((t) => (t.id === id ? { ...t, text } : t))
          )
        ),
      clearDoneTodos: (widgetId) =>
        set((s) =>
          updateList(s.todosByWidget, widgetId, (list) => list.filter((t) => !t.done))
        ),
      markAllDone: (widgetId) =>
        set((s) =>
          updateList(s.todosByWidget, widgetId, (list) =>
            list.map((t) => ({ ...t, done: true }))
          )
        ),
      reorderTodos: (widgetId, fromIndex, toIndex) =>
        set((s) =>
          updateList(s.todosByWidget, widgetId, (list) => {
            const next = [...list]
            const [moved] = next.splice(fromIndex, 1)
            next.splice(toIndex, 0, moved)
            return next
          })
        ),
      moveTodo: (fromWidgetId, toWidgetId, todoId, toIndex) =>
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
        }),

      habitsByWidget: {},
      habitLogs: {},
      addHabit: (widgetId, name) =>
        set((s) => ({
          habitsByWidget: {
            ...s.habitsByWidget,
            [widgetId]: [...(s.habitsByWidget[widgetId] ?? []), { id: makeId(), name }],
          },
        })),
      removeHabit: (widgetId, id) =>
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
        }),
      renameHabit: (widgetId, id, name) =>
        set((s) => ({
          habitsByWidget: {
            ...s.habitsByWidget,
            [widgetId]: (s.habitsByWidget[widgetId] ?? []).map((h) =>
              h.id === id ? { ...h, name } : h
            ),
          },
        })),
      toggleHabitLog: (habitId, date) =>
        set((s) => {
          const existing = s.habitLogs[habitId] ?? []
          const has = existing.includes(date)
          return {
            habitLogs: {
              ...s.habitLogs,
              [habitId]: has ? existing.filter((d) => d !== date) : [...existing, date],
            },
          }
        }),

      calendarEmbeds: {},
      setCalendarEmbed: (widgetId, code) =>
        set((s) => ({ calendarEmbeds: { ...s.calendarEmbeds, [widgetId]: code } })),

      notesByWidget: {},
      setNote: (widgetId, content) =>
        set((s) => ({ notesByWidget: { ...s.notesByWidget, [widgetId]: content } })),
      appendNote: (widgetId, content) =>
        set((s) => {
          const current = s.notesByWidget[widgetId] ?? ''
          const separator = current.trim() && content.trim() ? '\n\n' : ''
          return {
            notesByWidget: {
              ...s.notesByWidget,
              [widgetId]: `${current}${separator}${content}`,
            },
          }
        }),

      linedNotesByWidget: {},
      setLinedNotesDocument: (widgetId, document) =>
        set((s) => ({
          linedNotesByWidget: {
            ...s.linedNotesByWidget,
            [widgetId]: normalizeLinedNotesDocument(document),
          },
        })),
      appendLinedNote: (widgetId, content) =>
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
        }),

      scheduledTasksByWidget: {},
      addScheduledTask: (widgetId, text, dueDate) =>
        set((s) => ({
          scheduledTasksByWidget: {
            ...s.scheduledTasksByWidget,
            [widgetId]: [
              ...(s.scheduledTasksByWidget[widgetId] ?? []),
              { id: makeId(), text, dueDate, completed: false, completedAt: null },
            ],
          },
        })),
      toggleScheduledTask: (widgetId, id) =>
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
        }),
      removeScheduledTask: (widgetId, id) =>
        set((s) => ({
          scheduledTasksByWidget: {
            ...s.scheduledTasksByWidget,
            [widgetId]: (s.scheduledTasksByWidget[widgetId] ?? []).filter((t) => t.id !== id),
          },
        })),
      updateScheduledTask: (widgetId, id, updates) =>
        set((s) => ({
          scheduledTasksByWidget: {
            ...s.scheduledTasksByWidget,
            [widgetId]: (s.scheduledTasksByWidget[widgetId] ?? []).map((t) =>
              t.id === id ? { ...t, ...updates } : t
            ),
          },
        })),
      moveTodoToScheduledDate: (fromWidgetId, todoId, scheduledWidgetId, dueDate) =>
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
                  id: makeId(),
                  text: todo.text,
                  dueDate,
                  completed: todo.done,
                  completedAt: todo.done ? today() : null,
                },
              ],
            },
          }
        }),
      moveScheduledTaskToDate: (widgetId, taskId, dueDate) =>
        set((s) => ({
          scheduledTasksByWidget: {
            ...s.scheduledTasksByWidget,
            [widgetId]: (s.scheduledTasksByWidget[widgetId] ?? []).map((t) =>
              t.id === taskId && !t.completed ? { ...t, dueDate } : t
            ),
          },
        })),
      moveScheduledTaskToTodo: (scheduledWidgetId, taskId, todoWidgetId, toIndex) =>
        set((s) => {
          const fromList = s.scheduledTasksByWidget[scheduledWidgetId] ?? []
          const task = fromList.find((t) => t.id === taskId)
          if (!task) return s

          const targetTodos = [...(s.todosByWidget[todoWidgetId] ?? [])]
          const insertAt = Math.max(0, Math.min(toIndex, targetTodos.length))
          targetTodos.splice(insertAt, 0, {
            id: makeId(),
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
        }),

      pomodoro: { totalSessions: 0, todaySessions: 0, lastSessionDate: today() },
      incrementPomodoro: () => {
        const { pomodoro } = get()
        const todayStr = today()
        const todaySessions =
          pomodoro.lastSessionDate === todayStr ? pomodoro.todaySessions + 1 : 1
        set({ pomodoro: { totalSessions: pomodoro.totalSessions + 1, todaySessions, lastSessionDate: todayStr } })
      },

      dailyBriefsByDate: {},
      setDailyBrief: (brief) =>
        set((s) => ({ dailyBriefsByDate: { ...s.dailyBriefsByDate, [brief.date]: brief } })),
      removeDailyBrief: (date) =>
        set((s) => {
          const dailyBriefsByDate = { ...s.dailyBriefsByDate }
          delete dailyBriefsByDate[date]
          return { dailyBriefsByDate }
        }),
    }),
    { name: WIDGET_DATA_STORAGE_KEY }
  )
)
