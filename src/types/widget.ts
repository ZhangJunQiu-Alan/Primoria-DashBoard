export type WidgetType =
  | 'clock'
  | 'weather'
  | 'quick-links'
  | 'notes'
  | 'todo'
  | 'pomodoro'
  | 'ai-chat'

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
