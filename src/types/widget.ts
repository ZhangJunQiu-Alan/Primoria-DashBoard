export type DashboardBreakpoint = 'lg' | 'md' | 'sm'

export type WidgetType =
  | 'clock'
  | 'quick-links'
  | 'motto'
  | 'notes'
  | 'lined-notes'
  | 'todo'
  | 'focus-journey'
  | 'google-calendar'
  | 'music-player'
  | 'habits'
  | 'scheduled-todo'
  | 'daily-brief'

export interface WidgetMeta {
  type: WidgetType
  name: string
  description: string
  defaultW: number
  defaultH: number
  minW: number
  minH: number
}

export interface WidgetInstance {
  id: string
  type: WidgetType
  // layout is managed by react-grid-layout, stored separately
}

export interface LayoutItem {
  i: string   // widget instance id
  x: number
  y: number
  w: number
  h: number
  minW?: number
  minH?: number
}

export type ResponsiveLayouts = Partial<Record<DashboardBreakpoint, LayoutItem[]>>
