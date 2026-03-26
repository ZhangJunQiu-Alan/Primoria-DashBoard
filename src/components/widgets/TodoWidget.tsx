import { useState, useRef, memo, useCallback } from 'react'
import { Trash2, CheckCheck, Eraser, GripVertical } from 'lucide-react'
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

// Sensors config is static — define outside component to avoid recreation
const pointerSensor = { activationConstraint: { distance: 5 } }
const EMPTY: TodoItem[] = []

// Memoized row — only re-renders when its own todo data changes
const SortableRow = memo(function SortableRow({
  todo, onRemove, onToggle,
}: {
  todo: TodoItem
  onRemove: (id: string) => void
  onToggle: (id: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: todo.id,
  })

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
      className="flex items-center gap-2 group px-1 py-1 rounded-lg transition-colors"
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-muted)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = '')}
    >
      <button
        {...attributes}
        {...listeners}
        className="opacity-0 group-hover:opacity-40 hover:!opacity-70 transition-all flex-shrink-0 cursor-grab active:cursor-grabbing"
        style={{ color: 'var(--text-muted)', touchAction: 'none' }}
        tabIndex={-1}
      >
        <GripVertical size={12} />
      </button>
      <button
        onClick={() => onToggle(todo.id)}
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
        onClick={() => onRemove(todo.id)}
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

interface TodoWidgetProps {
  widgetId?: string
}

export function TodoWidget({ widgetId = 'default' }: TodoWidgetProps) {
  // Granular selectors — only re-render when this widget's todos change
  const todos = useWidgetDataStore((s) => s.todosByWidget[widgetId] ?? EMPTY)
  const addTodo = useWidgetDataStore((s) => s.addTodo)
  const toggleTodo = useWidgetDataStore((s) => s.toggleTodo)
  const removeTodo = useWidgetDataStore((s) => s.removeTodo)
  const clearDoneTodos = useWidgetDataStore((s) => s.clearDoneTodos)
  const markAllDone = useWidgetDataStore((s) => s.markAllDone)
  const reorderTodos = useWidgetDataStore((s) => s.reorderTodos)

  const [input, setInput] = useState('')
  const [adding, setAdding] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const sensors = useSensors(useSensor(PointerSensor, pointerSensor))

  const handleToggle = useCallback((id: string) => toggleTodo(widgetId, id), [widgetId, toggleTodo])
  const handleRemove = useCallback((id: string) => removeTodo(widgetId, id), [widgetId, removeTodo])

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

  return (
    <div className="flex flex-col h-full gap-1.5">
      {adding && (
        <div className="flex-shrink-0">
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
            style={{ background: 'var(--bg-muted)', border: '1.5px solid var(--primary-light)', color: 'var(--text)' }}
          />
        </div>
      )}

      <div
        className="flex-1 overflow-y-auto overflow-x-hidden flex flex-col gap-0.5 pr-1"
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
              <SortableRow
                key={todo.id}
                todo={todo}
                onToggle={handleToggle}
                onRemove={handleRemove}
              />
            ))}
          </SortableContext>
        </DndContext>
      </div>

      <div
        className="flex items-center justify-between pt-1.5 flex-shrink-0"
        style={{ borderTop: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-1">
          <button
            onClick={() => markAllDone(widgetId)}
            className="p-1.5 rounded-lg transition-all"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--primary-dark)'; e.currentTarget.style.background = 'var(--bg-muted)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = '' }}
            title="全部完成"
          >
            <CheckCheck size={14} />
          </button>
          <button
            onClick={handleClearDone}
            className="p-1.5 rounded-lg transition-all"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#C4807A'; e.currentTarget.style.background = 'var(--bg-muted)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = '' }}
            title="删除已完成"
          >
            <Eraser size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}
