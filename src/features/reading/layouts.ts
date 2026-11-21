import { KAI_EMPHASIS_STACK, MONO_FAMILY, SANS_FAMILY } from './fonts'

/**
 * Layouts (T122): how headings, quotes, rules and paragraphs are set, chosen apart from the paper, so any of them
 * goes with any reading style. A layout changes CSS only; the document is never touched. `settings.rs` lists the
 * same IDs. Numbering is drawn by CSS counters and leaves headings inside quotes and alerts alone.
 */
export const layoutIds = ['standard', 'academic', 'official', 'technical', 'typewriter'] as const
export type LayoutId = (typeof layoutIds)[number]

export const layouts: readonly { id: LayoutId; name: string; note: string }[] = [
  { id: 'standard', name: '标准', note: '现在的样子：标题用强调色，引用一条竖线' },
  { id: 'academic', name: '学术', note: '居中的题目，“1  1.1” 节号，段首缩进，引用缩进成小字' },
  { id: 'official', name: '公文', note: '参照 GB/T 9704：标题居中，“一、（一）1.（1）”层次，黑体、楷体分级，段首缩进两字' },
  { id: 'technical', name: '技术', note: '“1.  1.1  1.1.1” 编号，二级标题下有细线，代码块带边框，更紧凑' },
  { id: 'typewriter', name: '打字机', note: '等宽字，标题前的 # 挂在页边，虚线分隔，像一页纯文本' },
]

export function isLayout(value: unknown): value is LayoutId {
  return typeof value === 'string' && (layoutIds as readonly string[]).includes(value)
}

/** The font a layout sets the text in, before the reader's own; only the typewriter has one. */
export function layoutFontPrefix(layout: LayoutId | undefined): string {
  return layout === 'typewriter' ? `'${MONO_FAMILY}', ` : ''
}

/**
 * The page margins a layout prescribes, replacing the reader's choice (T136): GB/T 9704 sets an official document
 * 37 mm from the top, 35 from the bottom, 28 from the binding edge and 26 from the other.
 */
export function layoutPageMargin(layout: LayoutId | undefined): string | null {
  return layout === 'official' ? '37mm 26mm 35mm 28mm' : null
}

const HEI = `'${SANS_FAMILY}', 'PingFang SC', 'Heiti SC', sans-serif`
const KAI = `${KAI_EMPHASIS_STACK}, serif`

/** Headings in quotes and alerts are not part of the outline, so they neither count nor show a number. */
function numbered(r: string, levels: readonly string[]): string {
  const rules = [`${r}{counter-reset:${levels.map((_, index) => `mino-h${index + 2}`).join(' ')}}`]
  levels.forEach((content, index) => {
    const level = index + 2
    const below = levels.slice(index + 1).map((_, offset) => `mino-h${level + offset + 1}`).join(' ')
    rules.push(`${r} > h${level}{counter-increment:mino-h${level};${below ? `counter-reset:${below}` : ''}}`)
    rules.push(`${r} > h${level}::before{content:${content};font-weight:inherit;color:var(--layout-number,inherit)}`)
  })
  return rules.join('')
}

