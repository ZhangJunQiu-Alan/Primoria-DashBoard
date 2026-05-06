// FOCUSING state — dense night forest background, character bobbing in place,
// countdown + long-press ✓.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import { formatMMSS } from './format'

interface Props {
  focusRemainingSec: number
  onTapBackground: () => void
  onLongPressEnd: () => void
}

const LONGPRESS_MS = 3000

export function FocusingScreen({
  focusRemainingSec,
  onTapBackground,
  onLongPressEnd,
}: Props) {
  return (
    <ImmersiveScene
      bgUrl="/assets/focus-journey/trees-overlay.jpg"
      bgKenBurns
      countdown={formatMMSS(focusRemainingSec)}
      blinkCountdown={false}
      secondLine={null}
      onTapBackground={onTapBackground}
      onLongPressEnd={onLongPressEnd}
    />
  )
}

interface SceneProps {
  bgUrl: string
  bgKenBurns?: boolean
  showCharacter?: boolean
  countdown: string
  blinkCountdown: boolean
  secondLine: string | null
  onTapBackground: () => void
  onLongPressEnd: () => void
  extras?: ReactNode
}

export function ImmersiveScene({
  bgUrl,
  bgKenBurns,
  showCharacter = true,
  countdown,
  blinkCountdown,
  secondLine,
  onTapBackground,
  onLongPressEnd,
  extras,
}: SceneProps) {
  const [pressing, setPressing] = useState(false)
  const longTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (longTimer.current) clearTimeout(longTimer.current)
    }
  }, [])

  function startPress() {
    setPressing(true)
    longTimer.current = setTimeout(() => {
      setPressing(false)
      onLongPressEnd()
    }, LONGPRESS_MS)
  }

  function cancelPress() {
    if (longTimer.current) {
      clearTimeout(longTimer.current)
      longTimer.current = null
    }
    setPressing(false)
  }

  return (
    <div
      className="absolute inset-0"
      onClick={onTapBackground}
      style={{ cursor: 'pointer', background: '#0E2A4A' }}
    >
      <div
        aria-hidden
        className={bgKenBurns ? 'fj-ken-burns' : ''}
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `url(${bgUrl})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}
      />

      {showCharacter && (
        <img
          src="/assets/focus-journey/character-idle.png"
          alt=""
          draggable={false}
          className="fj-bob"
          style={{
            position: 'absolute',
            left: '50%',
            bottom: '18%',
            transform: 'translateX(-50%)',
            width: 'clamp(48px, 18cqw, 100px)',
            height: 'auto',
            pointerEvents: 'none',
            filter: 'drop-shadow(0 6px 8px rgba(0,0,0,0.45))',
          }}
        />
      )}

      {extras}

      {/* Countdown — top-left, away from flag and moon */}
      <div
        className="absolute flex flex-col"
        style={{
          top: 'clamp(8px, 3cqw, 16px)',
          left: 'clamp(10px, 3cqw, 16px)',
          gap: 1,
          pointerEvents: 'none',
        }}
      >
        <span
          className={blinkCountdown ? 'fj-blink' : ''}
          style={{
            fontFamily: "'Cormorant Garamond', serif",
            fontSize: 'clamp(15px, 5cqw, 26px)',
            color: '#fff',
            letterSpacing: '0.06em',
            fontVariantNumeric: 'tabular-nums',
            lineHeight: 1,
            textShadow: '0 2px 6px rgba(0, 0, 0, 0.75)',
          }}
        >
          {countdown}
        </span>
        {secondLine && (
          <span
            style={{
              fontFamily: "'Cormorant Garamond', serif",
              fontSize: 'clamp(10px, 3cqw, 14px)',
              color: 'rgba(255, 255, 255, 0.78)',
              letterSpacing: '0.06em',
              fontVariantNumeric: 'tabular-nums',
              lineHeight: 1,
              textShadow: '0 1px 4px rgba(0, 0, 0, 0.6)',
            }}
          >
            {secondLine}
          </span>
        )}
      </div>

      {/* End button — bottom-right, compact, doesn't cover scene focal points */}
      <div
        className="absolute"
        style={{
          bottom: 'clamp(10px, 3cqw, 18px)',
          right: 'clamp(10px, 3cqw, 16px)',
        }}
      >
        <CheckButton
          pressing={pressing}
          onPressStart={startPress}
          onPressEnd={cancelPress}
        />
      </div>
    </div>
  )
}

function CheckButton({
  pressing,
  onPressStart,
  onPressEnd,
}: {
  pressing: boolean
  onPressStart: () => void
  onPressEnd: () => void
}) {
  const r = 20
  const c = 2 * Math.PI * r
  return (
    <button
      type="button"
      onPointerDown={(e) => {
        e.stopPropagation()
        onPressStart()
      }}
      onPointerUp={(e) => {
        e.stopPropagation()
        onPressEnd()
      }}
      onPointerLeave={(e) => {
        e.stopPropagation()
        onPressEnd()
      }}
      onClick={(e) => e.stopPropagation()}
      style={{
        pointerEvents: 'auto',
        position: 'relative',
        width: 'clamp(30px, 9cqw, 44px)',
        aspectRatio: '1',
        borderRadius: '9999px',
        background: 'rgba(255, 255, 255, 0.78)',
        backdropFilter: 'blur(2px)',
        color: '#3B7BB8',
        border: 'none',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        padding: 0,
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
      }}
      aria-label="长按 3 秒结束专注"
      title="长按 3 秒结束专注"
    >
      <Check size={14} />
      <svg
        viewBox="0 0 50 50"
        style={{
          position: 'absolute',
          inset: 0,
          transform: 'rotate(-90deg)',
          pointerEvents: 'none',
        }}
      >
        <circle
          cx="25"
          cy="25"
          r={r}
          fill="none"
          stroke="#3B7BB8"
          strokeWidth="3"
          strokeDasharray={c}
          strokeDashoffset={pressing ? 0 : c}
          className="fj-press-ring"
        />
      </svg>
    </button>
  )
}
