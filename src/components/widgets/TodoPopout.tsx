import { useEffect, useRef, useState, memo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { X, Pin, PinOff, GripVertical, Trash2, CheckCheck, Eraser } from 'lucide-react'
import { toast } from 'sonner'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useWidgetDataStore } from '@/store/widgetDataStore'
import type { TodoItem } from '@/store/widgetDataStore'
import { useDashboardStore } from '@/store/dashboardStore'

const pointerSensor = { activationConstraint: { distance: 5 } }
const PANEL_W = 280
const EMPTY: TodoItem[] = []
const PANEL_H = 400

const SortableRow = memo(function SortableRow({
  todo, onToggle, onRemove,
}: { todo: TodoItem; onToggle: (id: string) => void; onRemove: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: todo.id })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      className="flex items-center gap-2 group px-1 py-1 rounded-lg transition-colors"
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-muted)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = '')}
    >
      <button {...attributes} {...listeners}
        className="opacity-0 group-hover:opacity-40 transition-all flex-shrink-0 cursor-grab active:cursor-grabbing"
        style={{ color: 'var(--text-muted)', touchAction: 'none' }} tabIndex={-1}
      >
        <GripVertical size={12} />
      </button>
      <button
        onClick={() => onToggle(todo.id)}
        className="w-4 h-4 rounded-full border flex-shrink-0 flex items-center justify-center transition-colors"
        style={{ background: todo.done ? 'var(--primary)' : 'transparent', borderColor: todo.done ? 'var(--primary)' : 'var(--border)' }}
      >
        {todo.done && <span className="text-white" style={{ fontSize: '8px' }}>✓</span>}
      </button>
      <span className="flex-1 text-sm" style={{ textDecoration: todo.done ? 'line-through' : 'none', color: todo.done ? 'var(--text-muted)' : 'var(--text)' }}>
        {todo.text}
      </span>
      <button onClick={() => onRemove(todo.id)}
        className="opacity-0 group-hover:opacity-100 transition-all"
        style={{ color: 'var(--text-muted)' }}
        onMouseEnter={(e) => (e.currentTarget.style.color = '#C4807A')}
        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
      >
        <Trash2 size={12} />
      </button>
    </div>
  )
})

interface TodoPopoutProps {
  widgetId: string
  onClose: () => void
}

