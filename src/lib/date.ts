export function formatLocalDateKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function parseLocalDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function addDaysToDateKey(base: string | Date, amount: number) {
  const next = typeof base === 'string' ? parseLocalDateKey(base) : new Date(base)
  next.setDate(next.getDate() + amount)
  return formatLocalDateKey(next)
}

export function msUntilNextLocalDay(from = new Date()) {
  const next = new Date(from)
  next.setHours(24, 0, 0, 0)
  return Math.max(1, next.getTime() - from.getTime())
}
