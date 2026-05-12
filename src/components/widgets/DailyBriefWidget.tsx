import { useCallback, useEffect, useState } from 'react'
import { CalendarDays, LoaderCircle, RefreshCw, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { connectGoogleCalendar, fetchCalendarEvents, fetchCalendarStatus, generateDailyBrief } from '@/lib/ai/api'
import { buildBriefContext, getLocalDayIsoRange } from '@/lib/ai/briefContext'
import type { AssistantAgentTraceItem, AssistantRagSource, CalendarEvent } from '@/lib/ai/types'
import { summarizeText, trackBehaviorEvent } from '@/lib/behaviorEvents'
import { useCloudSync } from '@/components/cloud/cloudSyncContext'
import { useCurrentDayKey } from '@/hooks/useCurrentDayKey'
import { useWidgetDataStore } from '@/store/widgetDataStore'

interface DailyBriefWidgetProps {
  widgetId: string
}

const RAG_SOURCE_LABELS = {
  assistant_memory: '记忆',
  assistant_reflection: '反思',
  content_item: '内容',
} satisfies Record<AssistantRagSource['source_type'], string>

function formatRagScore(value: number) {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`
}

const AGENT_ROLE_LABELS = {
  briefing_agent: 'Briefing',
  dashboard_operator: 'Dashboard',
  memory_agent: 'Memory',
  memory_curator: 'Curator',
  orchestrator: 'Orchestrator',
  policy_guard: 'Guard',
  rag_retriever: 'RAG',
  reflection_agent: 'Reflection',
} satisfies Record<AssistantAgentTraceItem['role'], string>

function formatAgentTrace(trace: AssistantAgentTraceItem[] | undefined) {
  const visible = (trace ?? []).filter((item) => item.role !== 'policy_guard').slice(0, 4)
  return visible.map((item) => AGENT_ROLE_LABELS[item.role]).join(' → ')
}

export function DailyBriefWidget({ widgetId: _widgetId }: DailyBriefWidgetProps) {
  const { configured, online, user } = useCloudSync()
  const today = useCurrentDayKey()
  const brief = useWidgetDataStore((s) => s.dailyBriefsByDate[today])
  const setDailyBrief = useWidgetDataStore((s) => s.setDailyBrief)
  const setCalendarEventsForDate = useWidgetDataStore((s) => s.setCalendarEventsForDate)
  const removeDailyBrief = useWidgetDataStore((s) => s.removeDailyBrief)
  const [calendarConnected, setCalendarConnected] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const loggedIn = configured && Boolean(user)
  const ready = loggedIn && online

  useEffect(() => {
    if (!ready) return
    void fetchCalendarStatus()
      .then((status) => {
        setCalendarConnected(status.connected)
        trackBehaviorEvent({
          actor: 'system',
          eventName: 'daily_brief.calendar_status_loaded',
          metadata: { connected: status.connected },
          objectType: 'calendar_status',
          summary: status.connected ? '每日简报读取到日历已连接' : '每日简报读取到日历未连接',
          surface: 'widget',
          widgetId: _widgetId,
          widgetType: 'daily-brief',
        })
      })
      .catch(() => setCalendarConnected(false))
  }, [_widgetId, ready])

  const loadBrief = useCallback(async (force: boolean) => {
    if (!ready || loading) return

    setLoading(true)
    setError(null)

    try {
      const range = getLocalDayIsoRange(today)
      let connected = false
      let events: CalendarEvent[] = []

      try {
        const calendar = await fetchCalendarEvents(range)
        connected = calendar.connected
        events = calendar.events
        setCalendarEventsForDate(today, events)
        trackBehaviorEvent({
          actor: 'system',
          eventName: 'daily_brief.calendar_status_loaded',
          metadata: { connected, eventCount: events.length },
          objectType: 'calendar_status',
          summary: `每日简报读取日历：${events.length} 个事件`,
          surface: 'widget',
          widgetId: _widgetId,
          widgetType: 'daily-brief',
        })
      } catch {
        connected = false
        events = []
        setCalendarEventsForDate(today, events)
      }

      setCalendarConnected(connected)
      const { context, sourceFingerprint } = buildBriefContext(today, events)
      if (!force && brief?.sourceFingerprint === sourceFingerprint) return

      const result = await generateDailyBrief({ context, date: today, force })
      setDailyBrief({
        calendarConnected: connected,
        date: today,
        generatedAt: new Date().toISOString(),
        agentTrace: result.agent_trace ?? [],
        ragSources: result.rag_sources ?? [],
        recommendation: result.recommendation,
        sourceFingerprint,
        summary: result.summary,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : '每日简报生成失败'
      setError(message)
      trackBehaviorEvent({
        actor: 'system',
        eventName: 'daily_brief.error',
        metadata: { date: today, message: summarizeText(message, 120) },
        objectId: today,
        objectType: 'daily_brief',
        summary: `每日简报失败：${summarizeText(message, 80)}`,
        surface: 'widget',
        widgetId: _widgetId,
        widgetType: 'daily-brief',
      })
    } finally {
      setLoading(false)
    }
  }, [_widgetId, brief?.sourceFingerprint, loading, ready, setCalendarEventsForDate, setDailyBrief, today])

  useEffect(() => {
    if (!ready || brief || loading) return
    void loadBrief(false)
  }, [brief, loadBrief, loading, ready])

  async function handleConnectCalendar() {
    trackBehaviorEvent({
      eventName: 'calendar.connect_requested',
      metadata: { provider: 'google' },
      objectType: 'calendar_connection',
      summary: '请求连接 Google Calendar',
      surface: 'widget',
      widgetId: _widgetId,
      widgetType: 'daily-brief',
    })
    try {
      if (!online) throw new Error('离线时无法连接 Google Calendar。')
      await connectGoogleCalendar()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Google Calendar 连接失败'
      toast.error(message)
    }
  }

  function handleRefresh() {
    if (!online) {
      toast.error('离线时无法刷新每日简报。')
      return
    }
    removeDailyBrief(today)
    void loadBrief(true)
  }

  if (!loggedIn) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <Sparkles size={28} style={{ color: 'var(--border)' }} />
        <p style={{ fontSize: '14px', color: 'var(--text-muted)' }}>登录后生成每日简报</p>
      </div>
    )
  }

  if (!online && !brief) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <Sparkles size={28} style={{ color: 'var(--border)' }} />
        <p style={{ fontSize: '14px', color: 'var(--text-muted)' }}>离线时无法生成每日简报</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden">
      <div
        className="flex items-center justify-between gap-2 rounded-xl px-3 py-2"
        style={{
          background: calendarConnected ? 'var(--bg-hover)' : 'var(--bg-muted)',
          border: '1px solid var(--border)',
        }}
      >
        <div className="flex min-w-0 items-center gap-2">
          <CalendarDays size={14} style={{ color: calendarConnected ? 'var(--primary-dark)' : 'var(--text-muted)' }} />
          <span
            className="truncate"
            style={{ fontSize: '12px', color: calendarConnected ? 'var(--primary-dark)' : 'var(--text-muted)' }}
          >
            {calendarConnected ? 'Google Calendar 已连接' : '连接 Google Calendar 后可读取会议'}
          </span>
        </div>
        {!calendarConnected && (
          <button
            onClick={handleConnectCalendar}
            disabled={!online}
            className="rounded-lg px-2 py-1 text-xs font-semibold"
            style={{ color: 'white', background: 'var(--primary)', opacity: online ? 1 : 0.6 }}
          >
            连接
          </button>
        )}
      </div>

      <div className="flex flex-1 flex-col justify-center gap-3 overflow-hidden">
        {loading && (
          <div className="flex items-center justify-center gap-2" style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
            <LoaderCircle size={15} className="animate-spin" />
            正在生成简报
          </div>
        )}

        {!loading && error && (
          <div className="rounded-xl px-3 py-2" style={{ background: 'rgba(196,128,122,0.12)', color: '#9B4A45', fontSize: '13px' }}>
            {error}
          </div>
        )}

        {!loading && brief && (
          <>
            <div
              className="rounded-2xl px-4 py-3"
              style={{ background: 'var(--bg-muted)', border: '1px solid var(--border)' }}
            >
              <p style={{ fontSize: '15px', lineHeight: 1.65, color: 'var(--text)', fontWeight: 600 }}>
                {brief.summary}
              </p>
            </div>
            <div className="flex items-start gap-2">
              <Sparkles size={14} style={{ color: 'var(--secondary)', marginTop: '3px', flexShrink: 0 }} />
              <p style={{ fontSize: '13px', lineHeight: 1.6, color: 'var(--text-sub)' }}>
                {brief.recommendation}
              </p>
            </div>
            {brief.ragSources && brief.ragSources.length > 0 && (
              <div className="flex flex-col gap-1">
                <div style={{ color: 'var(--text-muted)', fontSize: '10px', fontWeight: 700 }}>参考来源</div>
                {brief.ragSources.slice(0, 3).map((source) => (
                  <div
                    key={`${source.source_type}:${source.source_key}`}
                    className="truncate"
                    style={{ color: 'var(--text-muted)', fontSize: '10px', lineHeight: 1.4 }}
                    title={source.excerpt}
                  >
                    {RAG_SOURCE_LABELS[source.source_type]} · {source.title} · {formatRagScore(source.similarity)}
                  </div>
                ))}
              </div>
            )}
            {formatAgentTrace(brief.agentTrace) && (
              <div style={{ color: 'var(--text-muted)', fontSize: '10px', lineHeight: 1.4 }}>
                {formatAgentTrace(brief.agentTrace)}
              </div>
            )}
          </>
        )}

        {!loading && !brief && !error && (
          <div className="flex flex-col items-center justify-center gap-3 text-center">
            <Sparkles size={28} style={{ color: 'var(--border)' }} />
            <p style={{ fontSize: '14px', color: 'var(--text-muted)' }}>今天还没有简报</p>
          </div>
        )}
      </div>

      <button
        onClick={handleRefresh}
        disabled={loading || !online}
        className="flex flex-shrink-0 items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-semibold disabled:opacity-60"
        style={{ background: 'var(--bg-muted)', color: 'var(--text-sub)', border: '1px solid var(--border)' }}
      >
        {loading ? <LoaderCircle size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        手动刷新
      </button>
    </div>
  )
}
