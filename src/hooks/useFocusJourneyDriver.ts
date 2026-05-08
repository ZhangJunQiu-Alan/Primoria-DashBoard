import { useEffect, useMemo, useRef } from 'react'
import { toast } from 'sonner'
import {
  REST_DURATION_SEC,
  getActiveFocusEndAt,
} from '@/store/pomodoroJourneyReducer'
import { usePomodoroJourneyStore } from '@/store/pomodoroJourneyStore'
import { playFocusEndSound } from '@/lib/focusJourneySound'
import { formatMinutesShort } from '@/components/widgets/focus-journey/format'

const TICK_INTERVAL_MS = 1000
const DEADLINE_WAKE_MARGIN_MS = 50

export function useFocusJourneyDriver() {
  const activity = usePomodoroJourneyStore((s) => s.activity)
  const notificationPermission = usePomodoroJourneyStore(
    (s) => s.notificationPermission
  )
  const dispatch = usePomodoroJourneyStore((s) => s.dispatch)
  const reconcile = usePomodoroJourneyStore((s) => s.reconcile)
  const setNotificationPermission = usePomodoroJourneyStore(
    (s) => s.setNotificationPermission
  )

  useEffect(() => {
    reconcile()
    if (typeof document === 'undefined') return

    const onVisible = () => {
      if (document.visibilityState === 'visible') reconcile()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [reconcile])

  useEffect(() => {
    if (activity.phase !== 'FOCUSING' && activity.phase !== 'RESTING') return
    if (typeof window === 'undefined') return

    const id = window.setInterval(() => {
      dispatch({ type: 'TICK', now: Date.now() })
    }, TICK_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [activity.phase, dispatch])

  const nextDeadlineAt = useMemo(() => {
    if (activity.phase === 'FOCUSING') {
      return getActiveFocusEndAt(activity.session)
    }
    if (activity.phase === 'RESTING' && activity.session.restStartedAt !== null) {
      return activity.session.restStartedAt + REST_DURATION_SEC * 1000
    }
    return null
  }, [activity])

  useEffect(() => {
    if (nextDeadlineAt === null) return
    if (typeof window === 'undefined') return

    const delay = Math.max(0, nextDeadlineAt - Date.now()) + DEADLINE_WAKE_MARGIN_MS
    const id = window.setTimeout(() => {
      dispatch({ type: 'TICK', now: Date.now() })
    }, delay)
    return () => window.clearTimeout(id)
  }, [dispatch, nextDeadlineAt])

  useEffect(() => {
    if (activity.phase !== 'FOCUSING') return
    if (notificationPermission !== 'default') return
    if (typeof Notification === 'undefined') return

    let cancelled = false
    Notification.requestPermission().then((perm) => {
      if (!cancelled) setNotificationPermission(perm)
    })
    return () => {
      cancelled = true
    }
  }, [activity.phase, notificationPermission, setNotificationPermission])

  const handledCompletionId = useRef<string | null>(null)
  useEffect(() => {
    if (activity.phase !== 'COMPLETED') {
      handledCompletionId.current = null
      return
    }

    const fingerprint = `${activity.pending.startedAt}-${activity.pending.endedAt}`
    if (handledCompletionId.current === fingerprint) return
    handledCompletionId.current = fingerprint

    const minutes = formatMinutesShort(activity.pending.actualSec)
    toast.success(`已完成 ${minutes} 专注 · ${activity.pending.topic}`)

    if (
      typeof Notification !== 'undefined' &&
      Notification.permission === 'granted'
    ) {
      try {
        new Notification('Primoria · 专注完成', {
          body: `${activity.pending.topic} · ${minutes}`,
          tag: 'primoria-focus-journey',
        })
      } catch {
        // Notification is best-effort.
      }
    }

    playFocusEndSound()

    const t = window.setTimeout(() => {
      const out = dispatch({ type: 'DISMISS' })
      if (out.summited) {
        toast.success('🎉 旅程完成 · 已登顶 20 小时', { duration: 5000 })
      }
    }, 600)
    return () => window.clearTimeout(t)
  }, [activity, dispatch])
}
