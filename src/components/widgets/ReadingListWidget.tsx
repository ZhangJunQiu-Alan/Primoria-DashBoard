import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  MoreHorizontal,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react'
import {
  DEFAULT_READING_LIST_ITEMS,
  useWidgetDataStore,
  type ReadingListItem,
  type ReadingListStatus,
} from '@/store/widgetDataStore'

interface ReadingListWidgetProps {
  widgetId: string
}

const STATUS_TABS: Array<{ label: string; value: ReadingListStatus }> = [
  { label: 'To Read', value: 'to-read' },
  { label: 'Reading', value: 'reading' },
  { label: 'Done', value: 'done' },
]

const COMMON_TAGS = ['学习方法', 'AI 工具', 'AI', '设计', '效率']

function getNextStatus(status: ReadingListStatus): ReadingListStatus {
  if (status === 'to-read') return 'reading'
  if (status === 'reading') return 'done'
  return 'to-read'
}

function getRowActionLabel(status: ReadingListStatus) {
  if (status === 'to-read') return '开始阅读'
  if (status === 'reading') return '完成阅读'
  return '重新加入待读'
}

function getItemSearchText(item: ReadingListItem) {
  return `${item.title} ${item.source} ${item.tag}`.toLowerCase()
}

function ReadingListRow({
  item,
  onRemove,
  onStatusChange,
}: {
  item: ReadingListItem
  onRemove: (id: string) => void
  onStatusChange: (id: string, status: ReadingListStatus) => void
}) {
  const rowActionStatus = getNextStatus(item.status)
  const RowIcon = item.status === 'done' ? RotateCcw : item.status === 'reading' ? Check : BookOpen

  return (
    <div className="reading-list-row">
      <button
        className={`reading-list-checkbox${item.status === 'done' ? ' is-checked' : ''}`}
        onClick={() => onStatusChange(item.id, item.status === 'done' ? 'to-read' : 'done')}
        aria-label={item.status === 'done' ? '标为待读' : '标为已完成'}
      >
        {item.status === 'done' && <Check size={15} strokeWidth={2.5} />}
      </button>

      <div className="reading-list-row-main">
        <div className="reading-list-row-title" title={item.title}>
          {item.title}
        </div>
        <div className="reading-list-row-source" title={item.source}>
          {item.source}
        </div>
      </div>

      <div className="reading-list-row-tools">
        <button
          className="reading-list-row-action"
          onClick={() => onStatusChange(item.id, rowActionStatus)}
          title={getRowActionLabel(item.status)}
          aria-label={getRowActionLabel(item.status)}
        >
          <RowIcon size={15} />
        </button>
        <button
          className="reading-list-row-action danger"
          onClick={() => onRemove(item.id)}
          title="删除"
          aria-label="删除"
        >
          <Trash2 size={15} />
        </button>
        <span className="reading-list-tag" title={item.tag}>
          {item.tag}
        </span>
      </div>
    </div>
  )
}

