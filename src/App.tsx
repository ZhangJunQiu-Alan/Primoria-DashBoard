import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Dashboard } from '@/components/layout/Dashboard'
import { AddWidgetModal } from '@/components/layout/AddWidgetModal'
import { Toaster } from 'sonner'

export default function App() {
  const [modalOpen, setModalOpen] = useState(false)

  return (
    <div className="min-h-screen relative" style={{ background: 'var(--bg)' }}>
      <Toaster theme="light" />

      {/* Top bar */}
      <header
        className="fixed top-0 left-0 right-0 z-40 flex items-center justify-end px-6 py-3"
        style={{
          background: 'rgba(254,250,245,0.82)',
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-all"
          style={{
            background: 'linear-gradient(145deg, var(--primary-light), var(--primary))',
            color: '#fff',
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

      <main className="pt-14 relative z-10">
        <Dashboard />
      </main>

      <AddWidgetModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  )
}
