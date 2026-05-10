import type { WidgetInstance, ResponsiveLayouts } from '@/types/widget'
import { BACKGROUND_STORAGE_KEY, useBackgroundStore } from '@/store/backgroundStore'
import { useDashboardStore } from '@/store/dashboardStore'
import {
  WIDGET_DATA_STORAGE_KEY,
  useWidgetDataStore,
  type DailyBriefData,
  type HabitItem,
  type AiConversationState,
  type LinedNotesDocument,
  type PomodoroData,
  type QuickLink,
  type ScheduledTask,
  type TodoItem,
  normalizeLinedNotesDocument,
} from '@/store/widgetDataStore'
import type { CalendarEvent } from '@/lib/ai/types'

export const DASHBOARD_STORAGE_KEY = 'primoria-dashboard'

export interface DashboardSnapshotData {
  widgets: WidgetInstance[]
  layouts: ResponsiveLayouts
  widgetNames: Record<string, string>
}

export interface WidgetDataSnapshot {
  quickLinks: QuickLink[]
  todosByWidget: Record<string, TodoItem[]>
  habitsByWidget: Record<string, HabitItem[]>
  habitLogs: Record<string, string[]>
  calendarEmbeds: Record<string, string>
  notesByWidget: Record<string, string>
  linedNotesByWidget: Record<string, LinedNotesDocument>
  scheduledTasksByWidget: Record<string, ScheduledTask[]>
  pomodoro: PomodoroData
  dailyBriefsByDate: Record<string, DailyBriefData>
  calendarEventsByDate: Record<string, CalendarEvent[]>
  aiConversations: Record<string, AiConversationState>
  activeAiConversationId: string
}

export interface LocalDashboardBackup {
  version: 1
  exportedAt: string
  dashboard: DashboardSnapshotData
  widgetData: WidgetDataSnapshot
  backgroundImage: string | null
}

const IMAGE_MIME_TO_EXTENSION: Record<string, string> = {
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

export const MAX_BACKGROUND_IMAGE_BYTES = 5 * 1024 * 1024
export const ALLOWED_BACKGROUND_IMAGE_TYPES = Object.keys(IMAGE_MIME_TO_EXTENSION)

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function getDashboardSnapshot(): DashboardSnapshotData {
  const { layouts, widgetNames, widgets } = useDashboardStore.getState()
  return cloneJson({ layouts, widgetNames, widgets })
}

export function applyDashboardSnapshot(snapshot: DashboardSnapshotData) {
  useDashboardStore.setState({
    widgets: cloneJson(snapshot.widgets ?? []),
    layouts: cloneJson(snapshot.layouts ?? {}),
    widgetNames: cloneJson(snapshot.widgetNames ?? {}),
  })
}

export function getWidgetDataSnapshot(): WidgetDataSnapshot {
  const {
    calendarEmbeds,
    calendarEventsByDate,
    dailyBriefsByDate,
    habitLogs,
    habitsByWidget,
    aiConversations,
    activeAiConversationId,
    linedNotesByWidget,
    notesByWidget,
    pomodoro,
    quickLinks,
    scheduledTasksByWidget,
    todosByWidget,
  } = useWidgetDataStore.getState()

  return cloneJson({
    calendarEmbeds,
    calendarEventsByDate,
    dailyBriefsByDate,
    habitLogs,
    habitsByWidget,
    linedNotesByWidget,
    notesByWidget,
    pomodoro,
    quickLinks,
    scheduledTasksByWidget,
    todosByWidget,
    aiConversations,
    activeAiConversationId,
  })
}

export function applyWidgetDataSnapshot(snapshot: WidgetDataSnapshot) {
  const normalizedLinedNotes = Object.fromEntries(
    Object.entries(snapshot.linedNotesByWidget ?? {}).map(([widgetId, document]) => [
      widgetId,
      normalizeLinedNotesDocument(document),
    ])
  )

  useWidgetDataStore.setState({
    quickLinks: cloneJson(snapshot.quickLinks ?? []),
    todosByWidget: cloneJson(snapshot.todosByWidget ?? {}),
    habitsByWidget: cloneJson(snapshot.habitsByWidget ?? {}),
    habitLogs: cloneJson(snapshot.habitLogs ?? {}),
    calendarEmbeds: cloneJson(snapshot.calendarEmbeds ?? {}),
    calendarEventsByDate: cloneJson(snapshot.calendarEventsByDate ?? {}),
    notesByWidget: cloneJson(snapshot.notesByWidget ?? {}),
    linedNotesByWidget: cloneJson(normalizedLinedNotes),
    scheduledTasksByWidget: cloneJson(snapshot.scheduledTasksByWidget ?? {}),
    pomodoro: cloneJson(snapshot.pomodoro ?? {
      totalSessions: 0,
      todaySessions: 0,
      lastSessionDate: new Date().toISOString().slice(0, 10),
    }),
    dailyBriefsByDate: cloneJson(snapshot.dailyBriefsByDate ?? {}),
    aiConversations: cloneJson(snapshot.aiConversations ?? {}),
    activeAiConversationId: cloneJson(snapshot.activeAiConversationId ?? 'default-dashboard-agent'),
  })
}

export function getLocalBackup(): LocalDashboardBackup {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    dashboard: getDashboardSnapshot(),
    widgetData: getWidgetDataSnapshot(),
    backgroundImage: useBackgroundStore.getState().backgroundImage,
  }
}

export function downloadLocalBackup() {
  const backup = getLocalBackup()
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `primoria-dashboard-backup-${backup.exportedAt.slice(0, 10)}.json`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export function hasLocalPersistedData() {
  return [DASHBOARD_STORAGE_KEY, WIDGET_DATA_STORAGE_KEY, BACKGROUND_STORAGE_KEY].some((key) => {
    try {
      return localStorage.getItem(key) !== null
    } catch {
      return false
    }
  })
}

export function getBackgroundSignature() {
  const backgroundImage = useBackgroundStore.getState().backgroundImage
  if (!backgroundImage) return null
  return [
    backgroundImage.length,
    backgroundImage.slice(0, 80),
    backgroundImage.slice(-80),
  ].join(':')
}

export function getLocalSnapshotFingerprint(backgroundPath: string | null) {
  return JSON.stringify({
    dashboard: getDashboardSnapshot(),
    widgetData: getWidgetDataSnapshot(),
    backgroundPath,
    backgroundSignature: getBackgroundSignature(),
  })
}

export function imageDataUrlToBlob(dataUrl: string) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/.exec(dataUrl)
  if (!match) return null

  const mimeType = match[1]
  const base64 = match[2]
  if (!mimeType || !base64 || !ALLOWED_BACKGROUND_IMAGE_TYPES.includes(mimeType)) return null

  const binary = window.atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  const blob = new Blob([bytes], { type: mimeType })
  return {
    blob,
    extension: IMAGE_MIME_TO_EXTENSION[mimeType] ?? 'img',
    mimeType,
  }
}

export function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('读取壁纸失败'))
    reader.readAsDataURL(blob)
  })
}
