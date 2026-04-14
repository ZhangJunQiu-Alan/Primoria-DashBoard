import { useState, useRef, useEffect, useMemo } from 'react'
import { useCurrentDayKey } from '@/hooks/useCurrentDayKey'
import { addDaysToDateKey, parseLocalDateKey } from '@/lib/date'
import { Plus, X, Check, Pencil } from 'lucide-react'
import { useWidgetDataStore } from '@/store/widgetDataStore'
import type { HabitItem } from '@/store/widgetDataStore'

const EMPTY: HabitItem[] = []

// Returns last 7 days ending today, as 'YYYY-MM-DD' strings
function getLast7Days(todayKey: string): { date: string; label: string; isToday: boolean }[] {
  const days: { date: string; label: string; isToday: boolean }[] = []
  const dayAbbr = ['日', '一', '二', '三', '四', '五', '六']
  const today = parseLocalDateKey(todayKey)
  today.setHours(0, 0, 0, 0)
  for (let i = 6; i >= 0; i--) {
    const dateStr = addDaysToDateKey(today, -i)
    const d = parseLocalDateKey(dateStr)
    days.push({
      date: dateStr,
      label: dayAbbr[d.getDay()],
      isToday: i === 0,
    })
  }
  return days
}

interface HabitWidgetProps {
  widgetId: string
}

