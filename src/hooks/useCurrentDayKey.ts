import { useEffect, useState } from 'react'
import { formatLocalDateKey, msUntilNextLocalDay } from '@/lib/date'

export function useCurrentDayKey() {
  const [dayKey, setDayKey] = useState(() => formatLocalDateKey())

  useEffect(() => {
    let timerId: number | null = null

    function syncDayKey() {
      const nextDayKey = formatLocalDateKey()
      setDayKey((currentDayKey) => (currentDayKey === nextDayKey ? currentDayKey : nextDayKey))
    }

    function scheduleNextSync() {
      if (timerId !== null) window.clearTimeout(timerId)

      timerId = window.setTimeout(() => {
        syncDayKey()
        scheduleNextSync()
      }, msUntilNextLocalDay())
    }

    function handleVisibilityChange() {
      if (document.visibilityState !== 'visible') return
      syncDayKey()
      scheduleNextSync()
    }

    function handleFocus() {
      syncDayKey()
      scheduleNextSync()
    }

    scheduleNextSync()
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleFocus)

    return () => {
      if (timerId !== null) window.clearTimeout(timerId)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleFocus)
    }
  }, [])

  return dayKey
}
