import type { WidgetInstance } from '@/types/widget'
import {
  createLinedNotesDocument,
  normalizeLinedNotesDocument,
  useWidgetDataStore,
} from '@/store/widgetDataStore'

const LEGACY_NOTES_KEY = 'primoria-notes'
const MIGRATION_MARKER_KEY = 'primoria-notes-zustand-migrated-v1'

function parseJson(value: string) {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

export function migrateLegacyNotesToWidgetStore(widgets: WidgetInstance[]) {
  if (typeof localStorage === 'undefined') return

  const marker = localStorage.getItem(MIGRATION_MARKER_KEY)
  const state = useWidgetDataStore.getState()
  const notesUpdates: Record<string, string> = {}
  const linedNotesUpdates = { ...state.linedNotesByWidget }
  let checkedGlobalNotes = Boolean(marker)

  if (!marker) {
    const firstNotesWidget = widgets.find((widget) => widget.type === 'notes')
    const legacyNotes = localStorage.getItem(LEGACY_NOTES_KEY)
    checkedGlobalNotes = Boolean(firstNotesWidget) || legacyNotes === null
    if (
      firstNotesWidget &&
      legacyNotes !== null &&
      !state.notesByWidget[firstNotesWidget.id]
    ) {
      notesUpdates[firstNotesWidget.id] = legacyNotes
    }
  }

  for (const widget of widgets) {
    if (widget.type !== 'lined-notes') continue
    if (state.linedNotesByWidget[widget.id]) continue

    const storageKey = `primoria-lined-notes-${widget.id}`
    const raw = localStorage.getItem(storageKey)
    if (raw === null) continue

    const parsed = parseJson(raw)
    linedNotesUpdates[widget.id] =
      typeof parsed === 'string'
        ? createLinedNotesDocument(parsed)
        : normalizeLinedNotesDocument(parsed)
  }

  const hasLinedNotesUpdates =
    Object.keys(linedNotesUpdates).length !== Object.keys(state.linedNotesByWidget).length

  if (Object.keys(notesUpdates).length > 0 || hasLinedNotesUpdates) {
    useWidgetDataStore.setState({
      notesByWidget: { ...state.notesByWidget, ...notesUpdates },
      linedNotesByWidget: linedNotesUpdates,
    })
  }

  if (!marker && checkedGlobalNotes) {
    localStorage.setItem(MIGRATION_MARKER_KEY, new Date().toISOString())
  }
}
