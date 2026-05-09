import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { summarizeText, trackBehaviorEvent } from '@/lib/behaviorEvents'
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

function trackPomodoroAction(previous: ActivityState, next: ActivityState, action: Action) {
  if (next === previous) return

  if (action.type === 'OPEN_SETUP' && next.phase === 'SETUP') {
    trackBehaviorEvent({
      eventName: 'pomodoro.setup_opened',
      objectType: 'pomodoro_session',
      summary: '打开番茄钟设置',
      surface: 'widget',
      widgetType: 'focus-journey',
    })
    return
  }

  if (action.type === 'CANCEL') {
    trackBehaviorEvent({
      eventName: 'pomodoro.setup_cancelled',
      objectType: 'pomodoro_session',
      summary: '取消番茄钟设置',
      surface: 'widget',
      widgetType: 'focus-journey',
    })
    return
  }

  if (action.type === 'START' && next.phase === 'FOCUSING') {
    trackBehaviorEvent({
      eventName: 'pomodoro.started',
      metadata: {
        durationSec: action.duration,
        topicLength: action.topic.length,
        topicSummary: summarizeText(action.topic, 72),
      },
      objectId: String(action.now),
      objectType: 'pomodoro_session',
      summary: `开始番茄钟：${summarizeText(action.topic, 72)}`,
      surface: 'widget',
      widgetType: 'focus-journey',
    })
    return
  }

  if (action.type === 'TAP_BG' && previous.phase === 'FOCUSING' && next.phase === 'RESTING') {
    trackBehaviorEvent({
      eventName: 'pomodoro.rest_started',
      metadata: {
        focusRemainingSec: next.focusRemainingSec,
        topicSummary: summarizeText(previous.session.topic, 72),
      },
      objectId: String(previous.session.startedAt),
      objectType: 'pomodoro_session',
      summary: `进入休息：${summarizeText(previous.session.topic, 72)}`,
      surface: 'widget',
      widgetType: 'focus-journey',
    })
    return
  }

  if (action.type === 'TAP_BG' && previous.phase === 'RESTING' && next.phase === 'FOCUSING') {
    trackBehaviorEvent({
      eventName: 'pomodoro.focus_resumed',
      metadata: {
        focusRemainingSec: next.focusRemainingSec,
        topicSummary: summarizeText(next.session.topic, 72),
      },
      objectId: String(next.session.startedAt),
      objectType: 'pomodoro_session',
      summary: `恢复专注：${summarizeText(next.session.topic, 72)}`,
      surface: 'widget',
      widgetType: 'focus-journey',
    })
    return
  }

  if (next.phase === 'COMPLETED' && previous.phase !== 'COMPLETED') {
    trackBehaviorEvent({
      eventName: 'pomodoro.completed',
      metadata: {
        actualSec: next.pending.actualSec,
        completedBy: action.type === 'LONGPRESS_DONE' ? 'manual' : 'timer',
        plannedSec: next.pending.plannedSec,
        restCount: next.pending.restCount,
        topicSummary: summarizeText(next.pending.topic, 72),
      },
      objectId: String(next.pending.startedAt),
      objectType: 'pomodoro_session',
      summary: `完成番茄钟：${summarizeText(next.pending.topic, 72)}`,
      surface: 'widget',
      widgetType: 'focus-journey',
    })
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
          trackBehaviorEvent({
            eventName: 'pomodoro.dismissed',
            metadata: {
              actualSec: activity.pending.actualSec,
              plannedSec: activity.pending.plannedSec,
              summited,
              topicSummary: summarizeText(activity.pending.topic, 72),
            },
            objectId: String(activity.pending.startedAt),
            objectType: 'pomodoro_session',
            summary: `确认番茄钟完成：${summarizeText(activity.pending.topic, 72)}`,
            surface: 'widget',
            widgetType: 'focus-journey',
          })
          return { committed: true, summited }
        }

        const next = reducer(activity, action)
        if (next === activity) return { committed: false, summited: false }
        set({ activity: next })
        trackPomodoroAction(activity, next, action)
        return { committed: false, summited: false }
      },

      setDefaultDuration: (duration) => {
        const previous = get().defaultDuration
        set({ defaultDuration: duration })
        if (previous !== duration) {
          trackBehaviorEvent({
            eventName: 'pomodoro.default_duration_changed',
            metadata: { nextDurationSec: duration, previousDurationSec: previous },
            objectType: 'pomodoro_setting',
            summary: `修改番茄钟默认时长：${Math.round(duration / 60)} 分钟`,
            surface: 'widget',
            widgetType: 'focus-journey',
          })
        }
      },
      setLastTopic: (topic) => set({ lastTopic: topic }),
      setNotificationPermission: (perm) => {
        const previous = get().notificationPermission
        set({ notificationPermission: perm })
        if (previous !== perm) {
          trackBehaviorEvent({
            eventName: 'pomodoro.notification_permission_changed',
            metadata: { nextPermission: perm, previousPermission: previous },
            objectType: 'pomodoro_setting',
            summary: `修改番茄钟通知权限：${perm}`,
            surface: 'widget',
            widgetType: 'focus-journey',
          })
        }
      },

      reconcile: (now = Date.now()) => {
        const { activity, aggregates } = get()
        const out = reconcileActivity(activity, aggregates, now)
        if (!out.changed) {
          return { changed: false, committed: false, summited: false }
        }
        set({ activity: out.activity, aggregates: out.aggregates })
        if (out.activity.phase === 'COMPLETED' && activity.phase !== 'COMPLETED') {
          trackBehaviorEvent({
            eventName: 'pomodoro.completed',
            metadata: {
              actualSec: out.activity.pending.actualSec,
              completedBy: 'reconcile',
              plannedSec: out.activity.pending.plannedSec,
              restCount: out.activity.pending.restCount,
              topicSummary: summarizeText(out.activity.pending.topic, 72),
            },
            objectId: String(out.activity.pending.startedAt),
            objectType: 'pomodoro_session',
            summary: `恢复后确认番茄钟完成：${summarizeText(out.activity.pending.topic, 72)}`,
            surface: 'widget',
            widgetType: 'focus-journey',
          })
        }
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
