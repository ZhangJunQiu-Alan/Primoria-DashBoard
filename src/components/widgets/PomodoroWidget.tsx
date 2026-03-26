import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { Play, Pause, RotateCcw } from 'lucide-react'
import { useWidgetDataStore } from '@/store/widgetDataStore'

const MODES = {
  work:  { label: '专注',  duration: 25 * 60 },
  short: { label: '短休息', duration: 5 * 60 },
  long:  { label: '长休息', duration: 15 * 60 },
} as const

type Mode = keyof typeof MODES

const CIRCUMFERENCE = 2 * Math.PI * 45

export function PomodoroWidget() {
  const pomodoro = useWidgetDataStore((s) => s.pomodoro)
  const incrementPomodoro = useWidgetDataStore((s) => s.incrementPomodoro)

  const [mode, setMode] = useState<Mode>('work')
  const [timeLeft, setTimeLeft] = useState(MODES.work.duration)
  const [running, setRunning] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Stable reference so the interval effect doesn't restart on every store update
  const incrementRef = useRef(incrementPomodoro)
  incrementRef.current = incrementPomodoro

  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => {
        setTimeLeft((t) => {
          if (t <= 1) {
            setRunning(false)
            if (mode === 'work') incrementRef.current()
            return 0
          }
          return t - 1
        })
      }, 1000)
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [running, mode])

  const switchMode = useCallback((m: Mode) => {
    setMode(m)
    setTimeLeft(MODES[m].duration)
    setRunning(false)
  }, [])

  const reset = useCallback(() => {
    setTimeLeft(MODES[mode].duration)
    setRunning(false)
  }, [mode])

  const { dashOffset, mins, secs } = useMemo(() => {
    const total = MODES[mode].duration
    return {
      dashOffset: CIRCUMFERENCE * (1 - (total - timeLeft) / total),
      mins: Math.floor(timeLeft / 60).toString().padStart(2, '0'),
      secs: (timeLeft % 60).toString().padStart(2, '0'),
    }
  }, [mode, timeLeft])

  return (
    <div className="flex flex-col items-center justify-between h-full gap-2">
      <div className="flex gap-1" style={{ fontSize: '11px' }}>
        {(Object.keys(MODES) as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => switchMode(m)}
            className="px-2 py-1 rounded-lg transition-colors"
            style={{
              background: mode === m ? 'var(--primary)' : 'transparent',
              color: mode === m ? '#fff' : 'var(--text-muted)',
            }}
          >
            {MODES[m].label}
          </button>
        ))}
      </div>

      <div className="relative flex items-center justify-center">
        <svg width="110" height="110" className="-rotate-90">
          <circle cx="55" cy="55" r="45" fill="none" stroke="var(--bg-muted)" strokeWidth="4" />
          <circle
            cx="55" cy="55" r="45" fill="none"
            stroke="var(--primary)" strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
            className="transition-all duration-1000"
          />
        </svg>
        <span
          className="absolute tabular-nums"
          style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '26px', fontWeight: 400, color: 'var(--text)' }}
        >
          {mins}:{secs}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={reset}
          className="p-2 rounded-full transition-all"
          style={{ color: 'var(--text-muted)' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-muted)')}
          onMouseLeave={e => (e.currentTarget.style.background = '')}
        >
          <RotateCcw size={14} />
        </button>
        <button
          onClick={() => setRunning((r) => !r)}
          className="p-3 rounded-full text-white transition-colors"
          style={{ background: 'var(--primary)' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--primary-dark)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'var(--primary)')}
        >
          {running ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <div className="text-center w-10">
          <p style={{ fontSize: '14px', color: 'var(--text-sub)', fontWeight: 500 }}>
            {pomodoro.todaySessions}
          </p>
          <p style={{ fontSize: '9px', color: 'var(--text-muted)' }}>今日</p>
        </div>
      </div>
    </div>
  )
}
