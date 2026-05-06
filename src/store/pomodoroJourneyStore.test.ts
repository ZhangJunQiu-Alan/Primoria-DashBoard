import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  REST_DURATION_SEC,
  type ActiveSession,
} from './pomodoroJourneyReducer'
import {
  resetIdGenerator,
  setIdGenerator,
  usePomodoroJourneyStore,
} from './pomodoroJourneyStore'

const T0 = 1_700_000_000_000

function reset() {
  usePomodoroJourneyStore.getState().reset()
  localStorage.clear()
}

function startSession(topic = '画画', now = T0) {
  const { dispatch } = usePomodoroJourneyStore.getState()
  dispatch({ type: 'OPEN_SETUP' })
  dispatch({ type: 'START', topic, duration: 1500, now })
}

function getActivity() {
  return usePomodoroJourneyStore.getState().activity
}

describe('store · dispatch happy path', () => {
  beforeEach(() => {
    reset()
    let counter = 0
    setIdGenerator(() => `test-id-${++counter}`)
  })

  afterEach(() => {
    resetIdGenerator()
  })

  it('IDLE → SETUP → FOCUSING flow updates activity', () => {
    const { dispatch } = usePomodoroJourneyStore.getState()
    expect(getActivity().phase).toBe('IDLE')
    dispatch({ type: 'OPEN_SETUP' })
    expect(getActivity().phase).toBe('SETUP')
    dispatch({ type: 'START', topic: '画画', duration: 1500, now: T0 })
    expect(getActivity().phase).toBe('FOCUSING')
  })

  it('B4: setDefaultDuration updates store state', () => {
    const { setDefaultDuration } = usePomodoroJourneyStore.getState()
    setDefaultDuration(2700)
    expect(usePomodoroJourneyStore.getState().defaultDuration).toBe(2700)
  })

  it('DISMISS commits pending session into aggregates and updates lastTopic', () => {
    const { dispatch } = usePomodoroJourneyStore.getState()
    startSession('画画', T0)
    // jump to LONGPRESS_DONE after 600s of focus (10min)
    // first manually patch focusRemainingSec so we have a deterministic actualSec
    usePomodoroJourneyStore.setState((s) => {
      if (s.activity.phase !== 'FOCUSING') throw new Error('expected FOCUSING')
      return {
        activity: { ...s.activity, focusRemainingSec: 900 }, // consumed 600s
      }
    })
    dispatch({ type: 'LONGPRESS_DONE', now: T0 + 600_000 })
    expect(getActivity().phase).toBe('COMPLETED')

    const result = dispatch({ type: 'DISMISS' })
    expect(result.committed).toBe(true)
    expect(result.summited).toBe(false)
    expect(getActivity().phase).toBe('IDLE')

    const { aggregates, lastTopic } = usePomodoroJourneyStore.getState()
    expect(aggregates.sessions).toHaveLength(1)
    expect(aggregates.sessions[0].actualSec).toBe(600)
    expect(aggregates.sessions[0].topic).toBe('画画')
    expect(aggregates.sessions[0].id).toBe('test-id-1')
    expect(aggregates.currentJourneyMin).toBe(10) // 600s / 60 = 10min
    expect(lastTopic).toBe('画画')
  })

  it('DISMISS that crosses JOURNEY_GOAL_MIN reports summited=true', () => {
    const { dispatch } = usePomodoroJourneyStore.getState()
    // pre-load almost a full journey
    usePomodoroJourneyStore.setState({
      aggregates: {
        sessions: [],
        journeys: [],
        currentJourneyMin: 1190, // 10min away from summit
      },
    })

    startSession('登顶', T0)
    usePomodoroJourneyStore.setState((s) => {
      if (s.activity.phase !== 'FOCUSING') throw new Error('expected FOCUSING')
      return {
        activity: { ...s.activity, focusRemainingSec: 900 }, // 600s consumed = 10min
      }
    })
    dispatch({ type: 'LONGPRESS_DONE', now: T0 + 600_000 })
    const result = dispatch({ type: 'DISMISS' })

    expect(result.summited).toBe(true)
    const { aggregates } = usePomodoroJourneyStore.getState()
    expect(aggregates.currentJourneyMin).toBe(0)
    expect(aggregates.journeys).toHaveLength(1)
  })
})

