// SETUP state — path map (2/3) and a compact stats panel (1/3).

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowLeft, ChevronDown, Clock } from 'lucide-react'
import {
  FOCUS_DURATIONS,
  JOURNEY_GOAL_MIN,
  type FocusDuration,
} from '@/store/pomodoroJourneyReducer'
import { formatHHMMSS } from './format'

interface Props {
  segmentIndex: number
  progressInSegment: number   // 0..1
  todayTotalSec: number
  todaySessionCount: number
  weekTotalSec: number
  weekSessionCount: number
  journeyMin: number
  defaultDuration: FocusDuration
  defaultTopic: string
  onCancel: () => void
  onStart: (topic: string, duration: FocusDuration) => void
  onChangeDuration: (d: FocusDuration) => void
}

const DURATION_LABEL: Record<FocusDuration, string> = {
  1500: '25 分钟',
  2700: '45 分钟',
  3600: '60 分钟',
}

const TOTAL_SEGMENTS = 5

// Path-bg image dimensions (601×1300) and an SVG path tracing the brown
// dashed trail in image-space (origin top-left, bottom-up climb).
// Adjust by tweaking these control points if the trace drifts from the artwork.
const IMG_W = 601
const IMG_H = 1300
const PATH_D = [
  'M 315 1290',
  'Q 290 1240 275 1180',
  'Q 255 1115 265 1050',
  'Q 285 985 315 925',
  'Q 335 865 305 815',
  'Q 270 760 265 695',
  'Q 280 630 315 575',
  'Q 335 520 305 470',
  'Q 270 420 270 360',
  'Q 290 310 305 250',
  'Q 308 180 305 100',
].join(' ')

export function SetupScreen({
  segmentIndex,
  progressInSegment,
  todayTotalSec,
  todaySessionCount,
  weekTotalSec,
  weekSessionCount,
  journeyMin,
  defaultDuration,
  defaultTopic,
  onCancel,
  onStart,
  onChangeDuration,
}: Props) {
  const [topic, setTopic] = useState(defaultTopic)
  const [pickerOpen, setPickerOpen] = useState(false)
  const trimmed = topic.trim()
  const canStart = trimmed.length > 0
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true })
  }, [])

  const totalProgress =
    (segmentIndex + progressInSegment) / TOTAL_SEGMENTS
  const journeyPct = Math.min(100, Math.round((journeyMin / JOURNEY_GOAL_MIN) * 100))

  return (
    <div className="absolute inset-0 flex flex-col">
      <PathArea totalProgress={totalProgress} onCancel={onCancel} />

      {/* Lower: setup panel — 1/3 */}
      <div
        className="relative flex flex-col items-center"
        style={{
          flex: '1 1 33.333%',
          minHeight: 0,
          background: 'var(--fj-bg)',
          padding: 'clamp(8px, 2.5cqw, 14px) clamp(10px, 3cqw, 16px) clamp(8px, 2.5cqw, 12px)',
          gap: 'clamp(6px, 1.6cqw, 10px)',
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={topic}
          maxLength={30}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canStart) onStart(trimmed, defaultDuration)
          }}
          placeholder="想专注什么呢？"
          className="bg-transparent outline-none w-full"
          style={{
            color: 'var(--fj-text)',
            fontFamily: "'Cormorant Garamond', serif",
            fontSize: 'clamp(13px, 4cqw, 19px)',
            fontWeight: 500,
            textAlign: 'center',
            letterSpacing: '0.04em',
            borderBottom: '1px solid rgba(168, 200, 230, 0.3)',
            padding: 'clamp(2px, 0.6cqw, 5px) 0',
            flexShrink: 0,
          }}
        />

        <div
          className="flex items-center justify-center w-full"
          style={{ gap: 'clamp(8px, 3cqw, 22px)', flex: 1, minHeight: 0 }}
        >
          <Stat
            label="今日"
            value={formatHHMMSS(todayTotalSec)}
            sub={`${todaySessionCount} 次`}
          />

          <button
            type="button"
            disabled={!canStart}
            onClick={() => canStart && onStart(trimmed, defaultDuration)}
            className="fj-pulse-btn"
            style={{
              width: 'clamp(58px, 22cqw, 92px)',
              aspectRatio: '1',
              fontSize: 'clamp(11px, 3.4cqw, 16px)',
              flexShrink: 0,
            }}
          >
            开始专注
          </button>

          <Stat
            label="本周"
            value={formatHHMMSS(weekTotalSec)}
            sub={`${weekSessionCount} 次`}
          />
        </div>

        <div
          className="w-full flex items-center"
          style={{
            gap: 'clamp(6px, 2cqw, 12px)',
            flexShrink: 0,
          }}
        >
          <DurationPill
            value={defaultDuration}
            open={pickerOpen}
            onToggle={() => setPickerOpen((v) => !v)}
            onPick={(d) => {
              onChangeDuration(d)
              setPickerOpen(false)
            }}
          />
          <JourneyBar pct={journeyPct} />
        </div>
      </div>
    </div>
  )
}

