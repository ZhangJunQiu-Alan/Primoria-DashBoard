import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Quote, RefreshCw } from 'lucide-react'
import { MOTIVATIONAL_MOTTOS, type Motto } from '@/lib/mottos'

const AUTO_ROTATE_MS = 10 * 60 * 1000

function pickRandomIndex(exclude: number) {
  if (MOTIVATIONAL_MOTTOS.length <= 1) return 0

  let next = Math.floor(Math.random() * MOTIVATIONAL_MOTTOS.length)
  while (next === exclude) {
    next = Math.floor(Math.random() * MOTIVATIONAL_MOTTOS.length)
  }
  return next
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

function getQuoteFontSize(motto: Motto, width: number, height: number) {
  const normalizedWidth = Math.max(width || 320, 220)
  const normalizedHeight = Math.max(height || 220, 180)
  const areaBoost = Math.min(1.25, normalizedWidth / 360) + Math.min(0.28, normalizedHeight / 520)
  const baseSize = 22 * areaBoost
  const lengthPenalty = Math.max(0, motto.text.length - 18) * 0.42
  return Math.max(16, Math.min(38, baseSize - lengthPenalty))
}

export function MottoWidget() {
  const { ref, width, height } = useElementSize<HTMLDivElement>()
  const [index, setIndex] = useState(() => Math.floor(Math.random() * MOTIVATIONAL_MOTTOS.length))

  const motto = MOTIVATIONAL_MOTTOS[index]
  const compact = width > 0 && (width < 300 || height < 220)

  const nextRandomMotto = useCallback(() => {
    setIndex((current) => pickRandomIndex(current))
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      nextRandomMotto()
    }, AUTO_ROTATE_MS)

    return () => window.clearTimeout(timer)
  }, [index, nextRandomMotto])

  const quoteFontSize = useMemo(
    () => getQuoteFontSize(motto, width, height),
    [height, motto, width]
  )

  return (
    <div ref={ref} className="h-full overflow-hidden">
      <div className="flex h-full flex-col">
        <div
          className="flex-1 min-h-0 rounded-[24px] px-4 py-4 flex flex-col justify-between"
          style={{
            background: 'transparent',
          }}
        >
          <div className="flex items-center justify-between" style={{ color: 'rgba(122,158,126,0.56)' }}>
            <Quote size={compact ? 18 : 22} />
            <button
              onClick={nextRandomMotto}
              className="flex items-center justify-center rounded-full transition-all"
              style={{
                width: compact ? '32px' : '36px',
                height: compact ? '32px' : '36px',
                color: 'var(--text-sub)',
                background: 'transparent',
                border: 'none',
              }}
              onMouseEnter={(event) => {
                event.currentTarget.style.color = 'var(--primary-dark)'
                event.currentTarget.style.background = 'rgba(122,158,126,0.08)'
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.color = 'var(--text-sub)'
                event.currentTarget.style.background = 'transparent'
              }}
              title="换一句"
            >
              <RefreshCw size={14} />
            </button>
          </div>

          <div className="flex-1 flex items-center py-3">
            <p
              style={{
                margin: 0,
                width: '100%',
                fontFamily: "'Iowan Old Style', 'Palatino Linotype', 'Songti SC', serif",
                fontSize: `${quoteFontSize}px`,
                lineHeight: 1.45,
                letterSpacing: motto.text.length > 28 ? '0.01em' : '0.02em',
                color: 'var(--text)',
                textWrap: 'balance',
              }}
            >
              {motto.text}
            </p>
          </div>

          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <div
                className="truncate"
                style={{
                  fontSize: compact ? '12px' : '13px',
                  fontWeight: 600,
                  color: 'var(--text-sub)',
                }}
              >
                {motto.author}
              </div>
              {motto.source && (
                <div
                  className="truncate"
                  style={{
                    marginTop: '2px',
                    fontSize: '11px',
                    color: 'var(--text-muted)',
                  }}
                >
                  {motto.source}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