export function HabitWidget({ widgetId }: HabitWidgetProps) {
  const habits = useWidgetDataStore((s) => s.habitsByWidget[widgetId] ?? EMPTY)
  const habitLogs = useWidgetDataStore((s) => s.habitLogs)
  const addHabit = useWidgetDataStore((s) => s.addHabit)
  const removeHabit = useWidgetDataStore((s) => s.removeHabit)
  const renameHabit = useWidgetDataStore((s) => s.renameHabit)
  const toggleHabitLog = useWidgetDataStore((s) => s.toggleHabitLog)

  const [showModal, setShowModal] = useState(false)
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const editRef = useRef<HTMLInputElement>(null)
  const todayKey = useCurrentDayKey()

  const days = useMemo(() => getLast7Days(todayKey), [todayKey])

  useEffect(() => {
    if (showModal) setTimeout(() => inputRef.current?.focus(), 0)
  }, [showModal])

  useEffect(() => {
    if (editingId) setTimeout(() => { editRef.current?.focus(); editRef.current?.select() }, 0)
  }, [editingId])

  function handleAdd() {
    if (!newName.trim()) return
    addHabit(widgetId, newName.trim())
    setNewName('')
    setShowModal(false)
  }

  function handleRename() {
    if (!editingId) return
    if (editName.trim()) renameHabit(widgetId, editingId, editName.trim())
    setEditingId(null)
  }

  // Empty state
  if (habits.length === 0) {
    return (
      <div className="flex flex-col h-full">
        {/* Empty state */}
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <Check size={28} style={{ color: 'var(--text-muted)' }} strokeWidth={1.5} />
          <p style={{ fontSize: '14px', color: 'var(--text-muted)' }}>开始追踪你的每日习惯</p>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-5 py-2 rounded-full text-white font-medium transition-all"
            style={{ background: 'var(--primary)', fontSize: '14px' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--primary-dark)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--primary)')}
          >
            <Plus size={14} />
            添加习惯
          </button>
        </div>

        {showModal && (
          <AddHabitModal
            value={newName}
            inputRef={inputRef}
            onChange={setNewName}
            onConfirm={handleAdd}
            onCancel={() => { setShowModal(false); setNewName('') }}
          />
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full gap-2 overflow-hidden">
      {/* Habit list */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden flex flex-col gap-3 pr-0.5">
        {habits.map((habit) => {
          const logs = habitLogs[habit.id] ?? []
          return (
            <div key={habit.id}>
              {/* Habit name row */}
              <div className="flex items-center gap-1.5 mb-1.5 group">
                {editingId === habit.id ? (
                  <input
                    ref={editRef}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRename()
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                    onBlur={handleRename}
                    style={{
                      flex: 1, outline: 'none', background: 'transparent',
                      fontSize: '14px', fontWeight: 600, color: 'var(--text)',
                      borderBottom: '1px solid var(--primary-light)',
                    }}
                  />
                ) : (
                  <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)', flex: 1 }}>
                    {habit.name}
                  </span>
                )}
                <button
                  onClick={() => { setEditingId(habit.id); setEditName(habit.name) }}
                  className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-all p-0.5 rounded"
                  style={{ color: 'var(--text-muted)' }}
                  title="重命名"
                >
                  <Pencil size={11} />
                </button>
                <button
                  onClick={() => removeHabit(widgetId, habit.id)}
                  className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-all p-0.5 rounded"
                  style={{ color: 'var(--text-muted)' }}
                  title="删除"
                  onMouseEnter={(e) => (e.currentTarget.style.color = '#C4807A')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
                >
                  <X size={12} />
                </button>
              </div>

              {/* 7-day grid */}
              <div className="grid grid-cols-7 gap-1">
                {days.map(({ date, label, isToday }) => {
                  const done = logs.includes(date)
                  return (
                    <button
                      key={date}
                      onClick={() => toggleHabitLog(habit.id, date)}
                      title={done ? '点击取消' : '点击打卡'}
                      className="flex flex-col items-center py-1.5 rounded-xl transition-all"
                      style={{
                        background: done
                          ? 'var(--primary)'
                          : isToday
                          ? 'var(--bg-card)'
                          : 'var(--bg-muted)',
                        border: isToday && !done
                          ? '1.5px solid var(--primary-light)'
                          : '1.5px solid transparent',
                      }}
                      onMouseEnter={(e) => {
                        if (!done) e.currentTarget.style.background = isToday ? '#e8f4e9' : '#dde8de'
                      }}
                      onMouseLeave={(e) => {
                        if (!done) e.currentTarget.style.background = isToday ? 'var(--bg-card)' : 'var(--bg-muted)'
                      }}
                    >
                      <span style={{
                        fontSize: '10px',
                        fontWeight: isToday ? 600 : 400,
                        color: done ? 'white' : isToday ? 'var(--primary-dark)' : 'var(--text-muted)',
                      }}>
                        {isToday ? '今' : label}
                      </span>
                      <span style={{ fontSize: '14px', lineHeight: '1', marginTop: '2px' }}>
                        {done
                          ? <Check size={12} color="white" strokeWidth={2.5} />
                          : <span style={{ display: 'block', width: '4px', height: '4px', borderRadius: '50%', background: isToday ? 'var(--primary-light)' : 'var(--border)', margin: '0 auto' }} />
                        }
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {/* Add habit button */}
      <button
        onClick={() => setShowModal(true)}
        className="flex items-center justify-center gap-1.5 py-1.5 rounded-xl transition-all flex-shrink-0"
        style={{ color: 'var(--text-muted)', border: '1.5px dashed var(--border)', fontSize: '13px' }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'var(--primary-dark)'
          e.currentTarget.style.borderColor = 'var(--primary-light)'
          e.currentTarget.style.background = 'var(--bg-muted)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'var(--text-muted)'
          e.currentTarget.style.borderColor = 'var(--border)'
          e.currentTarget.style.background = ''
        }}
      >
        <Plus size={13} />
        添加习惯
      </button>

      {showModal && (
        <AddHabitModal
          value={newName}
          inputRef={inputRef}
          onChange={setNewName}
          onConfirm={handleAdd}
          onCancel={() => { setShowModal(false); setNewName('') }}
        />
      )}
    </div>
  )
}

function AddHabitModal({
  value, inputRef, onChange, onConfirm, onCancel,
}: {
  value: string
  inputRef: React.RefObject<HTMLInputElement | null>
  onChange: (v: string) => void
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onCancel}
    >
      <div className="absolute inset-0" style={{ background: 'rgba(61,52,42,0.35)', backdropFilter: 'blur(4px)' }} />
      <div
        className="relative flex flex-col gap-4 p-6 rounded-2xl w-80"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', boxShadow: '0 8px 32px rgba(90,70,50,0.18)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '18px', fontWeight: 600, color: 'var(--text)' }}>
            添加习惯
          </h3>
          <button onClick={onCancel} style={{ color: 'var(--text-muted)' }}>
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-col gap-1.5">
          <label style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-sub)', letterSpacing: '0.05em' }}>
            习惯名称
          </label>
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onConfirm(); if (e.key === 'Escape') onCancel() }}
            placeholder="例如：喝水 8 杯、运动 30 分钟"
            className="rounded-xl px-3 py-2 outline-none"
            style={{ background: 'var(--bg-muted)', border: '1.5px solid var(--border)', color: 'var(--text)', fontSize: '14px' }}
            onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--primary-light)')}
            onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
          />
        </div>

        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-xl text-sm transition-all"
            style={{ background: 'var(--bg-muted)', color: 'var(--text-sub)', border: '1px solid var(--border)' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--border)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg-muted)')}
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            disabled={!value.trim()}
            className="px-4 py-2 rounded-xl text-sm text-white font-medium transition-all"
            style={{ background: value.trim() ? 'var(--primary)' : 'var(--border)', cursor: value.trim() ? 'pointer' : 'default' }}
            onMouseEnter={(e) => { if (value.trim()) e.currentTarget.style.background = 'var(--primary-dark)' }}
            onMouseLeave={(e) => { if (value.trim()) e.currentTarget.style.background = 'var(--primary)' }}
          >
            添加习惯
          </button>
        </div>
      </div>
    </div>
  )
}
