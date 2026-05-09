import { useEffect, useRef, useState } from 'react'
import { AlertCircle, Bot, Check, LoaderCircle, Send, Sparkles, X } from 'lucide-react'
import { applyPendingActions, executeDashboardTool } from '@/lib/ai/dashboardTools'
import { sendAgentTurn } from '@/lib/ai/api'
import {
  summarizeText,
  trackBehaviorEvent,
  withBehaviorEventContext,
} from '@/lib/behaviorEvents'
import type { GeminiContent, PendingAction } from '@/lib/ai/types'
import { useCloudSync } from '@/components/cloud/cloudSyncContext'

interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
}

interface AIChatPanelProps {
  open: boolean
  onClose: () => void
}

function makeMessageId() {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
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

export function AIChatPanel({ open, onClose }: AIChatPanelProps) {
  const { configured, user } = useCloudSync()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [pendingActions, setPendingActions] = useState<PendingAction[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)
  const contentsRef = useRef<GeminiContent[]>([])

  const ready = configured && Boolean(user)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, pendingActions, busy])

  function appendMessage(message: Omit<Message, 'id'>) {
    setMessages((prev) => [...prev, { ...message, id: makeMessageId() }])
  }

  async function runAgentLoop(contents: GeminiContent[]) {
    setBusy(true)

    try {
      let nextContents = contents
      for (let turn = 0; turn < 5; turn += 1) {
        const response = await sendAgentTurn({ messages: nextContents })
        const modelContent = response.modelContent
        nextContents = [...nextContents, modelContent]

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
        }

        const toolContent: GeminiContent = { role: 'user', parts: toolParts }
        nextContents = [...nextContents, toolContent]

        if (actions.length > 0) {
          contentsRef.current = nextContents
          setPendingActions(actions)
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
    setPendingActions([])
    appendMessage({ role: 'assistant', content: `已执行 ${count} 项变更。` })
    contentsRef.current = [
      ...contentsRef.current,
      {
        role: 'user',
        parts: [{ text: `用户已确认并执行 ${count} 项 pending actions。` }],
      },
    ]
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
    setPendingActions([])
    appendMessage({ role: 'assistant', content: `已取消 ${count} 项待确认变更。` })
    contentsRef.current = [
      ...contentsRef.current,
      {
        role: 'user',
        parts: [{ text: `用户已取消 ${count} 项 pending actions，不要写入这些变更。` }],
      },
    ]
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
                className="max-w-[86%] rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap"
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
                {msg.content}
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
