import { GridLayout, useContainerWidth, useResponsiveLayout, noCompactor } from 'react-grid-layout'
import { useDashboardStore } from '@/store/dashboardStore'
import { WidgetShell } from './WidgetShell'
import type { LayoutItem } from '@/types/widget'

const BREAKPOINTS = { lg: 1200, md: 996, sm: 768 }
const COLS = { lg: 12, md: 10, sm: 6 }

interface DashboardProps {
  showWidgetHeaders: boolean
}

export function Dashboard({ showWidgetHeaders }: DashboardProps) {
  const widgets = useDashboardStore((s) => s.widgets)
  const layout = useDashboardStore((s) => s.layout)
  const removeWidget = useDashboardStore((s) => s.removeWidget)
  const updateLayout = useDashboardStore((s) => s.updateLayout)

  const { width, containerRef } = useContainerWidth({ initialWidth: 1200 })

  const layouts = { lg: layout, md: layout, sm: layout }

  const { layout: activeLayout, cols } = useResponsiveLayout({
    width,
    breakpoints: BREAKPOINTS,
    cols: COLS,
    layouts,
    onLayoutChange: (currentLayout) => updateLayout([...currentLayout] as LayoutItem[]),
  })

  return (
    <div ref={containerRef as React.RefObject<HTMLDivElement>}>
      <GridLayout
        width={width}
        layout={activeLayout}
        dragConfig={{ handle: '.drag-handle' }}
        onLayoutChange={(currentLayout) => updateLayout([...currentLayout] as LayoutItem[])}
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
