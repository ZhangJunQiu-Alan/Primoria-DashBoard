import { describe, expect, it } from 'vitest'
import {
  INITIAL_AGGREGATES,
  commitSession,
  deriveCurrentSegmentIndex,
  deriveProgressInSegment,
  getThisWeekTotalSec,
  getTodaySessionCount,
  getTodayTotalSec,
  type FocusSession,
} from './pomodoroJourneyAggregates'
import {
  JOURNEY_GOAL_MIN,
  TOTAL_SEGMENTS,
  VIEWPORT_MIN,
  type PendingSession,
} from './pomodoroJourneyReducer'

const T0 = new Date('2026-05-06T10:00:00').getTime()

function pendingOf(actualSec: number, startedAt = T0): PendingSession {
  return {
    topic: '画画',
    plannedSec: 1500,
    actualSec,
    startedAt,
    endedAt: startedAt + actualSec * 1000,
    restCount: 0,
    totalRestSec: 0,
  }
}

describe('aggregates · commitSession', () => {
  it('B1: appends session and accumulates currentJourneyMin', () => {
    const r1 = commitSession(INITIAL_AGGREGATES, pendingOf(600), 'id1') // 10min
    expect(r1.summited).toBe(false)
    expect(r1.next.sessions).toHaveLength(1)
    expect(r1.next.sessions[0].id).toBe('id1')
    expect(r1.next.currentJourneyMin).toBe(10)

    const r2 = commitSession(r1.next, pendingOf(900), 'id2') // 15min
    expect(r2.next.currentJourneyMin).toBe(25)
    expect(r2.next.sessions).toHaveLength(2)
  })

  it('B9: hitting JOURNEY_GOAL_MIN archives a journey and resets currentJourneyMin', () => {
    let agg = INITIAL_AGGREGATES
    // 19h (1140min) accumulated via one big session
    agg = commitSession(agg, pendingOf(1140 * 60), 'a').next
    expect(agg.currentJourneyMin).toBe(1140)
    expect(agg.journeys).toHaveLength(0)

    // Add 90min more → crosses 1200 → summit
    const r = commitSession(agg, pendingOf(90 * 60), 'b')
    expect(r.summited).toBe(true)
    expect(r.next.currentJourneyMin).toBe(0)
    expect(r.next.journeys).toHaveLength(1)
    expect(r.next.journeys[0].sessionIds).toEqual(['a', 'b'])
    expect(r.next.journeys[0].totalFocusSec).toBe(1140 * 60 + 90 * 60)
  })

  it('B9b: a second journey only includes sessions after the previous summit', () => {
    let agg = INITIAL_AGGREGATES
    // first journey (single session over goal)
    agg = commitSession(
      agg,
      { ...pendingOf(JOURNEY_GOAL_MIN * 60, T0), endedAt: T0 + 1 },
      'first'
    ).next
    expect(agg.journeys).toHaveLength(1)
    expect(agg.currentJourneyMin).toBe(0)

    // second journey starts; session is after first summit
    const T1 = T0 + 1000 // strictly after first summit's reachedSummitAt
    agg = commitSession(agg, pendingOf(60 * 60, T1), 's2-a').next // 60min
    const r = commitSession(
      agg,
      pendingOf((JOURNEY_GOAL_MIN - 60) * 60, T1 + 100),
      's2-b'
    )
    expect(r.summited).toBe(true)
    expect(r.next.journeys).toHaveLength(2)
    expect(r.next.journeys[1].sessionIds).toEqual(['s2-a', 's2-b'])
    // first journey's session 'first' must NOT appear in second archive
    expect(r.next.journeys[1].sessionIds).not.toContain('first')
  })
})

describe('aggregates · derivations', () => {
  // B3
  it('deriveCurrentSegmentIndex returns 0 for fresh journey', () => {
    expect(deriveCurrentSegmentIndex(0)).toBe(0)
  })

  it('deriveCurrentSegmentIndex returns 0 just before first viewport boundary', () => {
    expect(deriveCurrentSegmentIndex(VIEWPORT_MIN - 0.1)).toBe(0)
  })

  it('deriveCurrentSegmentIndex returns 1 at first viewport boundary', () => {
    expect(deriveCurrentSegmentIndex(VIEWPORT_MIN)).toBe(1)
  })

  it('deriveCurrentSegmentIndex caps at TOTAL_SEGMENTS - 1 even if overshooting', () => {
    expect(deriveCurrentSegmentIndex(JOURNEY_GOAL_MIN + 999)).toBe(
      TOTAL_SEGMENTS - 1
    )
  })

  it('deriveProgressInSegment returns mod/VIEWPORT_MIN', () => {
    expect(deriveProgressInSegment(0)).toBe(0)
    expect(deriveProgressInSegment(VIEWPORT_MIN / 2)).toBeCloseTo(0.5)
    expect(deriveProgressInSegment(VIEWPORT_MIN)).toBe(0) // boundary → next segment progress = 0
    expect(deriveProgressInSegment(VIEWPORT_MIN * 2 + 60)).toBeCloseTo(60 / VIEWPORT_MIN)
  })

  // B10
  it('B10: cross-segment boundary 239→241 increments segmentIndex', () => {
    expect(deriveCurrentSegmentIndex(239)).toBe(0)
    expect(deriveCurrentSegmentIndex(241)).toBe(1)
    expect(deriveProgressInSegment(241)).toBeCloseTo(1 / VIEWPORT_MIN)
  })
})

