import { useState, useRef, memo, useCallback, useEffect } from 'react'
import { Trash2, CheckCheck, Eraser, GripVertical } from 'lucide-react'
import { toast } from 'sonner'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { useDroppable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { useWidgetDataStore } from '@/store/widgetDataStore'
import { useTodoDndState } from '@/components/layout/TodoDndProvider'
import type { TodoItem } from '@/store/widgetDataStore'

const EMPTY: TodoItem[] = []
const TODO_TEXT_SIZE = '11px'
const TODO_TEXT_LINE_HEIGHT = 1.45

const SortableRow = memo(function SortableRow({
  todo, widgetId, onRemove, onToggle, isEditing, onStartEdit, onCommitEdit, onCancelEdit,
}: {
  todo: TodoItem
  widgetId: string
  onRemove: (id: string) => void
  onToggle: (id: string) => void
  isEditing: boolean
  onStartEdit: (id: string) => void
  onCommitEdit: (id: string, text: string) => void
  onCancelEdit: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: todo.id,
    disabled: isEditing,
    data: { widgetId, todoId: todo.id, type: 'todo-item' },
  })
  const [localText, setLocalText] = useState(todo.text)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditing) {
      setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select() }, 0)
    }
  }, [isEditing])

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.3 : 1,
      }}
      className="flex items-center gap-2 group px-1 py-1 rounded-lg transition-colors"
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-muted)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = '')}
    >
      {!isEditing && (
        <button
          {...attributes}
          {...listeners}
          className="opacity-0 group-hover:opacity-40 hover:!opacity-70 transition-all flex-shrink-0 cursor-grab active:cursor-grabbing"
          style={{ color: 'var(--text-muted)', touchAction: 'none' }}
          tabIndex={-1}
        >
          <GripVertical size={12} />
        </button>
      )}
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

      {isEditing ? (
        <input
          ref={inputRef}
          value={localText}
          onChange={(e) => setLocalText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCommitEdit(todo.id, localText)
            if (e.key === 'Escape') onCancelEdit()
          }}
          onBlur={() => onCommitEdit(todo.id, localText)}
          onClick={(e) => e.stopPropagation()}
          className="flex-1 outline-none bg-transparent"
          style={{
            fontSize: TODO_TEXT_SIZE,
            lineHeight: TODO_TEXT_LINE_HEIGHT,
            color: 'var(--text)',
            borderBottom: '1px solid var(--primary-light)',
            padding: '0 2px',
          }}
        />
      ) : (
        <span
          className="flex-1 cursor-text"
          onClick={() => onStartEdit(todo.id)}
          style={{
            fontSize: TODO_TEXT_SIZE,
            lineHeight: TODO_TEXT_LINE_HEIGHT,
            textDecoration: todo.done ? 'line-through' : 'none',
            color: todo.done ? 'var(--text-muted)' : 'var(--text)',
            wordBreak: 'break-word',
          }}
        >
          {todo.text}
        </span>
      )}

      {!isEditing && (
        <button
          onClick={() => onRemove(todo.id)}
          className="opacity-0 group-hover:opacity-100 transition-all"
          style={{ color: 'var(--text-muted)' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#C4807A')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
  )
})

interface TodoWidgetProps {
  widgetId?: string
}

export function TodoWidget({ widgetId = 'default' }: TodoWidgetProps) {
  const todos = useWidgetDataStore((s) => s.todosByWidget[widgetId] ?? EMPTY)
  const addTodo = useWidgetDataStore((s) => s.addTodo)
  const toggleTodo = useWidgetDataStore((s) => s.toggleTodo)
  const removeTodo = useWidgetDataStore((s) => s.removeTodo)
  const renameTodo = useWidgetDataStore((s) => s.renameTodo)
  const clearDoneTodos = useWidgetDataStore((s) => s.clearDoneTodos)
  const markAllDone = useWidgetDataStore((s) => s.markAllDone)

  const [input, setInput] = useState('')
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Cross-widget drag state (to show visual feedback)
  const { activeId, activeWidgetId, activeType } = useTodoDndState()
  const isDraggingFromOther =
    activeId !== null &&
    ((activeType === 'todo-item' && activeWidgetId !== widgetId) ||
      activeType === 'scheduled-task')

  // Droppable for when this widget is the drop target (especially when empty)
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `drop-${widgetId}`,
    data: { widgetId, type: 'todo-container' },
  })

  const handleToggle = useCallback((id: string) => toggleTodo(widgetId, id), [widgetId, toggleTodo])
  const handleRemove = useCallback((id: string) => removeTodo(widgetId, id), [widgetId, removeTodo])
  const handleStartEdit = useCallback((id: string) => { setAdding(false); setEditingId(id) }, [])
  const handleCommitEdit = useCallback((id: string, text: string) => {
    if (text.trim()) renameTodo(widgetId, id, text.trim())
    setEditingId(null)
  }, [widgetId, renameTodo])
  const handleCancelEdit = useCallback(() => setEditingId(null), [])

  function startAdding() {
    setEditingId(null)
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
            className="w-full rounded-lg px-3 py-1.5 outline-none"
            style={{
              fontSize: TODO_TEXT_SIZE,
              lineHeight: TODO_TEXT_LINE_HEIGHT,
              background: 'var(--bg-muted)',
              border: '1.5px solid var(--primary-light)',
              color: 'var(--text)',
            }}
          />
        </div>
      )}

      <SortableContext items={todos.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div
          ref={setDropRef}
          className="flex-1 overflow-y-auto overflow-x-hidden flex flex-col gap-0.5 pr-1 rounded-lg transition-all"
          style={{
            outline: isOver && isDraggingFromOther ? '2px dashed var(--primary-light)' : 'none',
            outlineOffset: '2px',
          }}
          onClick={(e) => { if (e.target === e.currentTarget && !editingId) startAdding() }}
        >
          {todos.length === 0 && !adding && (
            <p
              className="text-center mt-6 cursor-text select-none"
              style={{ fontSize: TODO_TEXT_SIZE, lineHeight: TODO_TEXT_LINE_HEIGHT, color: 'var(--text-muted)' }}
              onClick={startAdding}
            >
              {isDraggingFromOther && isOver ? '松开放置到这里' : '点击此处添加任务'}
            </p>
          )}
          {todos.map((todo) => (
            <SortableRow
              key={`${todo.id}-${editingId === todo.id ? 'editing' : 'view'}`}
              todo={todo}
              widgetId={widgetId}
              onToggle={handleToggle}
              onRemove={handleRemove}
              isEditing={editingId === todo.id}
              onStartEdit={handleStartEdit}
              onCommitEdit={handleCommitEdit}
              onCancelEdit={handleCancelEdit}
            />
          ))}
        </div>
      </SortableContext>

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
