import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  deriveCurrentSegmentIndex,
  deriveProgressInSegment,
  getThisWeekSessionCount,
  getThisWeekTotalSec,
  getTodaySessionCount,
  getTodayTotalSec,
} from '@/store/pomodoroJourneyAggregates'
import {
  type FocusDuration,
} from '@/store/pomodoroJourneyReducer'
import { usePomodoroJourneyStore } from '@/store/pomodoroJourneyStore'
import { IdleScreen } from './focus-journey/IdleScreen'
import { SetupScreen } from './focus-journey/SetupScreen'
import { FocusingScreen } from './focus-journey/FocusingScreen'
import { RestingScreen } from './focus-journey/RestingScreen'
import { formatMinutesShort } from './focus-journey/format'

const QUOTE = '徒步旅行的乐趣在于旅程，而不是目的地'

export function FocusJourneyWidget() {
  const activity = usePomodoroJourneyStore((s) => s.activity)
  const aggregates = usePomodoroJourneyStore((s) => s.aggregates)
  const defaultDuration = usePomodoroJourneyStore((s) => s.defaultDuration)
  const lastTopic = usePomodoroJourneyStore((s) => s.lastTopic)
  const notificationPermission = usePomodoroJourneyStore(
    (s) => s.notificationPermission
  )
  const dispatch = usePomodoroJourneyStore((s) => s.dispatch)
  const reconcile = usePomodoroJourneyStore((s) => s.reconcile)
  const setDefaultDuration = usePomodoroJourneyStore(
    (s) => s.setDefaultDuration
  )
  const setNotificationPermission = usePomodoroJourneyStore(
    (s) => s.setNotificationPermission
  )

  // Reconcile on mount and on tab focus.
  useEffect(() => {
    reconcile()
    const onVisible = () => {
      if (document.visibilityState === 'visible') reconcile()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [reconcile])

  // 1s tick driver while FOCUSING / RESTING.
  useEffect(() => {
    if (activity.phase !== 'FOCUSING' && activity.phase !== 'RESTING') return
    const id = setInterval(() => {
      dispatch({ type: 'TICK', now: Date.now() })
    }, 1000)
    return () => clearInterval(id)
  }, [activity.phase, dispatch])

  // First entry into FOCUSING: request notification permission once.
  useEffect(() => {
    if (activity.phase !== 'FOCUSING') return
    if (notificationPermission !== 'default') return
    if (typeof Notification === 'undefined') return
    Notification.requestPermission().then((perm) => {
      setNotificationPermission(perm)
    })
  }, [activity.phase, notificationPermission, setNotificationPermission])

  // COMPLETED handler: toast + sound + system notification + auto-dismiss.
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

    // System notification (best-effort).
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
        // ignore
      }
    }

    playSound('/assets/focus-journey/focus-end.mp3')

    const t = setTimeout(() => {
      const out = dispatch({ type: 'DISMISS' })
      if (out.summited) {
        toast.success('🎉 旅程完成 · 已登顶 20 小时', { duration: 5000 })
      }
    }, 600)
    return () => clearTimeout(t)
  }, [activity, dispatch])

  // "now" is refreshed once a minute so todayTotalSec re-evaluates across day boundaries.
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  // Derived presentation values.
  const todayTotalSec = useMemo(
    () => getTodayTotalSec(aggregates.sessions, nowMs),
    [aggregates.sessions, nowMs]
  )
  const todaySessionCount = useMemo(
    () => getTodaySessionCount(aggregates.sessions, nowMs),
    [aggregates.sessions, nowMs]
  )
  const weekTotalSec = useMemo(
    () => getThisWeekTotalSec(aggregates.sessions, nowMs),
    [aggregates.sessions, nowMs]
  )
  const weekSessionCount = useMemo(
    () => getThisWeekSessionCount(aggregates.sessions, nowMs),
    [aggregates.sessions, nowMs]
  )
  const segmentIndex = deriveCurrentSegmentIndex(aggregates.currentJourneyMin)
  const progressInSegment = deriveProgressInSegment(
    aggregates.currentJourneyMin
  )

  function start(topic: string, duration: FocusDuration) {
    dispatch({ type: 'START', topic, duration, now: Date.now() })
  }

  function tap() {
    dispatch({
      type: 'TAP_BG',
      now: Date.now(),
    })
  }

  function longPressEnd() {
    dispatch({ type: 'LONGPRESS_DONE', now: Date.now() })
  }

  return (
    <div className="focus-journey">
      {activity.phase === 'IDLE' && (
        <IdleScreen
          quote={QUOTE}
          onOpenSetup={() => dispatch({ type: 'OPEN_SETUP' })}
        />
      )}
      {activity.phase === 'SETUP' && (
        <SetupScreen
          segmentIndex={segmentIndex}
          progressInSegment={progressInSegment}
          todayTotalSec={todayTotalSec}
          todaySessionCount={todaySessionCount}
          weekTotalSec={weekTotalSec}
          weekSessionCount={weekSessionCount}
          journeyMin={aggregates.currentJourneyMin}
          defaultDuration={defaultDuration}
          defaultTopic={lastTopic}
          onCancel={() => dispatch({ type: 'CANCEL' })}
          onStart={start}
          onChangeDuration={setDefaultDuration}
        />
      )}
      {activity.phase === 'FOCUSING' && (
        <FocusingScreen
          focusRemainingSec={activity.focusRemainingSec}
          onTapBackground={tap}
          onLongPressEnd={longPressEnd}
        />
      )}
      {activity.phase === 'RESTING' && (
        <RestingScreen
          focusRemainingSec={activity.focusRemainingSec}
          restRemainingSec={activity.restRemainingSec}
          onTapBackground={tap}
          onLongPressEnd={longPressEnd}
        />
      )}
      {activity.phase === 'COMPLETED' && (
        <CompletedFlash topic={activity.pending.topic} />
      )}
    </div>
  )
}

function CompletedFlash({ topic }: { topic: string }) {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{
        background: 'rgba(14, 42, 74, 0.95)',
        animation: 'fj-blink-anim 0.6s ease-in-out',
      }}
    >
      <p
        style={{
          fontFamily: "'Cormorant Garamond', serif",
          fontSize: 'clamp(14px, 4cqw, 22px)',
          color: '#fff',
        }}
      >
        🎉 {topic}
      </p>
    </div>
  )
}

let cachedAudio: HTMLAudioElement | null = null
function playSound(src: string) {
  try {
    if (!cachedAudio) cachedAudio = new Audio(src)
    cachedAudio.currentTime = 0
    void cachedAudio.play()
  } catch {
    // ignore — sound is best-effort
  }
}
