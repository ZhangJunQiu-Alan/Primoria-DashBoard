import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  Bot,
  Brain,
  CalendarClock,
  Check,
  Edit3,
  LoaderCircle,
  MessageCircle,
  RefreshCw,
  Save,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { applyPendingActions, executeDashboardTool } from '@/lib/ai/dashboardTools'
import {
  deleteAssistantMemory,
  fetchAssistantMemories,
  generateAssistantReflection,
  sendAgentTurn,
  updateAssistantMemory,
} from '@/lib/ai/api'
import { parseChatMarkdown, type ChatMarkdownSegment } from '@/lib/ai/chatMarkdown'
import {
  summarizeText,
  trackBehaviorEvent,
  withBehaviorEventContext,
} from '@/lib/behaviorEvents'
import { flushBehaviorEventQueue } from '@/lib/behaviorEventSync'
import { formatLocalDateKey } from '@/lib/date'
import { syncUserContentItems } from '@/lib/userContentItems'
import type {
  AssistantAgentTraceItem,
  AssistantMemory,
  AssistantMemoryType,
  AssistantRagSource,
  AssistantMemoryUpdateSummary,
  AssistantReflectionPeriodType,
  AssistantReflectionResult,
  GeminiContent,
  PendingAction,
} from '@/lib/ai/types'
import { useCloudSync } from '@/components/cloud/cloudSyncContext'
import {
  DEFAULT_AI_CONVERSATION_ID,
  createAiConversationState,
  useWidgetDataStore,
  type AiConversationMessage,
  type AiToolCallRecord,
} from '@/store/widgetDataStore'

interface AIChatPanelProps {
  open: boolean
  onClose: () => void
}

type PanelMode = 'chat' | 'memories'

type MemoryDraft = {
  body: string
  memory_type: AssistantMemoryType
  scope: string
  title: string
}

const MEMORY_TYPE_LABELS: Record<AssistantMemoryType, string> = {
  process_rule: '流程规则',
  project_fact: '项目事实',
  user_preference: '用户偏好',
  work_habit: '工作习惯',
}

const MEMORY_TYPE_OPTIONS = Object.keys(MEMORY_TYPE_LABELS) as AssistantMemoryType[]

const RAG_SOURCE_LABELS = {
  assistant_memory: '记忆',
  assistant_reflection: '反思',
  content_item: '内容',
} satisfies Record<AssistantRagSource['source_type'], string>

const AGENT_ROLE_LABELS = {
  briefing_agent: 'Briefing',
  dashboard_operator: 'Dashboard',
  memory_agent: 'Memory',
  memory_curator: 'Curator',
  orchestrator: 'Orchestrator',
  policy_guard: 'Guard',
  rag_retriever: 'RAG',
  reflection_agent: 'Reflection',
} satisfies Record<AssistantAgentTraceItem['role'], string>

