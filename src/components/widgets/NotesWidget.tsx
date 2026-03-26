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
        className="flex-1 bg-transparent text-white/80 text-sm resize-none outline-none placeholder:text-white/20 leading-relaxed"
        spellCheck={false}
      />
      <p className="text-white/20 text-xs text-right">{content.length} chars</p>
    </div>
  )
}
