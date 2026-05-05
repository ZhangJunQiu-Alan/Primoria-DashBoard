import { useWidgetDataStore } from '@/store/widgetDataStore'

interface NotesWidgetProps {
  widgetId?: string
}

export function NotesWidget({ widgetId = 'default' }: NotesWidgetProps) {
  const content = useWidgetDataStore((s) => s.notesByWidget[widgetId] ?? '')
  const setNote = useWidgetDataStore((s) => s.setNote)

  return (
    <div className="flex flex-col h-full gap-2">
      <textarea
        value={content}
        onChange={(e) => setNote(widgetId, e.target.value)}
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
