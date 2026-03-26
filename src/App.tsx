import { useRef } from 'react'
import { useState } from 'react'
import { Plus, Eye, EyeOff, Sparkles, ImageIcon } from 'lucide-react'
import { Dashboard } from '@/components/layout/Dashboard'
import { AddWidgetModal } from '@/components/layout/AddWidgetModal'
import { AIChatPanel } from '@/components/layout/AIChatPanel'
import { useDashboardStore } from '@/store/dashboardStore'
import { Toaster } from 'sonner'

export default function App() {
  const [modalOpen, setModalOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [uiVisible, setUiVisible] = useState(true)
  const backgroundImage = useDashboardStore((s) => s.backgroundImage)
  const setBackgroundImage = useDashboardStore((s) => s.setBackgroundImage)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string
      setBackgroundImage(dataUrl)
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  return (
    <div
      className="min-h-screen relative"
      style={{
        background: backgroundImage
          ? `url(${backgroundImage}) center/cover no-repeat fixed`
          : 'var(--bg)',
      }}
    >
      {backgroundImage && (
        <div className="fixed inset-0 z-0" style={{ background: 'rgba(254,250,245,0.55)' }} />
      )}

      <Toaster theme="light" />

      {/* 右上角控制区 — 始终在右上角 */}
      <div className="fixed top-0 right-0 z-50 flex items-center gap-2 px-4 py-2.5">

        {/* 顶部栏按钮组 — 跟随 uiVisible 显示/隐藏 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            transform: uiVisible ? 'translateY(0)' : 'translateY(-52px)',
            opacity: uiVisible ? 1 : 0,
            transition: 'transform 0.3s ease, opacity 0.2s ease',
            pointerEvents: uiVisible ? 'auto' : 'none',
          }}
        >
          {/* 背景图 */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="p-2 rounded-full transition-all"
            style={{
              color: 'var(--text-muted)',
              background: 'rgba(254,250,245,0.9)',
              border: '1px solid var(--border)',
              boxShadow: '0 2px 8px var(--shadow)',
            }}
            title={backgroundImage ? '更换背景图' : '设置背景图'}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--text)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
          >
            <ImageIcon size={14} />
          </button>
          {backgroundImage && (
            <button
              onClick={() => setBackgroundImage(null)}
              className="px-2 py-1 rounded-full text-xs transition-all"
              style={{
                color: 'var(--text-muted)',
                background: 'rgba(254,250,245,0.9)',
                border: '1px solid var(--border)',
              }}
            >
              移除背景
            </button>
          )}

          {/* AI 助手 */}
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

          {/* 添加组件 */}
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
        </div>

        {/* 眼睛按钮 — 始终可见 */}
        <button
          onClick={() => setUiVisible((v) => !v)}
          className="p-2 rounded-full transition-all"
          style={{
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
      </div>

      {/* 顶部栏背景条 */}
      {uiVisible && (
        <div
          className="fixed top-0 left-0 right-0 z-40"
          style={{
            height: '52px',
            background: 'rgba(254,250,245,0.82)',
            backdropFilter: 'blur(12px)',
            borderBottom: '1px solid var(--border)',
          }}
        />
      )}

      <main
        className="relative z-10"
        style={{ paddingTop: uiVisible ? '52px' : '0', transition: 'padding-top 0.3s ease' }}
      >
        <Dashboard showWidgetHeaders={uiVisible} />
      </main>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleImageUpload}
      />

      <AddWidgetModal open={modalOpen} onClose={() => setModalOpen(false)} />
      <AIChatPanel open={aiOpen} onClose={() => setAiOpen(false)} />
    </div>
  )
}
