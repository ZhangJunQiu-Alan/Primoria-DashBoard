import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  ExternalLink,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react'
import {
  getReadingListUrlDomain,
  normalizeReadingListItems,
  normalizeReadingListUrl,
  useWidgetDataStore,
  type ReadingListItem,
  type ReadingListStatus,
} from '@/store/widgetDataStore'
import { summarizeText, trackBehaviorEvent } from '@/lib/behaviorEvents'

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
  const domain = getReadingListUrlDomain(item.source) ?? ''
  return `${item.title} ${item.source} ${domain} ${item.tag}`.toLowerCase()
}

function ReadingListRow({
  item,
  onCopy,
  onEdit,
  onRemove,
  onStatusChange,
}: {
  item: ReadingListItem
  onCopy: (item: ReadingListItem) => void
  onEdit: (item: ReadingListItem) => void
  onRemove: (id: string) => void
  onStatusChange: (id: string, status: ReadingListStatus) => void
}) {
  const rowActionStatus = getNextStatus(item.status)
  const RowIcon = item.status === 'done' ? RotateCcw : item.status === 'reading' ? Check : BookOpen
  const normalizedUrl = normalizeReadingListUrl(item.source)
  const sourceLabel = normalizedUrl ? getReadingListUrlDomain(normalizedUrl) ?? normalizedUrl : '链接待补充'

  return (
    <div className="reading-list-row" role="listitem">
      <button
        className={`reading-list-checkbox${item.status === 'done' ? ' is-checked' : ''}`}
        onClick={() => onStatusChange(item.id, item.status === 'done' ? 'to-read' : 'done')}
        aria-label={item.status === 'done' ? '标为待读' : '标为已完成'}
      >
        {item.status === 'done' && <Check size={15} strokeWidth={2.5} />}
      </button>

      <div className="reading-list-row-main">
        {normalizedUrl ? (
          <>
            <a
              className="reading-list-row-title reading-list-link"
              href={normalizedUrl}
              target="_blank"
              rel="noopener noreferrer"
              title={item.title}
            >
              <span>{item.title}</span>
              <ExternalLink size={11} />
            </a>
            <a
              className="reading-list-row-source reading-list-link"
              href={normalizedUrl}
              target="_blank"
              rel="noopener noreferrer"
              title={normalizedUrl}
            >
              {sourceLabel}
            </a>
          </>
        ) : (
          <>
            <div className="reading-list-row-title is-unlinked" title={item.title}>
              {item.title}
            </div>
            <div className="reading-list-row-source is-invalid" title={item.source}>
              {sourceLabel}
            </div>
          </>
        )}
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
          className="reading-list-row-action"
          onClick={() => onEdit(item)}
          title="编辑"
          aria-label="编辑"
        >
          <Pencil size={14} />
        </button>
        <button
          className="reading-list-row-action"
          onClick={() => onCopy(item)}
          disabled={!normalizedUrl}
          title={normalizedUrl ? '复制链接' : '链接待补充'}
          aria-label={normalizedUrl ? '复制链接' : '链接待补充'}
        >
          <Copy size={14} />
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
  const updateReadingListItem = useWidgetDataStore((s) => s.updateReadingListItem)
  const updateReadingListItemStatus = useWidgetDataStore((s) => s.updateReadingListItemStatus)
  const removeReadingListItem = useWidgetDataStore((s) => s.removeReadingListItem)
  const items = useMemo(() => normalizeReadingListItems(storedItems ?? []), [storedItems])

  const [activeStatus, setActiveStatus] = useState<ReadingListStatus>('to-read')
  const [activeTag, setActiveTag] = useState('all')
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [formError, setFormError] = useState('')
  const [form, setForm] = useState({ source: '', tag: '', title: '' })
  const titleInputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const saveTimerRef = useRef<number | null>(null)

  const formTags = useMemo(() => {
    const unique = new Set([...COMMON_TAGS, ...items.map((item) => item.tag).filter(Boolean)])
    return [...unique]
  }, [items])

  const itemTags = useMemo(() => {
    return [...new Set(items.map((item) => item.tag).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  }, [items])

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return items.filter((item) => {
      if (item.status !== activeStatus) return false
      if (activeTag !== 'all' && item.tag !== activeTag) return false
      if (!normalizedQuery) return true
      return getItemSearchText(item).includes(normalizedQuery)
    })
  }, [activeStatus, activeTag, items, query])

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
    setEditingId(null)
    setFormError('')
    setAdding(false)
  }

  function showNotice(message: string) {
    setNotice(message)
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => setNotice(''), 1800)
  }

  function startEdit(item: ReadingListItem) {
    setForm({ source: item.source, tag: item.tag, title: item.title })
    setEditingId(item.id)
    setAdding(true)
    setFormError('')
  }

  function toggleAddForm() {
    if (adding) {
      resetForm()
      return
    }
    setForm({ source: '', tag: '', title: '' })
    setEditingId(null)
    setFormError('')
    setAdding(true)
  }

  function handleSave() {
    const title = form.title.trim()
    if (!title) {
      titleInputRef.current?.focus()
      return
    }
    const normalizedUrl = normalizeReadingListUrl(form.source)
    if (!normalizedUrl) {
      setFormError('请输入有效链接，例如 example.com 或 https://example.com')
      return
    }

    if (editingId) {
      updateReadingListItem(widgetId, editingId, {
        source: normalizedUrl,
        tag: form.tag,
        title,
      })
    } else {
      addReadingListItem(widgetId, {
        source: normalizedUrl,
        status: activeStatus,
        tag: form.tag,
        title,
      })
    }
    resetForm()
    showNotice(editingId ? '已更新' : '已添加')
  }

  async function copyItemLink(item: ReadingListItem) {
    const normalizedUrl = normalizeReadingListUrl(item.source)
    if (!normalizedUrl) return
    try {
      await navigator.clipboard.writeText(normalizedUrl)
    } catch {
      showNotice('复制失败')
      return
    }
    showNotice('链接已复制')
    trackBehaviorEvent({
      eventName: 'reading_list.item_link_copied',
      metadata: {
        sourceDomain: getReadingListUrlDomain(normalizedUrl),
        titleSummary: summarizeText(item.title, 72),
      },
      objectId: item.id,
      objectType: 'reading_list_item',
      summary: `复制阅读链接：${summarizeText(item.title, 72)}`,
      surface: 'widget',
      widgetId,
      widgetType: 'reading-list',
    })
  }

  function clearDoneItems() {
    items
      .filter((item) => item.status === 'done')
      .forEach((item) => removeReadingListItem(widgetId, item.id))
    setMenuOpen(false)
  }

  return (
    <section className="reading-list-widget" aria-label="阅读清单">
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

        <div className="reading-list-actions">
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
            className={`reading-list-add-button${adding ? ' is-active' : ''}`}
            onClick={toggleAddForm}
          >
            添加
          </button>
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
                    setActiveTag('all')
                    setSearchOpen(false)
                    setMenuOpen(false)
                  }}
                >
                  重置筛选
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="reading-list-body">
        {notice && (
          <div className="reading-list-saved-toast" role="status">
            <CheckCircle2 size={17} />
            {notice}
          </div>
        )}

        {itemTags.length > 0 && (
          <div className="reading-list-filter-row">
            <select
              className="reading-list-tag-filter"
              value={activeTag}
              onChange={(event) => setActiveTag(event.target.value)}
              aria-label="按标签筛选阅读清单"
            >
              <option value="all">全部标签</option>
              {itemTags.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
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
              <span>链接</span>
              <input
                value={form.source}
                onChange={(event) => {
                  setForm((current) => ({ ...current, source: event.target.value }))
                  setFormError('')
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') handleSave()
                  if (event.key === 'Escape') resetForm()
                }}
                placeholder="example.com 或 https://example.com"
                inputMode="url"
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
                  {formTags.map((tag) => (
                    <option key={tag} value={tag} />
                  ))}
                </datalist>
              </div>
            </label>

            {formError && (
              <p className="reading-list-form-error" role="alert">
                {formError}
              </p>
            )}

            <div className="reading-list-form-actions">
              <button className="reading-list-secondary-button" onClick={resetForm}>
                取消
              </button>
              <button className="reading-list-primary-button" onClick={handleSave}>
                {editingId ? '更新' : '保存'}
              </button>
            </div>
          </div>
        )}

        <div className="reading-list-table" role="list">
          {visibleItems.map((item) => (
            <ReadingListRow
              key={item.id}
              item={item}
              onCopy={(entry) => void copyItemLink(entry)}
              onEdit={startEdit}
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
