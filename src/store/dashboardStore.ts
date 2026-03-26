import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { WidgetInstance, LayoutItem, WidgetType } from '@/types/widget'

interface DashboardState {
  widgets: WidgetInstance[]
  layout: LayoutItem[]
  addWidget: (type: WidgetType) => void
  removeWidget: (id: string) => void
  updateLayout: (layout: LayoutItem[]) => void
}

function generateId() {
  return `widget-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

const DEFAULT_SIZES: Record<WidgetType, { w: number; h: number; minW: number; minH: number }> = {
  clock: { w: 3, h: 2, minW: 2, minH: 2 },
  'quick-links': { w: 3, h: 3, minW: 2, minH: 2 },
  notes: { w: 4, h: 4, minW: 2, minH: 3 },
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

      addWidget: (type) => {
        const id = generateId()
        const size = DEFAULT_SIZES[type]
        const { layout } = get()
        const maxY = layout.reduce((acc, item) => Math.max(acc, item.y + item.h), 0)

        const newLayoutItem: LayoutItem = {
          i: id,
          x: 0,
          y: maxY,
          w: size.w,
          h: size.h,
          minW: size.minW,
          minH: size.minH,
        }

        set((state) => ({
          widgets: [...state.widgets, { id, type }],
          layout: [...state.layout, newLayoutItem],
        }))
      },

      removeWidget: (id) => {
        set((state) => ({
          widgets: state.widgets.filter((w) => w.id !== id),
          layout: state.layout.filter((l) => l.i !== id),
        }))
      },

      updateLayout: (layout) => set({ layout }),
    }),
    {
      name: 'primoria-dashboard',
    }
  )
)
