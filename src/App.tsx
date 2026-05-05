import { useEffect, useRef, useState } from 'react'
import { Plus, Eye, EyeOff, Sparkles, ImageIcon, Music2, LoaderCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Dashboard } from '@/components/layout/Dashboard'
import { AddWidgetModal } from '@/components/layout/AddWidgetModal'
import { AIChatPanel } from '@/components/layout/AIChatPanel'
import { TodoDndProvider } from '@/components/layout/TodoDndProvider'
import { CloudSyncControl } from '@/components/cloud/CloudSyncControl'
import { CloudSyncProvider } from '@/components/cloud/CloudSyncProvider'
import { useMusicUploader } from '@/hooks/useMusicUploader'
import { useUiVisible } from '@/hooks/useUiVisible'
import { useGoogleCalendarTokenCapture } from '@/hooks/useGoogleCalendarTokenCapture'
import { useWidgetDataStoreSync } from '@/hooks/useWidgetDataStoreSync'
import { sweepExpiredAudio } from '@/lib/audioCache'
import { ALLOWED_BACKGROUND_IMAGE_TYPES, MAX_BACKGROUND_IMAGE_BYTES } from '@/lib/cloudSnapshots'
import { migrateLegacyNotesToWidgetStore } from '@/lib/notesMigration'
import { useBackgroundStore } from '@/store/backgroundStore'
import { useDashboardStore } from '@/store/dashboardStore'
import { Toaster } from 'sonner'

export default function App() {
  return (
    <CloudSyncProvider>
      <DashboardApp />
    </CloudSyncProvider>
  )
}

function DashboardApp() {
  const [modalOpen, setModalOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [uiVisible, setUiVisible] = useUiVisible()
  const widgets = useDashboardStore((s) => s.widgets)
  const backgroundImage = useBackgroundStore((s) => s.backgroundImage)
  const setBackgroundImage = useBackgroundStore((s) => s.setBackgroundImage)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const musicInputRef = useRef<HTMLInputElement>(null)
  const { uploading: musicUploading, handleFiles: handleMusicFiles } = useMusicUploader()

  useWidgetDataStoreSync()
  useGoogleCalendarTokenCapture()

  useEffect(() => {
    void sweepExpiredAudio()
  }, [])

  useEffect(() => {
    migrateLegacyNotesToWidgetStore(widgets)
  }, [widgets])

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!ALLOWED_BACKGROUND_IMAGE_TYPES.includes(file.type)) {
      toast.error('请选择 PNG、JPG、WebP 或 GIF 图片')
      e.target.value = ''
      return
    }
    if (file.size > MAX_BACKGROUND_IMAGE_BYTES) {
      toast.error('壁纸图片不能超过 5MB')
      e.target.value = ''
      return
    }
    const reader = new FileReader()
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string
      setBackgroundImage(dataUrl)
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  return (
    <TodoDndProvider>
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
            className="btn-ghost-hover flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-all"
            style={{
              color: backgroundImage ? 'var(--primary-dark)' : 'var(--text-sub)',
              background: backgroundImage
                ? 'linear-gradient(135deg, var(--bg-hover), var(--bg-hover-dark))'
                : 'rgba(254,250,245,0.92)',
              borderRadius: '999px',
              border: `1px solid ${backgroundImage ? 'var(--primary-light)' : 'var(--border)'}`,
              boxShadow: '0 2px 8px var(--shadow)',
              backdropFilter: 'blur(8px)',
            }}
            title={backgroundImage ? '更换壁纸' : '设置壁纸'}
          >
            <ImageIcon size={13} />
            壁纸
          </button>
          {backgroundImage && (
            <button
              onClick={() => setBackgroundImage(null)}
              className="btn-danger-hover px-3 py-1.5 rounded-full text-sm transition-all"
              style={{
                color: 'var(--text-muted)',
                background: 'rgba(254,250,245,0.92)',
                border: '1px solid var(--border)',
                backdropFilter: 'blur(8px)',
              }}
            >
              移除壁纸
            </button>
          )}

          {/* AI 助手 */}
          <button
            onClick={() => setAiOpen((o) => !o)}
            className="btn-lift flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white transition-all"
            style={{
              background: 'linear-gradient(135deg, var(--primary-light), var(--secondary))',
              borderRadius: '999px',
              boxShadow: '0 2px 8px rgba(196,149,106,0.35)',
            }}
          >
            <Sparkles size={13} />
            AI 助手
          </button>

          <CloudSyncControl />

          {/* 添加组件 */}
          <button
            onClick={() => setModalOpen(true)}
            className="btn-lift flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white transition-all"
            style={{
              background: 'linear-gradient(145deg, var(--primary-light), var(--primary))',
              borderRadius: '999px',
              boxShadow: '0 4px 0 var(--primary-dark), 0 2px 8px rgba(92,125,96,0.3)',
            }}
          >
            <Plus size={13} />
            添加组件
          </button>

          {/* 上传音乐 */}
          <button
            onClick={() => musicInputRef.current?.click()}
            disabled={musicUploading}
            className="btn-ghost-hover flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-all disabled:opacity-60"
            style={{
              color: 'var(--text-sub)',
              background: 'rgba(254,250,245,0.92)',
              borderRadius: '999px',
              border: '1px solid var(--border)',
              boxShadow: '0 2px 8px var(--shadow)',
              backdropFilter: 'blur(8px)',
            }}
            title="上传 MP3 到云端音乐库"
          >
            {musicUploading ? <LoaderCircle size={13} className="animate-spin" /> : <Music2 size={13} />}
            上传音乐
          </button>
        </div>

        {/* 眼睛按钮 — 始终可见 */}
        <button
          onClick={() => setUiVisible((v) => !v)}
          className="btn-ghost-hover flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-all"
          style={{
            color: uiVisible ? 'var(--text-sub)' : 'var(--primary-dark)',
            background: uiVisible
              ? 'rgba(254,250,245,0.92)'
              : 'linear-gradient(135deg, var(--bg-hover), var(--bg-hover-dark))',
            borderRadius: '999px',
            border: `1px solid ${uiVisible ? 'var(--border)' : 'var(--primary-light)'}`,
            boxShadow: '0 2px 8px var(--shadow)',
            backdropFilter: 'blur(8px)',
          }}
          title={uiVisible ? '隐藏界面' : '显示界面'}
        >
          {uiVisible ? <Eye size={13} /> : <EyeOff size={13} />}
          {uiVisible ? '隐藏' : '显示'}
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
          style={{ paddingTop: uiVisible ? '52px' : '0' }}
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

        <input
          ref={musicInputRef}
          type="file"
          accept="audio/*,.mp3,.m4a,.flac,.ogg,.opus,.wav"
          multiple
          className="hidden"
          onChange={(e) => {
            handleMusicFiles(e.target.files)
            e.target.value = ''
          }}
        />

        <AddWidgetModal open={modalOpen} onClose={() => setModalOpen(false)} />
        <AIChatPanel open={aiOpen} onClose={() => setAiOpen(false)} />
      </div>
    </TodoDndProvider>
  )
}
