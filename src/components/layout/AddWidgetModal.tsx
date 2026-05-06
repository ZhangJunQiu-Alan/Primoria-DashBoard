import { useState, useMemo } from 'react'
import { X, Search, Clock, Link2, FileText, CheckSquare, Mountain, CalendarDays, ListChecks, Disc3, Quote, CalendarClock, Sparkles } from 'lucide-react'
import { useDashboardStore } from '@/store/dashboardStore'
import type { WidgetType } from '@/types/widget'

interface WidgetDef {
  type: WidgetType
  name: string
  description: string
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>
  category: string
}

const WIDGET_DEFS: WidgetDef[] = [
  { type: 'clock', name: '时钟', description: '显示当前时间与日期', icon: Clock, category: '信息' },
  { type: 'quick-links', name: '快速链接', description: '常用书签，一键直达', icon: Link2, category: '效率' },
  { type: 'motto', name: '格言', description: '展示激励人奋斗的精选格言，每 10 分钟自动切换', icon: Quote, category: '灵感' },
  { type: 'notes', name: '便签', description: '随手记录想法', icon: FileText, category: '效率' },
  { type: 'lined-notes', name: '格纸笔记', description: '带横线格纸风格的笔记', icon: FileText, category: '效率' },
  { type: 'todo', name: '待办事项', description: '管理每日任务', icon: CheckSquare, category: '效率' },
  { type: 'focus-journey', name: '番茄钟', description: '徒步登山式专注：累计 20 小时登顶一次', icon: Mountain, category: '效率' },
  { type: 'google-calendar', name: 'Google 日历', description: '嵌入 Google Calendar 日历', icon: CalendarDays, category: '效率' },
  { type: 'music-player', name: '网易云播放器', description: '黑胶风格的网易云音乐播放卡片', icon: Disc3, category: '娱乐' },
  { type: 'habits', name: '习惯打卡', description: '追踪每日习惯，查看近 7 天', icon: ListChecks, category: '效率' },
  { type: 'scheduled-todo', name: '日程任务', description: '横向日期时间轴，可拖拽任务吸附到不同日期', icon: CalendarClock, category: '效率' },
  { type: 'daily-brief', name: '每日简报', description: '读取日程、待办、习惯和笔记生成当天建议', icon: Sparkles, category: 'AI' },
]

interface Props {
  open: boolean
  onClose: () => void
}

export function AddWidgetModal({ open, onClose }: Props) {
  const [search, setSearch] = useState('')
  const addWidget = useDashboardStore((s) => s.addWidget)

  const { filtered, categories } = useMemo(() => {
    const f = WIDGET_DEFS.filter((w) => w.name.includes(search) || w.description.includes(search))
    return { filtered: f, categories: [...new Set(f.map((w) => w.category))] }
  }, [search])

  if (!open) return null

  function handleAdd(type: WidgetType) {
    addWidget(type)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div
        className="absolute inset-0"
        style={{ background: 'rgba(61,52,42,0.3)', backdropFilter: 'blur(6px)' }}
      />
      <div
        className="relative w-full max-w-xl max-h-[75vh] flex flex-col overflow-hidden"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-lg)',
          boxShadow: '0 8px 40px rgba(90,70,50,0.18)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <h2
            style={{
              fontFamily: "'Cormorant Garamond', serif",
              fontSize: '20px',
              fontWeight: 500,
              color: 'var(--text)',
            }}
          >
            添加组件
          </h2>
          <button
            onClick={onClose}
            className="btn-icon-hover p-1.5 rounded-lg"
            style={{ color: 'var(--text-muted)' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* 搜索 */}
        <div className="px-6 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-xl"
            style={{ background: 'var(--bg-muted)', border: '1.5px solid var(--border)' }}
          >
            <Search size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索组件..."
              className="flex-1 text-sm outline-none bg-transparent"
              style={{ color: 'var(--text)', fontFamily: "'DM Sans', sans-serif" }}
            />
          </div>
        </div>

        {/* 组件列表 */}
        <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-5">
          {categories.map((category) => (
            <div key={category}>
              <h3
                className="mb-3"
                style={{
                  fontFamily: "'Cormorant Garamond', serif",
                  fontSize: '11px',
                  fontWeight: 600,
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  color: 'var(--text-muted)',
                  borderBottom: '1px solid var(--border)',
                  paddingBottom: '6px',
                }}
              >
                {category}
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {filtered
                  .filter((w) => w.category === category)
                  .map((w) => {
                    const Icon = w.icon
                    return (
                      <button
                        key={w.type}
                        onClick={() => handleAdd(w.type)}
                        className="widget-item flex items-center gap-3 p-3 rounded-xl text-left transition-all"
                        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
                      >
                        <div
                          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                          style={{ background: 'var(--bg-icon)' }}
                        >
                          <Icon size={18} style={{ color: 'var(--primary-dark)' }} />
                        </div>
                        <div>
                          <p style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text)' }}>
                            {w.name}
                          </p>
                          <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                            {w.description}
                          </p>
                        </div>
                      </button>
                    )
                  })}
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="text-sm text-center py-8" style={{ color: 'var(--text-muted)' }}>
              未找到相关组件
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
