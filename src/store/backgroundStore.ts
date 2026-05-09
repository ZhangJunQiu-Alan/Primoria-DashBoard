import { create } from 'zustand'
import { trackBehaviorEvent } from '@/lib/behaviorEvents'

export const BACKGROUND_STORAGE_KEY = 'primoria-background'

// Read once at startup
function loadImage(): string | null {
  try { return localStorage.getItem(BACKGROUND_STORAGE_KEY) } catch { return null }
}

function saveImage(dataUrl: string | null) {
  try {
    if (dataUrl === null) {
      localStorage.removeItem(BACKGROUND_STORAGE_KEY)
    } else {
      localStorage.setItem(BACKGROUND_STORAGE_KEY, dataUrl)
    }
  } catch (e) {
    // QuotaExceededError — image too large, silently ignore
    console.warn('Background image too large to store:', e)
  }
}

interface BackgroundState {
  backgroundImage: string | null
  setBackgroundImage: (dataUrl: string | null) => void
}

export const useBackgroundStore = create<BackgroundState>()((set) => ({
  backgroundImage: loadImage(),
  setBackgroundImage: (dataUrl) => {
    const hadBackground = Boolean(loadImage())
    saveImage(dataUrl)
    set({ backgroundImage: dataUrl })
    trackBehaviorEvent({
      eventName: 'dashboard.background_changed',
      metadata: {
        hasBackground: Boolean(dataUrl),
        previousHadBackground: hadBackground,
        size: dataUrl?.length ?? 0,
      },
      objectType: 'background',
      summary: dataUrl ? '设置壁纸' : '移除壁纸',
      surface: 'dashboard',
    })
  },
}))
