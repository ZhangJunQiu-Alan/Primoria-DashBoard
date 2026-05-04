import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'primoria-ui-visible'

function read(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return true
    return raw !== '0'
  } catch {
    return true
  }
}

export function useUiVisible(): [boolean, (next: boolean | ((prev: boolean) => boolean)) => void] {
  const [visible, setVisible] = useState<boolean>(read)

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, visible ? '1' : '0') } catch { /* quota / private mode */ }
  }, [visible])

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== STORAGE_KEY || e.newValue === null) return
      setVisible(e.newValue !== '0')
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const setter = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      setVisible((prev) => (typeof next === 'function' ? next(prev) : next))
    },
    []
  )

  return [visible, setter]
}
