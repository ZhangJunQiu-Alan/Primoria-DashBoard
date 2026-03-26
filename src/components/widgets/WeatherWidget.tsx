import { Cloud, Droplets, Wind } from 'lucide-react'

// Placeholder — wire up a real weather API (e.g. Open-Meteo) later
export function WeatherWidget() {
  return (
    <div className="flex flex-col h-full p-1 gap-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-white/40 text-xs">Current Location</p>
          <p className="text-white font-medium">-- / --</p>
        </div>
        <Cloud className="text-white/30" size={40} strokeWidth={1} />
      </div>

      <div className="text-5xl font-light text-white">--°</div>

      <p className="text-white/40 text-sm">Weather data not configured</p>

      <div className="flex gap-4 mt-auto text-white/40 text-xs">
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
