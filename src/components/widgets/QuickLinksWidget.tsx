import { useState } from 'react'
import { Plus, X, Link2 } from 'lucide-react'
import { useWidgetDataStore } from '@/store/widgetDataStore'

export function QuickLinksWidget() {
  const { quickLinks, addQuickLink, removeQuickLink } = useWidgetDataStore()
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ title: '', url: '' })

  function getFavicon(url: string) {
    try {
      return `${new URL(url).origin}/favicon.ico`
    } catch {
      return null
    }
  }

  function handleAdd() {
    if (!form.url) return
    try {
      const title = form.title || new URL(form.url).hostname
      addQuickLink({ title, url: form.url })
      setForm({ title: '', url: '' })
      setAdding(false)
    } catch {
      // URL 格式错误
    }
  }

  return (
    <div className="flex flex-col h-full gap-2">
      <div className="flex flex-wrap gap-2 flex-1 content-start">
        {quickLinks.map((link) => {
          const favicon = getFavicon(link.url)
          return (
            <a
              key={link.id}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group relative flex flex-col items-center gap-1 p-2 rounded-xl transition-colors w-16"
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-muted)')}
              onMouseLeave={e => (e.currentTarget.style.background = '')}
              title={link.title}
            >
              <button
                onClick={(e) => { e.preventDefault(); removeQuickLink(link.id) }}
                className="absolute -top-1 -right-1 hidden group-hover:flex items-center justify-center w-4 h-4 rounded-full transition-colors"
                style={{ background: 'var(--border)' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#C4807A')}
                onMouseLeave={e => (e.currentTarget.style.background = 'var(--border)')}
              >
                <X size={8} style={{ color: 'var(--text-sub)' }} />
              </button>
              {favicon ? (
                <img
                  src={favicon}
                  alt=""
                  className="w-8 h-8 rounded-lg object-contain"
                  style={{ background: 'var(--bg-muted)' }}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                />
              ) : (
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{ background: 'var(--bg-muted)' }}
                >
                  <Link2 size={14} style={{ color: 'var(--text-muted)' }} />
                </div>
              )}
              <span className="truncate w-full text-center" style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                {link.title}
              </span>
            </a>
          )
        })}

        <button
          onClick={() => setAdding(true)}
          className="flex flex-col items-center gap-1 p-2 rounded-xl transition-colors w-16"
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-muted)')}
          onMouseLeave={e => (e.currentTarget.style.background = '')}
        >
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center border border-dashed"
            style={{ borderColor: 'var(--border)' }}
          >
            <Plus size={14} style={{ color: 'var(--text-muted)' }} />
          </div>
          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>添加</span>
        </button>
      </div>

      {adding && (
        <div className="flex flex-col gap-2 p-2 rounded-xl" style={{ background: 'var(--bg-muted)' }}>
          <input
            autoFocus
            placeholder="网址（必填）"
            value={form.url}
            onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            className="rounded-lg px-2 py-1 text-xs outline-none"
            style={{ background: 'var(--bg-card)', border: '1.5px solid var(--border)', color: 'var(--text)' }}
          />
          <input
            placeholder="名称（可选）"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            className="rounded-lg px-2 py-1 text-xs outline-none"
            style={{ background: 'var(--bg-card)', border: '1.5px solid var(--border)', color: 'var(--text)' }}
          />
          <div className="flex gap-2">
            <button onClick={handleAdd} className="flex-1 text-xs rounded-lg py-1 text-white font-medium" style={{ background: 'var(--primary)' }}>
              确认
            </button>
            <button onClick={() => setAdding(false)} className="flex-1 text-xs rounded-lg py-1" style={{ background: 'var(--border)', color: 'var(--text-sub)' }}>
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
