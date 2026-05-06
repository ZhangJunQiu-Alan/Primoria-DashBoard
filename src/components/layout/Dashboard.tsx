import { useMemo } from 'react'
import {
  findOrGenerateResponsiveLayout,
  GridLayout,
  noCompactor,
  useContainerWidth,
  useResponsiveLayout,
} from 'react-grid-layout'
import { aspectRatio } from 'react-grid-layout/core'
import { useDashboardStore } from '@/store/dashboardStore'
import { WidgetShell } from './WidgetShell'
import type { DashboardBreakpoint, LayoutItem, ResponsiveLayouts, WidgetType } from '@/types/widget'

// Per-widget grid constraints injected at render time. Constraint instances must be
// stable across renders — react-grid-layout uses reference equality.
const FOCUS_JOURNEY_CONSTRAINTS = [aspectRatio(9 / 16)]
const TYPE_CONSTRAINTS: Partial<Record<WidgetType, ReturnType<typeof aspectRatio>[]>> = {
  'focus-journey': FOCUS_JOURNEY_CONSTRAINTS,
}

const BREAKPOINTS: Record<DashboardBreakpoint, number> = { lg: 1200, md: 996, sm: 768 }
const COLS: Record<DashboardBreakpoint, number> = { lg: 12, md: 10, sm: 6 }
const BREAKPOINT_ORDER: DashboardBreakpoint[] = ['sm', 'md', 'lg']

interface DashboardProps {
  showWidgetHeaders: boolean
}

function preserveEdgeAnchors(
  generatedLayout: LayoutItem[],
  sourceLayout: LayoutItem[],
  sourceCols: number,
  targetCols: number
) {
  const sourceMap = new Map(sourceLayout.map((item) => [item.i, item]))

  return generatedLayout.map((item) => {
    const source = sourceMap.get(item.i)
    if (!source) return item

    if (source.x <= 0) {
      return { ...item, x: 0 }
    }

    if (source.x + source.w >= sourceCols) {
      return { ...item, x: Math.max(0, targetCols - item.w) }
    }

    return item
  })
}

function buildResponsiveLayouts(layouts: ResponsiveLayouts) {
  const completeLayouts: ResponsiveLayouts = { ...layouts }
  const availableBreakpoints = BREAKPOINT_ORDER.filter((breakpoint) => layouts[breakpoint]?.length)

  if (availableBreakpoints.length === 0) return completeLayouts

  for (const breakpoint of BREAKPOINT_ORDER) {
    if (completeLayouts[breakpoint]?.length) continue

    const targetIndex = BREAKPOINT_ORDER.indexOf(breakpoint)
    const sourceBreakpoint = [...availableBreakpoints].sort((a, b) => {
      const aDistance = Math.abs(BREAKPOINT_ORDER.indexOf(a) - targetIndex)
      const bDistance = Math.abs(BREAKPOINT_ORDER.indexOf(b) - targetIndex)
      return aDistance - bDistance
    })[0]

    if (!sourceBreakpoint) continue

    const sourceLayout = layouts[sourceBreakpoint]
    if (!sourceLayout) continue

    const generated = findOrGenerateResponsiveLayout(
      layouts,
      BREAKPOINTS,
      breakpoint,
      sourceBreakpoint,
      COLS[breakpoint],
      noCompactor
    ) as LayoutItem[]

    completeLayouts[breakpoint] = preserveEdgeAnchors(
      generated,
      sourceLayout,
      COLS[sourceBreakpoint],
      COLS[breakpoint]
    )
  }

  return completeLayouts
}

export function Dashboard({ showWidgetHeaders }: DashboardProps) {
  const widgets = useDashboardStore((s) => s.widgets)
  const layouts = useDashboardStore((s) => s.layouts)
  const removeWidget = useDashboardStore((s) => s.removeWidget)
  const updateLayout = useDashboardStore((s) => s.updateLayout)

  const { width, containerRef } = useContainerWidth({ initialWidth: 1200 })
  const responsiveLayouts = useMemo(() => buildResponsiveLayouts(layouts), [layouts])

  const {
    breakpoint,
    cols,
    layout: activeLayout,
  } = useResponsiveLayout({
    width,
    breakpoints: BREAKPOINTS,
    cols: COLS,
    layouts: responsiveLayouts,
    compactor: noCompactor,
  })

  const widgetTypeById = useMemo(
    () => new Map(widgets.map((w) => [w.id, w.type])),
    [widgets]
  )
  const enrichedLayout = useMemo(
    () =>
      activeLayout.map((item) => {
        const type = widgetTypeById.get(item.i)
        const constraints = type ? TYPE_CONSTRAINTS[type] : undefined
        return constraints ? { ...item, constraints } : item
      }),
    [activeLayout, widgetTypeById]
  )

  // Layouts for breakpoints the user hasn't customized are derived on the fly
  // by buildResponsiveLayouts. We deliberately do NOT auto-persist that derivation —
  // doing so would freeze the generated layout, blocking later edits at lg from
  // propagating to md/sm. Only commitLayout (drag/resize) writes to the store.

  function commitLayout(layout: readonly LayoutItem[]) {
    updateLayout(breakpoint, [...layout] as LayoutItem[])
  }

  return (
    <div ref={containerRef as React.RefObject<HTMLDivElement>}>
      <GridLayout
        width={width}
        layout={enrichedLayout}
        dragConfig={{ handle: '.drag-handle' }}
        onDragStop={(currentLayout) => commitLayout(currentLayout)}
        onResizeStop={(currentLayout) => commitLayout(currentLayout)}
        compactor={noCompactor}
        gridConfig={{
          cols,
          rowHeight: 80,
          margin: [12, 12],
          containerPadding: [16, 16],
        }}
      >
        {widgets.map((widget) => (
          <div key={widget.id}>
            <WidgetShell
              type={widget.type}
              widgetId={widget.id}
              onRemove={() => removeWidget(widget.id)}
              showHeader={showWidgetHeaders}
            />
          </div>
        ))}
      </GridLayout>
    </div>
  )
}
