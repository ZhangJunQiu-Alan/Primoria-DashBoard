import { useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, CheckCircle2, Cloud, CloudOff, LoaderCircle, LogIn, LogOut, RefreshCw, X } from 'lucide-react'
import { toast } from 'sonner'
import { useCloudSync } from '@/components/cloud/cloudSyncContext'

function formatSyncTime(value: string | null) {
  if (!value) return '尚未同步'
  return new Date(value).toLocaleString()
}

export function CloudSyncControl() {
  const cloudSync = useCloudSync()
  const [open, setOpen] = useState(false)
  const syncing = cloudSync.status === 'syncing' || cloudSync.status === 'checking'

  const color = cloudSync.user
    ? cloudSync.status === 'error' || cloudSync.status === 'conflict'
      ? '#B65E52'
      : cloudSync.status === 'offline' || cloudSync.status === 'pending'
        ? '#9A7A41'
      : 'var(--primary-dark)'
    : 'var(--text-sub)'

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="btn-ghost-hover flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-all"
        style={{
          color,
          background: 'rgba(254,250,245,0.92)',
          borderRadius: '999px',
          border: '1px solid var(--border)',
          boxShadow: '0 2px 8px var(--shadow)',
          backdropFilter: 'blur(8px)',
        }}
        title="云同步"
      >
        {syncing ? (
          <LoaderCircle size={13} className="animate-spin" />
        ) : cloudSync.status === 'offline' ? (
          <CloudOff size={13} />
        ) : cloudSync.status === 'conflict' || cloudSync.status === 'error' ? (
          <AlertTriangle size={13} />
        ) : cloudSync.user ? (
          <Cloud size={13} />
        ) : (
          <CloudOff size={13} />
        )}
        云同步
      </button>

      {open && createPortal(<CloudSyncDialog onClose={() => setOpen(false)} />, document.body)}
    </>
  )
}

function CloudSyncDialog({ onClose }: { onClose: () => void }) {
  const { configured, message, online, pushNow, signIn, signOut, signUp, status, updatedAt, user } = useCloudSync()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  async function runAuth(action: 'sign-in' | 'sign-up') {
    if (!email.trim() || !password) return
    setBusy(true)
    try {
      if (action === 'sign-in') {
        await signIn(email.trim(), password)
        toast.success('已登录，正在同步数据')
      } else {
        await signUp(email.trim(), password)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '认证失败')
    } finally {
      setBusy(false)
    }
  }

  async function handlePushNow() {
    setBusy(true)
    try {
      const synced = await pushNow()
      if (synced) toast.success('已手动同步')
      else toast.message('本地更改已保留，联网后会继续同步')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '手动同步失败')
    } finally {
      setBusy(false)
    }
  }

  async function handleSignOut() {
    setBusy(true)
    try {
      await signOut()
      toast.success('已退出云同步')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '退出失败')
    } finally {
      setBusy(false)
    }
  }

  const ready = status === 'ready'
  const syncing = status === 'syncing' || status === 'checking'
  const blocked = !online || status === 'conflict'

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center px-4" style={{ background: 'rgba(61,52,42,0.18)' }}>
      <div
        className="w-full max-w-[390px] rounded-2xl p-5"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          boxShadow: '0 18px 52px rgba(61,52,42,0.18)',
        }}
      >
        <div className="flex items-start gap-3">
          <div
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl"
            style={{
              background: user ? 'rgba(92,125,96,0.12)' : 'rgba(185,150,95,0.12)',
              color: user ? 'var(--primary-dark)' : 'var(--text-sub)',
            }}
          >
            {syncing ? (
              <LoaderCircle size={18} className="animate-spin" />
            ) : status === 'offline' ? (
              <CloudOff size={18} />
            ) : status === 'conflict' || status === 'error' ? (
              <AlertTriangle size={18} />
            ) : user ? (
              <Cloud size={18} />
            ) : (
              <CloudOff size={18} />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div style={{ fontSize: '16px', fontWeight: 650, color: 'var(--text)' }}>云同步</div>
            <p style={{ marginTop: '5px', fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.6 }}>
              {message ?? (user ? '已启用 Supabase 个人云同步。' : '登录后同步布局、组件数据和壁纸。')}
            </p>
          </div>
          <button onClick={onClose} className="rounded-xl p-1.5" style={{ color: 'var(--text-muted)' }}>
            <X size={16} />
          </button>
        </div>

        {!configured ? (
          <div className="mt-5 rounded-xl p-4" style={{ background: 'var(--bg-muted)', color: 'var(--text-sub)', fontSize: '12px', lineHeight: 1.7 }}>
            还没有配置 Supabase。部署时需要设置
            <code> VITE_SUPABASE_URL </code>
            和
            <code> VITE_SUPABASE_ANON_KEY </code>
            ；当前页面会继续使用本地模式。
          </div>
        ) : user ? (
          <div className="mt-5 flex flex-col gap-3">
            <div className="rounded-xl p-4" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border)' }}>
              <div className="flex items-center gap-2" style={{ color: ready ? 'var(--primary-dark)' : 'var(--text-sub)', fontSize: '13px', fontWeight: 650 }}>
                {ready ? <CheckCircle2 size={15} /> : syncing ? <LoaderCircle size={15} className="animate-spin" /> : <AlertTriangle size={15} />}
                {user.email}
              </div>
              <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text-muted)' }}>
                最后同步：{formatSyncTime(updatedAt)}
              </div>
            </div>

            <button
              onClick={() => void handlePushNow()}
              disabled={busy || syncing || blocked}
              className="flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold"
              style={{ background: 'var(--primary)', color: 'white', opacity: busy || syncing || blocked ? 0.68 : 1 }}
            >
              {busy || syncing ? <LoaderCircle size={15} className="animate-spin" /> : <RefreshCw size={15} />}
              立即同步
            </button>
            <button
              onClick={() => void handleSignOut()}
              disabled={busy}
              className="flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold"
              style={{ background: 'var(--bg-muted)', color: 'var(--text-sub)', border: '1px solid var(--border)' }}
            >
              <LogOut size={15} />
              退出登录
            </button>
          </div>
        ) : (
          <div className="mt-5 flex flex-col gap-3">
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              autoComplete="email"
              placeholder="邮箱"
              className="rounded-xl px-3 py-2.5 text-sm outline-none"
              style={{ background: 'var(--bg-muted)', border: '1px solid var(--border)', color: 'var(--text)' }}
            />
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              autoComplete="current-password"
              placeholder="密码"
              className="rounded-xl px-3 py-2.5 text-sm outline-none"
              style={{ background: 'var(--bg-muted)', border: '1px solid var(--border)', color: 'var(--text)' }}
            />
            <button
              onClick={() => void runAuth('sign-in')}
              disabled={busy || !online || !email.trim() || !password}
              className="flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold"
              style={{
                background: online && email.trim() && password ? 'var(--text)' : 'var(--border)',
                color: online && email.trim() && password ? 'white' : 'var(--text-muted)',
              }}
            >
              {busy ? <LoaderCircle size={15} className="animate-spin" /> : <LogIn size={15} />}
              {online ? '登录并同步' : '离线时不能登录'}
            </button>
            <button
              onClick={() => void runAuth('sign-up')}
              disabled={busy || !online || !email.trim() || !password}
              className="rounded-xl px-4 py-2.5 text-sm font-semibold"
              style={{ background: 'var(--bg-muted)', color: 'var(--text-sub)', border: '1px solid var(--border)' }}
            >
              创建账号
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
