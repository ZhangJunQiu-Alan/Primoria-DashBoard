export const FOCUS_END_SOUND_SRC = '/assets/focus-journey/focus-end.mp3'

let cachedAudio: HTMLAudioElement | null = null
let primed = false

function getFocusEndAudio() {
  if (typeof Audio === 'undefined') return null
  if (!cachedAudio) {
    cachedAudio = new Audio(FOCUS_END_SOUND_SRC)
    cachedAudio.preload = 'auto'
  }
  return cachedAudio
}

export function primeFocusEndSound() {
  if (primed) return
  try {
    const audio = getFocusEndAudio()
    if (!audio) return

    audio.muted = true
    audio.currentTime = 0
    void audio
      .play()
      .then(() => {
        audio.pause()
        audio.currentTime = 0
        audio.muted = false
        primed = true
      })
      .catch(() => {
        audio.muted = false
      })
  } catch {
    // Browser audio unlock is best-effort.
  }
}

export function playFocusEndSound() {
  try {
    const audio = getFocusEndAudio()
    if (!audio) return

    audio.muted = false
    audio.currentTime = 0
    void audio.play().catch(() => {})
  } catch {
    // Sound is best-effort; system notification still runs when allowed.
  }
}
