// Pure reducer for the Focus Journey state machine.
// See tomato.md §1.2 for the transition matrix and §4 Phase A for tests.
//
// This file holds NO side effects: no zustand, no timers, no IO.
// The store wrapper (added later) drives TICK from setInterval and
// commits PendingSession into aggregates on DISMISS.

export const FOCUS_DURATIONS = [1500, 2700, 3600] as const
export type FocusDuration = typeof FOCUS_DURATIONS[number]

export const REST_DURATION_SEC = 300
export const JOURNEY_GOAL_MIN = 1200
export const VIEWPORT_MIN = 240
export const TOTAL_SEGMENTS = 5

export interface ActiveSession {
  topic: string
  plannedSec: FocusDuration
  startedAt: number
  currentRunStartedAt: number
  consumedSecBeforeRun: number
  restStartedAt: number | null
  restCount: number
  totalRestSec: number
}

export interface PendingSession {
  topic: string
  plannedSec: number
  actualSec: number
  startedAt: number
  endedAt: number
  restCount: number
  totalRestSec: number
}

export type ActivityState =
  | { phase: 'IDLE' }
  | { phase: 'SETUP' }
  | { phase: 'FOCUSING'; session: ActiveSession; focusRemainingSec: number }
  | {
      phase: 'RESTING'
      session: ActiveSession
      focusRemainingSec: number
      restRemainingSec: number
    }
  | { phase: 'COMPLETED'; pending: PendingSession }

export type Action =
  | { type: 'OPEN_SETUP' }
  | { type: 'CANCEL' }
  | { type: 'START'; topic: string; duration: FocusDuration; now: number }
  | { type: 'TICK'; now: number }
  | { type: 'TAP_BG'; now: number }
  | { type: 'LONGPRESS_DONE'; now: number }
  | { type: 'DISMISS' }

export const INITIAL_STATE: ActivityState = { phase: 'IDLE' }

export function reducer(state: ActivityState, action: Action): ActivityState {
  switch (action.type) {
    case 'OPEN_SETUP':
      return state.phase === 'IDLE' ? { phase: 'SETUP' } : state

    case 'CANCEL':
      return state.phase === 'SETUP' ? { phase: 'IDLE' } : state

    case 'START': {
      if (state.phase !== 'SETUP') return state
      const topic = action.topic.trim()
      if (topic === '') return state
      const session: ActiveSession = {
        topic,
        plannedSec: action.duration,
        startedAt: action.now,
        currentRunStartedAt: action.now,
        consumedSecBeforeRun: 0,
        restStartedAt: null,
        restCount: 0,
        totalRestSec: 0,
      }
      return { phase: 'FOCUSING', session, focusRemainingSec: action.duration }
    }

    case 'TICK': {
      if (state.phase === 'FOCUSING') {
        const next = state.focusRemainingSec - 1
        if (next <= 0) {
          return {
            phase: 'COMPLETED',
            pending: buildPending(state.session, state.session.plannedSec, action.now),
          }
        }
        return { ...state, focusRemainingSec: next }
      }
      if (state.phase === 'RESTING') {
        const next = state.restRemainingSec - 1
        if (next <= 0) {
          const session: ActiveSession = {
            ...state.session,
            restCount: state.session.restCount + 1,
            totalRestSec: state.session.totalRestSec + REST_DURATION_SEC,
            currentRunStartedAt: action.now,
            restStartedAt: null,
          }
          return {
            phase: 'FOCUSING',
            session,
            focusRemainingSec: state.focusRemainingSec,
          }
        }
        return { ...state, restRemainingSec: next }
      }
      return state
    }

    case 'TAP_BG': {
      if (state.phase === 'FOCUSING') {
        const elapsedThisRun =
          (action.now - state.session.currentRunStartedAt) / 1000
        const session: ActiveSession = {
          ...state.session,
          consumedSecBeforeRun:
            state.session.consumedSecBeforeRun + elapsedThisRun,
          restStartedAt: action.now,
        }
        return {
          phase: 'RESTING',
          session,
          focusRemainingSec: state.focusRemainingSec,
          restRemainingSec: REST_DURATION_SEC,
        }
      }
      if (state.phase === 'RESTING') {
        const restElapsed =
          state.session.restStartedAt !== null
            ? (action.now - state.session.restStartedAt) / 1000
            : 0
        const session: ActiveSession = {
          ...state.session,
          restCount: state.session.restCount + 1,
          totalRestSec: state.session.totalRestSec + restElapsed,
          currentRunStartedAt: action.now,
          restStartedAt: null,
        }
        return {
          phase: 'FOCUSING',
          session,
          focusRemainingSec: state.focusRemainingSec,
        }
      }
      return state
    }

    case 'LONGPRESS_DONE': {
      if (state.phase !== 'FOCUSING' && state.phase !== 'RESTING') return state
      const actualSec = state.session.plannedSec - state.focusRemainingSec
      return {
        phase: 'COMPLETED',
        pending: buildPending(state.session, actualSec, action.now),
      }
    }

    case 'DISMISS':
      return state.phase === 'COMPLETED' ? { phase: 'IDLE' } : state
  }
}

function buildPending(
  session: ActiveSession,
  actualSec: number,
  endedAt: number
): PendingSession {
  return {
    topic: session.topic,
    plannedSec: session.plannedSec,
    actualSec: Math.max(0, Math.min(session.plannedSec, Math.round(actualSec))),
    startedAt: session.startedAt,
    endedAt,
    restCount: session.restCount,
    totalRestSec: Math.round(session.totalRestSec),
  }
}
