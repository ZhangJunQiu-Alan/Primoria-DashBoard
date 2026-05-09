import { useState, useCallback, useRef, memo } from 'react'
import { Plus, X, Link2, ImageIcon } from 'lucide-react'
import { getDomainFromUrl, trackBehaviorEvent } from '@/lib/behaviorEvents'
import { useWidgetDataStore } from '@/store/widgetDataStore'

function getFavicon(url: string): string | null {
  try { return `${new URL(url).origin}/favicon.ico` } catch { return null }
}

export function QuickLinksWidget() {
  const quickLinks = useWidgetDataStore((s) => s.quickLinks)
  const addQuickLink = useWidgetDataStore((s) => s.addQuickLink)
  const removeQuickLink = useWidgetDataStore((s) => s.removeQuickLink)

  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ title: '', url: '' })
  const [iconMode, setIconMode] = useState<'auto' | 'url' | 'file'>('auto')
  const [iconUrl, setIconUrl] = useState('')
  const [iconPreview, setIconPreview] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string
      setIconPreview(dataUrl)
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  function resetForm() {
    setForm({ title: '', url: '' })
    setIconMode('auto')
    setIconUrl('')
    setIconPreview(null)
    setAdding(false)
  }

  const handleAdd = useCallback(() => {
    if (!form.url) return
    try {
      const title = form.title || new URL(form.url).hostname
      const customIcon = iconMode === 'file' ? iconPreview ?? undefined
        : iconMode === 'url' ? (iconUrl.trim() || undefined)
        : undefined
      addQuickLink({ title, url: form.url, iconUrl: customIcon })
      resetForm()
    } catch { /* invalid URL */ }
  }, [form, iconMode, iconUrl, iconPreview, addQuickLink])

  return (
    <div className="flex flex-col h-full gap-2">
      <div className="flex flex-wrap gap-2 flex-1 content-start">
        {quickLinks.map((link) => (
          <LinkItem
            key={link.id}
            id={link.id}
            title={link.title}
            url={link.url}
            iconUrl={link.iconUrl}
            onRemove={removeQuickLink}
          />
        ))}

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

          {/* Icon section */}
          <div className="flex flex-col gap-1.5">
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.05em' }}>图标（可选）</span>
            <div className="flex gap-1">
              {(['auto', 'url', 'file'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => { setIconMode(mode); setIconUrl(''); setIconPreview(null) }}
                  className="flex-1 text-xs rounded-lg py-1 transition-all"
                  style={{
                    background: iconMode === mode ? 'var(--primary)' : 'var(--bg-card)',
                    color: iconMode === mode ? 'white' : 'var(--text-muted)',
                    border: `1px solid ${iconMode === mode ? 'var(--primary)' : 'var(--border)'}`,
                  }}
                >
                  {mode === 'auto' ? '自动' : mode === 'url' ? 'URL' : '本地'}
                </button>
              ))}
            </div>

            {iconMode === 'url' && (
              <input
                placeholder="图标图片地址"
                value={iconUrl}
                onChange={(e) => setIconUrl(e.target.value)}
                className="rounded-lg px-2 py-1 text-xs outline-none"
                style={{ background: 'var(--bg-card)', border: '1.5px solid var(--border)', color: 'var(--text)' }}
              />
            )}

            {iconMode === 'file' && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => fileRef.current?.click()}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs transition-all"
                  style={{ background: 'var(--bg-card)', border: '1.5px solid var(--border)', color: 'var(--text-muted)' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--primary-light)'; e.currentTarget.style.color = 'var(--primary-dark)' }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)' }}
                >
                  <ImageIcon size={11} />
                  选择图片
                </button>
                {iconPreview && (
                  <img src={iconPreview} alt="" className="w-7 h-7 rounded-lg object-contain" style={{ background: 'var(--bg-card)' }} />
                )}
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
              </div>
            )}

            {iconMode === 'url' && iconUrl && (
              <img src={iconUrl} alt="" className="w-7 h-7 rounded-lg object-contain self-start" style={{ background: 'var(--bg-card)' }}
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
              />
            )}
          </div>

          <div className="flex gap-2">
            <button onClick={handleAdd} className="flex-1 text-xs rounded-lg py-1 text-white font-medium" style={{ background: 'var(--primary)' }}>
              确认
            </button>
            <button onClick={resetForm} className="flex-1 text-xs rounded-lg py-1" style={{ background: 'var(--border)', color: 'var(--text-sub)' }}>
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

const LinkItem = memo(function LinkItem({
  id, title, url, iconUrl, onRemove,
}: { id: string; title: string; url: string; iconUrl?: string; onRemove: (id: string) => void }) {
  const [faviconFailed, setFaviconFailed] = useState(false)
  const customIcon = iconUrl
  const favicon = !customIcon && !faviconFailed ? getFavicon(url) : null
  const showIcon = customIcon || favicon

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative flex flex-col items-center gap-1 p-2 rounded-xl transition-colors w-16"
      onClick={() => {
        trackBehaviorEvent({
          eventName: 'quick_link.opened',
          metadata: { domain: getDomainFromUrl(url), title },
          objectId: id,
          objectType: 'quick_link',
          summary: `打开快速链接：${title}`,
          surface: 'widget',
          widgetType: 'quick-links',
        })
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-muted)')}
      onMouseLeave={e => (e.currentTarget.style.background = '')}
      title={title}
    >
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove(id) }}
        className="absolute -top-1 -right-1 hidden group-hover:flex items-center justify-center w-4 h-4 rounded-full transition-colors"
        style={{ background: 'var(--border)' }}
        onMouseEnter={e => (e.currentTarget.style.background = '#C4807A')}
        onMouseLeave={e => (e.currentTarget.style.background = 'var(--border)')}
      >
        <X size={8} style={{ color: 'var(--text-sub)' }} />
      </button>

      {showIcon ? (
        <img
          src={customIcon ?? favicon!}
          alt=""
          className="w-8 h-8 rounded-lg object-contain"
          style={{ background: 'var(--bg-muted)' }}
          onError={(e) => {
            if (customIcon) {
              (e.target as HTMLImageElement).style.display = 'none'
            } else {
              setFaviconFailed(true)
            }
          }}
        />
      ) : (
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--bg-muted)' }}>
          <Link2 size={14} style={{ color: 'var(--text-muted)' }} />
        </div>
      )}
      <span className="truncate w-full text-center" style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
        {title}
      </span>
    </a>
  )
})
