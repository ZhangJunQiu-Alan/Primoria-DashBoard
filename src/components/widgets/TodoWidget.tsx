import { useState } from 'react'
import { Trash2, CheckCheck, Eraser, Plus } from 'lucide-react'
import { useWidgetDataStore } from '@/store/widgetDataStore'

interface TodoWidgetProps {
  widgetId?: string
}

export function TodoWidget({ widgetId = 'default' }: TodoWidgetProps) {
  const { todosByWidget, addTodo, toggleTodo, removeTodo, clearDoneTodos, markAllDone } =
    useWidgetDataStore()
  const todos = todosByWidget[widgetId] ?? []
  const [input, setInput] = useState('')
  const [adding, setAdding] = useState(false)

  function handleAdd() {
    if (!input.trim()) return
    addTodo(widgetId, input.trim())
    setInput('')
    setAdding(false)
  }

  return (
    <div className="flex flex-col h-full gap-1.5">
      {/* 输入框 */}
      {adding && (
        <div className="flex items-center gap-2 flex-shrink-0">
          <input
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd()
              if (e.key === 'Escape') setAdding(false)
            }}
            onBlur={() => { if (!input.trim()) setAdding(false) }}
            placeholder="输入任务，Enter 确认..."
            className="flex-1 rounded-lg px-3 py-1.5 text-sm outline-none"
            style={{ background: 'var(--bg-muted)', border: '1.5px solid var(--border)', color: 'var(--text)' }}
          />
        </div>
      )}

      {/* 任务列表 */}
      <div className="flex-1 overflow-y-auto flex flex-col gap-0.5 pr-1">
        {todos.length === 0 && !adding && (
          <p className="text-sm text-center mt-6" style={{ color: 'var(--text-muted)' }}>
            暂无任务，点击 + 添加
          </p>
        )}
        {todos.map((todo) => (
          <div
            key={todo.id}
            className="flex items-center gap-2 group px-1 py-1 rounded-lg transition-colors"
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-muted)')}
            onMouseLeave={e => (e.currentTarget.style.background = '')}
          >
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
              onMouseEnter={e => (e.currentTarget.style.color = '#C4807A')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>

      {/* 底部工具栏 */}
      <div
        className="flex items-center justify-between pt-1.5 flex-shrink-0"
        style={{ borderTop: '1px solid var(--border)' }}
      >
        <button
          onClick={() => markAllDone(widgetId)}
          className="flex items-center gap-1 transition-colors"
          style={{ fontSize: '11px', color: 'var(--text-muted)' }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--primary-dark)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
          title="全部完成"
        >
          <CheckCheck size={12} />
          全部完成
        </button>

        <button
          onClick={() => clearDoneTodos(widgetId)}
          className="flex items-center gap-1 transition-colors"
          style={{ fontSize: '11px', color: 'var(--text-muted)' }}
          onMouseEnter={e => (e.currentTarget.style.color = '#C4807A')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
          title="删除已完成"
        >
          <Eraser size={12} />
          删除已完成
        </button>

        <button
          onClick={() => setAdding(true)}
          className="flex items-center justify-center text-white rounded-full transition-colors"
          style={{
            width: '22px',
            height: '22px',
            background: 'var(--primary)',
            flexShrink: 0,
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--primary-dark)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'var(--primary)')}
          title="添加任务"
        >
          <Plus size={13} />
        </button>
      </div>
    </div>
  )
}
