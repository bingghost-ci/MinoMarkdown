import stylesheet from 'katex/dist/katex.min.css?raw'

const fonts = import.meta.glob<string>('/node_modules/katex/dist/fonts/*.woff2', { query: '?inline', import: 'default', eager: true })
const fontsByName = new Map(Object.entries(fonts).map(([path, data]) => [path.split('/').pop()!, data]))

function embeddedStylesheet(): string {
  return stylesheet.replace(/src:[^;}]*url\(fonts\/([^)]+\.woff2)\)[^;}]*/g, (_match, name: string) => `src:url(${fontsByName.get(name) ?? ''}) format("woff2")`)
}

/** Formula pages stay self-contained, and only they pay for KaTeX's styles and fonts. */
export function embedMathStyles(html: string): string {
  const css = embeddedStylesheet()
  return html.replace("font-src 'none'", 'font-src data:').replace('</style>', () => `${css}</style>`)
}
