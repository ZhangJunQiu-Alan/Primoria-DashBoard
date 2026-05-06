export function formatMMSS(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec))
  const mm = Math.floor(s / 60).toString().padStart(2, '0')
  const ss = (s % 60).toString().padStart(2, '0')
  return `${mm}:${ss}`
}

export function formatHHMMSS(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec))
  const hh = Math.floor(s / 3600).toString().padStart(2, '0')
  const mm = Math.floor((s % 3600) / 60).toString().padStart(2, '0')
  const ss = (s % 60).toString().padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

export function formatMinutesShort(totalSec: number): string {
  const m = Math.round(totalSec / 60)
  return `${m} 分钟`
}
