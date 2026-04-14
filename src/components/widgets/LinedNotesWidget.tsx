import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'

const LINE_HEIGHT = 28
const DEBOUNCE_MS = 600
const DOCUMENT_VERSION = 1

interface LinedNotesWidgetProps {
  widgetId?: string
}

interface LinedNotePage {
  id: string
  content: string
}

interface LinedNotesDocument {
  version: 1
  activePageId: string
  pages: LinedNotePage[]
}

function makePageId() {
  return `lined-note-page-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function createBlankPage(): LinedNotePage {
  return { id: makePageId(), content: '' }
}

function createDocument(initialContent = ''): LinedNotesDocument {
  const firstPage = { id: makePageId(), content: initialContent }
  return {
    version: DOCUMENT_VERSION,
    activePageId: firstPage.id,
    pages: [firstPage],
  }
}

function normalizeDocument(value: unknown): LinedNotesDocument {
  if (typeof value === 'string') return createDocument(value)

  if (!value || typeof value !== 'object') return createDocument()

  const candidate = value as Partial<LinedNotesDocument>
  const rawPages: unknown[] = Array.isArray(candidate.pages) ? candidate.pages : []
  const pages = rawPages
    .filter((page) => Boolean(page) && typeof page === 'object')
    .map((page) => ({
      id:
        typeof (page as Partial<LinedNotePage>).id === 'string' &&
        (page as Partial<LinedNotePage>).id?.trim()
          ? (page as Partial<LinedNotePage>).id as string
          : makePageId(),
      content:
        typeof (page as Partial<LinedNotePage>).content === 'string'
          ? (page as Partial<LinedNotePage>).content as string
          : '',
    }))

  const ensuredPages = pages.length > 0 ? pages : [createBlankPage()]
  const activePageId = ensuredPages.some((page) => page.id === candidate.activePageId)
    ? (candidate.activePageId as string)
    : ensuredPages[0].id

  return {
    version: DOCUMENT_VERSION,
    activePageId,
    pages: ensuredPages,
  }
}

function isDocumentPayload(value: unknown) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    ('pages' in value || 'activePageId' in value || 'version' in value)
  )
}

function loadDocument(storageKey: string) {
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return createDocument()
    const parsed = JSON.parse(raw) as unknown
    return isDocumentPayload(parsed) ? normalizeDocument(parsed) : createDocument(raw)
  } catch {
    try {
      const fallback = localStorage.getItem(storageKey)
      if (fallback === null) return createDocument()
      return normalizeDocument(fallback)
    } catch {
      return createDocument()
    }
  }
}

export function LinedNotesWidget({ widgetId = 'default' }: LinedNotesWidgetProps) {
  const storageKey = useMemo(() => `primoria-lined-notes-${widgetId}`, [widgetId])
  const [documentState, setDocumentState] = useState<LinedNotesDocument>(() => loadDocument(storageKey))
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setDocumentState(loadDocument(storageKey))
  }, [storageKey])

  useEffect(() => {
    timerRef.current = setTimeout(() => {
      localStorage.setItem(storageKey, JSON.stringify(documentState))
    }, DEBOUNCE_MS)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [documentState, storageKey])

  const activePageIndex = documentState.pages.findIndex((page) => page.id === documentState.activePageId)
  const safeActivePageIndex = activePageIndex >= 0 ? activePageIndex : 0
  const activePage = documentState.pages[safeActivePageIndex]

  function setActivePage(pageId: string) {
    setDocumentState((current) => {
      if (current.activePageId === pageId) return current
      return { ...current, activePageId: pageId }
    })
  }

  function handleContentChange(content: string) {
    setDocumentState((current) => ({
      ...current,
      pages: current.pages.map((page) =>
        page.id === current.activePageId ? { ...page, content } : page
      ),
    }))
  }

  function handleCreatePage() {
    setDocumentState((current) => {
      const currentIndex = current.pages.findIndex((page) => page.id === current.activePageId)
      const insertIndex = currentIndex >= 0 ? currentIndex + 1 : current.pages.length
      const nextPage = createBlankPage()
      const nextPages = [...current.pages]
      nextPages.splice(insertIndex, 0, nextPage)
      return {
        ...current,
        activePageId: nextPage.id,
        pages: nextPages,
      }
    })
  }

  function handleDeletePage() {
    setDocumentState((current) => {
      if (current.pages.length <= 1) return current

      const currentIndex = current.pages.findIndex((page) => page.id === current.activePageId)
      if (currentIndex < 0) return current

      const currentPage = current.pages[currentIndex]
      if (currentPage.content.trim() && !window.confirm('当前页面有内容，确认删除这一页吗？')) {
        return current
      }

      const nextPages = current.pages.filter((page) => page.id !== currentPage.id)
      const nextActivePage = nextPages[currentIndex] ?? nextPages[currentIndex - 1] ?? nextPages[0]
      if (!nextActivePage) return createDocument()

      return {
        ...current,
        activePageId: nextActivePage.id,
        pages: nextPages,
      }
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