describe('store · reconcile (refresh / wake recovery)', () => {
  beforeEach(() => {
    reset()
    let counter = 0
    setIdGenerator(() => `recover-${++counter}`)
  })

  afterEach(() => resetIdGenerator())

  function seedFocusing(opts: {
    plannedSec: number
    currentRunStartedAt: number
    consumedSecBeforeRun?: number
    focusRemainingSec: number
  }) {
    const session: ActiveSession = {
      topic: '专注',
      plannedSec: opts.plannedSec as 1500 | 2700 | 3600,
      startedAt: opts.currentRunStartedAt,
      currentRunStartedAt: opts.currentRunStartedAt,
      consumedSecBeforeRun: opts.consumedSecBeforeRun ?? 0,
      restStartedAt: null,
      restCount: 0,
      totalRestSec: 0,
    }
    usePomodoroJourneyStore.setState({
      activity: {
        phase: 'FOCUSING',
        session,
        focusRemainingSec: opts.focusRemainingSec,
      },
    })
  }

  function seedResting(opts: {
    plannedSec: number
    focusRemainingSec: number
    restStartedAt: number
    restRemainingSec: number
    consumedSecBeforeRun?: number
  }) {
    const session: ActiveSession = {
      topic: '专注',
      plannedSec: opts.plannedSec as 1500 | 2700 | 3600,
      startedAt: opts.restStartedAt - 60_000,
      currentRunStartedAt: opts.restStartedAt - 60_000,
      consumedSecBeforeRun: opts.consumedSecBeforeRun ?? 60,
      restStartedAt: opts.restStartedAt,
      restCount: 0,
      totalRestSec: 0,
    }
    usePomodoroJourneyStore.setState({
      activity: {
        phase: 'RESTING',
        session,
        focusRemainingSec: opts.focusRemainingSec,
        restRemainingSec: opts.restRemainingSec,
      },
    })
  }

  // B5
  it('B5: FOCUSING refresh recomputes focusRemainingSec from currentRunStartedAt', () => {
    seedFocusing({
      plannedSec: 1500,
      currentRunStartedAt: T0,
      focusRemainingSec: 1500, // stale snapshot
    })
    const { reconcile } = usePomodoroJourneyStore.getState()
    reconcile(T0 + 30_000) // 30s passed in real time
    const a = getActivity()
    if (a.phase !== 'FOCUSING') throw new Error('expected FOCUSING')
    expect(a.focusRemainingSec).toBe(1470)
  })

  it('B5b: FOCUSING reconcile uses consumedSecBeforeRun when present', () => {
    seedFocusing({
      plannedSec: 1500,
      currentRunStartedAt: T0,
      consumedSecBeforeRun: 100,
      focusRemainingSec: 1400,
    })
    const { reconcile } = usePomodoroJourneyStore.getState()
    reconcile(T0 + 200_000) // 200s in this run, total consumed = 300
    const a = getActivity()
    if (a.phase !== 'FOCUSING') throw new Error('expected FOCUSING')
    expect(a.focusRemainingSec).toBe(1200)
  })

  // B6
  it('B6: FOCUSING reconcile past planned end auto-completes and commits', () => {
    seedFocusing({
      plannedSec: 1500,
      currentRunStartedAt: T0,
      focusRemainingSec: 1500,
    })
    const { reconcile } = usePomodoroJourneyStore.getState()
    const out = reconcile(T0 + 1500_000 + 5_000) // 5s past natural end
    expect(out.committed).toBe(true)
    expect(getActivity().phase).toBe('IDLE')
    const { aggregates } = usePomodoroJourneyStore.getState()
    expect(aggregates.sessions).toHaveLength(1)
    expect(aggregates.sessions[0].actualSec).toBe(1500)
  })

  // B7
  it('B7: RESTING refresh recomputes restRemainingSec; focusRemainingSec stays frozen', () => {
    seedResting({
      plannedSec: 1500,
      focusRemainingSec: 1440,
      restStartedAt: T0,
      restRemainingSec: REST_DURATION_SEC,
    })
    const { reconcile } = usePomodoroJourneyStore.getState()
    reconcile(T0 + 60_000) // 60s into rest
    const a = getActivity()
    if (a.phase !== 'RESTING') throw new Error('expected RESTING')
    expect(a.focusRemainingSec).toBe(1440) // frozen
    expect(a.restRemainingSec).toBe(REST_DURATION_SEC - 60)
  })

  // B8
  it('B8: RESTING reconcile past 5min auto-resumes FOCUSING with restCount + totalRestSec updated', () => {
    seedResting({
      plannedSec: 1500,
      focusRemainingSec: 1440,
      restStartedAt: T0,
      restRemainingSec: REST_DURATION_SEC,
    })
    const { reconcile } = usePomodoroJourneyStore.getState()
    // 5min30s passed → rest done at T0+300_000, then 30s focus consumed → remaining 1440-30=1410
    reconcile(T0 + 330_000)
    const a = getActivity()
    if (a.phase !== 'FOCUSING') throw new Error('expected FOCUSING')
    expect(a.session.restCount).toBe(1)
    expect(a.session.totalRestSec).toBe(REST_DURATION_SEC)
    expect(a.session.restStartedAt).toBeNull()
    expect(a.focusRemainingSec).toBe(1410)
  })

  it('B8b: RESTING reconcile past long sleep that also exceeds remaining focus → commits', () => {
    seedResting({
      plannedSec: 1500,
      focusRemainingSec: 60, // only 1min focus remaining when rest started
      restStartedAt: T0,
      restRemainingSec: REST_DURATION_SEC,
      consumedSecBeforeRun: 1440,
    })
    const { reconcile } = usePomodoroJourneyStore.getState()
    // sleep for 1h: rest auto-ends, then focus auto-completes
    const out = reconcile(T0 + 3_600_000)
    expect(out.committed).toBe(true)
    expect(getActivity().phase).toBe('IDLE')
    const { aggregates } = usePomodoroJourneyStore.getState()
    expect(aggregates.sessions).toHaveLength(1)
    expect(aggregates.sessions[0].restCount).toBe(1)
    expect(aggregates.sessions[0].totalRestSec).toBe(REST_DURATION_SEC)
    expect(aggregates.sessions[0].actualSec).toBe(1500)
  })

  it('reconcile is a no-op in IDLE / SETUP / COMPLETED', () => {
    const { reconcile } = usePomodoroJourneyStore.getState()
    expect(reconcile(T0).changed).toBe(false)

    usePomodoroJourneyStore.setState({ activity: { phase: 'SETUP' } })
    expect(reconcile(T0).changed).toBe(false)

    usePomodoroJourneyStore.setState({
      activity: {
        phase: 'COMPLETED',
        pending: {
          topic: 'x',
          plannedSec: 1500,
          actualSec: 100,
          startedAt: T0,
          endedAt: T0 + 100_000,
          restCount: 0,
          totalRestSec: 0,
        },
      },
    })
    expect(reconcile(T0 + 1_000_000).changed).toBe(false)
  })
})

describe('store · persistence', () => {
  beforeEach(() => {
    reset()
  })

  it('persists activity + aggregates to localStorage', () => {
    const { dispatch, setDefaultDuration } = usePomodoroJourneyStore.getState()
    setDefaultDuration(2700)
    dispatch({ type: 'OPEN_SETUP' })

    const raw = localStorage.getItem('primoria.pomodoroJourney.v1')
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw!)
    expect(parsed.state.defaultDuration).toBe(2700)
    expect(parsed.state.activity.phase).toBe('SETUP')
  })
})
