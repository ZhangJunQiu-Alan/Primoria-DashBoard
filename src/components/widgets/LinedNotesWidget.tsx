import { useState, useEffect, useRef, useMemo } from 'react'

const LINE_HEIGHT = 28
const DEBOUNCE_MS = 600

interface LinedNotesWidgetProps {
  widgetId?: string
}

export function LinedNotesWidget({ widgetId = 'default' }: LinedNotesWidgetProps) {
  const storageKey = useMemo(() => `primoria-lined-notes-${widgetId}`, [widgetId])
  const [content, setContent] = useState(() => localStorage.getItem(storageKey) ?? '')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    timerRef.current = setTimeout(() => {
      localStorage.setItem(storageKey, content)
    }, DEBOUNCE_MS)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [content, storageKey])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="开始记录..."
        spellCheck={false}
        className="flex-1 w-full resize-none outline-none text-sm"
        style={{
          background: `repeating-linear-gradient(
            to bottom,
            transparent,
            transparent ${LINE_HEIGHT - 1}px,
            var(--border) ${LINE_HEIGHT - 1}px,
            var(--border) ${LINE_HEIGHT}px
          )`,
          lineHeight: `${LINE_HEIGHT}px`,
          paddingTop: '2px',
          color: 'var(--text)',
          fontFamily: "'DM Sans', sans-serif",
          border: 'none',
        }}
      />
    </div>
  )
}
