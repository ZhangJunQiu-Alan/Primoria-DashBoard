import { useEffect, useRef } from 'react'
import {
  BEHAVIOR_EVENT_FLUSH_DELAY_MS,
  BEHAVIOR_EVENT_MAX_RETRY_DELAY_MS,
  BEHAVIOR_EVENT_QUEUE_CHANGED,
  getQueuedBehaviorEvents,
} from '@/lib/behaviorEvents'
import { flushBehaviorEventQueue } from '@/lib/behaviorEventSync'

export function useBehaviorEventSync(userId: string | null | undefined) {
  const timerRef = useRef<number | null>(null)
  const retryDelayRef = useRef(BEHAVIOR_EVENT_FLUSH_DELAY_MS)

  useEffect(() => {
    if (!userId) return

    let cancelled = false

    const clearTimer = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }

    const schedule = (delay = BEHAVIOR_EVENT_FLUSH_DELAY_MS) => {
      if (cancelled || getQueuedBehaviorEvents().length === 0) return
      clearTimer()
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        void flushBehaviorEventQueue(userId).then((result) => {
          if (cancelled) return
          if (result.ok) {
            retryDelayRef.current = BEHAVIOR_EVENT_FLUSH_DELAY_MS
            if (result.remaining > 0) schedule(BEHAVIOR_EVENT_FLUSH_DELAY_MS)
            return
          }

          const nextDelay = retryDelayRef.current
          retryDelayRef.current = Math.min(
            BEHAVIOR_EVENT_MAX_RETRY_DELAY_MS,
            retryDelayRef.current * 2
          )
          schedule(nextDelay)
        })
      }, delay)
    }

    const onQueueChanged = () => schedule()
    window.addEventListener(BEHAVIOR_EVENT_QUEUE_CHANGED, onQueueChanged)
    schedule(0)

    return () => {
      cancelled = true
      clearTimer()
      window.removeEventListener(BEHAVIOR_EVENT_QUEUE_CHANGED, onQueueChanged)
    }
  }, [userId])
}
