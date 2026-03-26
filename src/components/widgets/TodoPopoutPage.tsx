import { useState, useRef } from 'react'
import { CheckCheck, Eraser, GripVertical, Trash2 } from 'lucide-react'
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

const EMPTY: TodoItem[] = []

function SortableRow({ todo, widgetId }: { todo: TodoItem; widgetId: string }) {
  const toggleTodo = useWidgetDataStore((s) => s.toggleTodo)
  const removeTodo = useWidgetDataStore((s) => s.removeTodo)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: todo.id,
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 group px-1 py-1 rounded-lg transition-colors"
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-muted)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = '')}
    >
      <button
        {...attributes}
        {...listeners}
        className="opacity-0 group-hover:opacity-40 transition-all flex-shrink-0 cursor-grab active:cursor-grabbing"
        style={{ color: 'var(--text-muted)', touchAction: 'none' }}
        tabIndex={-1}
      >
        <GripVertical size={12} />
      </button>
      <button
        onClick={() => toggleTodo(widgetId, todo.id)}
        className="w-4 h-4 rounded-full border flex-shrink-0 flex items-center justify-center transition-colors"
        style={{
          background: todo.done ? 'var(--primary)' : 'transparent',
          borderColor: todo.done ? 'var(--primary)' : 'var(--border)',
        }}
      >
        {todo.done && <span className="text-white" style={{ fontSize: '8px' }}>✓</span>}
      </button>
      <span
        className="flex-1 text-sm"
        style={{
          textDecoration: todo.done ? 'line-through' : 'none',
          color: todo.done ? 'var(--text-muted)' : 'var(--text)',
        }}
      >
        {todo.text}
      </span>
      <button
        onClick={() => removeTodo(widgetId, todo.id)}
        className="opacity-0 group-hover:opacity-100 transition-all"
        style={{ color: 'var(--text-muted)' }}
        onMouseEnter={(e) => (e.currentTarget.style.color = '#C4807A')}
        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
      >
        <Trash2 size={12} />
      </button>
    </div>
  )
}

export function TodoPopoutPage() {
  const params = new URLSearchParams(window.location.search)
  const widgetId = params.get('widgetId') ?? 'default'

  const todos = useWidgetDataStore((s) => s.todosByWidget[widgetId] ?? EMPTY)
  const addTodo = useWidgetDataStore((s) => s.addTodo)
  const clearDoneTodos = useWidgetDataStore((s) => s.clearDoneTodos)
  const markAllDone = useWidgetDataStore((s) => s.markAllDone)
  const reorderTodos = useWidgetDataStore((s) => s.reorderTodos)

  const [input, setInput] = useState('')
  const [adding, setAdding] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

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
    const doneItems = todos.filter((t) => t.done)
    if (doneItems.length === 0) return
    toast(`即将移除 ${doneItems.length} 个已完成项`, {
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

  return (
    <div
      className="flex flex-col h-screen"
      style={{ background: 'var(--bg-card)', color: 'var(--text)' }}
    >
      {/* 任务列表 */}
      <div className="flex-1 overflow-hidden flex flex-col px-3 pt-3">
        {adding && (
          <div className="flex-shrink-0 mb-2">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAdd()
                if (e.key === 'Escape') { setAdding(false); setInput('') }
              }}
              onBlur={() => { if (!input.trim()) setAdding(false) }}
              placeholder="输入任务，Enter 继续，Esc 结束"
              className="w-full rounded-lg px-3 py-1.5 text-sm outline-none"
              style={{
                background: 'var(--bg-muted)',
                border: '1.5px solid var(--primary-light)',
                color: 'var(--text)',
              }}
            />
          </div>
        )}

        <div
          className="flex-1 overflow-y-auto overflow-x-hidden flex flex-col gap-0.5"
          onClick={(e) => { if (e.target === e.currentTarget) startAdding() }}
        >
          {todos.length === 0 && !adding && (
            <p
              className="text-sm text-center mt-6 cursor-text select-none"
              style={{ color: 'var(--text-muted)' }}
              onClick={startAdding}
            >
              点击此处添加任务
            </p>
          )}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={todos.map((t) => t.id)} strategy={verticalListSortingStrategy}>
              {todos.map((todo) => (
                <SortableRow key={todo.id} todo={todo} widgetId={widgetId} />
              ))}
            </SortableContext>
          </DndContext>
        </div>
      </div>

      {/* 底部工具栏 */}
      <div
        className="flex items-center justify-between px-3 py-2 flex-shrink-0"
        style={{ borderTop: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-1">
          <button
            onClick={() => markAllDone(widgetId)}
            className="p-1.5 rounded-lg transition-all"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--primary-dark)'
              e.currentTarget.style.background = 'var(--bg-muted)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-muted)'
              e.currentTarget.style.background = ''
            }}
            title="全部完成"
          >
            <CheckCheck size={14} />
          </button>
          <button
            onClick={handleClearDone}
            className="p-1.5 rounded-lg transition-all"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = '#C4807A'
              e.currentTarget.style.background = 'var(--bg-muted)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-muted)'
              e.currentTarget.style.background = ''
            }}
            title="删除已完成"
          >
            <Eraser size={14} />
          </button>
        </div>

        <button
          onClick={startAdding}
          className="flex items-center justify-center text-white rounded-full transition-colors"
          style={{ width: '22px', height: '22px', background: 'var(--primary)', flexShrink: 0 }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--primary-dark)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--primary)')}
          title="添加任务"
        >
          <span style={{ fontSize: '16px', lineHeight: 1 }}>+</span>
        </button>
      </div>
    </div>
  )
}