function makeMessageId() {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function makeToolCallRecordId(name: string) {
  return `tool-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function makeFunctionResponsePart(
  call: { id?: string; name: string },
  response: Record<string, unknown>
) {
  return {
    functionResponse: {
      id: call.id,
      name: call.name,
      response,
    },
  }
}

function summarizePendingActions(actions: PendingAction[]) {
  return `我准备执行 ${actions.length} 项变更，请确认后再写入。`
}

function formatMemoryUpdates(summary: AssistantMemoryUpdateSummary | undefined) {
  if (!summary) return ''
  if (!summary.extracted) return '长期记忆：已是最新，或本次没有可提炼内容。'
  return `长期记忆：新增 ${summary.created} 条，更新 ${summary.updated} 条，跳过 ${summary.skipped} 条。`
}

function formatRagSources(sources: AssistantRagSource[] | undefined) {
  const visible = (sources ?? []).slice(0, 3)
  if (visible.length === 0) return ''
  return `\n\n参考来源：\n${visible
    .map((source) =>
      `- ${RAG_SOURCE_LABELS[source.source_type]}｜${source.title}｜${Math.round(source.similarity * 100)}%`
    )
    .join('\n')}`
}

function formatAgentTrace(trace: AssistantAgentTraceItem[] | undefined) {
  const visible = (trace ?? []).filter((item) => item.role !== 'policy_guard').slice(0, 5)
  return visible.map((item) => AGENT_ROLE_LABELS[item.role]).join(' → ')
}

function formatMemoryDate(value: string | null | undefined) {
  if (!value) return '未记录'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未记录'
  return date.toLocaleString('zh-CN', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
  })
}

function createMemoryDraft(memory: AssistantMemory): MemoryDraft {
  return {
    body: memory.body,
    memory_type: memory.memory_type,
    scope: memory.scope,
    title: memory.title,
  }
}

function renderMarkdownSegments(segments: ChatMarkdownSegment[]) {
  return segments.map((segment, index) =>
    segment.strong ? (
      <strong key={`${segment.text}-${index}`} style={{ fontWeight: 700, color: 'var(--text)' }}>
        {segment.text}
      </strong>
    ) : (
      <span key={`${segment.text}-${index}`}>{segment.text}</span>
    )
  )
}

function renderMessageContent(message: AiConversationMessage) {
  if (message.role === 'user') return message.content

  const blocks = parseChatMarkdown(message.content)
  return (
    <div className="flex flex-col gap-1">
      {blocks.map((block, index) => {
        if (block.kind === 'blank') {
          return <div key={`blank-${index}`} style={{ height: '0.45em' }} />
        }

        if (block.kind === 'heading') {
          return (
            <div
              key={`heading-${index}`}
              style={{ color: 'var(--text)', fontWeight: 700, marginTop: index === 0 ? 0 : '4px' }}
            >
              {renderMarkdownSegments(block.segments)}
            </div>
          )
        }

        if (block.kind === 'ordered-list-item' || block.kind === 'unordered-list-item') {
          return (
            <div key={`list-${index}`} className="flex items-start gap-2">
              <span style={{ color: 'var(--text-muted)', flex: '0 0 1.6em', textAlign: 'right' }}>
                {block.marker}
              </span>
              <span className="min-w-0 flex-1">{renderMarkdownSegments(block.segments)}</span>
            </div>
          )
        }

        return <div key={`paragraph-${index}`}>{renderMarkdownSegments(block.segments)}</div>
      })}
    </div>
  )
}

function formatReflectionMessage(result: AssistantReflectionResult) {
  const title = result.period_type === 'daily' ? '今日反思' : '本周反思'
  const priorities = result.priority_items.length
    ? result.priority_items
        .slice(0, 5)
        .map((item, index) =>
          `${index + 1}. ${item.title}｜重要 ${item.importance_score} / 紧急 ${item.urgency_score}\n   ${item.reason}`
        )
        .join('\n')
    : '暂无明显高优先级事项。'
  const suggestions = result.suggestions.length
    ? result.suggestions.map((item) => `- ${item}`).join('\n')
    : '- 暂无额外建议。'
  const memoryUpdates = formatMemoryUpdates(result.memory_updates)
  const memorySection = memoryUpdates ? `\n\n${memoryUpdates}` : ''
  const ragSection = formatRagSources(result.rag_sources)

  return `${title}（${result.period_start} 至 ${result.period_end}）\n\n${result.summary}\n\n${result.completion_summary}\n\n优先级：\n${priorities}\n\n建议：\n${suggestions}${memorySection}${ragSection}`
}

function AgentTraceLine({ trace }: { trace?: AssistantAgentTraceItem[] }) {
  const label = formatAgentTrace(trace)
  if (!label) return null
  return (
    <div
      className="mt-1 max-w-[86%] rounded-xl px-2 py-1 text-[10px]"
      style={{
        background: 'transparent',
        color: 'var(--text-muted)',
      }}
      title={(trace ?? []).map((item) => item.summary).join('\n')}
    >
      {label}
    </div>
  )
}

export function AIChatPanel({ open, onClose }: AIChatPanelProps) {
  const { configured, online, pushNow, user } = useCloudSync()
  const saveAiConversation = useWidgetDataStore((s) => s.saveAiConversation)
  const storedConversation = useWidgetDataStore((s) => s.aiConversations[DEFAULT_AI_CONVERSATION_ID])
  const initialConversationRef = useRef(
    useWidgetDataStore.getState().aiConversations[DEFAULT_AI_CONVERSATION_ID] ??
      createAiConversationState()
  )
  const [messages, setMessages] = useState<AiConversationMessage[]>(
    initialConversationRef.current.messages
  )
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [reflectionBusy, setReflectionBusy] = useState<AssistantReflectionPeriodType | null>(null)
  const [panelMode, setPanelMode] = useState<PanelMode>('chat')
  const [memories, setMemories] = useState<AssistantMemory[]>([])
  const [memoryDraft, setMemoryDraft] = useState<MemoryDraft>({
    body: '',
    memory_type: 'project_fact',
    scope: 'global',
    title: '',
  })
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null)
  const [memoryError, setMemoryError] = useState<string | null>(null)
  const [memoryLoading, setMemoryLoading] = useState(false)
  const [memorySavingId, setMemorySavingId] = useState<string | null>(null)
  const [memoryDeletingId, setMemoryDeletingId] = useState<string | null>(null)
  const [pendingActions, setPendingActions] = useState<PendingAction[]>(
    initialConversationRef.current.pendingActions
  )
  const bottomRef = useRef<HTMLDivElement>(null)
  const contentsRef = useRef<GeminiContent[]>(initialConversationRef.current.geminiContents)
  const messagesRef = useRef<AiConversationMessage[]>(initialConversationRef.current.messages)
  const pendingActionsRef = useRef<PendingAction[]>(initialConversationRef.current.pendingActions)
  const toolCallsRef = useRef<AiToolCallRecord[]>(initialConversationRef.current.toolCalls)
  const loadedUpdatedAtRef = useRef(initialConversationRef.current.updatedAt)

  const loggedIn = configured && Boolean(user)
  const ready = loggedIn && online

  const loadMemories = useCallback(async () => {
    if (!ready) {
      setMemories([])
      return
    }

    setMemoryLoading(true)
    setMemoryError(null)
    try {
      const result = await fetchAssistantMemories()
      setMemories(result.memories)
    } catch (error) {
      setMemoryError(error instanceof Error ? error.message : '长期记忆加载失败')
    } finally {
      setMemoryLoading(false)
    }
  }, [ready])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, pendingActions, busy])

  useEffect(() => {
    if (!open || panelMode !== 'memories') return
    void loadMemories()
  }, [loadMemories, open, panelMode])

  useEffect(() => {
    if (!storedConversation || busy) return
    if (loadedUpdatedAtRef.current === storedConversation.updatedAt) return
    if (
      messagesRef.current.length > 0 ||
      contentsRef.current.length > 0 ||
      pendingActionsRef.current.length > 0
    ) {
      return
    }

    messagesRef.current = storedConversation.messages
    contentsRef.current = storedConversation.geminiContents
    pendingActionsRef.current = storedConversation.pendingActions
    toolCallsRef.current = storedConversation.toolCalls
    loadedUpdatedAtRef.current = storedConversation.updatedAt
    setMessages(storedConversation.messages)
    setPendingActions(storedConversation.pendingActions)
  }, [busy, storedConversation])

  function persistConversation() {
    const now = new Date().toISOString()
    const previous =
      useWidgetDataStore.getState().aiConversations[DEFAULT_AI_CONVERSATION_ID] ??
      initialConversationRef.current
    const firstUserMessage = messagesRef.current.find((message) => message.role === 'user')
    const nextConversation = {
      ...previous,
      geminiContents: contentsRef.current,
      id: DEFAULT_AI_CONVERSATION_ID,
      messages: messagesRef.current,
      pendingActions: pendingActionsRef.current,
      title: firstUserMessage?.content
        ? summarizeText(firstUserMessage.content, 40)
        : previous.title,
      toolCalls: toolCallsRef.current,
      updatedAt: now,
    }

    loadedUpdatedAtRef.current = now
    saveAiConversation(nextConversation)
  }

  function appendMessage(message: Omit<AiConversationMessage, 'createdAt' | 'id'>) {
    const nextMessage: AiConversationMessage = {
      ...message,
      createdAt: new Date().toISOString(),
      id: makeMessageId(),
    }
    messagesRef.current = [...messagesRef.current, nextMessage]
    setMessages(messagesRef.current)
    persistConversation()
  }

  function setPendingActionsAndPersist(actions: PendingAction[]) {
    pendingActionsRef.current = actions
    setPendingActions(actions)
    persistConversation()
  }

  function appendToolCalls(records: AiToolCallRecord[]) {
    if (records.length === 0) return
    toolCallsRef.current = [...toolCallsRef.current, ...records]
    persistConversation()
  }

  function startEditingMemory(memory: AssistantMemory) {
    setEditingMemoryId(memory.id)
    setMemoryDraft(createMemoryDraft(memory))
    setMemoryError(null)
  }

  function cancelEditingMemory() {
    setEditingMemoryId(null)
    setMemoryDraft({ body: '', memory_type: 'project_fact', scope: 'global', title: '' })
  }

  async function saveMemoryEdit(id: string) {
    if (!memoryDraft.title.trim() || !memoryDraft.body.trim()) {
      setMemoryError('标题和内容不能为空')
      return
    }

    setMemorySavingId(id)
    setMemoryError(null)
    try {
      const result = await updateAssistantMemory({
        body: memoryDraft.body,
        id,
        memory_type: memoryDraft.memory_type,
        scope: memoryDraft.scope,
        title: memoryDraft.title,
      })
      setMemories((items) => items.map((item) => (item.id === id ? result.memory : item)))
      cancelEditingMemory()
    } catch (error) {
      setMemoryError(error instanceof Error ? error.message : '长期记忆保存失败')
    } finally {
      setMemorySavingId(null)
    }
  }

  async function removeMemory(id: string) {
    if (!window.confirm('确认删除这条长期记忆吗？')) return

    setMemoryDeletingId(id)
    setMemoryError(null)
    try {
      await deleteAssistantMemory(id)
      setMemories((items) => items.filter((item) => item.id !== id))
      if (editingMemoryId === id) cancelEditingMemory()
    } catch (error) {
      setMemoryError(error instanceof Error ? error.message : '长期记忆删除失败')
    } finally {
      setMemoryDeletingId(null)
    }
  }

  async function runAgentLoop(contents: GeminiContent[]) {
    setBusy(true)

    try {
      let nextContents = contents
      for (let turn = 0; turn < 5; turn += 1) {
        const response = await sendAgentTurn({ messages: nextContents })
        const modelContent = response.modelContent
        nextContents = [...nextContents, modelContent]
        contentsRef.current = nextContents
        persistConversation()

        if (response.functionCalls.length === 0) {
          contentsRef.current = nextContents
          trackBehaviorEvent({
            actor: 'assistant',
            eventName: 'ai.reply_received',
            metadata: {
              length: response.text.length,
              ragSourceCount: response.rag_sources?.length ?? 0,
              agentTrace: response.agent_trace?.map((item) => item.role) ?? [],
              replySummary: summarizeText(response.text || '我没有找到需要执行的操作。', 100),
            },
            objectType: 'ai_message',
            summary: `收到 AI 回复：${summarizeText(response.text || '无文本回复', 80)}`,
            surface: 'ai_chat',
          })
          appendMessage({
            role: 'assistant',
            agentTrace: response.agent_trace,
            content: `${response.text || '我没有找到需要执行的操作。'}${formatRagSources(response.rag_sources)}`,
          })
          return
        }

        const toolParts = []
        const actions: PendingAction[] = []
        const toolRecords: AiToolCallRecord[] = []

        for (const call of response.functionCalls) {
          trackBehaviorEvent({
            actor: 'assistant',
            eventName: 'ai.tool_called',
            metadata: { toolName: call.name },
            objectType: 'ai_tool_call',
            summary: `AI 调用工具：${call.name}`,
            surface: 'ai_chat',
          })
          const result = await executeDashboardTool(call)
          actions.push(...result.pendingActions)
          toolParts.push(makeFunctionResponsePart(call, { result: result.response }))
          toolRecords.push({
            args: call.args ?? {},
            createdAt: new Date().toISOString(),
            id: call.id ?? makeToolCallRecordId(call.name),
            name: call.name,
            result: result.response,
          })
        }
        appendToolCalls(toolRecords)

        const toolContent: GeminiContent = { role: 'user', parts: toolParts }
        nextContents = [...nextContents, toolContent]
        contentsRef.current = nextContents
        persistConversation()

        if (actions.length > 0) {
          setPendingActionsAndPersist(actions)
          trackBehaviorEvent({
            actor: 'assistant',
            eventName: 'ai.pending_actions_created',
            metadata: {
              actionCount: actions.length,
              actionTypes: actions.map((action) => action.type),
              labels: actions.map((action) => summarizeText(action.label, 80)),
            },
            objectType: 'pending_action',
            summary: `AI 准备 ${actions.length} 项待确认变更`,
            surface: 'ai_chat',
          })
          appendMessage({
            role: 'assistant',
            agentTrace: response.agent_trace,
            content: summarizePendingActions(actions),
          })
          return
        }
      }

      contentsRef.current = nextContents
      persistConversation()
      appendMessage({ role: 'assistant', content: '这个请求需要更多步骤，我先暂停在这里。' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI 请求失败'
      trackBehaviorEvent({
        actor: 'system',
        eventName: 'ai.error',
        metadata: { message: summarizeText(message, 120) },
        objectType: 'ai_turn',
        summary: `AI 请求失败：${summarizeText(message, 80)}`,
        surface: 'ai_chat',
      })
      appendMessage({ role: 'system', content: message })
    } finally {
      setBusy(false)
    }
  }

  async function runReflection(periodType: AssistantReflectionPeriodType) {
    if (!ready || busy || pendingActions.length > 0 || !user) return

    const date = formatLocalDateKey()
    setBusy(true)
    setReflectionBusy(periodType)
    trackBehaviorEvent({
      actor: 'user',
      eventName: 'assistant_reflection.requested',
      metadata: { date, periodType },
      objectType: 'assistant_reflection',
      summary: periodType === 'daily' ? '请求生成今日反思' : '请求生成本周反思',
      surface: 'ai_chat',
    })

    try {
      const eventFlush = await flushBehaviorEventQueue(user.id)
      if (!eventFlush.ok) {
        throw new Error(`行为事件同步失败：${eventFlush.error ?? '未知错误'}`)
      }
      const synced = await pushNow()
      if (!synced) throw new Error('同步失败，暂不生成反思。')
      const contentSynced = await syncUserContentItems(user.id)
      if (!contentSynced.ok) {
        throw new Error(`内容索引同步失败：${contentSynced.error ?? '未知错误'}`)
      }

      const result = await generateAssistantReflection({ date, periodType })
      const content = formatReflectionMessage(result)
      contentsRef.current = [
        ...contentsRef.current,
        {
          role: 'user',
          parts: [{ text: periodType === 'daily' ? '生成今日反思。' : '生成本周反思。' }],
        },
        { role: 'model', parts: [{ text: content }] },
      ]
      trackBehaviorEvent({
        actor: 'assistant',
        eventName: 'assistant_reflection.generated',
        metadata: {
          cached: Boolean(result.cached),
          memoryCreated: result.memory_updates?.created ?? 0,
          memoryExtracted: result.memory_updates?.extracted ?? false,
          memorySkipped: result.memory_updates?.skipped ?? 0,
          memoryUpdated: result.memory_updates?.updated ?? 0,
          periodEnd: result.period_end,
          periodStart: result.period_start,
          periodType: result.period_type,
          priorityCount: result.priority_items.length,
          ragSourceCount: result.rag_sources?.length ?? 0,
          agentTrace: result.agent_trace?.map((item) => item.role) ?? [],
          suggestionCount: result.suggestions.length,
        },
        objectId: result.reflection_key,
        objectType: 'assistant_reflection',
        summary: periodType === 'daily' ? '生成今日反思' : '生成本周反思',
        surface: 'ai_chat',
      })
      appendMessage({ role: 'assistant', agentTrace: result.agent_trace, content })
      if (result.memory_updates) void loadMemories()
      await flushBehaviorEventQueue(user.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : '反思生成失败'
      trackBehaviorEvent({
        actor: 'system',
        eventName: 'assistant_reflection.error',
        metadata: { date, message: summarizeText(message, 120), periodType },
        objectType: 'assistant_reflection',
        summary: `反思生成失败：${summarizeText(message, 80)}`,
        surface: 'ai_chat',
      })
      appendMessage({ role: 'system', content: message })
    } finally {
      setReflectionBusy(null)
      setBusy(false)
    }
  }

  function send() {
    const text = input.trim()
    if (!text || busy || !ready || pendingActions.length > 0) return

    const userContent: GeminiContent = { role: 'user', parts: [{ text }] }
    const nextContents = [...contentsRef.current, userContent]
    contentsRef.current = nextContents
    appendMessage({ role: 'user', content: text })
    trackBehaviorEvent({
      actor: 'user',
      eventName: 'ai.message_sent',
      metadata: {
        length: text.length,
        messageSummary: summarizeText(text, 100),
      },
      objectType: 'ai_message',
      summary: `发送 AI 消息：${summarizeText(text, 80)}`,
      surface: 'ai_chat',
    })
    setInput('')
    void runAgentLoop(nextContents)
  }

  function confirmPendingActions() {
    if (pendingActions.length === 0) return
    withBehaviorEventContext({ actor: 'assistant', surface: 'ai_chat' }, () => {
      applyPendingActions(pendingActions)
    })
    const count = pendingActions.length
    trackBehaviorEvent({
      actor: 'user',
      eventName: 'ai.pending_actions_confirmed',
      metadata: {
        actionCount: count,
        actionTypes: pendingActions.map((action) => action.type),
        labels: pendingActions.map((action) => summarizeText(action.label, 80)),
      },
      objectType: 'pending_action',
      summary: `确认执行 ${count} 项 AI 变更`,
      surface: 'ai_chat',
    })
    contentsRef.current = [
      ...contentsRef.current,
      {
        role: 'user',
        parts: [{ text: `用户已确认并执行 ${count} 项 pending actions。` }],
      },
    ]
    setPendingActionsAndPersist([])
    appendMessage({ role: 'assistant', content: `已执行 ${count} 项变更。` })
  }

  function cancelPendingActions() {
    if (pendingActions.length === 0) return
    const count = pendingActions.length
    trackBehaviorEvent({
      actor: 'user',
      eventName: 'ai.pending_actions_cancelled',
      metadata: {
        actionCount: count,
        actionTypes: pendingActions.map((action) => action.type),
        labels: pendingActions.map((action) => summarizeText(action.label, 80)),
      },
      objectType: 'pending_action',
      summary: `取消 ${count} 项 AI 待确认变更`,
      surface: 'ai_chat',
    })
    contentsRef.current = [
      ...contentsRef.current,
      {
        role: 'user',
        parts: [{ text: `用户已取消 ${count} 项 pending actions，不要写入这些变更。` }],
      },
    ]
    setPendingActionsAndPersist([])
    appendMessage({ role: 'assistant', content: `已取消 ${count} 项待确认变更。` })
  }

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40"
          style={{ background: 'rgba(61,52,42,0.15)' }}
          onClick={onClose}
        />
      )}

      <div
        className="fixed top-0 right-0 h-full z-50 flex flex-col"
        style={{
          width: '380px',
          background: 'var(--bg-card)',
          borderLeft: '1px solid var(--border)',
          boxShadow: '-4px 0 24px rgba(90,70,50,0.12)',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        <div
          className="flex items-center gap-3 px-4 py-3 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-white flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, var(--primary-light), var(--secondary))' }}
          >
            <Sparkles size={12} />
          </div>
          <div className="flex-1">
            <p
              style={{
                fontFamily: "'Cormorant Garamond', serif",
                fontSize: '16px',
                fontWeight: 500,
                color: 'var(--text)',
              }}
            >
              Dashboard Agent
            </p>
            <p style={{ fontSize: '10px', color: ready ? 'var(--primary-dark)' : 'var(--text-muted)' }}>
              {ready ? '已连接 Gemini' : !online && loggedIn ? '离线中，AI 暂不可用' : configured ? '请先登录' : '未配置 Supabase'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="btn-icon-hover p-1.5 rounded-lg transition-all"
            style={{ color: 'var(--text-muted)' }}
            title="关闭"
          >
            <X size={15} />
          </button>
        </div>

        <div className="flex flex-shrink-0 gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
          {(['chat', 'memories'] as const).map((mode) => {
            const active = panelMode === mode
            return (
              <button
                key={mode}
                onClick={() => setPanelMode(mode)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold"
                style={{
                  background: active ? 'var(--primary)' : 'var(--bg-muted)',
                  border: `1px solid ${active ? 'var(--primary)' : 'var(--border)'}`,
                  color: active ? '#fff' : 'var(--text-sub)',
                }}
              >
                {mode === 'chat' ? <MessageCircle size={13} /> : <Brain size={13} />}
                {mode === 'chat' ? '聊天' : '记忆'}
              </button>
            )
          })}
        </div>

        {panelMode === 'chat' ? (
          <>
            <div className="flex flex-shrink-0 gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
              {(['daily', 'weekly'] as const).map((periodType) => {
                const loading = reflectionBusy === periodType
                return (
                  <button
                    key={periodType}
                    onClick={() => void runReflection(periodType)}
                    disabled={!ready || busy || pendingActions.length > 0}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold disabled:opacity-60"
                    style={{
                      background: 'var(--bg-muted)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-sub)',
                    }}
                  >
                    {loading ? <LoaderCircle size={13} className="animate-spin" /> : <CalendarClock size={13} />}
                    {periodType === 'daily' ? '今日反思' : '本周反思'}
                  </button>
                )
              })}
            </div>

            <div className="flex-1 overflow-y-auto flex flex-col gap-3 p-4">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                  <Bot size={36} style={{ color: 'var(--border)' }} />
                  <p style={{ fontSize: '14px', color: 'var(--text-muted)' }}>可以直接操作你的 dashboard</p>
                  <p style={{ fontSize: '11px', color: 'var(--text-muted)', opacity: 0.7, maxWidth: '240px' }}>
                    例如：把今天没做完的待办挪到明天，或搜索笔记里的面试日期。
                  </p>
                </div>
              )}

              {messages.map((msg) => (
                <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div
                    className={`max-w-[86%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                      msg.role === 'user' ? 'whitespace-pre-wrap' : ''
                    }`}
                    style={
                      msg.role === 'user'
                        ? { background: 'var(--primary)', color: '#fff', borderBottomRightRadius: '4px' }
                        : msg.role === 'system'
                          ? {
                              background: 'rgba(196,128,122,0.12)',
                              color: '#9B4A45',
                              border: '1px solid rgba(196,128,122,0.24)',
                              borderBottomLeftRadius: '4px',
                            }
                          : {
                              background: 'var(--bg-muted)',
                              color: 'var(--text-sub)',
                              border: '1px solid var(--border)',
                              borderBottomLeftRadius: '4px',
                            }
                    }
                  >
                    {msg.role === 'system' && (
                      <AlertCircle size={13} style={{ display: 'inline', marginRight: '6px', verticalAlign: '-2px' }} />
                    )}
                    {renderMessageContent(msg)}
                  </div>
                  {msg.role === 'assistant' && <AgentTraceLine trace={msg.agentTrace} />}
                </div>
              ))}

              {pendingActions.length > 0 && (
                <div
                  className="rounded-2xl p-3"
                  style={{
                    background: 'rgba(254,250,245,0.96)',
                    border: '1px solid var(--primary-light)',
                    boxShadow: '0 6px 18px rgba(90,70,50,0.08)',
                  }}
                >
                  <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--primary-dark)', marginBottom: '8px' }}>
                    待确认变更
                  </div>
                  <div className="flex flex-col gap-2">
                    {pendingActions.map((action) => (
                      <div
                        key={action.id}
                        className="rounded-xl px-3 py-2"
                        style={{
                          background: 'var(--bg-muted)',
                          color: 'var(--text-sub)',
                          fontSize: '12px',
                          lineHeight: 1.5,
                        }}
                      >
                        {action.label}
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex gap-2 justify-end">
                    <button
                      onClick={cancelPendingActions}
                      className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold"
                      style={{
                        background: 'var(--bg-muted)',
                        border: '1px solid var(--border)',
                        color: 'var(--text-sub)',
                      }}
                    >
                      <X size={13} />
                      取消
                    </button>
                    <button
                      onClick={confirmPendingActions}
                      className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-white"
                      style={{ background: 'var(--primary)' }}
                    >
                      <Check size={13} />
                      确认执行
                    </button>
                  </div>
                </div>
              )}

              {busy && (
                <div className="flex justify-start">
                  <div
                    className="flex items-center gap-2 rounded-2xl px-3 py-2 text-sm"
                    style={{
                      background: 'var(--bg-muted)',
                      color: 'var(--text-muted)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    <LoaderCircle size={14} className="animate-spin" />
                    正在思考
                  </div>
                </div>
              )}

              <div ref={bottomRef} />
            </div>

            <div
              className="flex gap-2 items-end p-4 flex-shrink-0"
              style={{ borderTop: '1px solid var(--border)' }}
            >
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    send()
                  }
                }}
                placeholder={ready ? '发送消息… (Enter 发送)' : !online && loggedIn ? '联网后可继续使用 AI' : '登录后可使用 AI'}
                rows={1}
                disabled={!ready || busy || pendingActions.length > 0}
                className="flex-1 rounded-xl px-3 py-2 text-sm outline-none resize-none disabled:opacity-60"
                style={{
                  background: 'var(--bg-muted)',
                  border: '1.5px solid var(--border)',
                  color: 'var(--text)',
                  fontFamily: "'DM Sans', sans-serif",
                  maxHeight: '120px',
                }}
              />
              <button
                onClick={send}
                disabled={!input.trim() || !ready || busy || pendingActions.length > 0}
                className="p-2 rounded-xl flex-shrink-0 transition-all disabled:opacity-60"
                style={{ background: input.trim() && ready && !busy ? 'var(--primary)' : 'var(--border)' }}
                title="发送"
              >
                <Send size={14} style={{ color: input.trim() && ready && !busy ? '#fff' : 'var(--text-muted)' }} />
              </button>
            </div>
          </>
        ) : (
          <>
            <div
              className="flex flex-shrink-0 items-center justify-between gap-2 px-4 py-3"
              style={{ borderBottom: '1px solid var(--border)' }}
            >
              <div className="min-w-0">
                <div style={{ color: 'var(--text)', fontSize: '13px', fontWeight: 700 }}>长期记忆</div>
                <div style={{ color: 'var(--text-muted)', fontSize: '11px' }}>{memories.length} 条</div>
              </div>
              <button
                onClick={() => void loadMemories()}
                disabled={!ready || memoryLoading}
                className="btn-icon-hover flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold disabled:opacity-60"
                style={{
                  background: 'var(--bg-muted)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-sub)',
                }}
                title="刷新"
              >
                <RefreshCw size={13} className={memoryLoading ? 'animate-spin' : ''} />
                刷新
              </button>
            </div>

            <div className="flex-1 overflow-y-auto flex flex-col gap-3 p-4">
              {memoryError && (
                <div
                  className="rounded-2xl px-3 py-2 text-sm"
                  style={{
                    background: 'rgba(196,128,122,0.12)',
                    border: '1px solid rgba(196,128,122,0.24)',
                    color: '#9B4A45',
                  }}
                >
                  <AlertCircle size={13} style={{ display: 'inline', marginRight: '6px', verticalAlign: '-2px' }} />
                  {memoryError}
                </div>
              )}

              {memoryLoading && memories.length === 0 && (
                <div
                  className="flex items-center justify-center gap-2 rounded-2xl px-3 py-4 text-sm"
                  style={{ background: 'var(--bg-muted)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}
                >
                  <LoaderCircle size={14} className="animate-spin" />
                  正在加载
                </div>
              )}

              {!memoryLoading && memories.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                  <Brain size={34} style={{ color: 'var(--border)' }} />
                  <p style={{ fontSize: '14px', color: 'var(--text-muted)' }}>暂无长期记忆</p>
                </div>
              )}

              {memories.map((memory) => {
                const editing = editingMemoryId === memory.id
                return (
                  <div
                    key={memory.id}
                    className="rounded-2xl p-3"
                    style={{
                      background: 'var(--bg-muted)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-sub)',
                    }}
                  >
                    {editing ? (
                      <div className="flex flex-col gap-2">
                        <div className="flex gap-2">
                          <select
                            value={memoryDraft.memory_type}
                            onChange={(event) =>
                              setMemoryDraft((draft) => ({
                                ...draft,
                                memory_type: event.target.value as AssistantMemoryType,
                              }))
                            }
                            className="min-w-0 flex-1 rounded-xl px-2 py-2 text-xs outline-none"
                            style={{
                              background: 'var(--bg-card)',
                              border: '1px solid var(--border)',
                              color: 'var(--text-sub)',
                            }}
                          >
                            {MEMORY_TYPE_OPTIONS.map((type) => (
                              <option key={type} value={type}>
                                {MEMORY_TYPE_LABELS[type]}
                              </option>
                            ))}
                          </select>
                          <input
                            value={memoryDraft.scope}
                            onChange={(event) =>
                              setMemoryDraft((draft) => ({ ...draft, scope: event.target.value }))
                            }
                            className="w-24 rounded-xl px-2 py-2 text-xs outline-none"
                            style={{
                              background: 'var(--bg-card)',
                              border: '1px solid var(--border)',
                              color: 'var(--text-sub)',
                            }}
                          />
                        </div>
                        <input
                          value={memoryDraft.title}
                          onChange={(event) =>
                            setMemoryDraft((draft) => ({ ...draft, title: event.target.value }))
                          }
                          className="rounded-xl px-3 py-2 text-sm font-semibold outline-none"
                          style={{
                            background: 'var(--bg-card)',
                            border: '1px solid var(--border)',
                            color: 'var(--text)',
                          }}
                        />
                        <textarea
                          value={memoryDraft.body}
                          onChange={(event) =>
                            setMemoryDraft((draft) => ({ ...draft, body: event.target.value }))
                          }
                          rows={4}
                          className="rounded-xl px-3 py-2 text-sm outline-none resize-none"
                          style={{
                            background: 'var(--bg-card)',
                            border: '1px solid var(--border)',
                            color: 'var(--text-sub)',
                            fontFamily: "'DM Sans', sans-serif",
                          }}
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={cancelEditingMemory}
                            className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold"
                            style={{
                              background: 'var(--bg-card)',
                              border: '1px solid var(--border)',
                              color: 'var(--text-sub)',
                            }}
                          >
                            <X size={13} />
                            取消
                          </button>
                          <button
                            onClick={() => void saveMemoryEdit(memory.id)}
                            disabled={memorySavingId === memory.id}
                            className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                            style={{ background: 'var(--primary)' }}
                          >
                            {memorySavingId === memory.id ? (
                              <LoaderCircle size={13} className="animate-spin" />
                            ) : (
                              <Save size={13} />
                            )}
                            保存
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span
                                className="rounded-full px-2 py-1 text-[10px] font-semibold"
                                style={{
                                  background: 'var(--bg-card)',
                                  border: '1px solid var(--border)',
                                  color: 'var(--primary-dark)',
                                }}
                              >
                                {MEMORY_TYPE_LABELS[memory.memory_type]}
                              </span>
                              <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>
                                {Math.round(memory.confidence * 100)}%
                              </span>
                            </div>
                            <div
                              className="mt-2"
                              style={{ color: 'var(--text)', fontSize: '14px', fontWeight: 700, lineHeight: 1.35 }}
                            >
                              {memory.title}
                            </div>
                          </div>
                          <div className="flex flex-shrink-0 gap-1">
                            <button
                              onClick={() => startEditingMemory(memory)}
                              className="btn-icon-hover rounded-lg p-1.5"
                              style={{ color: 'var(--text-muted)' }}
                              title="编辑"
                            >
                              <Edit3 size={13} />
                            </button>
                            <button
                              onClick={() => void removeMemory(memory.id)}
                              disabled={memoryDeletingId === memory.id}
                              className="btn-icon-hover rounded-lg p-1.5 disabled:opacity-60"
                              style={{ color: '#9B4A45' }}
                              title="删除"
                            >
                              {memoryDeletingId === memory.id ? (
                                <LoaderCircle size={13} className="animate-spin" />
                              ) : (
                                <Trash2 size={13} />
                              )}
                            </button>
                          </div>
                        </div>
                        <div style={{ fontSize: '12px', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{memory.body}</div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '10px', lineHeight: 1.5 }}>
                          {memory.scope} · 来源 {memory.source_reflection_keys.slice(0, 2).join(', ') || '无'} · 最近{' '}
                          {formatMemoryDate(memory.last_seen_at)}
                          {memory.user_modified_at ? ' · 用户编辑' : ''}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </>
  )
}
