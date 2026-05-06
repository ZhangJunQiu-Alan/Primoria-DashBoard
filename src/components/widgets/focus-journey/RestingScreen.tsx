// RESTING state — use the all-in-one resting page artwork as a static
// full-bleed background. No overlay character or campfire (already painted in).

import { ImmersiveScene } from './FocusingScreen'
import { formatMMSS } from './format'

interface Props {
  focusRemainingSec: number
  restRemainingSec: number
  onTapBackground: () => void
  onLongPressEnd: () => void
}

export function RestingScreen({
  focusRemainingSec,
  restRemainingSec,
  onTapBackground,
  onLongPressEnd,
}: Props) {
  return (
    <ImmersiveScene
      bgUrl="/assets/focus-journey/resting-page.jpg"
      showCharacter={false}
      countdown={formatMMSS(focusRemainingSec)}
      blinkCountdown
      secondLine={formatMMSS(restRemainingSec)}
      onTapBackground={onTapBackground}
      onLongPressEnd={onLongPressEnd}
    />
  )
}
