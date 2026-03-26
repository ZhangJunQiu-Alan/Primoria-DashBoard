import { useEffect, useState } from 'react'

export function ClockWidget() {
  const [time, setTime] = useState(new Date())

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const hours = time.getHours().toString().padStart(2, '0')
  const minutes = time.getMinutes().toString().padStart(2, '0')
  const seconds = time.getSeconds().toString().padStart(2, '0')
  const dateStr = time.toLocaleDateString('zh-CN', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  return (
    <div className="flex flex-col items-center justify-center h-full gap-1 select-none">
      <div
        className="tabular-nums"
        style={{
          fontFamily: "'Cormorant Garamond', serif",
          fontSize: '48px',
          fontWeight: 400,
          letterSpacing: '0.05em',
          color: 'var(--text)',
        }}
      >
        {hours}:{minutes}
        <span style={{ fontSize: '30px', color: 'var(--text-muted)' }}>:{seconds}</span>
      </div>
      <div style={{ fontSize: '12px', color: 'var(--text-muted)', letterSpacing: '0.04em' }}>
        {dateStr}
      </div>
    </div>
  )
}
