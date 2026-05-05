import { buildBriefContext, getLocalDayIsoRange } from '@/lib/ai/briefContext'
import { fetchCalendarEvents } from '@/lib/ai/api'
import type { CalendarEvent, GeminiFunctionCall, PendingAction } from '@/lib/ai/types'
import { formatLocalDateKey } from '@/lib/date'
import { useDashboardStore } from '@/store/dashboardStore'
import { useWidgetDataStore } from '@/store/widgetDataStore'
import type { WidgetType } from '@/types/widget'

interface ToolResult {
  pendingActions: PendingAction[]
  response: Record<string, unknown>
}

const TITLE_BY_TYPE: Record<WidgetType, string> = {
  clock: '时钟',
  'daily-brief': '每日简报',
  'google-calendar': 'Google 日历',
  habits: '习惯打卡',
  'lined-notes': '格纸笔记',
  motto: '格言',
  'music-player': '网易云播放器',
  notes: '便签',
  pomodoro: '番茄钟',
  'quick-links': '快速链接',
  'scheduled-todo': '日程任务',
  todo: '待办事项',
}

function makeActionId(type: string) {
  return `ai-action-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function getString(args: Record<string, unknown>, key: string) {
  const value = args[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function getBoolean(args: Record<string, unknown>, key: string, fallback: boolean) {
  const value = args[key]
  return typeof value === 'boolean' ? value : fallback
}

function getStringArray(args: Record<string, unknown>, key: string) {
  const value = args[key]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function getWidgetTitle(widgetId: string) {
  const dashboard = useDashboardStore.getState()
  const widget = dashboard.widgets.find((item) => item.id === widgetId)
  if (!widget) return widgetId
  return dashboard.widgetNames[widgetId] ?? TITLE_BY_TYPE[widget.type]
}

function findWidget(type: WidgetType, widgetId?: string | null) {
  const widgets = useDashboardStore.getState().widgets
  if (widgetId) {
    const widget = widgets.find((item) => item.id === widgetId && item.type === type)
    if (widget) return widget.id
  }
  return widgets.find((widget) => widget.type === type)?.id ?? null
}

function listWidgets() {
  const dashboard = useDashboardStore.getState()
  return dashboard.widgets.map((widget) => ({
    id: widget.id,
    type: widget.type,
    title: dashboard.widgetNames[widget.id] ?? TITLE_BY_TYPE[widget.type],
  }))
}

function getDashboardOverview(): ToolResult {
  const data = useWidgetDataStore.getState()
  return {
    pendingActions: [],
    response: {
      widgets: listWidgets(),
      counts: {
        habits: Object.values(data.habitsByWidget).reduce((sum, habits) => sum + habits.length, 0),
        notes: Object.keys(data.notesByWidget).length + Object.keys(data.linedNotesByWidget).length,
        quickLinks: data.quickLinks.length,
        scheduledTasks: Object.values(data.scheduledTasksByWidget).reduce((sum, tasks) => sum + tasks.length, 0),
        todos: Object.values(data.todosByWidget).reduce((sum, todos) => sum + todos.length, 0),
      },
    },
  }
}

function listTodos(args: Record<string, unknown>): ToolResult {
  const data = useWidgetDataStore.getState()
  const widgetId = getString(args, 'widgetId')
  const includeCompleted = getBoolean(args, 'includeCompleted', true)
  const entries = Object.entries(data.todosByWidget)
    .filter(([id]) => !widgetId || id === widgetId)
    .map(([id, todos]) => ({
      widgetId: id,
      widgetTitle: getWidgetTitle(id),
      todos: todos.filter((todo) => includeCompleted || !todo.done),
    }))

  return { pendingActions: [], response: { widgets: entries } }
}

function listScheduledTasks(args: Record<string, unknown>): ToolResult {
  const data = useWidgetDataStore.getState()
  const widgetId = getString(args, 'widgetId')
  const fromDate = getString(args, 'fromDate')
  const toDate = getString(args, 'toDate')
  const includeCompleted = getBoolean(args, 'includeCompleted', true)
  const entries = Object.entries(data.scheduledTasksByWidget)
    .filter(([id]) => !widgetId || id === widgetId)
    .map(([id, tasks]) => ({
      widgetId: id,
      widgetTitle: getWidgetTitle(id),
      tasks: tasks.filter((task) => {
        if (!includeCompleted && task.completed) return false
        if (fromDate && task.dueDate && task.dueDate < fromDate) return false
        if (toDate && task.dueDate && task.dueDate > toDate) return false
        return true
      }),
    }))

  return { pendingActions: [], response: { widgets: entries } }
}

function prepareMoveScheduledTasks(args: Record<string, unknown>): ToolResult {
  const data = useWidgetDataStore.getState()
  const requestedWidgetId = getString(args, 'widgetId')
  const toDate = getString(args, 'toDate') ?? formatLocalDateKey()
  const fromDate = getString(args, 'fromDate')
  const includeCompleted = getBoolean(args, 'includeCompleted', false)
  const explicitTaskIds = new Set(getStringArray(args, 'taskIds'))
  const actions: PendingAction[] = []

  for (const [widgetId, tasks] of Object.entries(data.scheduledTasksByWidget)) {
    if (requestedWidgetId && widgetId !== requestedWidgetId) continue
    const taskIds = tasks
      .filter((task) => {
        if (explicitTaskIds.size > 0) return explicitTaskIds.has(task.id)
        if (!includeCompleted && task.completed) return false
        if (fromDate) return task.dueDate === fromDate
        return false
      })
      .map((task) => task.id)

    if (taskIds.length === 0) continue
    actions.push({
      id: makeActionId('move-scheduled'),
      label: `将 ${getWidgetTitle(widgetId)} 中的 ${taskIds.length} 个任务移动到 ${toDate}`,
      taskIds,
      toDate,
      type: 'moveScheduledTasks',
      widgetId,
    })
  }

  return {
    pendingActions: actions,
    response: {
      pending: actions.length > 0,
      actions,
      message: actions.length > 0 ? '已准备移动任务，等待用户确认。' : '没有找到符合条件的任务。',
    },
  }
}

function prepareCreateHabit(args: Record<string, unknown>): ToolResult {
  const name = getString(args, 'name')
  if (!name) return { pendingActions: [], response: { error: '习惯名称不能为空' } }

  const widgetId = findWidget('habits', getString(args, 'widgetId'))
  const action: PendingAction = {
    id: makeActionId('create-habit'),
    label: widgetId ? `在 ${getWidgetTitle(widgetId)} 新建习惯：${name}` : `添加习惯打卡组件并新建习惯：${name}`,
    name,
    type: 'createHabit',
    widgetId,
  }

  return { pendingActions: [action], response: { pending: true, actions: [action] } }
}

function prepareHabitLog(args: Record<string, unknown>): ToolResult {
  const habitId = getString(args, 'habitId')
  const date = getString(args, 'date')
  const checked = getBoolean(args, 'checked', true)
  if (!habitId || !date) return { pendingActions: [], response: { error: 'habitId 和 date 必填' } }

  const action: PendingAction = {
    checked,
    date,
    habitId,
    id: makeActionId('habit-log'),
    label: `${checked ? '完成' : '取消'} ${date} 的习惯打卡`,
    type: 'updateHabitLog',
  }
  return { pendingActions: [action], response: { pending: true, actions: [action] } }
}

function getSearchTerms(query: string) {
  const normalized = query.toLowerCase()
  const terms: string[] = [...(normalized.match(/[\p{Script=Han}a-z0-9]{2,}/gu) ?? [])]
  for (const keyword of ['面试', '会议', '考试', '截止', '电话', 'deadline', 'interview']) {
    if (normalized.includes(keyword) && !terms.includes(keyword)) terms.push(keyword)
  }
  return terms.length > 0 ? terms : [normalized]
}

function searchNotes(args: Record<string, unknown>): ToolResult {
  const data = useWidgetDataStore.getState()
  const query = getString(args, 'query') ?? ''
  const limitValue = args.limit
  const limit = typeof limitValue === 'number' ? Math.max(1, Math.min(10, limitValue)) : 5
  const terms = getSearchTerms(query)
  const documents = [
    ...Object.entries(data.notesByWidget).map(([widgetId, content]) => ({
      content,
      type: 'notes' as const,
      widgetId,
      widgetTitle: getWidgetTitle(widgetId),
    })),
    ...Object.entries(data.linedNotesByWidget).flatMap(([widgetId, document]) =>
      document.pages.map((page, index) => ({
        content: page.content,
        page: index + 1,
        type: 'lined-notes' as const,
        widgetId,
        widgetTitle: getWidgetTitle(widgetId),
      }))
    ),
  ]

  const matches = documents
    .flatMap((document) => {
      const lower = document.content.toLowerCase()
      const score = terms.reduce((sum, term) => sum + (lower.includes(term) ? 1 : 0), 0)
      if (score === 0) return []
      return [{
        ...document,
        excerpt: document.content.replace(/\s+/g, ' ').trim().slice(0, 500),
        score,
      }]
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  return { pendingActions: [], response: { matches, query } }
}

function prepareWriteNote(args: Record<string, unknown>): ToolResult {
  const content = getString(args, 'content')
  if (!content) return { pendingActions: [], response: { error: '笔记内容不能为空' } }

  const requestedWidgetId = getString(args, 'widgetId')
  const notesWidgetId = findWidget('notes', requestedWidgetId)
  const linedWidgetId = requestedWidgetId ? findWidget('lined-notes', requestedWidgetId) : null
  const target = linedWidgetId ? 'lined-notes' : 'notes'
  const widgetId = linedWidgetId ?? notesWidgetId
  const mode = getString(args, 'mode') === 'replace' ? 'replace' : 'append'
  const action: PendingAction = {
    content,
    id: makeActionId('write-note'),
    label: widgetId
      ? `${mode === 'replace' ? '替换' : '追加'}笔记到 ${getWidgetTitle(widgetId)}`
      : `${mode === 'replace' ? '创建并写入' : '创建并追加'}便签`,
    mode,
    target,
    type: 'writeNote',
    widgetId,
  }

  return { pendingActions: [action], response: { pending: true, actions: [action] } }
}

async function listCalendarEvents(args: Record<string, unknown>): Promise<ToolResult> {
  const today = formatLocalDateKey()
  const fallbackRange = getLocalDayIsoRange(today)
  const timeMin = getString(args, 'timeMin') ?? fallbackRange.timeMin
  const timeMax = getString(args, 'timeMax') ?? fallbackRange.timeMax
  const result = await fetchCalendarEvents({ timeMax, timeMin })
  return { pendingActions: [], response: result }
}

async function getBriefContext(args: Record<string, unknown>): Promise<ToolResult> {
  const date = getString(args, 'date') ?? formatLocalDateKey()
  const range = getLocalDayIsoRange(date)
  let calendarConnected = false
  let events: CalendarEvent[] = []

  try {
    const calendar = await fetchCalendarEvents(range)
    calendarConnected = calendar.connected
    events = calendar.events
  } catch {
    calendarConnected = false
  }

  const briefContext = buildBriefContext(date, events)
  return {
    pendingActions: [],
    response: {
      calendarConnected,
      date,
      ...briefContext,
    },
  }
}

export async function executeDashboardTool(call: GeminiFunctionCall): Promise<ToolResult> {
  const args = call.args ?? {}

  switch (call.name) {
    case 'get_dashboard_overview':
      return getDashboardOverview()
    case 'list_todos':
      return listTodos(args)
    case 'list_scheduled_tasks':
      return listScheduledTasks(args)
    case 'move_scheduled_tasks':
      return prepareMoveScheduledTasks(args)
    case 'create_habit':
      return prepareCreateHabit(args)
    case 'update_habit_log':
      return prepareHabitLog(args)
    case 'search_notes':
      return searchNotes(args)
    case 'write_note':
      return prepareWriteNote(args)
    case 'list_calendar_events':
      return listCalendarEvents(args)
    case 'get_brief_context':
      return getBriefContext(args)
    default:
      return { pendingActions: [], response: { error: `Unknown tool: ${call.name}` } }
  }
}

export function applyPendingActions(actions: PendingAction[]) {
  const dashboard = useDashboardStore.getState()
  const data = useWidgetDataStore.getState()

  for (const action of actions) {
    if (action.type === 'moveScheduledTasks') {
      for (const taskId of action.taskIds) {
        data.moveScheduledTaskToDate(action.widgetId, taskId, action.toDate)
      }
      continue
    }

    if (action.type === 'createHabit') {
      let widgetId = action.widgetId
      if (!widgetId) {
        const before = new Set(useDashboardStore.getState().widgets.map((widget) => widget.id))
        dashboard.addWidget('habits')
        widgetId =
          useDashboardStore.getState().widgets.find((widget) => widget.type === 'habits' && !before.has(widget.id))?.id ??
          findWidget('habits')
      }
      if (widgetId) data.addHabit(widgetId, action.name)
      continue
    }

    if (action.type === 'updateHabitLog') {
      const hasLog = (useWidgetDataStore.getState().habitLogs[action.habitId] ?? []).includes(action.date)
      if (hasLog !== action.checked) data.toggleHabitLog(action.habitId, action.date)
      continue
    }

    if (action.type === 'writeNote') {
      let widgetId = action.widgetId
      if (!widgetId) {
        const before = new Set(useDashboardStore.getState().widgets.map((widget) => widget.id))
        dashboard.addWidget('notes')
        widgetId =
          useDashboardStore.getState().widgets.find((widget) => widget.type === 'notes' && !before.has(widget.id))?.id ??
          findWidget('notes')
      }
      if (!widgetId) continue
      if (action.target === 'lined-notes') {
        data.appendLinedNote(widgetId, action.content)
      } else if (action.mode === 'replace') {
        data.setNote(widgetId, action.content)
      } else {
        data.appendNote(widgetId, action.content)
      }
    }
  }
}
