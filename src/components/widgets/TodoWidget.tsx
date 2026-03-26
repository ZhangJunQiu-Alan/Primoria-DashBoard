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
          placeholder="Add task..."
          className="flex-1 bg-white/5 rounded-lg px-3 py-1.5 text-sm text-white outline-none border border-white/10 focus:border-white/30 placeholder:text-white/20"
        />
        <button onClick={handleAdd} className="p-1.5 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] transition-colors">
          <Plus size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto flex flex-col gap-1 pr-1">
        {todos.length === 0 && (
          <p className="text-white/20 text-sm text-center mt-4">No tasks yet</p>
        )}
        {todos.map((todo) => (
          <div key={todo.id} className="flex items-center gap-2 group px-1 py-0.5 rounded-lg hover:bg-white/5">
            <button
              onClick={() => toggleTodo(todo.id)}
              className={`w-4 h-4 rounded-full border flex-shrink-0 flex items-center justify-center transition-colors ${
                todo.done
                  ? 'bg-[var(--accent)] border-[var(--accent)]'
                  : 'border-white/20 hover:border-white/40'
              }`}
            >
              {todo.done && <span className="text-white text-[8px]">✓</span>}
            </button>
            <span className={`flex-1 text-sm ${todo.done ? 'line-through text-white/30' : 'text-white/80'}`}>
              {todo.text}
            </span>
            <button
              onClick={() => removeTodo(todo.id)}
              className="opacity-0 group-hover:opacity-100 text-white/30 hover:text-red-400 transition-all"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>

      {todos.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-white/20 text-xs">{doneCount}/{todos.length} completed</p>
          {doneCount > 0 && (
            <button
              onClick={clearDoneTodos}
              className="flex items-center gap-1 text-white/20 hover:text-white/50 text-xs transition-colors"
            >
              <CheckCheck size={10} /> Clear done
            </button>
          )}
        </div>
      )}
    </div>
  )
}
