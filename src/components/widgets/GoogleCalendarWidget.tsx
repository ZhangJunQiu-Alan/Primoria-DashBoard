import { useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink, Info, RefreshCw, Save } from 'lucide-react'
import { getGoogleCalendarEmbedSrc } from '@/lib/googleCalendarEmbed'
import { useWidgetDataStore } from '@/store/widgetDataStore'

interface GoogleCalendarWidgetProps {
  widgetId: string
}

function useElementReady<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const update = () => {
      const rect = element.getBoundingClientRect()
      setReady(rect.width > 24 && rect.height > 24)
    }

    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)

    return () => observer.disconnect()
  }, [])

  return { ready, ref }
}

export function GoogleCalendarWidget({ widgetId }: GoogleCalendarWidgetProps) {
  const embedCode = useWidgetDataStore((s) => s.calendarEmbeds[widgetId] ?? '')
  const setCalendarEmbed = useWidgetDataStore((s) => s.setCalendarEmbed)
  const embedSrc = useMemo(() => getGoogleCalendarEmbedSrc(embedCode), [embedCode])

  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const draftEmbedSrc = useMemo(() => getGoogleCalendarEmbedSrc(draft), [draft])

  // If embed code is saved, show the calendar iframe
  if (embedCode && !editing) {
    return (
      <CalendarEmbedView
        embedSrc={embedSrc}
        onEdit={() => { setDraft(embedCode); setEditing(true) }}
      />
    )
  }

  // Setup / edit screen
  function handleSave() {
    const trimmed = draft.trim()
    if (!trimmed) return
    const src = getGoogleCalendarEmbedSrc(trimmed)
    if (!src) return
    setCalendarEmbed(widgetId, src)
    setDraft('')
    setEditing(false)
  }

  return (
    <div
      className="flex flex-col h-full"
      style={{ color: 'var(--text)' }}
    >
      {/* Description */}
      <p style={{ fontSize: '13px', color: 'var(--text-muted)', lineHeight: '1.6', marginBottom: '12px' }}>
        嵌入日历需要将日历设为<strong style={{ color: 'var(--text-sub)' }}>公开</strong>，否则会出现登录错误。
      </p>

      {/* Steps */}
      <div className="flex flex-col gap-2 mb-3">
        <a
          href="https://calendar.google.com/calendar/r/settings"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 transition-opacity hover:opacity-70"
          style={{ fontSize: '13px', color: 'var(--primary-dark)', fontWeight: 500 }}
        >
          <span>1. 打开 Google 日历设置</span>
          <ExternalLink size={12} />
        </a>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.5' }}>
          2. 左侧选择你的日历 → <strong>设置和共享</strong> → 勾选"公开此日历"
        </p>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.5' }}>
          3. 向下滚动到"<strong>整合日历</strong>"→ 复制<strong>嵌入代码</strong>（iframe 标签）
        </p>
      </div>

      {/* Step label */}
      <div className="flex items-center gap-2 mb-2">
        <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text)' }}>4. 粘贴嵌入代码</span>
        <Info size={12} style={{ color: 'var(--text-muted)' }} />
      </div>

      {/* Embed input */}
      <div
        className="flex-1 flex flex-col rounded-xl overflow-hidden"
        style={{ border: '1px solid var(--border)', background: 'var(--bg-muted)', minHeight: 0 }}
      >
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSave() }}
          placeholder={'<iframe src="https://calendar.google.com/calendar/embed?..." ...></iframe>'}
          className="flex-1 outline-none bg-transparent resize-none px-3 py-2"
          style={{ fontSize: '12px', color: 'var(--text)', fontFamily: 'monospace', minHeight: 0 }}
        />
        <div
          className="flex items-center justify-end px-3 py-2"
          style={{ borderTop: '1px solid var(--border)' }}
        >
          {editing && (
            <button
              onClick={() => { setDraft(''); setEditing(false) }}
              className="mr-2 px-3 py-1 rounded-lg text-xs transition-all"
              style={{ color: 'var(--text-muted)', background: 'transparent' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--border)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              取消
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={!draftEmbedSrc}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs transition-all"
            style={{
              background: draftEmbedSrc ? 'var(--primary)' : 'var(--border)',
              color: draftEmbedSrc ? 'white' : 'var(--text-muted)',
              cursor: draftEmbedSrc ? 'pointer' : 'default',
            }}
          >
            <Save size={12} />
            保存
          </button>
        </div>
      </div>
    </div>
  )
}

function CalendarEmbedView({
  embedSrc,
  onEdit,
}: {
  embedSrc: string | null
  onEdit: () => void
}) {
  const [reloadKey, setReloadKey] = useState(0)
  const [loadedFrameId, setLoadedFrameId] = useState<string | null>(null)
  const { ready: iframeContainerReady, ref: iframeContainerRef } = useElementReady<HTMLDivElement>()
  const iframeId = embedSrc ? `${embedSrc}-${reloadKey}` : ''
  const iframeLoaded = loadedFrameId === iframeId

  return (
    <div ref={iframeContainerRef} className="relative h-full w-full overflow-hidden rounded-xl group">
      {embedSrc && iframeContainerReady ? (
        <iframe
          key={iframeId}
          src={embedSrc}
          title="Google Calendar"
          loading="eager"
          referrerPolicy="no-referrer-when-downgrade"
          onLoad={() => setLoadedFrameId(iframeId)}
          style={{
            width: '100%',
            height: '100%',
            border: 0,
            display: 'block',
            background: 'white',
          }}
        />
      ) : (
        <CalendarEmbedState
          message={embedSrc ? '正在准备日历尺寸...' : '日历嵌入代码无效，请重新粘贴 Google Calendar iframe。'}
        />
      )}

      {embedSrc && iframeContainerReady && !iframeLoaded && (
        <CalendarEmbedState message="正在载入 Google 日历..." />
      )}

      <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-all group-hover:opacity-100">
        {embedSrc && (
          <button
            onClick={() => setReloadKey((key) => key + 1)}
            className="rounded-lg px-2 py-1 text-xs"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
            title="重新加载日历"
          >
            <RefreshCw size={12} />
          </button>
        )}
        <button
          onClick={onEdit}
          className="rounded-lg px-2 py-1 text-xs"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
        >
          更改
        </button>
      </div>
    </div>
  )
}

function CalendarEmbedState({ message }: { message: string }) {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center px-4 text-center"
      style={{
        background: 'rgba(254,250,245,0.92)',
        color: 'var(--text-muted)',
        fontSize: '12px',
        lineHeight: 1.6,
      }}
    >
      {message}
    </div>
  )
}