describe('aggregates · today helpers', () => {
  function dayMs(date: string, hour = 10) {
    return new Date(`${date}T${String(hour).padStart(2, '0')}:00:00`).getTime()
  }

  it('B1: getTodayTotalSec sums actualSec for today', () => {
    const sessions: FocusSession[] = [
      {
        id: 's1',
        topic: 'a',
        plannedSec: 1500,
        actualSec: 1200,
        startedAt: dayMs('2026-05-06', 9),
        endedAt: dayMs('2026-05-06', 9) + 1200_000,
        restCount: 0,
        totalRestSec: 0,
      },
      {
        id: 's2',
        topic: 'b',
        plannedSec: 1500,
        actualSec: 800,
        startedAt: dayMs('2026-05-06', 14),
        endedAt: dayMs('2026-05-06', 14) + 800_000,
        restCount: 0,
        totalRestSec: 0,
      },
    ]
    expect(getTodayTotalSec(sessions, dayMs('2026-05-06', 18))).toBe(2000)
    expect(getTodaySessionCount(sessions, dayMs('2026-05-06', 18))).toBe(2)
  })

  it('B2: yesterday session is excluded from today totals', () => {
    const sessions: FocusSession[] = [
      {
        id: 'y',
        topic: 'yesterday',
        plannedSec: 1500,
        actualSec: 1500,
        startedAt: dayMs('2026-05-05', 22),
        endedAt: dayMs('2026-05-05', 22) + 1500_000,
        restCount: 0,
        totalRestSec: 0,
      },
      {
        id: 't',
        topic: 'today',
        plannedSec: 1500,
        actualSec: 600,
        startedAt: dayMs('2026-05-06', 8),
        endedAt: dayMs('2026-05-06', 8) + 600_000,
        restCount: 0,
        totalRestSec: 0,
      },
    ]
    expect(getTodayTotalSec(sessions, dayMs('2026-05-06', 12))).toBe(600)
    expect(getTodaySessionCount(sessions, dayMs('2026-05-06', 12))).toBe(1)
  })

  it('returns 0 when no sessions today', () => {
    expect(getTodayTotalSec([], dayMs('2026-05-06'))).toBe(0)
    expect(getTodaySessionCount([], dayMs('2026-05-06'))).toBe(0)
  })

  // 2026-05-06 is a Wednesday → week = Mon 2026-05-04 .. Mon 2026-05-11
  it('getThisWeekTotalSec sums Mon..Sun within current ISO week', () => {
    const sessions: FocusSession[] = [
      // Sunday before this week (excluded)
      session('s-prev-sun', dayMs('2026-05-03', 12), 1500),
      // Monday this week (included)
      session('s-mon', dayMs('2026-05-04', 9), 1200),
      // Wednesday this week (included)
      session('s-wed', dayMs('2026-05-06', 14), 800),
      // Sunday this week (included)
      session('s-sun', dayMs('2026-05-10', 20), 600),
      // Next Monday (excluded)
      session('s-next-mon', dayMs('2026-05-11', 8), 999),
    ]
    expect(getThisWeekTotalSec(sessions, dayMs('2026-05-06', 18))).toBe(
      1200 + 800 + 600
    )
  })

  it('getThisWeekTotalSec returns 0 when no sessions this week', () => {
    expect(getThisWeekTotalSec([], dayMs('2026-05-06'))).toBe(0)
  })
})

function session(
  id: string,
  startedAt: number,
  actualSec: number
): FocusSession {
  return {
    id,
    topic: 't',
    plannedSec: 1500,
    actualSec,
    startedAt,
    endedAt: startedAt + actualSec * 1000,
    restCount: 0,
    totalRestSec: 0,
  }
}
