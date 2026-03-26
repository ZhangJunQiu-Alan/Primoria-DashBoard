import { useState } from 'react'
import { Plus, Trash2, CheckCheck } from 'lucide-react'
import { useWidgetDataStore } from '@/store/widgetDataStore'

export function TodoWidget() {
  const { todos, addTodo, toggleTodo, removeTodo, clearDoneTodos } = useWidgetDataStore()
  const [input, setInput] = useState('')

  function handleAdd() {
    if (!input.trim()) return
    addTodo(input.trim())
    setInput('')
  }

  const doneCount = todos.filter((t) => t.done).length

  return (
    <div className="flex flex-col h-full gap-2">
      <div className="flex items-center gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          placeholder="添加任务..."
          className="flex-1 rounded-lg px-3 py-1.5 text-sm outline-none"
          style={{ background: 'var(--bg-muted)', border: '1.5px solid var(--border)', color: 'var(--text)' }}
        />
        <button onClick={handleAdd} className="p-1.5 rounded-lg text-white" style={{ background: 'var(--primary)' }}>
          <Plus size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto flex flex-col gap-1 pr-1">
        {todos.length === 0 && (
          <p className="text-sm text-center mt-4" style={{ color: 'var(--text-muted)' }}>
            暂无任务
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
              onClick={() => toggleTodo(todo.id)}
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
              onClick={() => removeTodo(todo.id)}
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

      {todos.length > 0 && (
        <div className="flex items-center justify-between">
          <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            {doneCount}/{todos.length} 已完成
          </p>
          {doneCount > 0 && (
            <button
              onClick={clearDoneTodos}
              className="flex items-center gap-1 transition-colors"
              style={{ fontSize: '11px', color: 'var(--text-muted)' }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--primary-dark)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
            >
              <CheckCheck size={10} /> 清除已完成
            </button>
          )}
        </div>
      )}
    </div>
  )
}
