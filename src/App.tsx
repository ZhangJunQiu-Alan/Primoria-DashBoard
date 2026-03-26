import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Dashboard } from '@/components/layout/Dashboard'
import { AddWidgetModal } from '@/components/layout/AddWidgetModal'
import { Toaster } from 'sonner'

export default function App() {
  const [modalOpen, setModalOpen] = useState(false)

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] relative">
      <Toaster theme="dark" />

      {/* Top bar */}
      <header className="fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-6 py-3 bg-[var(--bg-primary)]/80 backdrop-blur-sm border-b border-white/5">
        <span className="text-white/60 text-sm font-semibold tracking-wide">Primoria</span>
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-sm transition-colors"
        >
          <Plus size={14} />
          Add Widget
        </button>
      </header>

      {/* Dashboard grid */}
      <main className="pt-14">
        <Dashboard />
      </main>

      <AddWidgetModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  )
}
