import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'

interface Todo {
  id: string
  text: string
  done: boolean
}

export function TodoWidget() {
  const [todos, setTodos] = useState<Todo[]>([])
  const [input, setInput] = useState('')

  function add() {
    if (!input.trim()) return
    setTodos((prev) => [...prev, { id: Date.now().toString(), text: input.trim(), done: false }])
    setInput('')
  }

  function toggle(id: string) {
    setTodos((prev) => prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t)))
  }

  function remove(id: string) {
    setTodos((prev) => prev.filter((t) => t.id !== id))
  }

  const done = todos.filter((t) => t.done).length

  return (
    <div className="flex flex-col h-full gap-2">
      <div className="flex items-center gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="Add task..."
          className="flex-1 bg-white/5 rounded-lg px-3 py-1.5 text-sm text-white outline-none border border-white/10 focus:border-white/30 placeholder:text-white/20"
        />
        <button onClick={add} className="p-1.5 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] transition-colors">
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
              onClick={() => toggle(todo.id)}
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
              onClick={() => remove(todo.id)}
              className="opacity-0 group-hover:opacity-100 text-white/30 hover:text-red-400 transition-all"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>

      {todos.length > 0 && (
        <p className="text-white/20 text-xs">{done}/{todos.length} completed</p>
      )}
    </div>
  )
}
