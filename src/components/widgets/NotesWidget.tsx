import { useRef } from 'react'
import { summarizeText, trackBehaviorEvent } from '@/lib/behaviorEvents'
import { useWidgetDataStore } from '@/store/widgetDataStore'

interface NotesWidgetProps {
  widgetId?: string
}

export function NotesWidget({ widgetId = 'default' }: NotesWidgetProps) {
  const content = useWidgetDataStore((s) => s.notesByWidget[widgetId] ?? '')
  const setNote = useWidgetDataStore((s) => s.setNote)
  const lastTrackedContentRef = useRef(content)

  function trackEditIfChanged() {
    const previous = lastTrackedContentRef.current
    if (previous === content) return
    lastTrackedContentRef.current = content
    trackBehaviorEvent({
      eventName: 'note.updated',
      metadata: {
        nextLength: content.length,
        nextSummary: summarizeText(content, 80),
        previousLength: previous.length,
      },
      objectId: widgetId,
      objectType: 'note',
      summary: `更新便签：${content.length} 字`,
      surface: 'widget',
      widgetId,
      widgetType: 'notes',
    })
  }

  return (
    <div className="flex flex-col h-full gap-2">
      <textarea
        value={content}
        onChange={(e) => setNote(widgetId, e.target.value)}
        onBlur={trackEditIfChanged}
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
