import { buildBriefContext, getLocalDayIsoRange } from '@/lib/ai/briefContext'
import {
  createAssistantMemory,
  fetchCalendarEvents,
  updateAssistantMemory,
} from '@/lib/ai/api'
import type {
  AssistantMemoryType,
  CalendarEvent,
  GeminiFunctionCall,
  PendingAction,
} from '@/lib/ai/types'
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
  'music-player': '音乐播放器',
  notes: '便签',
  'focus-journey': '番茄钟',
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

function findScheduledTask(taskId: string, requestedWidgetId?: string | null) {
  const scheduled = useWidgetDataStore.getState().scheduledTasksByWidget
  if (requestedWidgetId) {
    const task = (scheduled[requestedWidgetId] ?? []).find((t) => t.id === taskId)
    if (task) return { widgetId: requestedWidgetId, task }
  }
  for (const [widgetId, tasks] of Object.entries(scheduled)) {
    const task = tasks.find((t) => t.id === taskId)
    if (task) return { widgetId, task }
  }
  return null
}

function prepareAddScheduledTask(args: Record<string, unknown>): ToolResult {
  const text = getString(args, 'text')
  if (!text) return { pendingActions: [], response: { error: '任务内容不能为空' } }
  const dueDateRaw = args.dueDate
  const dueDate =
    typeof dueDateRaw === 'string' && dueDateRaw.trim() ? dueDateRaw.trim() : null

  const widgetId = findWidget('scheduled-todo', getString(args, 'widgetId'))
  const action: PendingAction = {
    dueDate,
    id: makeActionId('add-scheduled'),
    label: widgetId
      ? `在 ${getWidgetTitle(widgetId)} 新建日程任务：${text}${dueDate ? `（${dueDate}）` : ''}`
      : `添加日程任务组件并新建：${text}${dueDate ? `（${dueDate}）` : ''}`,
    text,
    type: 'addScheduledTask',
    widgetId,
  }
  return { pendingActions: [action], response: { pending: true, actions: [action] } }
}

function prepareToggleScheduledTask(args: Record<string, unknown>): ToolResult {
  const taskId = getString(args, 'taskId')
  if (!taskId) return { pendingActions: [], response: { error: 'taskId 必填' } }
  const found = findScheduledTask(taskId, getString(args, 'widgetId'))
  if (!found) return { pendingActions: [], response: { error: '未找到该任务' } }

  const completed =
    typeof args.completed === 'boolean' ? args.completed : !found.task.completed
  const action: PendingAction = {
    completed,
    id: makeActionId('toggle-scheduled'),
    label: `${completed ? '完成' : '取消完成'}日程任务：${found.task.text}`,
    taskId,
    type: 'toggleScheduledTask',
    widgetId: found.widgetId,
  }
  return { pendingActions: [action], response: { pending: true, actions: [action] } }
}

function prepareUpdateScheduledTask(args: Record<string, unknown>): ToolResult {
  const taskId = getString(args, 'taskId')
  if (!taskId) return { pendingActions: [], response: { error: 'taskId 必填' } }
  const found = findScheduledTask(taskId, getString(args, 'widgetId'))
  if (!found) return { pendingActions: [], response: { error: '未找到该任务' } }

  const text = getString(args, 'text') ?? undefined
  const hasDueDate = Object.prototype.hasOwnProperty.call(args, 'dueDate')
  const rawDueDate = args.dueDate
  const dueDate = hasDueDate
    ? typeof rawDueDate === 'string' && rawDueDate.trim()
      ? rawDueDate.trim()
      : null
    : undefined

  if (text === undefined && dueDate === undefined) {
    return { pendingActions: [], response: { error: '至少提供 text 或 dueDate 之一' } }
  }

  const parts: string[] = []
  if (text !== undefined) parts.push(`内容改为「${text}」`)
  if (dueDate !== undefined) parts.push(`日期改为 ${dueDate ?? '无'}`)
  const action: PendingAction = {
    dueDate,
    id: makeActionId('update-scheduled'),
    label: `编辑日程任务「${found.task.text}」：${parts.join('，')}`,
    taskId,
    text,
    type: 'updateScheduledTask',
    widgetId: found.widgetId,
  }
  return { pendingActions: [action], response: { pending: true, actions: [action] } }
}

