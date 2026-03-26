import { useState, useRef, useEffect } from 'react'
import { X, Send, Sparkles, Bot } from 'lucide-react'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
}

interface AIChatPanelProps {
  open: boolean
  onClose: () => void
}

export function AIChatPanel({ open, onClose }: AIChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function send() {
    if (!input.trim()) return
    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: input.trim() }
    const reply: Message = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: 'AI backend not connected yet. Configure your API key to enable responses.',
    }
    setMessages((prev) => [...prev, userMsg, reply])
    setInput('')
  }

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40"
          style={{ background: 'rgba(61,52,42,0.15)' }}
          onClick={onClose}
        />
      )}

      {/* Side panel */}
      <div
        className="fixed top-0 right-0 h-full z-50 flex flex-col"
        style={{
          width: '360px',
          background: 'var(--bg-card)',
          borderLeft: '1px solid var(--border)',
          boxShadow: '-4px 0 24px rgba(90,70,50,0.12)',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        {/* Header */}
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
                fontSize: '15px',
                fontWeight: 500,
                color: 'var(--text)',
              }}
            >
              AI Assistant
            </p>
            <p style={{ fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.04em' }}>
              Not configured
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg transition-all"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-muted)')}
            onMouseLeave={e => (e.currentTarget.style.background = '')}
          >
            <X size={15} />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto flex flex-col gap-3 p-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
              <Bot size={36} style={{ color: 'var(--border)' }} />
              <p style={{ fontSize: '14px', color: 'var(--text-muted)' }}>Ask me anything</p>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', opacity: 0.7, maxWidth: '200px' }}>
                Connect your API key in settings to enable AI responses
              </p>
            </div>
          )}
          {messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className="max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed"
                style={
                  msg.role === 'user'
                    ? { background: 'var(--primary)', color: '#fff', borderBottomRightRadius: '4px' }
                    : {
                        background: 'var(--bg-muted)',
                        color: 'var(--text-sub)',
                        border: '1px solid var(--border)',
                        borderBottomLeftRadius: '4px',
                      }
                }
              >
                {msg.content}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
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
            placeholder="Message... (Enter to send)"
            rows={1}
            className="flex-1 rounded-xl px-3 py-2 text-sm outline-none resize-none transition-colors"
            style={{
              background: 'var(--bg-muted)',
              border: '1.5px solid var(--border)',
              color: 'var(--text)',
              fontFamily: "'DM Sans', sans-serif",
            }}
          />
          <button
            onClick={send}
            disabled={!input.trim()}
            className="p-2 rounded-xl text-white transition-all flex-shrink-0"
            style={{ background: input.trim() ? 'var(--primary)' : 'var(--border)' }}
          >
            <Send size={14} style={{ color: input.trim() ? '#fff' : 'var(--text-muted)' }} />
          </button>
        </div>
      </div>
    </>
  )
}
