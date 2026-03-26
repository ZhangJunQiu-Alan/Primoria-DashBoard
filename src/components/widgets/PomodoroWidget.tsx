import { useState, useEffect, useRef } from 'react'
import { Play, Pause, RotateCcw } from 'lucide-react'

const MODES = {
  work: { label: 'Focus', duration: 25 * 60 },
  short: { label: 'Short Break', duration: 5 * 60 },
  long: { label: 'Long Break', duration: 15 * 60 },
} as const

type Mode = keyof typeof MODES

export function PomodoroWidget() {
  const [mode, setMode] = useState<Mode>('work')
  const [timeLeft, setTimeLeft] = useState(MODES.work.duration)
  const [running, setRunning] = useState(false)
  const [sessions, setSessions] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => {
        setTimeLeft((t) => {
          if (t <= 1) {
            setRunning(false)
            if (mode === 'work') setSessions((s) => s + 1)
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

  function switchMode(m: Mode) {
    setMode(m)
    setTimeLeft(MODES[m].duration)
    setRunning(false)
  }

  function reset() {
    setTimeLeft(MODES[mode].duration)
    setRunning(false)
  }

  const total = MODES[mode].duration
  const progress = (total - timeLeft) / total
  const circumference = 2 * Math.PI * 45
  const dashOffset = circumference * (1 - progress)

  const mins = Math.floor(timeLeft / 60).toString().padStart(2, '0')
  const secs = (timeLeft % 60).toString().padStart(2, '0')

  return (
    <div className="flex flex-col items-center justify-between h-full gap-2">
      <div className="flex gap-1 text-xs">
        {(Object.keys(MODES) as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => switchMode(m)}
            className={`px-2 py-1 rounded-lg transition-colors ${
              mode === m ? 'bg-[var(--accent)] text-white' : 'text-white/40 hover:text-white/70'
            }`}
          >
            {MODES[m].label}
          </button>
        ))}
      </div>

      <div className="relative flex items-center justify-center">
        <svg width="110" height="110" className="-rotate-90">
          <circle cx="55" cy="55" r="45" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="4" />
          <circle
            cx="55" cy="55" r="45" fill="none"
            stroke="var(--accent)" strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            className="transition-all duration-1000"
          />
        </svg>
        <span className="absolute text-2xl font-light tabular-nums text-white">{mins}:{secs}</span>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={reset} className="p-2 rounded-full text-white/30 hover:text-white/60 hover:bg-white/5 transition-all">
          <RotateCcw size={14} />
        </button>
        <button
          onClick={() => setRunning((r) => !r)}
          className="p-3 rounded-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] transition-colors"
        >
          {running ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <span className="text-white/30 text-xs w-8 text-center">{sessions}×</span>
      </div>
    </div>
  )
}
