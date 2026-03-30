import { createContext, useContext, useState } from 'react'
import {
  DndContext, DragOverlay, closestCenter,
  PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core'
import { useWidgetDataStore } from '@/store/widgetDataStore'

interface TodoDndState {
  activeId: string | null
  activeWidgetId: string | null
}
const Ctx = createContext<TodoDndState>({ activeId: null, activeWidgetId: null })
// eslint-disable-next-line react-refresh/only-export-components
export const useTodoDndState = () => useContext(Ctx)

export function TodoDndProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState<{ id: string; widgetId: string } | null>(null)
  const todosByWidget = useWidgetDataStore((s) => s.todosByWidget)
  const reorderTodos = useWidgetDataStore((s) => s.reorderTodos)
  const moveTodo = useWidgetDataStore((s) => s.moveTodo)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const activeTodo = active
    ? (todosByWidget[active.widgetId] ?? []).find((t) => t.id === active.id)
    : null

  function onDragStart(e: DragStartEvent) {
    const widgetId = e.active.data.current?.widgetId as string | undefined
    if (widgetId) setActive({ id: e.active.id as string, widgetId })
  }

  function onDragEnd(e: DragEndEvent) {
    const { active: a, over } = e
    setActive(null)
    if (!over || !a) return

    const fromWidgetId = a.data.current?.widgetId as string | undefined
    const toWidgetId = over.data.current?.widgetId as string | undefined
    if (!fromWidgetId || !toWidgetId) return

    const fromTodos = todosByWidget[fromWidgetId] ?? []
    const toTodos = todosByWidget[toWidgetId] ?? []

    if (fromWidgetId === toWidgetId) {
      const oldIndex = fromTodos.findIndex((t) => t.id === a.id)
      const newIndex = fromTodos.findIndex((t) => t.id === over.id)
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        reorderTodos(fromWidgetId, oldIndex, newIndex)
      }
    } else {
      const toIndex = toTodos.findIndex((t) => t.id === over.id)
      moveTodo(fromWidgetId, toWidgetId, a.id as string, toIndex >= 0 ? toIndex : toTodos.length)
    }
  }

  return (
    <Ctx.Provider value={{ activeId: active?.id ?? null, activeWidgetId: active?.widgetId ?? null }}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        {children}
        <DragOverlay dropAnimation={{ duration: 150, easing: 'ease' }}>
          {activeTodo ? (
            <div
              style={{
                padding: '6px 10px',
                background: 'var(--bg-card)',
                border: '1.5px solid var(--primary-light)',
                borderRadius: '8px',
                fontSize: '15px',
                color: 'var(--text)',
                boxShadow: '0 6px 20px rgba(90,70,50,0.2)',
                cursor: 'grabbing',
                maxWidth: '300px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {activeTodo.text}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </Ctx.Provider>
  )
}
