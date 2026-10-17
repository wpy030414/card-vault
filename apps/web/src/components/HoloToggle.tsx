interface HoloToggleProps {
  checked: boolean
  onChange: (value: boolean) => void
}

/** 镀层开关：只有开启的卡片才会在端详时浮现镭射彩光 */
export function HoloToggle({ checked, onChange }: HoloToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label="镀层"
      className="holo-toggle"
      onClick={() => onChange(!checked)}
    >
      <span className="holo-toggle-copy">
        <strong>镀层</strong>
        <em>开启后卡面会浮现镭射彩光</em>
      </span>
      <span className="holo-toggle-track" aria-hidden="true" />
    </button>
  )
}
