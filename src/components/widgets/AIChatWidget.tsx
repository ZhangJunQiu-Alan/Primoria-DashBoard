import { useState, useRef, useEffect } from 'react'
import { Send, Bot, Sparkles } from 'lucide-react'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
}

// UI placeholder — AI backend not yet connected
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
      <div className="flex items-center gap-2 pb-2 border-b border-white/5">
        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
          <Sparkles size={12} />
        </div>
        <span className="text-white/60 text-sm font-medium">AI Assistant</span>
        <span className="ml-auto text-[10px] text-white/20 bg-white/5 px-2 py-0.5 rounded-full">Not configured</span>
      </div>

      <div className="flex-1 overflow-y-auto flex flex-col gap-3 pr-1">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
            <Bot size={32} className="text-white/10" />
            <p className="text-white/20 text-sm">Ask me anything</p>
            <p className="text-white/10 text-xs">Connect your API key in settings to start</p>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-[var(--accent)] text-white rounded-br-sm'
                  : 'bg-white/5 text-white/70 rounded-bl-sm'
              }`}
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
          className="flex-1 bg-white/5 rounded-xl px-3 py-2 text-sm text-white outline-none border border-white/10 focus:border-white/30 resize-none placeholder:text-white/20"
        />
        <button
          onClick={send}
          disabled={!input.trim()}
          className="p-2 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  )
}