/** The rules of one layout for one document root; `standard` has none. */
export function layoutRules(layout: LayoutId, root: string): string {
  const r = root
  switch (layout) {
    case 'standard': return ''
    case 'academic': return [
      `${r} > h1{text-align:center;font-size:1.75em;margin:.4em 0 1.2em;letter-spacing:.04em}`,
      `${r} > h2{font-size:1.32em;margin:1.8em 0 .7em}${r} > h3{font-size:1.12em;margin:1.4em 0 .5em}${r} > h4{font-size:1em}`,
      numbered(r, ['counter(mino-h2) "\\2003"', 'counter(mino-h2) "." counter(mino-h3) "\\2003"', 'counter(mino-h2) "." counter(mino-h3) "." counter(mino-h4) "\\2003"']),
      `${r} > p{text-indent:2em}`,
      // Western papers leave the paragraph after a heading or a rule flush; Chinese ones indent every paragraph.
      `${r} > :is(h1,h2,h3,h4,h5,h6,hr) + p:lang(en){text-indent:0}`,
      `${r} blockquote:not(.mino-alert){border-left:0;padding:0 2em;font-size:.94em;color:var(--secondary)}`,
      `${r} blockquote:not(.mino-alert)::before{content:none}`,
      // LaTeX's labels by depth: a dash and an asterisk under the bullet, (a) and i. under the number.
      `@counter-style mino-paren-alpha{system:extends lower-alpha;prefix:"(";suffix:") "}`,
      `${r} ul ul > li::marker{content:"\\2013\\2002"}${r} ul ul ul > li::marker{content:"\\2217\\2002"}${r} ol ol{list-style-type:mino-paren-alpha}${r} ol ol ol{list-style-type:lower-roman}`,
      `${r} hr{border:0;height:1.4em;margin:1.6em 0;text-align:center;overflow:visible}${r} hr::before{content:"*\\2003*\\2003*";display:block;color:var(--secondary);line-height:1.4em}`,
    ].join('\n')
    case 'official': return [
      `${r}{--layout-number:inherit}`,
      `${r} > h1{text-align:center;font-size:1.375em;font-weight:700;color:var(--text);margin:.3em 0 .4em;padding-bottom:.55em;border-bottom:2px solid var(--alert-caution);letter-spacing:.06em}`,
      `${r} > h1 + *{margin-top:1.3em}`,
      `${r} > h2,${r} > h3,${r} > h4,${r} > h5{font-size:1em;font-weight:400;color:var(--text);text-indent:2em;margin:.6em 0 .3em}`,
      `${r} > h2{font-family:${HEI}}${r} > h3{font-family:${KAI}}${r} > h4{font-weight:700}`,
      numbered(r, ['counter(mino-h2, cjk-ideographic) "、"', '"（" counter(mino-h3, cjk-ideographic) "）"', 'counter(mino-h4) "."', '"（" counter(mino-h5) "）"']),
      `${r} > p{text-indent:2em}`,
      `${r} em{font-style:normal;font-family:${KAI}}`,
      `${r} hr{border-top:2px solid var(--alert-caution)}`,
      `${r} blockquote:not(.mino-alert){border-left:0;padding:0 0 0 2em;color:var(--text)}${r} blockquote:not(.mino-alert)::before{content:none}`,
    ].join('\n')
    case 'technical': return [
      `${r} > h1{font-size:1.75em;margin:.2em 0 .8em;padding-bottom:.35em;border-bottom:2px solid var(--rule)}`,
      `${r} > h2{font-size:1.38em;margin:1.5em 0 .55em;padding-bottom:.25em;border-bottom:1px solid var(--rule)}`,
      `${r} > h3{font-size:1.15em;margin:1.2em 0 .45em}${r} > h4{font-size:1em;margin:1em 0 .35em}`,
      `${r}{--layout-number:var(--secondary)}`,
      numbered(r, ['counter(mino-h2) ".\\2002"', 'counter(mino-h2) "." counter(mino-h3) "\\2002"', 'counter(mino-h2) "." counter(mino-h3) "." counter(mino-h4) "\\2002"']),
      `${r} pre{border:1px solid var(--rule);border-radius:6px}`,
      `${r} blockquote:not(.mino-alert){border-left-width:4px;padding:.35em 1em;background:color-mix(in srgb,var(--quote-line) 8%,transparent);border-radius:0 6px 6px 0}${r} blockquote:not(.mino-alert)::before{content:none}`,
    ].join('\n')
    case 'typewriter': return [
      `${r} h1,${r} h2,${r} h3,${r} h4,${r} h5,${r} h6{position:relative;font-size:1em;font-weight:700;letter-spacing:0;color:var(--title)}`,
      `${r} h1{font-size:1.25em;margin:.2em 0 1em}`,
      // The marks hang in the margin, outside the text column, so the heading text lines up with the paragraphs.
      ...[1, 2, 3, 4, 5, 6].map((level) => `${r} > h${level}::before{content:"${'#'.repeat(level)} ";position:absolute;right:100%;white-space:pre;color:var(--muted);font-weight:400}`),
      `${r} em{font-style:normal;text-decoration:underline 1px;text-underline-offset:3px}`,
      `${r} hr{border:0;height:1px;background:repeating-linear-gradient(90deg,var(--secondary) 0 .6ch,transparent .6ch 1.2ch)}`,
      `${r} blockquote:not(.mino-alert){border-left:0;padding:.4em 0 .4em 1.2em;outline:1px dashed var(--quote-line);outline-offset:.4em;color:var(--secondary)}${r} blockquote:not(.mino-alert)::before{content:none}`,
      `${r} ul > li::marker{content:"* "}${r} ul.contains-task-list > li::marker{content:none}`,
      `${r} pre{border-radius:0;border-left:2px solid var(--rule)}`,
    ].join('\n')
  }
}
