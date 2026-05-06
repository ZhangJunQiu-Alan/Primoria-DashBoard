// Pure aggregation helpers for the Focus Journey.
// Reducer (pomodoroJourneyReducer.ts) handles transient session state.
// Aggregates handle the persisted history: sessions[], journeys[], currentJourneyMin.
//
// All functions here are pure: same input → same output, no IO, no Date.now().

import {
  JOURNEY_GOAL_MIN,
  TOTAL_SEGMENTS,
  VIEWPORT_MIN,
  type PendingSession,
} from './pomodoroJourneyReducer'

export interface FocusSession {
  id: string
  topic: string
  plannedSec: number
  actualSec: number
  startedAt: number
  endedAt: number
  restCount: number
  totalRestSec: number
}

export interface JourneyArchive {
  id: string
  startedAt: number
  reachedSummitAt: number
  totalFocusSec: number
  sessionIds: string[]
}

export interface Aggregates {
  sessions: FocusSession[]
  journeys: JourneyArchive[]
  currentJourneyMin: number
}

export const INITIAL_AGGREGATES: Aggregates = {
  sessions: [],
  journeys: [],
  currentJourneyMin: 0,
}

export interface CommitResult {
  next: Aggregates
  summited: boolean
}

export function commitSession(
  agg: Aggregates,
  pending: PendingSession,
  id: string
): CommitResult {
  const newSession: FocusSession = { id, ...pending }
  const additionalMin = pending.actualSec / 60
  const nextJourneyMin = agg.currentJourneyMin + additionalMin

  if (nextJourneyMin >= JOURNEY_GOAL_MIN) {
    const lastSummitAt =
      agg.journeys[agg.journeys.length - 1]?.reachedSummitAt ?? 0
    const allSessionsIncl = [...agg.sessions, newSession]
    const journeySessions = allSessionsIncl.filter(
      (s) => s.startedAt > lastSummitAt
    )
    const totalFocusSec = journeySessions.reduce(
      (sum, s) => sum + s.actualSec,
      0
    )
    const archive: JourneyArchive = {
      id: `journey-${id}`,
      startedAt:
        journeySessions[0]?.startedAt ?? newSession.startedAt,
      reachedSummitAt: pending.endedAt,
      totalFocusSec,
      sessionIds: journeySessions.map((s) => s.id),
    }
    return {
      next: {
        sessions: allSessionsIncl,
        journeys: [...agg.journeys, archive],
        currentJourneyMin: 0,
      },
      summited: true,
    }
  }

  return {
    next: {
      sessions: [...agg.sessions, newSession],
      journeys: agg.journeys,
      currentJourneyMin: nextJourneyMin,
    },
    summited: false,
  }
}

export function deriveCurrentSegmentIndex(currentJourneyMin: number): number {
  if (currentJourneyMin <= 0) return 0
  return Math.min(
    Math.floor(currentJourneyMin / VIEWPORT_MIN),
    TOTAL_SEGMENTS - 1
  )
}

export function deriveProgressInSegment(currentJourneyMin: number): number {
  if (currentJourneyMin <= 0) return 0
  if (currentJourneyMin >= JOURNEY_GOAL_MIN) return 1
  return (currentJourneyMin % VIEWPORT_MIN) / VIEWPORT_MIN
}

function startOfLocalDayMs(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function getTodayTotalSec(
  sessions: FocusSession[],
  now: number
): number {
  const dayStart = startOfLocalDayMs(now)
  const dayEnd = dayStart + 86_400_000
  return sessions
    .filter((s) => s.startedAt >= dayStart && s.startedAt < dayEnd)
    .reduce((sum, s) => sum + s.actualSec, 0)
}

export function getTodaySessionCount(
  sessions: FocusSession[],
  now: number
): number {
  const dayStart = startOfLocalDayMs(now)
  const dayEnd = dayStart + 86_400_000
  return sessions.filter(
    (s) => s.startedAt >= dayStart && s.startedAt < dayEnd
  ).length
}

// Local week starts on Monday. Returns sum of actualSec for sessions in [Mon 00:00, Mon+7d 00:00).
function startOfLocalWeekMs(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  // getDay(): 0=Sunday, 1=Monday, ..., 6=Saturday → days since Monday
  const daysSinceMonday = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - daysSinceMonday)
  return d.getTime()
}

export function getThisWeekTotalSec(
  sessions: FocusSession[],
  now: number
): number {
  const weekStart = startOfLocalWeekMs(now)
  const weekEnd = weekStart + 7 * 86_400_000
  return sessions
    .filter((s) => s.startedAt >= weekStart && s.startedAt < weekEnd)
    .reduce((sum, s) => sum + s.actualSec, 0)
}

export function getThisWeekSessionCount(
  sessions: FocusSession[],
  now: number
): number {
  const weekStart = startOfLocalWeekMs(now)
  const weekEnd = weekStart + 7 * 86_400_000
  return sessions.filter(
    (s) => s.startedAt >= weekStart && s.startedAt < weekEnd
  ).length
}