function PathArea({
  totalProgress,
  onCancel,
}: {
  totalProgress: number
  onCancel: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const pathRef = useRef<SVGPathElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [pathLen, setPathLen] = useState(0)
  const [charPos, setCharPos] = useState({ x: IMG_W / 2, y: IMG_H })

  // Measure container so we can translate the world by exact pixels.
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => {
      setSize({ w: el.clientWidth, h: el.clientHeight })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const p = pathRef.current
    if (!p) return
    if (pathLen === 0) setPathLen(p.getTotalLength())
    const len = pathLen || p.getTotalLength()
    const pt = p.getPointAtLength(len * totalProgress)
    setCharPos({ x: pt.x, y: pt.y })
  }, [totalProgress, pathLen])

  const worldH = size.w > 0 ? (size.w * IMG_H) / IMG_W : 0
  const offsetY = size.h > 0 ? (size.h - worldH) * (1 - totalProgress) : 0

  return (
    <div
      ref={containerRef}
      className="relative"
      style={{
        flex: '0 0 66.667%',
        overflow: 'hidden',
        background: '#7DB7B5', // soft teal placeholder while bg loads
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: '100%',
          height: worldH || 'auto',
          transform: `translateY(${offsetY}px)`,
          transition: 'transform 0.6s ease-out',
        }}
      >
        <img
          src="/assets/focus-journey/path-bg.jpg"
          alt=""
          draggable={false}
          style={{ width: '100%', display: 'block' }}
        />

        <svg
          viewBox={`0 0 ${IMG_W} ${IMG_H}`}
          preserveAspectRatio="xMidYMin meet"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            overflow: 'visible',
          }}
        >
          {/* Hidden reference path used for getTotalLength / getPointAtLength */}
          <path ref={pathRef} d={PATH_D} fill="none" stroke="none" />
          {/* Walked-solid overlay covering the dashed brown trail. */}
          <path
            d={PATH_D}
            fill="none"
            stroke="#FFE9B5"
            strokeWidth="20"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={pathLen || 0}
            strokeDashoffset={(pathLen || 0) * (1 - totalProgress)}
            style={{
              transition: 'stroke-dashoffset 0.6s ease-out',
              filter: 'drop-shadow(0 0 4px rgba(255, 222, 140, 0.6))',
            }}
            opacity="0.95"
          />
        </svg>

        <img
          src="/assets/focus-journey/character-idle.png"
          alt=""
          draggable={false}
          style={{
            position: 'absolute',
            left: `${(charPos.x / IMG_W) * 100}%`,
            top: `${(charPos.y / IMG_H) * 100}%`,
            transform: 'translate(-50%, -55%)',
            width: '13%',
            height: 'auto',
            pointerEvents: 'none',
            filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.25))',
            transition: 'left 0.6s ease-out, top 0.6s ease-out',
          }}
        />
      </div>

      <button
        type="button"
        onClick={onCancel}
        className="absolute"
        style={{
          top: 'clamp(6px, 2cqw, 12px)',
          left: 'clamp(6px, 2cqw, 12px)',
          width: 'clamp(28px, 8cqw, 40px)',
          aspectRatio: '1',
          background: 'rgba(60, 50, 40, 0.85)',
          color: '#fff',
          border: 'none',
          borderRadius: '9999px',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          zIndex: 1,
        }}
        aria-label="返回"
      >
        <ArrowLeft size={14} />
      </button>
    </div>
  )
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string
  value: string
  sub: string
}) {
  return (
    <div
      className="flex flex-col items-center"
      style={{ gap: 2, minWidth: 0 }}
    >
      <span
        style={{
          fontFamily: "'Cormorant Garamond', serif",
          fontSize: 'clamp(8px, 2.4cqw, 11px)',
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'rgba(168, 200, 230, 0.55)',
        }}
      >
        {label}
      </span>
      <span
        className="tabular-nums"
        style={{
          fontFamily: "'Cormorant Garamond', serif",
          fontSize: 'clamp(11px, 3.4cqw, 16px)',
          fontWeight: 500,
          color: 'var(--fj-text)',
          letterSpacing: '0.04em',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </span>
      <span
        style={{
          fontSize: 'clamp(8px, 2.4cqw, 11px)',
          color: 'rgba(168, 200, 230, 0.5)',
          fontFamily: "'DM Sans', sans-serif",
        }}
      >
        {sub}
      </span>
    </div>
  )
}

function DurationPill({
  value,
  open,
  onToggle,
  onPick,
}: {
  value: FocusDuration
  open: boolean
  onToggle: () => void
  onPick: (d: FocusDuration) => void
}) {
  return (
    <div className="relative" style={{ flexShrink: 0 }}>
      <button
        type="button"
        onClick={onToggle}
        className="fj-pill"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 'clamp(3px, 1cqw, 6px)',
          padding: 'clamp(3px, 1cqw, 6px) clamp(8px, 2.4cqw, 14px)',
          borderRadius: '9999px',
          background: 'rgba(168, 200, 230, 0.1)',
          border: '1px solid rgba(168, 200, 230, 0.25)',
          color: '#D6E2EF',
          fontSize: 'clamp(9px, 2.6cqw, 12px)',
          fontFamily: "'DM Sans', sans-serif",
          cursor: 'pointer',
          transition: 'background 0.15s ease, border-color 0.15s ease',
          whiteSpace: 'nowrap',
        }}
      >
        <Clock size={11} />
        <span>{DURATION_LABEL[value]}</span>
        <ChevronDown
          size={11}
          style={{
            transition: 'transform 0.2s ease',
            transform: open ? 'rotate(180deg)' : 'rotate(0)',
          }}
        />
      </button>

      {open && (
        <div
          className="absolute"
          style={{
            bottom: 'calc(100% + 6px)',
            left: 0,
            background: '#1A3A5C',
            borderRadius: 12,
            padding: 4,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
            border: '1px solid rgba(168, 200, 230, 0.15)',
            zIndex: 10,
            minWidth: 100,
          }}
        >
          {FOCUS_DURATIONS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => onPick(d)}
              style={{
                background: d === value ? 'var(--fj-accent)' : 'transparent',
                color: '#fff',
                border: 'none',
                padding: '5px 10px',
                borderRadius: 8,
                fontSize: 12,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                textAlign: 'left',
              }}
            >
              {DURATION_LABEL[d]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function JourneyBar({ pct }: { pct: number }) {
  return (
    <div
      className="flex flex-col"
      style={{ flex: 1, minWidth: 0, gap: 3 }}
      title={`已登顶 ${pct}%`}
    >
      <div
        className="flex items-baseline justify-between"
        style={{ gap: 6 }}
      >
        <span
          style={{
            fontFamily: "'Cormorant Garamond', serif",
            fontSize: 'clamp(8px, 2.4cqw, 11px)',
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: 'rgba(168, 200, 230, 0.55)',
          }}
        >
          登顶
        </span>
        <span
          className="tabular-nums"
          style={{
            fontFamily: "'Cormorant Garamond', serif",
            fontSize: 'clamp(9px, 2.6cqw, 12px)',
            color: 'rgba(168, 200, 230, 0.85)',
          }}
        >
          {pct}%
        </span>
      </div>
      <div
        style={{
          width: '100%',
          height: 4,
          background: 'rgba(168, 200, 230, 0.15)',
          borderRadius: 9999,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: 'linear-gradient(to right, #5BA3D9, #A8E2F4)',
            borderRadius: 9999,
            transition: 'width 0.4s ease-out',
          }}
        />
      </div>
    </div>
  )
}
