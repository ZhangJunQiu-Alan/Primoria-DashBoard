import { useState } from 'react'
import { Plus, Eye, EyeOff, Sparkles } from 'lucide-react'
import { Dashboard } from '@/components/layout/Dashboard'
import { AddWidgetModal } from '@/components/layout/AddWidgetModal'
import { AIChatPanel } from '@/components/layout/AIChatPanel'
import { Toaster } from 'sonner'

export default function App() {
  const [modalOpen, setModalOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [uiVisible, setUiVisible] = useState(true)

  return (
    <div className="min-h-screen relative" style={{ background: 'var(--bg)' }}>
      <Toaster theme="light" />

      {/* 顶部栏 */}
      <header
        className="fixed top-0 left-0 right-0 z-40 flex items-center justify-end gap-2 px-4 py-2.5"
        style={{
          background: 'rgba(254,250,245,0.82)',
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid var(--border)',
          transform: uiVisible ? 'translateY(0)' : 'translateY(-100%)',
          transition: 'transform 0.3s ease',
        }}
      >
        {/* AI 按钮 */}
        <button
          onClick={() => setAiOpen((o) => !o)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white transition-all"
          style={{
            background: 'linear-gradient(135deg, var(--primary-light), var(--secondary))',
            borderRadius: '999px',
            boxShadow: '0 2px 8px rgba(196,149,106,0.35)',
          }}
          onMouseEnter={e => (e.currentTarget.style.transform = 'translateY(-1px)')}
          onMouseLeave={e => (e.currentTarget.style.transform = '')}
        >
          <Sparkles size={13} />
          AI 助手
        </button>

        {/* 添加组件按钮 */}
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white transition-all"
          style={{
            background: 'linear-gradient(145deg, var(--primary-light), var(--primary))',
            borderRadius: '999px',
            boxShadow: '0 4px 0 var(--primary-dark), 0 2px 8px rgba(92,125,96,0.3)',
          }}
          onMouseEnter={e => (e.currentTarget.style.transform = 'translateY(-1px)')}
          onMouseLeave={e => (e.currentTarget.style.transform = '')}
        >
          <Plus size={13} />
          添加组件
        </button>
      </header>

      {/* 眼睛按钮 — 始终固定在右上角 */}
      <button
        onClick={() => setUiVisible((v) => !v)}
        className="fixed z-50 p-2 rounded-full transition-all"
        style={{
          top: '10px',
          right: '10px',
          color: uiVisible ? 'var(--text-muted)' : 'var(--primary)',
          background: 'rgba(254,250,245,0.92)',
          border: '1px solid var(--border)',
          boxShadow: '0 2px 8px var(--shadow)',
          backdropFilter: 'blur(8px)',
        }}
        title={uiVisible ? '隐藏界面' : '显示界面'}
        onMouseEnter={e => (e.currentTarget.style.color = 'var(--primary-dark)')}
        onMouseLeave={e => (e.currentTarget.style.color = uiVisible ? 'var(--text-muted)' : 'var(--primary)')}
      >
        {uiVisible ? <Eye size={15} /> : <EyeOff size={15} />}
      </button>

      <main
        className="relative z-10"
        style={{ paddingTop: uiVisible ? '52px' : '0', transition: 'padding-top 0.3s ease' }}
      >
        <Dashboard showWidgetHeaders={uiVisible} />
      </main>

      <AddWidgetModal open={modalOpen} onClose={() => setModalOpen(false)} />
      <AIChatPanel open={aiOpen} onClose={() => setAiOpen(false)} />
    </div>
  )
}
