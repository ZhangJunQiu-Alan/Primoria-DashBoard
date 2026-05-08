import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import {
  INITIAL_STATE,
  REST_DURATION_SEC,
  getActiveFocusEndAt,
  getActiveFocusRemainingSec,
  reducer,
  type Action,
  type ActiveSession,
  type ActivityState,
  type FocusDuration,
  type PendingSession,
} from './pomodoroJourneyReducer'
import {
  INITIAL_AGGREGATES,
  commitSession,
  type Aggregates,
} from './pomodoroJourneyAggregates'

export const POMODORO_JOURNEY_PERSIST_KEY = 'primoria.pomodoroJourney.v1'

type NotificationPermissionLike = 'default' | 'granted' | 'denied'

interface PomodoroJourneyState {
  activity: ActivityState
  aggregates: Aggregates
  defaultDuration: FocusDuration
  lastTopic: string
  notificationPermission: NotificationPermissionLike

  dispatch: (action: Action) => DispatchOutcome
  setDefaultDuration: (duration: FocusDuration) => void
  setLastTopic: (topic: string) => void
  setNotificationPermission: (perm: NotificationPermissionLike) => void
  reconcile: (now?: number) => ReconcileOutcome
  reset: () => void
}

export interface DispatchOutcome {
  committed: boolean
  summited: boolean
}

export interface ReconcileOutcome {
  changed: boolean
  committed: boolean
  summited: boolean
}

let idGenerator: () => string = defaultIdGenerator

function defaultIdGenerator() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

// Test hook: lets tests inject a deterministic id generator.
export function setIdGenerator(fn: () => string) {
  idGenerator = fn
}

export function resetIdGenerator() {
  idGenerator = defaultIdGenerator
}

function buildPendingFromTimedRecovery(session: ActiveSession): PendingSession {
  return {
    topic: session.topic,
    plannedSec: session.plannedSec,
    actualSec: session.plannedSec,
    startedAt: session.startedAt,
    endedAt: getActiveFocusEndAt(session),
    restCount: session.restCount,
    totalRestSec: Math.round(session.totalRestSec),
  }
}

function reconcileActivity(
  activity: ActivityState,
  aggregates: Aggregates,
  now: number
): {
  activity: ActivityState
  aggregates: Aggregates
  changed: boolean
  committed: boolean
  summited: boolean
} {
  if (activity.phase === 'FOCUSING') {
    const remaining = getActiveFocusRemainingSec(activity.session, now)
    if (remaining <= 0) {
      return {
        activity: {
          phase: 'COMPLETED',
          pending: buildPendingFromTimedRecovery(activity.session),
        },
        aggregates,
        changed: true,
        committed: false,
        summited: false,
      }
    }
    const newRemaining = Math.ceil(remaining)
    if (newRemaining === activity.focusRemainingSec) {
      return { activity, aggregates, changed: false, committed: false, summited: false }
    }
    return {
      activity: { ...activity, focusRemainingSec: newRemaining },
      aggregates,
      changed: true,
      committed: false,
      summited: false,
    }
  }

  if (activity.phase === 'RESTING') {
    if (activity.session.restStartedAt === null) {
      return { activity, aggregates, changed: false, committed: false, summited: false }
    }
    const restElapsedMs = now - activity.session.restStartedAt
    const restElapsedSec = restElapsedMs / 1000
    if (restElapsedSec >= REST_DURATION_SEC) {
      // Auto-resume FOCUSING from the moment rest would have ended.
      const resumeAt = activity.session.restStartedAt + REST_DURATION_SEC * 1000
      const session: ActiveSession = {
        ...activity.session,
        restCount: activity.session.restCount + 1,
        totalRestSec: activity.session.totalRestSec + REST_DURATION_SEC,
        currentRunStartedAt: resumeAt,
        restStartedAt: null,
      }
      const resumed: ActivityState = {
        phase: 'FOCUSING',
        session,
        focusRemainingSec: activity.focusRemainingSec,
      }
      // Now reconcile FOCUSING from resumeAt to now (handles long sleeps that span rest + focus).
      const inner = reconcileActivity(resumed, aggregates, now)
      return { ...inner, changed: true }
    }
    const newRestRemaining = Math.ceil(REST_DURATION_SEC - restElapsedSec)
    if (newRestRemaining === activity.restRemainingSec) {
      return { activity, aggregates, changed: false, committed: false, summited: false }
    }
    return {
      activity: { ...activity, restRemainingSec: newRestRemaining },
      aggregates,
      changed: true,
      committed: false,
      summited: false,
    }
  }

  return { activity, aggregates, changed: false, committed: false, summited: false }
}

export const usePomodoroJourneyStore = create<PomodoroJourneyState>()(
  persist(
    (set, get) => ({
      activity: INITIAL_STATE,
      aggregates: INITIAL_AGGREGATES,
      defaultDuration: 1500,
      lastTopic: '',
      notificationPermission: 'default',

      dispatch: (action) => {
        const { activity, aggregates } = get()

        // Commit the pending session on DISMISS.
        if (action.type === 'DISMISS' && activity.phase === 'COMPLETED') {
          const { next: nextAgg, summited } = commitSession(
            aggregates,
            activity.pending,
            idGenerator()
          )
          set({
            activity: { phase: 'IDLE' },
            aggregates: nextAgg,
            lastTopic: activity.pending.topic,
          })
          return { committed: true, summited }
        }

        const next = reducer(activity, action)
        if (next === activity) return { committed: false, summited: false }
        set({ activity: next })
        return { committed: false, summited: false }
      },

      setDefaultDuration: (duration) => set({ defaultDuration: duration }),
      setLastTopic: (topic) => set({ lastTopic: topic }),
      setNotificationPermission: (perm) =>
        set({ notificationPermission: perm }),

      reconcile: (now = Date.now()) => {
        const { activity, aggregates } = get()
        const out = reconcileActivity(activity, aggregates, now)
        if (!out.changed) {
          return { changed: false, committed: false, summited: false }
        }
        set({ activity: out.activity, aggregates: out.aggregates })
        return {
          changed: true,
          committed: out.committed,
          summited: out.summited,
        }
      },

      reset: () =>
        set({
          activity: INITIAL_STATE,
          aggregates: INITIAL_AGGREGATES,
          defaultDuration: 1500,
          lastTopic: '',
          notificationPermission: 'default',
        }),
    }),
    {
      name: POMODORO_JOURNEY_PERSIST_KEY,
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (state) => ({
        activity: state.activity,
        aggregates: state.aggregates,
        defaultDuration: state.defaultDuration,
        lastTopic: state.lastTopic,
        notificationPermission: state.notificationPermission,
      }),
    }
  )
)
