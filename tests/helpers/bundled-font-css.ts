import { vi } from 'vitest'

/**
 * Vitest empties CSS files that `test.css.include` in vite.config.ts does not list, even when they are
 * imported with `?raw`, and that list names Noto Serif SC only. fonts.ts reads its faces out of these
 * stylesheets, so a test that needs every bundled family imports this file first. It can go once the
 * config lists them.
 */
const rawCss = vi.hoisted(() => async (path: string) => ({ default: (await import('node:fs')).readFileSync(`node_modules/${path}`, 'utf8') }))
vi.mock('/node_modules/@fontsource/noto-sans-sc/400.css?raw', () => rawCss('@fontsource/noto-sans-sc/400.css'))
vi.mock('/node_modules/@fontsource/noto-sans-sc/700.css?raw', () => rawCss('@fontsource/noto-sans-sc/700.css'))
vi.mock('/node_modules/@fontsource-variable/source-serif-4/wght.css?raw', () => rawCss('@fontsource-variable/source-serif-4/wght.css'))
vi.mock('/node_modules/@fontsource-variable/source-serif-4/wght-italic.css?raw', () => rawCss('@fontsource-variable/source-serif-4/wght-italic.css'))
vi.mock('/node_modules/@fontsource-variable/literata/wght.css?raw', () => rawCss('@fontsource-variable/literata/wght.css'))
vi.mock('/node_modules/@fontsource-variable/literata/wght-italic.css?raw', () => rawCss('@fontsource-variable/literata/wght-italic.css'))
vi.mock('/node_modules/@fontsource-variable/eb-garamond/wght.css?raw', () => rawCss('@fontsource-variable/eb-garamond/wght.css'))
vi.mock('/node_modules/@fontsource-variable/eb-garamond/wght-italic.css?raw', () => rawCss('@fontsource-variable/eb-garamond/wght-italic.css'))
vi.mock('/node_modules/@fontsource-variable/inter/wght.css?raw', () => rawCss('@fontsource-variable/inter/wght.css'))
vi.mock('/node_modules/@fontsource-variable/inter/wght-italic.css?raw', () => rawCss('@fontsource-variable/inter/wght-italic.css'))
vi.mock('/node_modules/@fontsource-variable/jetbrains-mono/wght.css?raw', () => rawCss('@fontsource-variable/jetbrains-mono/wght.css'))
vi.mock('/node_modules/@fontsource-variable/jetbrains-mono/wght-italic.css?raw', () => rawCss('@fontsource-variable/jetbrains-mono/wght-italic.css'))
