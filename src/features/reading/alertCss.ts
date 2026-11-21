import { alertTitles, alertTypes, type AlertType } from '../../core/markdown/alerts'
import { towardContrast } from './color'
import type { ReadingStyle } from './styles'

/**
 * The colors and drawing of alert blocks (T121). Each type has one ink, fitted to the paper so its title reads
 * at 4.5:1 at least; the wash and the edge are that ink mixed into the paper by CSS, so a style needs no table of
 * its own. Day inks are deep and quiet, night inks light and soft, after GitHub's five meanings.
 */
const inks: Record<AlertType, { day: string; night: string }> = {
  note: { day: '#3b6fa3', night: '#8ab4f8' },
  tip: { day: '#3f7566', night: '#7fc4ad' },
  important: { day: '#5f5a9c', night: '#b3aee6' },
  warning: { day: '#8a5d00', night: '#e3c07b' },
  caution: { day: '#a63d4a', night: '#e58a96' },
}

export function alertVariables(style: ReadingStyle): Record<string, string> {
  const variables: Record<string, string> = {}
  for (const type of alertTypes) {
    const ink = style.dark ? inks[type].night : inks[type].day
    variables[`--alert-${type}`] = towardContrast(ink, style.paper, 4.5, { lighter: style.dark, step: 0.03, steps: 20 })
  }
  // Night papers need a little more of the ink to show the card at all.
  variables['--alert-wash'] = style.dark ? '11%' : '7%'
  return variables
}

// Lucide's info, lightbulb, message-square-warning, triangle-alert and octagon-alert (ISC), drawn as masks so they
// take the alert's ink; inline data, so neither the app nor an exported page loads anything.
const iconPaths: Record<AlertType, string> = {
  note: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  tip: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5M9 18h6M10 22h4"/>',
  important: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2zM12 7v2M12 13h.01"/>',
  warning: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3M12 9v4M12 17h.01"/>',
  caution: '<path d="M7.86 2h8.28L22 7.86v8.28L16.14 22H7.86L2 16.14V7.86zM12 8v4M12 16h.01"/>',
}

function icon(type: AlertType): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconPaths[type]}</svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

/**
 * Rules for one document root. The preview and exports carry `<div class="mino-alert">` with an empty title
 * paragraph; the editor keeps the block quote and its `[!TYPE]` text, which shows as the title until the caret
 * reaches it (`alerts.ts` in the editor).
 */
export function alertCss(root: string): string {
  const r = root
  const card = `${r} .mino-alert`
  // The label: an icon in the ink, then the title by the document's language.
  const label = 'display:inline-flex;align-items:center;gap:.45em;font-size:.84em;font-weight:700;letter-spacing:.04em;color:var(--alert);line-height:1.6'
  const glyph = 'content:"";display:inline-block;width:1.15em;height:1.15em;flex:none;background:var(--alert);-webkit-mask:var(--alert-icon) center/contain no-repeat;mask:var(--alert-icon) center/contain no-repeat'
  return [
    `${card}{--alert:var(--alert-note);position:relative;margin:1.2em 0;padding:.75em 1.1em .8em 1.15em;border:1px solid color-mix(in srgb,var(--alert) 26%,transparent);border-left:3px solid var(--alert);border-radius:4px 10px 10px 4px;background:color-mix(in srgb,var(--alert) var(--alert-wash,7%),transparent);color:var(--text);break-inside:avoid;-webkit-print-color-adjust:exact;print-color-adjust:exact}`,
    `${card} p{text-indent:0}${card} > :last-child{margin-bottom:0}`,
    ...alertTypes.map((type) => `${r} .mino-alert-${type}{--alert:var(--alert-${type});--alert-icon:${icon(type)}}`),
    `${card} .mino-alert-title{${label};margin:0 0 .3em}`,
    `${card} .mino-alert-title::before{${glyph}}`,
    ...alertTypes.map((type) => `${r} .mino-alert-${type} .mino-alert-title::after{content:"${alertTitles[type].zh}"}${r} .mino-alert-${type} .mino-alert-title:lang(en)::after{content:"${alertTitles[type].en}"}`),
    // The editor: the marker's own text is set to nothing and the label is drawn in its place.
    `${card} .mino-alert-marker:not(.is-editing){font-size:0;letter-spacing:0}`,
    `${card} .mino-alert-marker:not(.is-editing)::before{${glyph};font-size:var(--doc-size);vertical-align:-.2em;margin-right:.45em}`,
    `${card} .mino-alert-marker:not(.is-editing)::after{font-size:calc(var(--doc-size) * .84);font-weight:700;letter-spacing:.04em;color:var(--alert)}`,
    ...alertTypes.map((type) => `${r} .mino-alert-${type} .mino-alert-marker:not(.is-editing)::after{content:"${alertTitles[type].zh}"}${r} .mino-alert-${type} .mino-alert-marker:not(.is-editing):lang(en)::after{content:"${alertTitles[type].en}"}`),
    `${card} .mino-alert-marker.is-editing{color:var(--alert);font:.88em var(--code-font)}`,
  ].join('\n')
}
