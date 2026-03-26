import { useState, useRef, useEffect } from 'react'
import { Send, Bot, Sparkles } from 'lucide-react'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
}

export function AIChatWidget() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function send() {
    if (!input.trim()) return
    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: input.trim() }
    const placeholder: Message = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: 'AI backend not connected yet. Configure your API key to enable responses.',
    }
    setMessages((prev) => [...prev, userMsg, placeholder])
    setInput('')
  }

  return (
    <div className="flex flex-col h-full gap-2">
      <div
        className="flex items-center gap-2 pb-2"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div
          className="w-6 h-6 rounded-full flex items-center justify-center text-white"
          style={{ background: 'linear-gradient(135deg, var(--primary-light), var(--secondary))' }}
        >
          <Sparkles size={11} />
        </div>
        <span
          className="font-medium"
          style={{
            fontFamily: "'Cormorant Garamond', serif",
            fontSize: '14px',
            color: 'var(--text)',
          }}
        >
          AI Assistant
        </span>
        <span
          className="ml-auto px-2 py-0.5 rounded-full"
          style={{
            fontSize: '10px',
            color: 'var(--text-muted)',
            background: 'var(--bg-muted)',
            letterSpacing: '0.04em',
          }}
        >
          Not configured
        </span>
      </div>

      <div className="flex-1 overflow-y-auto flex flex-col gap-3 pr-1">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
            <Bot size={32} style={{ color: 'var(--border)' }} />
            <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Ask me anything</p>
            <p style={{ fontSize: '11px', color: 'var(--text-muted)', opacity: 0.7 }}>
              Connect your API key in settings to start
            </p>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className="max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed"
              style={
                msg.role === 'user'
                  ? {
                      background: 'var(--primary)',
                      color: '#fff',
                      borderBottomRightRadius: '4px',
                    }
                  : {
                      background: 'var(--bg-muted)',
                      color: 'var(--text-sub)',
                      borderBottomLeftRadius: '4px',
                      border: '1px solid var(--border)',
                    }
              }
            >
              {msg.content}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="flex gap-2 items-end">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          placeholder="Message..."
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
          className="p-2 rounded-xl text-white transition-all"
          style={{ background: input.trim() ? 'var(--primary)' : 'var(--border)' }}
        >
          <Send size={14} style={{ color: input.trim() ? '#fff' : 'var(--text-muted)' }} />
        </button>
      </div>
    </div>
  )
}
