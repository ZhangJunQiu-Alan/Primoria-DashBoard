import { useEffect, useRef, useState } from 'react'
import { Disc3, ExternalLink, Info, Music2 } from 'lucide-react'

interface MusicPlayerWidgetProps {
  widgetId: string
}

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize({ width, height })
    })

    observer.observe(element)
    const rect = element.getBoundingClientRect()
    setSize({ width: rect.width, height: rect.height })

    return () => observer.disconnect()
  }, [])

  return { ref, ...size }
}

export function MusicPlayerWidget({ widgetId }: MusicPlayerWidgetProps) {
  void widgetId

  const { ref, width, height } = useElementSize<HTMLDivElement>()
  const compact = width > 0 && (width < 290 || height < 205)

  return (
    <div ref={ref} className="h-full overflow-hidden">
      <div className={`flex h-full min-h-0 flex-col ${compact ? 'gap-3' : 'gap-4'}`}>
        <div className={`flex min-h-0 ${compact ? 'items-center gap-3' : 'gap-4'}`}>
          <RecordVisual compact={compact} spinning={false} title="NetEase" subtitle="网页版降级" />

          <div className={`min-w-0 ${compact ? 'flex-1' : 'flex flex-1 flex-col justify-center'}`}>
            <div
              style={{
                fontSize: compact ? '11px' : '12px',
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: 'var(--text-muted)',
              }}
            >
              网易云播放器
            </div>
            <div
              style={{
                marginTop: compact ? '3px' : '8px',
                fontSize: compact ? '15px' : '22px',
                fontWeight: 650,
                color: 'var(--text)',
                lineHeight: 1.24,
              }}
            >
              网页版暂不接入扫码播放
            </div>
            {!compact && (
              <p style={{ marginTop: '8px', fontSize: '12px', color: 'var(--text-sub)', lineHeight: 1.65 }}>
                原桌面版依赖本地 Tauri 后端保存网易云 cookie 并代理播放源。纯网页免费部署后，这部分已安全降级。
              </p>
            )}
          </div>
        </div>

        <div
          className={`rounded-[24px] ${compact ? 'p-3' : 'p-4'} flex flex-col gap-3`}
          style={{
            background: 'linear-gradient(180deg, rgba(248,242,231,0.84), rgba(255,251,244,0.96))',
            border: '1px solid rgba(179, 154, 111, 0.24)',
          }}
        >
          <div className="flex items-start gap-3">
            <div
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl"
              style={{ background: 'rgba(92,125,96,0.12)', color: 'var(--primary-dark)' }}
            >
              <Info size={18} />
            </div>
            <div className="min-w-0">
              <div style={{ fontSize: '13px', fontWeight: 650, color: 'var(--text)' }}>已切换为网页安全模式</div>
              <div style={{ marginTop: '5px', fontSize: '11px', color: 'var(--text-muted)', lineHeight: 1.65 }}>
                不在浏览器里保存第三方音乐 cookie，也不暴露播放代理接口。其他 Dashboard 数据仍可通过 Supabase 同步。
              </div>
            </div>
          </div>

          <a
            href="https://music.163.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold transition-all"
            style={{ background: 'var(--text)', color: 'white' }}
          >
            <Music2 size={15} />
            打开网易云音乐
            <ExternalLink size={13} />
          </a>
        </div>
      </div>
    </div>
  )
}

function RecordVisual({
  compact,
  spinning,
  subtitle,
  title,
}: {
  compact: boolean
  spinning: boolean
  subtitle: string
  title: string
}) {
  const size = compact ? 88 : 184

  return (
    <div
      className="relative flex flex-shrink-0 items-center justify-center"
      style={{
        width: `${size}px`,
        height: `${size + (compact ? 0 : 38)}px`,
        paddingTop: compact ? '0' : '38px',
      }}
    >
      {!compact && (
        <>
          <div
            className="absolute left-1/2 top-0 -translate-x-1/2 rounded-b-full"
            style={{
              width: '19px',
              height: '11px',
              background: 'rgba(255,255,255,0.92)',
              boxShadow: '0 2px 10px rgba(61,52,42,0.12)',
            }}
          />
          <div
            className="absolute left-1/2 -translate-x-1/2"
            style={{
              top: '8px',
              width: '4px',
              height: '31px',
              borderRadius: '999px',
              background: 'linear-gradient(180deg, #ffffff, #d7d3ce)',
              boxShadow: '0 0 0 1px rgba(61,52,42,0.04)',
            }}
          />
        </>
      )}

      <div
        className="relative rounded-full"
        style={{
          width: `${size}px`,
          height: `${size}px`,
          background:
            'radial-gradient(circle at 48% 42%, rgba(70,70,70,0.92), rgba(18,18,18,1) 48%, #070707 77%, #1f1f1f 100%)',
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.05), 0 14px 28px rgba(29,23,18,0.18)',
          animation: spinning ? 'spin 10s linear infinite' : undefined,
        }}
      >
        <div
          className="absolute inset-[11%] rounded-full"
          style={{
            background:
              'repeating-radial-gradient(circle, rgba(255,255,255,0.04) 0 2px, rgba(0,0,0,0) 2px 8px)',
            opacity: 0.72,
          }}
        />

        <div
          className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center overflow-hidden rounded-full"
          style={{
            width: `${Math.round(size * 0.42)}px`,
            height: `${Math.round(size * 0.42)}px`,
            background: 'linear-gradient(180deg, #DCC57A, #A28B4C)',
            boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.2)',
          }}
        >
          <Disc3 size={compact ? 24 : 42} style={{ color: '#17110B' }} />
        </div>

        {!compact && (
          <div
            className="absolute left-1/2 top-[17%] max-w-[46%] -translate-x-1/2 truncate"
            style={{
              fontSize: '8px',
              color: 'rgba(255,255,255,0.58)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            {subtitle}
          </div>
        )}

        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            width: `${Math.max(7, Math.round(size * 0.05))}px`,
            height: `${Math.max(7, Math.round(size * 0.05))}px`,
            background: '#14110D',
            boxShadow: '0 0 0 1px rgba(255,255,255,0.3)',
          }}
        />
      </div>

      {!compact && (
        <div
          className="absolute bottom-0 left-1/2 -translate-x-1/2 truncate text-center"
          style={{ maxWidth: `${size}px`, fontSize: '11px', color: 'var(--text-muted)' }}
        >
          {title}
        </div>
      )}
    </div>
  )
}
