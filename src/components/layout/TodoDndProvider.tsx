import { createContext, useContext, useState } from 'react'
import {
  DndContext, DragOverlay, closestCenter,
  PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core'
import { useWidgetDataStore } from '@/store/widgetDataStore'

type DragItemType = 'todo-item' | 'scheduled-task'

interface TodoDndState {
  activeId: string | null
  activeWidgetId: string | null
  activeType: DragItemType | null
}
const Ctx = createContext<TodoDndState>({ activeId: null, activeWidgetId: null, activeType: null })
// eslint-disable-next-line react-refresh/only-export-components
export const useTodoDndState = () => useContext(Ctx)

export function TodoDndProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState<{ id: string; itemId: string; widgetId: string; type: DragItemType } | null>(null)
  const todosByWidget = useWidgetDataStore((s) => s.todosByWidget)
  const scheduledTasksByWidget = useWidgetDataStore((s) => s.scheduledTasksByWidget)
  const reorderTodos = useWidgetDataStore((s) => s.reorderTodos)
  const moveTodo = useWidgetDataStore((s) => s.moveTodo)
  const moveTodoToScheduledDate = useWidgetDataStore((s) => s.moveTodoToScheduledDate)
  const moveScheduledTaskToDate = useWidgetDataStore((s) => s.moveScheduledTaskToDate)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const activeItem = active
    ? active.type === 'todo-item'
      ? (todosByWidget[active.widgetId] ?? []).find((t) => t.id === active.itemId)
      : (scheduledTasksByWidget[active.widgetId] ?? []).find((t) => t.id === active.itemId)
    : null

  function onDragStart(e: DragStartEvent) {
    const type = e.active.data.current?.type as DragItemType | undefined
    const widgetId = e.active.data.current?.widgetId as string | undefined
    if (!widgetId || (type !== 'todo-item' && type !== 'scheduled-task')) return

    const itemId =
      type === 'todo-item'
        ? (e.active.data.current?.todoId as string | undefined) ?? (e.active.id as string)
        : (e.active.data.current?.taskId as string | undefined) ?? (e.active.id as string)

    setActive({ id: e.active.id as string, itemId, widgetId, type })
  }

  function onDragEnd(e: DragEndEvent) {
    const { active: a, over } = e
    setActive(null)
    if (!over || !a) return

    const fromType = a.data.current?.type as DragItemType | undefined
    const fromWidgetId = a.data.current?.widgetId as string | undefined
    const toType = over.data.current?.type as string | undefined
    const toWidgetId = over.data.current?.widgetId as string | undefined
    if (!fromType || !fromWidgetId || !toType || !toWidgetId) return

    if (fromType === 'todo-item' && toType === 'scheduled-day') {
      moveTodoToScheduledDate(
        fromWidgetId,
        ((a.data.current?.todoId as string | undefined) ?? (a.id as string)),
        toWidgetId,
        (over.data.current?.dueDate as string | null | undefined) ?? null
      )
      return
    }

    if (fromType === 'scheduled-task' && toType === 'scheduled-day') {
      if (fromWidgetId !== toWidgetId) return
      moveScheduledTaskToDate(
        fromWidgetId,
        ((a.data.current?.taskId as string | undefined) ?? (a.id as string)),
        (over.data.current?.dueDate as string | null | undefined) ?? null
      )
      return
    }

    if (fromType !== 'todo-item') return

    const fromTodos = todosByWidget[fromWidgetId] ?? []
    const toTodos = todosByWidget[toWidgetId] ?? []

    if (fromWidgetId === toWidgetId) {
      if (toType !== 'todo-item') return
      const oldIndex = fromTodos.findIndex((t) => t.id === a.id)
      const newIndex = fromTodos.findIndex((t) => t.id === over.id)
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        reorderTodos(fromWidgetId, oldIndex, newIndex)
      }
    } else {
      const toIndex = toType === 'todo-item'
        ? toTodos.findIndex((t) => t.id === over.id)
        : toTodos.length
      moveTodo(fromWidgetId, toWidgetId, a.id as string, toIndex >= 0 ? toIndex : toTodos.length)
    }
  }

  return (
    <Ctx.Provider value={{ activeId: active?.itemId ?? null, activeWidgetId: active?.widgetId ?? null, activeType: active?.type ?? null }}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        {children}
        <DragOverlay dropAnimation={{ duration: 150, easing: 'ease' }}>
          {activeItem ? (
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
              {activeItem.text}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </Ctx.Provider>
  )
}
