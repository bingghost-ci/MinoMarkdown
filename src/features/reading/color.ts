/** Small sRGB helpers shared by the style data, the CSS generator and the contrast tests. */
export type Rgb = [number, number, number]

/** A plain `#rrggbb` color: the only form of a user's color that is stored or written into CSS. */
export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
}

export function parseHex(hex: string): Rgb {
  const value = hex.replace('#', '')
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value
  if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error(`Invalid color ${hex}`)
  return [0, 2, 4].map((offset) => parseInt(full.slice(offset, offset + 2), 16)) as Rgb
}

export function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((channel) => Math.round(Math.max(0, Math.min(255, channel))).toString(16).padStart(2, '0')).join('')}`
}

/** Linear blend in sRGB: `amount` 0 keeps `from`, 1 gives `to`. */
export function mix(from: string, to: string, amount: number): string {
  const a = parseHex(from), b = parseHex(to)
  return toHex([0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * amount) as Rgb)
}

export function toHsl(hex: string): [number, number, number] {
  const [r, g, b] = parseHex(hex).map((channel) => channel / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s, l]
}

/** `h` in degrees, `s` and `l` from 0 to 1. */
export function fromHsl(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x]
  return toHex([(r + m) * 255, (g + m) * 255, (b + m) * 255])
}

export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((channel) => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 2 contrast ratio. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * Moves a color's lightness, keeping its hue and saturation, until it stands out from `ground` by `least`:
 * lighter or darker in `steps` steps of `step`, never past `floor` and `ceiling`. A color that already has the
 * contrast is returned as it is; one that never reaches it becomes white or black.
 */
export function towardContrast(color: string, ground: string, least: number, { lighter, step, steps, floor = 0, ceiling = 1 }: { lighter: boolean; step: number; steps: number; floor?: number; ceiling?: number }): string {
  if (contrast(color, ground) >= least) return color
  const [hue, saturation, lightness] = toHsl(color)
  for (let count = 1; count <= steps; count++) {
    const next = fromHsl(hue, saturation, Math.max(floor, Math.min(ceiling, lightness + (lighter ? step : -step) * count)))
    if (contrast(next, ground) >= least) return next
  }
  return lighter ? '#ffffff' : '#000000'
}
