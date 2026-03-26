import { useState } from 'react'
import { Plus, X, Link2 } from 'lucide-react'

interface Link {
  id: string
  title: string
  url: string
}

const DEFAULT_LINKS: Link[] = [
  { id: '1', title: 'GitHub', url: 'https://github.com' },
  { id: '2', title: 'Google', url: 'https://google.com' },
]

export function QuickLinksWidget() {
  const [links, setLinks] = useState<Link[]>(DEFAULT_LINKS)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ title: '', url: '' })

  function getFavicon(url: string) {
    try {
      const origin = new URL(url).origin
      return `${origin}/favicon.ico`
    } catch {
      return null
    }
  }

  function handleAdd() {
    if (!form.url) return
    const title = form.title || new URL(form.url).hostname
    setLinks((prev) => [...prev, { id: Date.now().toString(), title, url: form.url }])
    setForm({ title: '', url: '' })
    setAdding(false)
  }

  function handleRemove(id: string) {
    setLinks((prev) => prev.filter((l) => l.id !== id))
  }

  return (
    <div className="flex flex-col h-full gap-2">
      <div className="flex flex-wrap gap-2 flex-1 content-start">
        {links.map((link) => {
          const favicon = getFavicon(link.url)
          return (
            <a
              key={link.id}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group relative flex flex-col items-center gap-1 p-2 rounded-xl hover:bg-white/5 transition-colors w-16"
              title={link.title}
            >
              <button
                onClick={(e) => { e.preventDefault(); handleRemove(link.id) }}
                className="absolute -top-1 -right-1 hidden group-hover:flex items-center justify-center w-4 h-4 bg-white/10 rounded-full hover:bg-red-500/70 transition-colors"
              >
                <X size={8} />
              </button>
              {favicon ? (
                <img
                  src={favicon}
                  alt=""
                  className="w-8 h-8 rounded-lg object-contain bg-white/5"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                />
              ) : (
                <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
                  <Link2 size={14} className="text-white/40" />
                </div>
              )}
              <span className="text-white/60 text-[10px] truncate w-full text-center">{link.title}</span>
            </a>
          )
        })}

        <button
          onClick={() => setAdding(true)}
          className="flex flex-col items-center gap-1 p-2 rounded-xl hover:bg-white/5 transition-colors w-16"
        >
          <div className="w-8 h-8 rounded-lg border border-dashed border-white/20 flex items-center justify-center hover:border-white/40 transition-colors">
            <Plus size={14} className="text-white/40" />
          </div>
          <span className="text-white/30 text-[10px]">Add</span>
        </button>
      </div>

      {adding && (
        <div className="flex flex-col gap-2 p-2 bg-white/5 rounded-xl">
          <input
            autoFocus
            placeholder="URL (required)"
            value={form.url}
            onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
            className="bg-white/5 rounded-lg px-2 py-1 text-xs text-white outline-none border border-white/10 focus:border-white/30"
          />
          <input
            placeholder="Title (optional)"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            className="bg-white/5 rounded-lg px-2 py-1 text-xs text-white outline-none border border-white/10 focus:border-white/30"
          />
          <div className="flex gap-2">
            <button onClick={handleAdd} className="flex-1 text-xs bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg py-1 transition-colors">
              Add
            </button>
            <button onClick={() => setAdding(false)} className="flex-1 text-xs bg-white/5 hover:bg-white/10 rounded-lg py-1 transition-colors text-white/60">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