function prepareRemoveScheduledTask(args: Record<string, unknown>): ToolResult {
  const taskId = getString(args, 'taskId')
  if (!taskId) return { pendingActions: [], response: { error: 'taskId 必填' } }
  const found = findScheduledTask(taskId, getString(args, 'widgetId'))
  if (!found) return { pendingActions: [], response: { error: '未找到该任务' } }

  const action: PendingAction = {
    id: makeActionId('remove-scheduled'),
    label: `删除日程任务：${found.task.text}`,
    taskId,
    type: 'removeScheduledTask',
    widgetId: found.widgetId,
  }
  return { pendingActions: [action], response: { pending: true, actions: [action] } }
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

const MEMORY_TYPE_LABELS: Record<AssistantMemoryType, string> = {
  user_preference: '偏好',
  work_habit: '工作习惯',
  project_fact: '项目事实',
  process_rule: '流程规则',
}

const ALLOWED_MEMORY_TYPES: AssistantMemoryType[] = [
  'user_preference',
  'work_habit',
  'project_fact',
  'process_rule',
]

function prepareProposeMemoryWrite(args: Record<string, unknown>): ToolResult {
  const memoryTypeRaw = getString(args, 'memoryType')
  const memoryType =
    memoryTypeRaw && (ALLOWED_MEMORY_TYPES as string[]).includes(memoryTypeRaw)
      ? (memoryTypeRaw as AssistantMemoryType)
      : null
  const title = getString(args, 'title')
  const body = getString(args, 'body')

  if (!memoryType) return { pendingActions: [], response: { error: 'memoryType 必须为 user_preference / work_habit / project_fact / process_rule。' } }
  if (!title) return { pendingActions: [], response: { error: '记忆 title 不能为空。' } }
  if (!body) return { pendingActions: [], response: { error: '记忆 body 不能为空。' } }

  const scope = getString(args, 'scope') ?? 'global'
  const existingMemoryId = getString(args, 'existingMemoryId')

  const action: PendingAction = {
    body,
    existingMemoryId,
    id: makeActionId('memory-write'),
    label: existingMemoryId
      ? `更新长期记忆（${MEMORY_TYPE_LABELS[memoryType]}）：${title}`
      : `写入长期记忆（${MEMORY_TYPE_LABELS[memoryType]}）：${title}`,
    memoryType,
    scope,
    title,
    type: 'proposeMemoryWrite',
  }

  return { pendingActions: [action], response: { pending: true, actions: [action] } }
}

async function listCalendarEvents(args: Record<string, unknown>): Promise<ToolResult> {
  const today = formatLocalDateKey()
  const fallbackRange = getLocalDayIsoRange(today)
  const timeMin = getString(args, 'timeMin') ?? fallbackRange.timeMin
  const timeMax = getString(args, 'timeMax') ?? fallbackRange.timeMax
  const result = await fetchCalendarEvents({ timeMax, timeMin })
  const date = getString(args, 'date') ?? formatLocalDateKey(new Date(timeMin))
  useWidgetDataStore.getState().setCalendarEventsForDate(date, result.events)
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
    useWidgetDataStore.getState().setCalendarEventsForDate(date, events)
  } catch {
    calendarConnected = false
    useWidgetDataStore.getState().setCalendarEventsForDate(date, [])
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
    case 'add_scheduled_task':
      return prepareAddScheduledTask(args)
    case 'toggle_scheduled_task':
      return prepareToggleScheduledTask(args)
    case 'update_scheduled_task':
      return prepareUpdateScheduledTask(args)
    case 'remove_scheduled_task':
      return prepareRemoveScheduledTask(args)
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
    case 'propose_memory_write':
      return prepareProposeMemoryWrite(args)
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

    if (action.type === 'addScheduledTask') {
      let widgetId = action.widgetId
      if (!widgetId) {
        const before = new Set(useDashboardStore.getState().widgets.map((widget) => widget.id))
        dashboard.addWidget('scheduled-todo')
        widgetId =
          useDashboardStore.getState().widgets.find(
            (widget) => widget.type === 'scheduled-todo' && !before.has(widget.id)
          )?.id ?? findWidget('scheduled-todo')
      }
      if (widgetId) data.addScheduledTask(widgetId, action.text, action.dueDate)
      continue
    }

    if (action.type === 'toggleScheduledTask') {
      const current = (useWidgetDataStore.getState().scheduledTasksByWidget[action.widgetId] ?? [])
        .find((t) => t.id === action.taskId)
      if (current && current.completed !== action.completed) {
        data.toggleScheduledTask(action.widgetId, action.taskId)
      }
      continue
    }

    if (action.type === 'updateScheduledTask') {
      const updates: Partial<{ text: string; dueDate: string | null }> = {}
      if (action.text !== undefined) updates.text = action.text
      if (action.dueDate !== undefined) updates.dueDate = action.dueDate
      data.updateScheduledTask(action.widgetId, action.taskId, updates)
      continue
    }

    if (action.type === 'removeScheduledTask') {
      data.removeScheduledTask(action.widgetId, action.taskId)
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
      continue
    }

    if (action.type === 'proposeMemoryWrite') {
      const payload = {
        body: action.body,
        memory_type: action.memoryType,
        scope: action.scope,
        title: action.title,
      }
      const persist = action.existingMemoryId
        ? updateAssistantMemory({ id: action.existingMemoryId, ...payload })
        : createAssistantMemory(payload)
      void persist.catch((error) => {
        console.warn('[memory] failed to persist memory write', error)
      })
      continue
    }
  }
}
