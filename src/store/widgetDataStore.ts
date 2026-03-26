import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// ── Quick Links ──────────────────────────────────────────────
export interface QuickLink {
  id: string
  title: string
  url: string
}

// ── Todo ─────────────────────────────────────────────────────
export interface TodoItem {
  id: string
  text: string
  done: boolean
  createdAt: number
}

// ── Pomodoro ─────────────────────────────────────────────────
export interface PomodoroData {
  totalSessions: number
  todaySessions: number
  lastSessionDate: string // YYYY-MM-DD
}

// ── Store ─────────────────────────────────────────────────────
interface WidgetDataState {
  // Quick Links
  quickLinks: QuickLink[]
  addQuickLink: (link: Omit<QuickLink, 'id'>) => void
  removeQuickLink: (id: string) => void

  // Todo
  todos: TodoItem[]
  addTodo: (text: string) => void
  toggleTodo: (id: string) => void
  removeTodo: (id: string) => void
  clearDoneTodos: () => void

  // Pomodoro
  pomodoro: PomodoroData
  incrementPomodoro: () => void
  resetTodayPomodoro: () => void
}

const today = () => new Date().toISOString().slice(0, 10)

export const useWidgetDataStore = create<WidgetDataState>()(
  persist(
    (set, get) => ({
      // ── Quick Links ──
      quickLinks: [
        { id: '1', title: 'GitHub', url: 'https://github.com' },
        { id: '2', title: 'Google', url: 'https://google.com' },
      ],
      addQuickLink: (link) =>
        set((s) => ({
          quickLinks: [...s.quickLinks, { ...link, id: Date.now().toString() }],
        })),
      removeQuickLink: (id) =>
        set((s) => ({ quickLinks: s.quickLinks.filter((l) => l.id !== id) })),

      // ── Todo ──
      todos: [],
      addTodo: (text) =>
        set((s) => ({
          todos: [
            ...s.todos,
            { id: Date.now().toString(), text, done: false, createdAt: Date.now() },
          ],
        })),
      toggleTodo: (id) =>
        set((s) => ({
          todos: s.todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t)),
        })),
      removeTodo: (id) =>
        set((s) => ({ todos: s.todos.filter((t) => t.id !== id) })),
      clearDoneTodos: () =>
        set((s) => ({ todos: s.todos.filter((t) => !t.done) })),

      // ── Pomodoro ──
      pomodoro: { totalSessions: 0, todaySessions: 0, lastSessionDate: today() },
      incrementPomodoro: () => {
        const { pomodoro } = get()
        const todayStr = today()
        const todaySessions =
          pomodoro.lastSessionDate === todayStr ? pomodoro.todaySessions + 1 : 1
        set({
          pomodoro: {
            totalSessions: pomodoro.totalSessions + 1,
            todaySessions,
            lastSessionDate: todayStr,
          },
        })
      },
      resetTodayPomodoro: () =>
        set((s) => ({
          pomodoro: { ...s.pomodoro, todaySessions: 0, lastSessionDate: today() },
        })),
    }),
    {
      name: 'primoria-widget-data',
    }
  )
)
