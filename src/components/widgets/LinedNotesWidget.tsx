import { useEffect, useRef } from 'react'
import { Plus, X } from 'lucide-react'
import { summarizeText, trackBehaviorEvent } from '@/lib/behaviorEvents'
import {
  createBlankLinedNotePage,
  createLinedNotesDocument,
  normalizeLinedNotesDocument,
  useWidgetDataStore,
  type LinedNotesDocument,
} from '@/store/widgetDataStore'

const LINE_HEIGHT = 28

interface LinedNotesWidgetProps {
  widgetId?: string
}

export function LinedNotesWidget({ widgetId = 'default' }: LinedNotesWidgetProps) {
  const storedDocument = useWidgetDataStore((s) => s.linedNotesByWidget[widgetId])
  const setLinedNotesDocument = useWidgetDataStore((s) => s.setLinedNotesDocument)
  const documentState = normalizeLinedNotesDocument(storedDocument ?? createLinedNotesDocument())

  const activePageIndex = documentState.pages.findIndex((page) => page.id === documentState.activePageId)
  const safeActivePageIndex = activePageIndex >= 0 ? activePageIndex : 0
  const activePage = documentState.pages[safeActivePageIndex]
  const trackedContentByPageRef = useRef<Record<string, string>>({})

  useEffect(() => {
    if (!(activePage.id in trackedContentByPageRef.current)) {
      trackedContentByPageRef.current[activePage.id] = activePage.content
    }
  }, [activePage.content, activePage.id])

  function commitDocument(document: LinedNotesDocument) {
    setLinedNotesDocument(widgetId, document)
  }

  function setActivePage(pageId: string) {
    if (documentState.activePageId === pageId) return
    commitDocument({ ...documentState, activePageId: pageId })
    trackBehaviorEvent({
      eventName: 'note.lined_page_selected',
      metadata: { pageId },
      objectId: pageId,
      objectType: 'lined_note_page',
      summary: '切换格纸笔记页面',
      surface: 'widget',
      widgetId,
      widgetType: 'lined-notes',
    })
  }

  function handleContentChange(content: string) {
    commitDocument({
      ...documentState,
      pages: documentState.pages.map((page) =>
        page.id === documentState.activePageId ? { ...page, content } : page
      ),
    })
  }

  function handleCreatePage() {
    const currentIndex = documentState.pages.findIndex((page) => page.id === documentState.activePageId)
    const insertIndex = currentIndex >= 0 ? currentIndex + 1 : documentState.pages.length
    const nextPage = createBlankLinedNotePage()
    const nextPages = [...documentState.pages]
    nextPages.splice(insertIndex, 0, nextPage)
    commitDocument({
      ...documentState,
      activePageId: nextPage.id,
      pages: nextPages,
    })
    trackedContentByPageRef.current[nextPage.id] = ''
    trackBehaviorEvent({
      eventName: 'note.lined_page_added',
      metadata: { pageCount: nextPages.length },
      objectId: nextPage.id,
      objectType: 'lined_note_page',
      summary: '新增格纸笔记页面',
      surface: 'widget',
      widgetId,
      widgetType: 'lined-notes',
    })
  }

  function handleDeletePage() {
    if (documentState.pages.length <= 1) return

    const currentIndex = documentState.pages.findIndex((page) => page.id === documentState.activePageId)
    if (currentIndex < 0) return

    const currentPage = documentState.pages[currentIndex]
    if (currentPage.content.trim() && !window.confirm('当前页面有内容，确认删除这一页吗？')) {
      return
    }

    const nextPages = documentState.pages.filter((page) => page.id !== currentPage.id)
    const nextActivePage = nextPages[currentIndex] ?? nextPages[currentIndex - 1] ?? nextPages[0]
    if (!nextActivePage) {
      commitDocument(createLinedNotesDocument())
      return
    }

    commitDocument({
      ...documentState,
      activePageId: nextActivePage.id,
      pages: nextPages,
    })
    delete trackedContentByPageRef.current[currentPage.id]
    trackBehaviorEvent({
      eventName: 'note.lined_page_deleted',
      metadata: {
        contentLength: currentPage.content.length,
        pageCount: nextPages.length,
      },
      objectId: currentPage.id,
      objectType: 'lined_note_page',
      summary: '删除格纸笔记页面',
      surface: 'widget',
      widgetId,
      widgetType: 'lined-notes',
    })
  }

  function trackActivePageEditIfChanged() {
    const previous = trackedContentByPageRef.current[activePage.id] ?? ''
    if (previous === activePage.content) return
    trackedContentByPageRef.current[activePage.id] = activePage.content
    trackBehaviorEvent({
      eventName: 'note.lined_updated',
      metadata: {
        nextLength: activePage.content.length,
        nextSummary: summarizeText(activePage.content, 80),
        pageId: activePage.id,
        previousLength: previous.length,
      },
      objectId: activePage.id,
      objectType: 'lined_note_page',
      summary: `更新格纸笔记：${activePage.content.length} 字`,
      surface: 'widget',
      widgetId,
      widgetType: 'lined-notes',
    })
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          paddingBottom: '10px',
          marginBottom: '4px',
          borderBottom: '1px solid rgba(221,211,195,0.9)',
          minHeight: '36px',
        }}
      >
        <div
          style={{
            flex: 1,
            minWidth: 0,
            overflowX: 'auto',
            overflowY: 'hidden',
          }}
        >
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', minWidth: '100%' }}>
            {documentState.pages.map((page, index) => {
              const isActive = page.id === activePage.id
              return (
                <button
                  key={page.id}
                  onClick={() => setActivePage(page.id)}
                  style={{
                    flexShrink: 0,
                    minWidth: '30px',
                    height: '24px',
                    padding: '0 9px',
                    borderRadius: '999px',
                    border: '1px solid',
                    borderColor: isActive ? 'var(--primary-light)' : 'rgba(221,211,195,0.9)',
                    background: isActive ? 'linear-gradient(135deg, var(--bg-hover), var(--bg-hover-dark))' : 'rgba(254,250,245,0.92)',
                    color: isActive ? 'var(--primary-dark)' : 'var(--text-muted)',
                    fontSize: '11px',
                    fontWeight: isActive ? 600 : 500,
                    cursor: 'pointer',
                    boxShadow: isActive ? '0 3px 10px rgba(122,158,126,0.12)' : 'none',
                    transition: 'all 150ms ease',
                  }}
                  title={`第 ${index + 1} 页`}
                >
                  {index + 1}
                </button>
              )
            })}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
          <button
            onClick={handleCreatePage}
            className="btn-icon-hover"
            style={{
              width: '24px',
              height: '24px',
              borderRadius: '999px',
              border: '1px solid var(--border)',
              background: 'rgba(254,250,245,0.92)',
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
            title="新建页面"
          >
            <Plus size={12} />
          </button>

          {documentState.pages.length > 1 && (
            <button
              onClick={handleDeletePage}
              className="btn-icon-hover"
              style={{
                width: '24px',
                height: '24px',
                borderRadius: '999px',
                border: '1px solid var(--border)',
                background: 'rgba(254,250,245,0.92)',
                color: 'var(--text-muted)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
              title="删除当前页"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      <textarea
        value={activePage.content}
        onChange={(e) => handleContentChange(e.target.value)}
        onBlur={trackActivePageEditIfChanged}
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
