import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface QuickLink {
  id: string
  title: string
  url: string
}

export interface TodoItem {
  id: string
  text: string
  done: boolean
  createdAt: number
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
  clearDoneTodos: (widgetId: string) => void
  markAllDone: (widgetId: string) => void
  reorderTodos: (widgetId: string, fromIndex: number, toIndex: number) => void

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