export function TodoPopout({ widgetId, onClose }: TodoPopoutProps) {
  const todos = useWidgetDataStore((s) => s.todosByWidget[widgetId] ?? EMPTY)
  const addTodo = useWidgetDataStore((s) => s.addTodo)
  const toggleTodo = useWidgetDataStore((s) => s.toggleTodo)
  const removeTodo = useWidgetDataStore((s) => s.removeTodo)
  const clearDoneTodos = useWidgetDataStore((s) => s.clearDoneTodos)
  const markAllDone = useWidgetDataStore((s) => s.markAllDone)
  const reorderTodos = useWidgetDataStore((s) => s.reorderTodos)
  const title = useDashboardStore((s) => s.widgetNames[widgetId] ?? '待办事项')

  const [pos, setPos] = useState(() => ({
    x: Math.max(0, (window.innerWidth - PANEL_W) / 2),
    y: Math.max(0, (window.innerHeight - PANEL_H) / 2),
  }))
  const [pinned, setPinned] = useState(false)
  const [adding, setAdding] = useState(false)
  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const dragOrigin = useRef<{ mx: number; my: number; px: number; py: number } | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, pointerSensor))

  const handleToggle = useCallback((id: string) => toggleTodo(widgetId, id), [widgetId, toggleTodo])
  const handleRemove = useCallback((id: string) => removeTodo(widgetId, id), [widgetId, removeTodo])

  function onHeaderMouseDown(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest('button')) return
    dragOrigin.current = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y }
    e.preventDefault()
  }

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragOrigin.current) return
      const dx = e.clientX - dragOrigin.current.mx
      const dy = e.clientY - dragOrigin.current.my
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - PANEL_W, dragOrigin.current.px + dx)),
        y: Math.max(0, Math.min(window.innerHeight - PANEL_H, dragOrigin.current.py + dy)),
      })
    }
    function onUp() { dragOrigin.current = null }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  function startAdding() {
    setAdding(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  function handleAdd() {
    if (!input.trim()) { setAdding(false); return }
    addTodo(widgetId, input.trim())
    setInput('')
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  function handleClearDone() {
    const count = todos.filter((t) => t.done).length
    if (count === 0) return
    toast(`即将移除 ${count} 个已完成项`, {
      duration: 4000,
      action: { label: '撤销', onClick: () => {} },
      onDismiss: () => clearDoneTodos(widgetId),
      onAutoClose: () => clearDoneTodos(widgetId),
    })
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = todos.findIndex((t) => t.id === active.id)
    const newIndex = todos.findIndex((t) => t.id === over.id)
    reorderTodos(widgetId, oldIndex, newIndex)
  }

  const panel = (
    <div
      style={{
        position: 'fixed', left: pos.x, top: pos.y,
        width: PANEL_W, height: PANEL_H,
        zIndex: pinned ? 9999 : 200,
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-lg)',
        boxShadow: '0 8px 32px rgba(90,70,50,0.18)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        onMouseDown={onHeaderMouseDown}
        style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          padding: '10px 12px', borderBottom: '1px solid var(--border)',
          cursor: 'grab', userSelect: 'none', flexShrink: 0,
        }}
      >
        <span style={{ flex: 1, fontFamily: "'Cormorant Garamond', serif", fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>
          {title}
        </span>
        <button onClick={() => setPinned((p) => !p)} title={pinned ? '取消置顶' : '置顶'}
          style={{ color: pinned ? 'var(--primary-dark)' : 'var(--text-muted)', padding: '3px', borderRadius: '6px', transition: 'all 0.15s' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-muted)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = '')}
        >
          {pinned ? <Pin size={13} /> : <PinOff size={13} />}
        </button>
        <button onClick={onClose} title="关闭"
          style={{ color: 'var(--text-muted)', padding: '3px', borderRadius: '6px', transition: 'all 0.15s' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-muted)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = '')}
        >
          <X size={13} />
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: '8px 10px 0' }}>
        {adding && (
          <div style={{ flexShrink: 0, marginBottom: '6px' }}>
            <input
              ref={inputRef} value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAdd()
                if (e.key === 'Escape') { setAdding(false); setInput('') }
              }}
              onBlur={() => { if (!input.trim()) setAdding(false) }}
              placeholder="输入任务，Enter 继续，Esc 结束"
              style={{ width: '100%', borderRadius: '8px', padding: '6px 10px', fontSize: '13px', outline: 'none', background: 'var(--bg-muted)', border: '1.5px solid var(--primary-light)', color: 'var(--text)' }}
            />
          </div>
        )}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}
          onClick={(e) => { if (e.target === e.currentTarget) startAdding() }}
        >
          {todos.length === 0 && !adding && (
            <p onClick={startAdding} style={{ fontSize: '13px', color: 'var(--text-muted)', textAlign: 'center', marginTop: '24px', cursor: 'text', userSelect: 'none' }}>
              点击此处添加任务
            </p>
          )}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={todos.map((t) => t.id)} strategy={verticalListSortingStrategy}>
              {todos.map((todo) => (
                <SortableRow key={todo.id} todo={todo} onToggle={handleToggle} onRemove={handleRemove} />
              ))}
            </SortableContext>
          </DndContext>
        </div>
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: '4px' }}>
          <button onClick={() => markAllDone(widgetId)} title="全部完成"
            style={{ color: 'var(--text-muted)', padding: '6px', borderRadius: '8px', transition: 'all 0.15s' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--primary-dark)'; e.currentTarget.style.background = 'var(--bg-muted)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = '' }}
          ><CheckCheck size={14} /></button>
          <button onClick={handleClearDone} title="删除已完成"
            style={{ color: 'var(--text-muted)', padding: '6px', borderRadius: '8px', transition: 'all 0.15s' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#C4807A'; e.currentTarget.style.background = 'var(--bg-muted)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = '' }}
          ><Eraser size={14} /></button>
        </div>
        <button onClick={startAdding} title="添加任务"
          style={{ width: '22px', height: '22px', borderRadius: '50%', background: 'var(--primary)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', lineHeight: '1', transition: 'background 0.15s' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--primary-dark)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--primary)')}
        >+</button>
      </div>
    </div>
  )

  return createPortal(panel, document.body)
}
