import { create } from 'zustand'
import { persist } from 'zustand/middleware'

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

export interface PomodoroData {
  totalSessions: number
  todaySessions: number
  lastSessionDate: string
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

  // Pomodoro
  pomodoro: PomodoroData
  incrementPomodoro: () => void
}

const today = () => new Date().toISOString().slice(0, 10)

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
        set((s) => ({ quickLinks: [...s.quickLinks, { ...link, id: Date.now().toString() }] })),
      removeQuickLink: (id) =>
        set((s) => ({ quickLinks: s.quickLinks.filter((l) => l.id !== id) })),

      todosByWidget: {},
      addTodo: (widgetId, text) =>
        set((s) =>
          updateList(s.todosByWidget, widgetId, (list) => [
            ...list,
            { id: Date.now().toString(), text, done: false, createdAt: Date.now() },
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
            [widgetId]: [...(s.habitsByWidget[widgetId] ?? []), { id: Date.now().toString(), name }],
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

      pomodoro: { totalSessions: 0, todaySessions: 0, lastSessionDate: today() },
      incrementPomodoro: () => {
        const { pomodoro } = get()
        const todayStr = today()
        const todaySessions =
          pomodoro.lastSessionDate === todayStr ? pomodoro.todaySessions + 1 : 1
        set({ pomodoro: { totalSessions: pomodoro.totalSessions + 1, todaySessions, lastSessionDate: todayStr } })
      },
    }),
    { name: 'primoria-widget-data' }
  )
)
