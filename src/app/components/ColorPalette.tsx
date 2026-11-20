import { isHexColor, parseHex, toHex } from '../../features/reading/color'

const channels = [['红', 'R'], ['绿', 'G'], ['蓝', 'B']] as const

/**
 * The palette one color is mixed in: its hex value, a slider for red, green and blue, and colors worth one click.
 * It holds no state. `onMix` is called for every step of a slider, so the owner shows the color at once and
 * saves it when the slider rests; `onCommit` saves a color now, and `null` puts the default back.
 */
export function ColorPalette({ label, color, canReset, quick, onMix, onCommit, t }: { label: string; color: string; canReset: boolean; quick: readonly string[]; onMix: (color: string) => void; onCommit: (color: string | null) => void; t: (text: string) => string }) {
  const rgb = parseHex(color)
  return <div className="code-palette" role="group" aria-label={`${t('调色板')}: ${label}`}>
    <div className="code-palette-head">
      <i style={{ background: color }} />
      <strong>{label}</strong>
      <input key={color} type="text" aria-label={t('色值')} defaultValue={color} maxLength={7} spellCheck={false}
        onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
        onBlur={(event) => { const value = event.target.value.trim(); if (isHexColor(value)) { if (value.toLowerCase() !== color) onCommit(value) } else event.target.value = color }} />
      <button type="button" disabled={!canReset} onClick={() => onCommit(null)}>{t('恢复默认')}</button>
    </div>
    {channels.map(([name, letter], index) => {
      const at = (value: number) => toHex(rgb.map((channel, i) => (i === index ? value : channel)) as [number, number, number])
      return <label key={letter} className="code-palette-channel">
        <span title={t(name)}>{letter}</span>
        <input type="range" min={0} max={255} step={1} aria-label={t(name)} value={rgb[index]} style={{ background: `linear-gradient(to right, ${at(0)}, ${at(255)})` }} onChange={(event) => onMix(at(Number(event.target.value)))} />
        <output>{rgb[index]}</output>
      </label>
    })}
    <div className="code-palette-quick" role="group" aria-label={t('常用颜色')}>
      {quick.map((value) => <button key={value} type="button" title={value} aria-label={value} aria-pressed={value === color} style={{ background: value }} onClick={() => onCommit(value)} />)}
    </div>
  </div>
}
