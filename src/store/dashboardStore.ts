import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { WidgetInstance, LayoutItem, WidgetType } from '@/types/widget'

const VALID_TYPES: WidgetType[] = ['clock', 'quick-links', 'notes', 'lined-notes', 'todo', 'pomodoro']

interface DashboardState {
  widgets: WidgetInstance[]
  layout: LayoutItem[]
  widgetNames: Record<string, string>
  backgroundImage: string | null
  addWidget: (type: WidgetType) => void
  removeWidget: (id: string) => void
  updateLayout: (layout: LayoutItem[]) => void
  renameWidget: (id: string, name: string) => void
  setBackgroundImage: (dataUrl: string | null) => void
}

function generateId() {
  return `widget-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

const DEFAULT_SIZES: Record<WidgetType, { w: number; h: number; minW: number; minH: number }> = {
  clock: { w: 3, h: 2, minW: 2, minH: 2 },
  'quick-links': { w: 3, h: 3, minW: 2, minH: 2 },
  notes: { w: 4, h: 4, minW: 2, minH: 3 },
  'lined-notes': { w: 4, h: 5, minW: 2, minH: 3 },
  todo: { w: 3, h: 4, minW: 2, minH: 3 },
  pomodoro: { w: 3, h: 3, minW: 2, minH: 3 },
}

const DEFAULT_WIDGETS: WidgetInstance[] = [
  { id: 'w-clock', type: 'clock' },
  { id: 'w-quick-links', type: 'quick-links' },
]

const DEFAULT_LAYOUT: LayoutItem[] = [
  { i: 'w-clock', x: 0, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
  { i: 'w-quick-links', x: 3, y: 0, w: 3, h: 3, minW: 2, minH: 2 },
]

export const useDashboardStore = create<DashboardState>()(
  persist(
    (set, get) => ({
      widgets: DEFAULT_WIDGETS,
      layout: DEFAULT_LAYOUT,
      widgetNames: {},
      backgroundImage: null,

      addWidget: (type) => {
        const id = generateId()
        const size = DEFAULT_SIZES[type]
        const { layout } = get()
        const maxY = layout.reduce((acc, item) => Math.max(acc, item.y + item.h), 0)
        set((state) => ({
          widgets: [...state.widgets, { id, type }],
          layout: [
            ...state.layout,
            { i: id, x: 0, y: maxY, w: size.w, h: size.h, minW: size.minW, minH: size.minH },
          ],
        }))
      },

      removeWidget: (id) => {
        set((state) => {
          const widgetNames = { ...state.widgetNames }
          delete widgetNames[id]
          return {
            widgets: state.widgets.filter((w) => w.id !== id),
            layout: state.layout.filter((l) => l.i !== id),
            widgetNames,
          }
        })
      },

      updateLayout: (layout) => set({ layout }),

      renameWidget: (id, name) =>
        set((s) => ({ widgetNames: { ...s.widgetNames, [id]: name } })),

      setBackgroundImage: (dataUrl) => set({ backgroundImage: dataUrl }),
    }),
    {
      name: 'primoria-dashboard',
      version: 3,
      migrate: (persisted) => {
        const state = persisted as DashboardState
        const validWidgets = (state.widgets ?? []).filter((w) =>
          VALID_TYPES.includes(w.type as WidgetType)
        )
        const validIds = new Set(validWidgets.map((w) => w.id))
        return {
          ...state,
          widgets: validWidgets,
          layout: (state.layout ?? []).filter((l) => validIds.has(l.i)),
          widgetNames: state.widgetNames ?? {},
          backgroundImage: state.backgroundImage ?? null,
        }
      },
    }
  )
)
