import { useState, useEffect } from 'react'

const STORAGE_KEY = 'primoria-notes'

export function NotesWidget() {
  const [content, setContent] = useState(() => localStorage.getItem(STORAGE_KEY) ?? '')

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, content)
  }, [content])

  return (
    <div className="flex flex-col h-full gap-2">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Start typing..."
        className="flex-1 resize-none outline-none leading-relaxed text-sm"
        style={{
          background: 'transparent',
          color: 'var(--text)',
          fontFamily: "'DM Sans', sans-serif",
        }}
        spellCheck={false}
      />
      <p style={{ fontSize: '11px', color: 'var(--text-muted)', textAlign: 'right' }}>
        {content.length} chars
      </p>
    </div>
  )
}
