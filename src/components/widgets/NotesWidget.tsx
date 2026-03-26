import { useState, useEffect, useRef } from 'react'

const STORAGE_KEY = 'primoria-notes'
const DEBOUNCE_MS = 600

export function NotesWidget() {
  const [content, setContent] = useState(() => localStorage.getItem(STORAGE_KEY) ?? '')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    timerRef.current = setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, content)
    }, DEBOUNCE_MS)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [content])

  return (
    <div className="flex flex-col h-full gap-2">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="开始记录..."
        className="flex-1 resize-none outline-none leading-relaxed text-sm"
        style={{ background: 'transparent', color: 'var(--text)', fontFamily: "'DM Sans', sans-serif" }}
        spellCheck={false}
      />
      <p style={{ fontSize: '11px', color: 'var(--text-muted)', textAlign: 'right' }}>
        {content.length} 字
      </p>
    </div>
  )
}
