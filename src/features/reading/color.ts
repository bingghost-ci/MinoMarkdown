/** Small sRGB helpers shared by the style data, the CSS generator and the contrast tests. */
export type Rgb = [number, number, number]

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
