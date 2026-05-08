import { useEffect, useMemo, useState } from 'react'
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
import { primeFocusEndSound } from '@/lib/focusJourneySound'
import { IdleScreen } from './focus-journey/IdleScreen'
import { SetupScreen } from './focus-journey/SetupScreen'
import { FocusingScreen } from './focus-journey/FocusingScreen'
import { RestingScreen } from './focus-journey/RestingScreen'

const QUOTE = '徒步旅行的乐趣在于旅程，而不是目的地'

export function FocusJourneyWidget() {
  const activity = usePomodoroJourneyStore((s) => s.activity)
  const aggregates = usePomodoroJourneyStore((s) => s.aggregates)
  const defaultDuration = usePomodoroJourneyStore((s) => s.defaultDuration)
  const lastTopic = usePomodoroJourneyStore((s) => s.lastTopic)
  const dispatch = usePomodoroJourneyStore((s) => s.dispatch)
  const setDefaultDuration = usePomodoroJourneyStore(
    (s) => s.setDefaultDuration
  )

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
    primeFocusEndSound()
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
