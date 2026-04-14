import { useEffect } from 'react'
import { WIDGET_DATA_STORAGE_KEY, useWidgetDataStore } from '@/store/widgetDataStore'

export function useWidgetDataStoreSync() {
  useEffect(() => {
    function rehydrateStore() {
      void useWidgetDataStore.persist.rehydrate()
    }

    function handleStorage(event: StorageEvent) {
      if (event.storageArea !== window.localStorage) return
      if (event.key !== WIDGET_DATA_STORAGE_KEY) return
      rehydrateStore()
    }

    function handleVisibilityChange() {
      if (document.visibilityState !== 'visible') return
      rehydrateStore()
    }

    window.addEventListener('storage', handleStorage)
    window.addEventListener('focus', rehydrateStore)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener('focus', rehydrateStore)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])
}
