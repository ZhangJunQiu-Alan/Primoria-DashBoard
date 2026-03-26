import { Cloud, Droplets, Wind } from 'lucide-react'

export function WeatherWidget() {
  return (
    <div className="flex flex-col h-full gap-3 p-1">
      <div className="flex items-center justify-between">
        <div>
          <p style={{ fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '0.04em' }}>
            Current Location
          </p>
          <p style={{ color: 'var(--text-sub)', fontWeight: 500 }}>-- / --</p>
        </div>
        <Cloud style={{ color: 'var(--primary-light)' }} size={36} strokeWidth={1.2} />
      </div>

      <div
        style={{
          fontFamily: "'Cormorant Garamond', serif",
          fontSize: '52px',
          fontWeight: 400,
          color: 'var(--text)',
          lineHeight: 1,
        }}
      >
        --°
      </div>

      <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Weather data not configured</p>

      <div className="flex gap-4 mt-auto" style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
        <span className="flex items-center gap-1">
          <Droplets size={12} /> --%
        </span>
        <span className="flex items-center gap-1">
          <Wind size={12} /> -- km/h
        </span>
      </div>
    </div>
  )
}
