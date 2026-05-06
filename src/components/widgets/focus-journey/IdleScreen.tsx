// IDLE state — quote, mountain illustration, pulsing focus button.

interface Props {
  quote: string
  onOpenSetup: () => void
}

export function IdleScreen({ quote, onOpenSetup }: Props) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-between py-[8%] px-[8%]">
      <p
        className="text-center"
        style={{
          fontFamily: "'Cormorant Garamond', serif",
          fontSize: 'clamp(11px, 3.2cqw, 16px)',
          lineHeight: 1.5,
          color: '#A8C0D8',
          fontStyle: 'italic',
        }}
      >
        “{quote}”
      </p>

      <img
        src="/assets/focus-journey/mountain-hero.png"
        alt=""
        draggable={false}
        style={{
          width: '100%',
          maxWidth: 404,
          height: 'auto',
          objectFit: 'contain',
          pointerEvents: 'none',
        }}
      />

      <button
        type="button"
        onClick={onOpenSetup}
        className="fj-pulse-btn"
        style={{
          width: 'clamp(72px, 24cqw, 110px)',
          aspectRatio: '1',
          fontSize: 'clamp(14px, 4.5cqw, 22px)',
        }}
      >
        专注
      </button>
    </div>
  )
}