export function ReadingListWidget({ widgetId }: ReadingListWidgetProps) {
  const storedItems = useWidgetDataStore((s) => s.readingListsByWidget[widgetId])
  const addReadingListItem = useWidgetDataStore((s) => s.addReadingListItem)
  const updateReadingListItemStatus = useWidgetDataStore((s) => s.updateReadingListItemStatus)
  const removeReadingListItem = useWidgetDataStore((s) => s.removeReadingListItem)
  const items = storedItems ?? DEFAULT_READING_LIST_ITEMS

  const [activeStatus, setActiveStatus] = useState<ReadingListStatus>('to-read')
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [savedVisible, setSavedVisible] = useState(false)
  const [form, setForm] = useState({ source: '', tag: '', title: '' })
  const titleInputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const saveTimerRef = useRef<number | null>(null)

  const tags = useMemo(() => {
    const unique = new Set([...COMMON_TAGS, ...items.map((item) => item.tag).filter(Boolean)])
    return [...unique]
  }, [items])

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return items.filter((item) => {
      if (item.status !== activeStatus) return false
      if (!normalizedQuery) return true
      return getItemSearchText(item).includes(normalizedQuery)
    })
  }, [activeStatus, items, query])

  const counts = useMemo(() => {
    return STATUS_TABS.reduce<Record<ReadingListStatus, number>>((acc, tab) => {
      acc[tab.value] = items.filter((item) => item.status === tab.value).length
      return acc
    }, { 'to-read': 0, reading: 0, done: 0 })
  }, [items])

  useEffect(() => {
    if (!adding) return
    window.setTimeout(() => titleInputRef.current?.focus(), 0)
  }, [adding])

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    }
  }, [])

  function resetForm() {
    setForm({ source: '', tag: '', title: '' })
    setAdding(false)
  }

  function handleSave() {
    const title = form.title.trim()
    if (!title) {
      titleInputRef.current?.focus()
      return
    }

    addReadingListItem(widgetId, {
      source: form.source,
      status: activeStatus,
      tag: form.tag,
      title,
    })
    resetForm()
    setSavedVisible(true)
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => setSavedVisible(false), 1800)
  }

  function clearDoneItems() {
    items
      .filter((item) => item.status === 'done')
      .forEach((item) => removeReadingListItem(widgetId, item.id))
    setMenuOpen(false)
  }

  return (
    <section className="reading-list-widget" aria-label="阅读清单">
      <header className="reading-list-header">
        <h2 className="reading-list-title drag-handle">READING LIST / 阅读清单</h2>
        <div className="reading-list-header-actions">
          {searchOpen && (
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setQuery('')
                  setSearchOpen(false)
                }
              }}
              className="reading-list-search-input"
              placeholder="搜索"
              aria-label="搜索阅读清单"
              autoFocus
            />
          )}
          <button
            className="reading-list-icon-button"
            onClick={() => setSearchOpen((open) => !open)}
            aria-label={searchOpen ? '关闭搜索' : '搜索'}
          >
            <Search size={23} strokeWidth={2.2} />
          </button>
          <div ref={menuRef} className="reading-list-menu-anchor">
            <button
              className="reading-list-icon-button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-label="更多操作"
              aria-expanded={menuOpen}
            >
              <MoreHorizontal size={23} strokeWidth={2.4} />
            </button>
            {menuOpen && (
              <div className="reading-list-menu">
                <button onClick={clearDoneItems} disabled={counts.done === 0}>
                  清理已完成
                </button>
                <button
                  onClick={() => {
                    setQuery('')
                    setSearchOpen(false)
                    setMenuOpen(false)
                  }}
                >
                  重置搜索
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="reading-list-toolbar">
        <div className="reading-list-tabs" role="tablist" aria-label="阅读状态">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              className={`reading-list-tab${activeStatus === tab.value ? ' is-active' : ''}`}
              onClick={() => setActiveStatus(tab.value)}
              role="tab"
              aria-selected={activeStatus === tab.value}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button
          className={`reading-list-add-button${adding ? ' is-active' : ''}`}
          onClick={() => setAdding((open) => !open)}
        >
          添加
        </button>
      </div>

      <div className="reading-list-body">
        {savedVisible && (
          <div className="reading-list-saved-toast" role="status">
            <CheckCircle2 size={17} />
            已添加
          </div>
        )}

        {adding && (
          <div className="reading-list-form">
            <label>
              <span>标题</span>
              <input
                ref={titleInputRef}
                value={form.title}
                onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') handleSave()
                  if (event.key === 'Escape') resetForm()
                }}
                placeholder="输入文章或书籍标题"
              />
            </label>
            <label>
              <span>来源</span>
              <input
                value={form.source}
                onChange={(event) => setForm((current) => ({ ...current, source: event.target.value }))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') handleSave()
                  if (event.key === 'Escape') resetForm()
                }}
                placeholder="输入来源，如网站、博客、作者或出版方"
              />
            </label>
            <label>
              <span>标签</span>
              <div className="reading-list-tag-input-wrap">
                <input
                  value={form.tag}
                  onChange={(event) => setForm((current) => ({ ...current, tag: event.target.value }))}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') handleSave()
                    if (event.key === 'Escape') resetForm()
                  }}
                  list={`reading-tags-${widgetId}`}
                  placeholder="输入或选择标签"
                />
                <ChevronDown size={16} />
                <datalist id={`reading-tags-${widgetId}`}>
                  {tags.map((tag) => (
                    <option key={tag} value={tag} />
                  ))}
                </datalist>
              </div>
            </label>

            <div className="reading-list-form-actions">
              <button className="reading-list-secondary-button" onClick={resetForm}>
                取消
              </button>
              <button className="reading-list-primary-button" onClick={handleSave}>
                保存
              </button>
            </div>
          </div>
        )}

        <div className="reading-list-table" role="list">
          {visibleItems.map((item) => (
            <ReadingListRow
              key={item.id}
              item={item}
              onRemove={(id) => removeReadingListItem(widgetId, id)}
              onStatusChange={(id, status) => updateReadingListItemStatus(widgetId, id, status)}
            />
          ))}

          {visibleItems.length === 0 && (
            <div className="reading-list-empty">
              {query.trim() ? '没有匹配的条目' : '这个状态下还没有阅读条目'}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
