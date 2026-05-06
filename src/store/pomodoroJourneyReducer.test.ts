import { describe, expect, it } from 'vitest'
import {
  INITIAL_STATE,
  REST_DURATION_SEC,
  reducer,
  type ActiveSession,
  type ActivityState,
  type FocusDuration,
} from './pomodoroJourneyReducer'

const T0 = 1_700_000_000_000

function makeSession(overrides: Partial<ActiveSession> = {}): ActiveSession {
  return {
    topic: '画画',
    plannedSec: 1500 as FocusDuration,
    startedAt: T0,
    currentRunStartedAt: T0,
    consumedSecBeforeRun: 0,
    restStartedAt: null,
    restCount: 0,
    totalRestSec: 0,
    ...overrides,
  }
}

function focusing(
  overrides: Partial<{
    session: Partial<ActiveSession>
    focusRemainingSec: number
  }> = {}
): Extract<ActivityState, { phase: 'FOCUSING' }> {
  return {
    phase: 'FOCUSING',
    session: makeSession(overrides.session),
    focusRemainingSec: overrides.focusRemainingSec ?? 1500,
  }
}

function resting(
  overrides: Partial<{
    session: Partial<ActiveSession>
    focusRemainingSec: number
    restRemainingSec: number
  }> = {}
): Extract<ActivityState, { phase: 'RESTING' }> {
  return {
    phase: 'RESTING',
    session: makeSession({ restStartedAt: T0 + 10_000, ...overrides.session }),
    focusRemainingSec: overrides.focusRemainingSec ?? 1500,
    restRemainingSec: overrides.restRemainingSec ?? REST_DURATION_SEC,
  }
}

