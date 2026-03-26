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
      <div className="text-5xl font-light tracking-widest text-white tabular-nums">
        {hours}:{minutes}
        <span className="text-3xl text-white/40">:{seconds}</span>
      </div>
      <div className="text-sm text-white/40">{dateStr}</div>
    </div>
  )
}
