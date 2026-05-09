import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { trackBehaviorEvent } from '@/lib/behaviorEvents'
import type {
  DashboardBreakpoint,
  LayoutItem,
  ResponsiveLayouts,
  WidgetInstance,
  WidgetType,
} from '@/types/widget'

const VALID_TYPES: WidgetType[] = [
  'clock',
  'quick-links',
  'motto',
  'notes',
  'lined-notes',
  'todo',
  'focus-journey',
  'google-calendar',
  'music-player',
  'habits',
  'scheduled-todo',
  'daily-brief',
]

// Legacy types are still recognized when migrating persisted layouts; map them to current ones.
const LEGACY_TYPE_REPLACEMENTS: Record<string, WidgetType> = {
  pomodoro: 'focus-journey',
}

const DASHBOARD_BREAKPOINTS: DashboardBreakpoint[] = ['lg', 'md', 'sm']
const DASHBOARD_COLS: Record<DashboardBreakpoint, number> = { lg: 12, md: 10, sm: 6 }

interface DashboardState {
  widgets: WidgetInstance[]
  layouts: ResponsiveLayouts
  widgetNames: Record<string, string>
  addWidget: (type: WidgetType) => void
  removeWidget: (id: string) => void
  updateLayout: (breakpoint: DashboardBreakpoint, layout: LayoutItem[]) => void
  renameWidget: (id: string, name: string) => void
}

