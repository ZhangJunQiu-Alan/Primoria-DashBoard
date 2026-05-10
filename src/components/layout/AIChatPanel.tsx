import { useEffect, useRef, useState } from 'react'
import { AlertCircle, Bot, CalendarClock, Check, LoaderCircle, Send, Sparkles, X } from 'lucide-react'
import { applyPendingActions, executeDashboardTool } from '@/lib/ai/dashboardTools'
import { generateAssistantReflection, sendAgentTurn } from '@/lib/ai/api'
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

  return `${title}（${result.period_start} 至 ${result.period_end}）\n\n${result.summary}\n\n${result.completion_summary}\n\n优先级：\n${priorities}\n\n建议：\n${suggestions}`
}

export function AIChatPanel({ open, onClose }: AIChatPanelProps) {
  const { configured, pushNow, user } = useCloudSync()
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
  const [pendingActions, setPendingActions] = useState<PendingAction[]>(
    initialConversationRef.current.pendingActions
  )
  const bottomRef = useRef<HTMLDivElement>(null)
  const contentsRef = useRef<GeminiContent[]>(initialConversationRef.current.geminiContents)
  const messagesRef = useRef<AiConversationMessage[]>(initialConversationRef.current.messages)
  const pendingActionsRef = useRef<PendingAction[]>(initialConversationRef.current.pendingActions)
  const toolCallsRef = useRef<AiToolCallRecord[]>(initialConversationRef.current.toolCalls)
  const loadedUpdatedAtRef = useRef(initialConversationRef.current.updatedAt)

  const ready = configured && Boolean(user)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, pendingActions, busy])

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
              replySummary: summarizeText(response.text || '我没有找到需要执行的操作。', 100),
            },
            objectType: 'ai_message',
            summary: `收到 AI 回复：${summarizeText(response.text || '无文本回复', 80)}`,
            surface: 'ai_chat',
          })
          appendMessage({
            role: 'assistant',
            content: response.text || '我没有找到需要执行的操作。',
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
          appendMessage({ role: 'assistant', content: summarizePendingActions(actions) })
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
          periodEnd: result.period_end,
          periodStart: result.period_start,
          periodType: result.period_type,
          priorityCount: result.priority_items.length,
          suggestionCount: result.suggestions.length,
        },
        objectId: result.reflection_key,
        objectType: 'assistant_reflection',
        summary: periodType === 'daily' ? '生成今日反思' : '生成本周反思',
        surface: 'ai_chat',
      })
      appendMessage({ role: 'assistant', content })
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
              {ready ? '已连接 Gemini' : configured ? '请先登录' : '未配置 Supabase'}
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
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
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
                style={{ background: 'var(--bg-muted)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}
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
            placeholder={ready ? '发送消息… (Enter 发送)' : '登录后可使用 AI'}
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
      </div>
    </>
  )
}
