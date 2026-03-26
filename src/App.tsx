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

      {/* Top bar — hidden when uiVisible = false */}
      {uiVisible && (
        <header
          className="fixed top-0 left-0 right-0 z-40 flex items-center justify-end gap-2 px-6 py-3"
          style={{
            background: 'rgba(254,250,245,0.82)',
            backdropFilter: 'blur(12px)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white transition-all"
            style={{
              background: 'linear-gradient(145deg, var(--primary-light), var(--primary))',
              borderRadius: '999px',
              boxShadow: '0 4px 0 var(--primary-dark), 0 2px 8px rgba(92,125,96,0.3)',
            }}
            onMouseEnter={e => (e.currentTarget.style.transform = 'translateY(-1px)')}
            onMouseLeave={e => (e.currentTarget.style.transform = '')}
          >
            <Plus size={14} />
            Add Widget
          </button>
        </header>
      )}

      {/* Eye toggle — always visible, top-right */}
      <button
        onClick={() => setUiVisible((v) => !v)}
        className="fixed z-50 p-2 rounded-full transition-all"
        style={{
          top: '14px',
          right: uiVisible ? '168px' : '16px',
          color: 'var(--text-muted)',
          background: 'rgba(254,250,245,0.9)',
          border: '1px solid var(--border)',
          boxShadow: '0 2px 8px var(--shadow)',
          backdropFilter: 'blur(8px)',
          transition: 'right 0.3s ease',
        }}
        title={uiVisible ? 'Hide UI' : 'Show UI'}
        onMouseEnter={e => (e.currentTarget.style.color = 'var(--text)')}
        onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
      >
        {uiVisible ? <Eye size={15} /> : <EyeOff size={15} />}
      </button>

      <main
        className="relative z-10"
        style={{ paddingTop: uiVisible ? '56px' : '0' }}
      >
        <Dashboard showWidgetHeaders={uiVisible} />
      </main>

      {/* AI floating button — hidden when uiVisible = false */}
      {uiVisible && (
        <button
          onClick={() => setAiOpen((o) => !o)}
          className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-4 py-3 text-white text-sm font-medium transition-all"
          style={{
            background: 'linear-gradient(135deg, var(--primary-light), var(--secondary))',
            borderRadius: '999px',
            boxShadow: '0 4px 16px rgba(90,70,50,0.2)',
          }}
          onMouseEnter={e => (e.currentTarget.style.transform = 'translateY(-2px)')}
          onMouseLeave={e => (e.currentTarget.style.transform = '')}
        >
          <Sparkles size={15} />
          AI
        </button>
      )}

      <AddWidgetModal open={modalOpen} onClose={() => setModalOpen(false)} />
      <AIChatPanel open={aiOpen} onClose={() => setAiOpen(false)} />
    </div>
  )
}