function generateId() {
  return `widget-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

const DEFAULT_SIZES: Record<WidgetType, { w: number; h: number; minW: number; minH: number }> = {
  clock: { w: 3, h: 2, minW: 2, minH: 2 },
  'quick-links': { w: 3, h: 3, minW: 2, minH: 2 },
  motto: { w: 4, h: 3, minW: 2, minH: 2 },
  notes: { w: 4, h: 4, minW: 2, minH: 3 },
  'lined-notes': { w: 4, h: 5, minW: 2, minH: 3 },
  todo: { w: 3, h: 4, minW: 2, minH: 3 },
  // 9:16 phone aspect; widget aspect-locked via aspectRatio constraint in Dashboard.tsx
  'focus-journey': { w: 3, h: 6, minW: 3, minH: 5 },
  'google-calendar': { w: 4, h: 5, minW: 3, minH: 3 },
  'music-player': { w: 4, h: 4, minW: 2, minH: 2 },
  habits: { w: 5, h: 4, minW: 3, minH: 3 },
  'scheduled-todo': { w: 4, h: 5, minW: 3, minH: 4 },
  'daily-brief': { w: 4, h: 3, minW: 3, minH: 3 },
}

const DEFAULT_WIDGETS: WidgetInstance[] = [
  { id: 'w-clock', type: 'clock' },
  { id: 'w-quick-links', type: 'quick-links' },
]

const DEFAULT_LAYOUT: LayoutItem[] = [
  { i: 'w-clock', x: 0, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
  { i: 'w-quick-links', x: 3, y: 0, w: 3, h: 3, minW: 2, minH: 2 },
]

const DEFAULT_LAYOUTS: ResponsiveLayouts = {
  lg: DEFAULT_LAYOUT,
}

const TITLE_BY_TYPE: Record<WidgetType, string> = {
  clock: '时钟',
  'daily-brief': '每日简报',
  'google-calendar': 'Google 日历',
  habits: '习惯打卡',
  'lined-notes': '格纸笔记',
  motto: '格言',
  'music-player': '音乐播放器',
  notes: '便签',
  'focus-journey': '番茄钟',
  'quick-links': '快速链接',
  'scheduled-todo': '日程任务',
  todo: '待办事项',
}

function cloneLayoutItem(item: LayoutItem): LayoutItem {
  return { ...item }
}

function buildWidgetLayoutItem(
  id: string,
  size: { w: number; h: number; minW: number; minH: number },
  y: number
): LayoutItem {
  return {
    i: id,
    x: 0,
    y,
    w: size.w,
    h: size.h,
    minW: size.minW,
    minH: size.minH,
  }
}

function sanitizeLayouts(layouts: ResponsiveLayouts | undefined, validIds: Set<string>) {
  const next: ResponsiveLayouts = {}

  for (const breakpoint of DASHBOARD_BREAKPOINTS) {
    const layout = layouts?.[breakpoint]
    if (!layout) continue

    next[breakpoint] = layout
      .filter((item) => validIds.has(item.i))
      .map(cloneLayoutItem)
  }

  return next
}

function inferBreakpointFromLayout(layout: LayoutItem[]): DashboardBreakpoint {
  const maxRight = layout.reduce((acc, item) => Math.max(acc, item.x + item.w), 0)

  if (maxRight <= DASHBOARD_COLS.sm) return 'sm'
  if (maxRight <= DASHBOARD_COLS.md) return 'md'
  return 'lg'
}

function normalizeLegacyLayouts(layouts: ResponsiveLayouts) {
  const populatedBreakpoints = DASHBOARD_BREAKPOINTS.filter((breakpoint) => layouts[breakpoint]?.length)

  if (populatedBreakpoints.length === 1 && populatedBreakpoints[0] === 'lg' && layouts.lg) {
    const inferredBreakpoint = inferBreakpointFromLayout(layouts.lg)
    if (inferredBreakpoint !== 'lg') {
      return {
        [inferredBreakpoint]: layouts.lg.map(cloneLayoutItem),
      } satisfies ResponsiveLayouts
    }
  }

  return layouts
}

export const useDashboardStore = create<DashboardState>()(
  persist(
    (set) => ({
      widgets: DEFAULT_WIDGETS,
      layouts: DEFAULT_LAYOUTS,
      widgetNames: {},

      addWidget: (type) => {
        const id = generateId()
        const size = DEFAULT_SIZES[type]

        set((state) => {
          const nextLayouts: ResponsiveLayouts = { ...state.layouts }

          for (const breakpoint of DASHBOARD_BREAKPOINTS) {
            const currentLayout = state.layouts[breakpoint]
            if (!currentLayout) continue

            const maxY = currentLayout.reduce((acc, item) => Math.max(acc, item.y + item.h), 0)
            nextLayouts[breakpoint] = [
              ...currentLayout.map(cloneLayoutItem),
              buildWidgetLayoutItem(id, size, maxY),
            ]
          }

          if (!nextLayouts.lg) {
            const fallbackLayout = state.layouts.lg ?? []
            const maxY = fallbackLayout.reduce((acc, item) => Math.max(acc, item.y + item.h), 0)
            nextLayouts.lg = [
              ...fallbackLayout.map(cloneLayoutItem),
              buildWidgetLayoutItem(id, size, maxY),
            ]
          }

          return {
            widgets: [...state.widgets, { id, type }],
            layouts: nextLayouts,
          }
        })
        trackBehaviorEvent({
          eventName: 'dashboard.widget_added',
          metadata: { widgetType: type },
          objectId: id,
          objectType: 'widget',
          summary: `添加组件：${TITLE_BY_TYPE[type]}`,
          surface: 'dashboard',
          widgetId: id,
          widgetType: type,
        })
      },

      removeWidget: (id) => {
        const before = useDashboardStore.getState()
        const removed = before.widgets.find((widget) => widget.id === id)
        const title = removed
          ? before.widgetNames[id] ?? TITLE_BY_TYPE[removed.type]
          : id

        set((state) => {
          const widgetNames = { ...state.widgetNames }
          delete widgetNames[id]

          const nextLayouts: ResponsiveLayouts = {}
          for (const breakpoint of DASHBOARD_BREAKPOINTS) {
            const currentLayout = state.layouts[breakpoint]
            if (!currentLayout) continue
            nextLayouts[breakpoint] = currentLayout
              .filter((item) => item.i !== id)
              .map(cloneLayoutItem)
          }

          return {
            widgets: state.widgets.filter((widget) => widget.id !== id),
            layouts: nextLayouts,
            widgetNames,
          }
        })

        if (removed) {
          trackBehaviorEvent({
            eventName: 'dashboard.widget_removed',
            metadata: { title, widgetType: removed.type },
            objectId: id,
            objectType: 'widget',
            summary: `删除组件：${title}`,
            surface: 'dashboard',
            widgetId: id,
            widgetType: removed.type,
          })
        }
      },

      updateLayout: (breakpoint, layout) => {
        set((state) => ({
          layouts: {
            ...state.layouts,
            [breakpoint]: layout.map(cloneLayoutItem),
          },
        }))
        trackBehaviorEvent({
          eventName: 'dashboard.layout_updated',
          metadata: {
            breakpoint,
            itemCount: layout.length,
            layout: layout.map((item) => ({
              h: item.h,
              i: item.i,
              w: item.w,
              x: item.x,
              y: item.y,
            })),
          },
          objectType: 'layout',
          summary: `调整 ${breakpoint} 布局`,
          surface: 'dashboard',
        })
      },

      renameWidget: (id, name) => {
        const before = useDashboardStore.getState()
        const widget = before.widgets.find((item) => item.id === id)
        const previousName = widget ? before.widgetNames[id] ?? TITLE_BY_TYPE[widget.type] : id
        set((state) => ({ widgetNames: { ...state.widgetNames, [id]: name } }))
        trackBehaviorEvent({
          eventName: 'dashboard.widget_renamed',
          metadata: {
            nextName: name,
            previousName,
            widgetType: widget?.type ?? null,
          },
          objectId: id,
          objectType: 'widget',
          summary: `重命名组件：${previousName} -> ${name}`,
          surface: 'dashboard',
          widgetId: id,
          widgetType: widget?.type ?? null,
        })
      },
    }),
    {
      name: 'primoria-dashboard',
      version: 7,
      storage: {
        getItem: (key) => {
          try { return JSON.parse(localStorage.getItem(key) ?? 'null') } catch { return null }
        },
        setItem: (key, value) => {
          try { localStorage.setItem(key, JSON.stringify(value)) } catch (e) {
            console.warn('dashboardStore: localStorage write failed', e)
          }
        },
        removeItem: (key) => { try { localStorage.removeItem(key) } catch { return } },
      },
      migrate: (persisted) => {
        const state = persisted as Partial<DashboardState> & {
          backgroundImage?: unknown
          layout?: LayoutItem[]
        }

        const migratedWidgets = (state.widgets ?? []).map((widget) => {
          const replacement = LEGACY_TYPE_REPLACEMENTS[widget.type as string]
          return replacement ? { ...widget, type: replacement } : widget
        })
        const validWidgets = migratedWidgets.filter((widget) =>
          VALID_TYPES.includes(widget.type as WidgetType)
        )
        const validIds = new Set(validWidgets.map((widget) => widget.id))

        const nextLayouts =
          state.layouts && Object.keys(state.layouts).length > 0
            ? sanitizeLayouts(state.layouts, validIds)
            : sanitizeLayouts({ lg: state.layout ?? [] }, validIds)

        return {
          widgets: validWidgets,
          layouts:
            Object.keys(nextLayouts).length > 0
              ? normalizeLegacyLayouts(nextLayouts)
              : DEFAULT_LAYOUTS,
          widgetNames: state.widgetNames ?? {},
        } as DashboardState
      },
    }
  )
)