describe('reducer · phase A — state machine', () => {
  // A1
  it('A1: IDLE + OPEN_SETUP → SETUP', () => {
    expect(reducer({ phase: 'IDLE' }, { type: 'OPEN_SETUP' })).toEqual({
      phase: 'SETUP',
    })
  })

  it('INITIAL_STATE is IDLE', () => {
    expect(INITIAL_STATE).toEqual({ phase: 'IDLE' })
  })

  // A2
  it('A2: SETUP + CANCEL → IDLE', () => {
    expect(reducer({ phase: 'SETUP' }, { type: 'CANCEL' })).toEqual({
      phase: 'IDLE',
    })
  })

  // A3
  it('A3: SETUP + START with non-empty topic → FOCUSING', () => {
    const next = reducer(
      { phase: 'SETUP' },
      { type: 'START', topic: '画画', duration: 1500, now: T0 }
    )
    expect(next.phase).toBe('FOCUSING')
    if (next.phase !== 'FOCUSING') return
    expect(next.focusRemainingSec).toBe(1500)
    expect(next.session).toMatchObject({
      topic: '画画',
      plannedSec: 1500,
      startedAt: T0,
      currentRunStartedAt: T0,
      consumedSecBeforeRun: 0,
      restCount: 0,
      totalRestSec: 0,
      restStartedAt: null,
    })
  })

  // A4
  it('A4: SETUP + START with whitespace topic → stays in SETUP (button should be disabled in UI)', () => {
    const next = reducer(
      { phase: 'SETUP' },
      { type: 'START', topic: '   ', duration: 1500, now: T0 }
    )
    expect(next).toEqual({ phase: 'SETUP' })
  })

  it('A4b: empty string topic also rejected', () => {
    const next = reducer(
      { phase: 'SETUP' },
      { type: 'START', topic: '', duration: 1500, now: T0 }
    )
    expect(next).toEqual({ phase: 'SETUP' })
  })

  it('A4c: topic is trimmed before storing', () => {
    const next = reducer(
      { phase: 'SETUP' },
      { type: 'START', topic: '  学习画画  ', duration: 2700, now: T0 }
    )
    if (next.phase !== 'FOCUSING') throw new Error('expected FOCUSING')
    expect(next.session.topic).toBe('学习画画')
    expect(next.session.plannedSec).toBe(2700)
    expect(next.focusRemainingSec).toBe(2700)
  })

  // A5
  it('A5: FOCUSING + TICK decrements focusRemainingSec', () => {
    const next = reducer(focusing({ focusRemainingSec: 1500 }), {
      type: 'TICK',
      now: T0 + 1000,
    })
    if (next.phase !== 'FOCUSING') throw new Error('expected FOCUSING')
    expect(next.focusRemainingSec).toBe(1499)
  })

  // A6
  it('A6: FOCUSING + TAP_BG → RESTING with frozen focus and accumulated consumedSec', () => {
    const next = reducer(
      focusing({
        session: { currentRunStartedAt: T0, consumedSecBeforeRun: 0 },
        focusRemainingSec: 1500,
      }),
      { type: 'TAP_BG', now: T0 + 10_000 }
    )
    if (next.phase !== 'RESTING') throw new Error('expected RESTING')
    expect(next.focusRemainingSec).toBe(1500) // frozen
    expect(next.restRemainingSec).toBe(REST_DURATION_SEC)
    expect(next.session.consumedSecBeforeRun).toBe(10)
    expect(next.session.restStartedAt).toBe(T0 + 10_000)
  })

  it('A6b: TAP_BG accumulates onto existing consumedSecBeforeRun (after prior rest)', () => {
    const next = reducer(
      focusing({
        session: { currentRunStartedAt: T0, consumedSecBeforeRun: 30 },
        focusRemainingSec: 1470,
      }),
      { type: 'TAP_BG', now: T0 + 5_000 }
    )
    if (next.phase !== 'RESTING') throw new Error('expected RESTING')
    expect(next.session.consumedSecBeforeRun).toBe(35)
  })

  // A7
  it('A7: RESTING + TICK only decrements restRemaining (focus frozen)', () => {
    const next = reducer(
      resting({ focusRemainingSec: 1500, restRemainingSec: 300 }),
      { type: 'TICK', now: T0 + 11_000 }
    )
    if (next.phase !== 'RESTING') throw new Error('expected RESTING')
    expect(next.focusRemainingSec).toBe(1500)
    expect(next.restRemainingSec).toBe(299)
  })

  // A8
  it('A8: RESTING + TAP_BG → FOCUSING; restCount +1, totalRestSec += elapsed', () => {
    const T1 = T0 + 10_000
    const next = reducer(
      resting({
        session: { restStartedAt: T1 },
        focusRemainingSec: 1500,
        restRemainingSec: 299,
      }),
      { type: 'TAP_BG', now: T1 + 1_000 }
    )
    if (next.phase !== 'FOCUSING') throw new Error('expected FOCUSING')
    expect(next.session.restCount).toBe(1)
    expect(next.session.totalRestSec).toBe(1)
    expect(next.session.currentRunStartedAt).toBe(T1 + 1_000)
    expect(next.session.restStartedAt).toBeNull()
    expect(next.focusRemainingSec).toBe(1500) // unchanged
  })

  // A9
  it('A9: RESTING + TICK with restRemainingSec=1 → FOCUSING; restCount +1, totalRestSec += full cycle', () => {
    const next = reducer(
      resting({
        focusRemainingSec: 800,
        restRemainingSec: 1,
      }),
      { type: 'TICK', now: T0 + 100_000 }
    )
    if (next.phase !== 'FOCUSING') throw new Error('expected FOCUSING')
    expect(next.session.restCount).toBe(1)
    expect(next.session.totalRestSec).toBe(REST_DURATION_SEC)
    expect(next.session.currentRunStartedAt).toBe(T0 + 100_000)
    expect(next.session.restStartedAt).toBeNull()
    expect(next.focusRemainingSec).toBe(800)
  })

  // A10
  it('A10: FOCUSING + LONGPRESS_DONE → COMPLETED with actualSec = planned - remaining', () => {
    const next = reducer(focusing({ focusRemainingSec: 600 }), {
      type: 'LONGPRESS_DONE',
      now: T0 + 900_000,
    })
    if (next.phase !== 'COMPLETED') throw new Error('expected COMPLETED')
    expect(next.pending.actualSec).toBe(900) // 1500 - 600
    expect(next.pending.plannedSec).toBe(1500)
    expect(next.pending.endedAt).toBe(T0 + 900_000)
    expect(next.pending.topic).toBe('画画')
  })

  // A11
  it('A11: RESTING + LONGPRESS_DONE → COMPLETED; actualSec = planned - frozen focus remaining', () => {
    const next = reducer(
      resting({
        focusRemainingSec: 600,
        restRemainingSec: 200,
      }),
      { type: 'LONGPRESS_DONE', now: T0 + 1_000_000 }
    )
    if (next.phase !== 'COMPLETED') throw new Error('expected COMPLETED')
    expect(next.pending.actualSec).toBe(900)
    expect(next.pending.endedAt).toBe(T0 + 1_000_000)
  })

  // A12
  it('A12: FOCUSING + TICK with focusRemainingSec=1 → COMPLETED; actualSec=planned (natural completion)', () => {
    const next = reducer(focusing({ focusRemainingSec: 1 }), {
      type: 'TICK',
      now: T0 + 1500_000,
    })
    if (next.phase !== 'COMPLETED') throw new Error('expected COMPLETED')
    expect(next.pending.actualSec).toBe(1500)
    expect(next.pending.plannedSec).toBe(1500)
    expect(next.pending.endedAt).toBe(T0 + 1500_000)
  })

  // A13
  it('A13: RESTING + TICK does NOT push to COMPLETED even if focusRemainingSec=1 (focus frozen)', () => {
    const next = reducer(
      resting({
        focusRemainingSec: 1,
        restRemainingSec: 100,
      }),
      { type: 'TICK', now: T0 + 1000 }
    )
    if (next.phase !== 'RESTING') throw new Error('expected RESTING')
    expect(next.focusRemainingSec).toBe(1) // still frozen
    expect(next.restRemainingSec).toBe(99)
  })

  // A14
  it('A14: COMPLETED + DISMISS → IDLE', () => {
    const next = reducer(
      {
        phase: 'COMPLETED',
        pending: {
          topic: '画画',
          plannedSec: 1500,
          actualSec: 1500,
          startedAt: T0,
          endedAt: T0 + 1500_000,
          restCount: 0,
          totalRestSec: 0,
        },
      },
      { type: 'DISMISS' }
    )
    expect(next).toEqual({ phase: 'IDLE' })
  })

  // Guard: events that don't apply in a phase are no-ops
  it('guard: OPEN_SETUP from FOCUSING is a no-op', () => {
    const f = focusing()
    expect(reducer(f, { type: 'OPEN_SETUP' })).toBe(f)
  })

  it('guard: TICK from IDLE is a no-op', () => {
    const idle: ActivityState = { phase: 'IDLE' }
    expect(reducer(idle, { type: 'TICK', now: T0 })).toBe(idle)
  })

  it('guard: TAP_BG from SETUP is a no-op', () => {
    const setup: ActivityState = { phase: 'SETUP' }
    expect(reducer(setup, { type: 'TAP_BG', now: T0 })).toBe(setup)
  })

  it('guard: LONGPRESS_DONE from IDLE is a no-op', () => {
    const idle: ActivityState = { phase: 'IDLE' }
    expect(reducer(idle, { type: 'LONGPRESS_DONE', now: T0 })).toBe(idle)
  })

  it('guard: DISMISS from FOCUSING is a no-op', () => {
    const f = focusing()
    expect(reducer(f, { type: 'DISMISS' })).toBe(f)
  })

  // Bonus: actualSec is clamped to [0, plannedSec]
  it('actualSec clamps to plannedSec when remaining is somehow negative', () => {
    const next = reducer(focusing({ focusRemainingSec: -5 }), {
      type: 'LONGPRESS_DONE',
      now: T0 + 1_000_000,
    })
    if (next.phase !== 'COMPLETED') throw new Error('expected COMPLETED')
    expect(next.pending.actualSec).toBe(1500)
  })

  // Bonus: full focus → rest → focus → rest → focus chain
  it('multi-rest chain accumulates restCount and totalRestSec', () => {
    let s: ActivityState = focusing({ focusRemainingSec: 1500 })
    s = reducer(s, { type: 'TAP_BG', now: T0 + 60_000 }) // enter rest #1
    expect(s.phase).toBe('RESTING')
    s = reducer(s, { type: 'TAP_BG', now: T0 + 60_000 + 30_000 }) // exit rest #1 after 30s
    if (s.phase !== 'FOCUSING') throw new Error('expected FOCUSING')
    expect(s.session.restCount).toBe(1)
    expect(s.session.totalRestSec).toBe(30)

    s = reducer(s, { type: 'TAP_BG', now: T0 + 200_000 }) // enter rest #2
    expect(s.phase).toBe('RESTING')
    s = reducer(s, { type: 'TAP_BG', now: T0 + 200_000 + 10_000 }) // exit rest #2 after 10s
    if (s.phase !== 'FOCUSING') throw new Error('expected FOCUSING')
    expect(s.session.restCount).toBe(2)
    expect(s.session.totalRestSec).toBe(40)
  })
})
