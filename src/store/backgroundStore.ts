import { create } from 'zustand'

const KEY = 'primoria-background'

// Read once at startup
function loadImage(): string | null {
  try { return localStorage.getItem(KEY) } catch { return null }
}

function saveImage(dataUrl: string | null) {
  try {
    if (dataUrl === null) {
      localStorage.removeItem(KEY)
    } else {
      localStorage.setItem(KEY, dataUrl)
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
    saveImage(dataUrl)
    set({ backgroundImage: dataUrl })
  },
}))
