import { appStylesheet } from './css'

/** Adds the generated style rules once; switching styles only changes `data-theme`. The fonts come from `bundledFonts.css`. */
export function installReadingStyles(target: Document = document): void {
  if (target.getElementById('mino-reading-styles')) return
  const element = target.createElement('style')
  element.id = 'mino-reading-styles'
  element.textContent = appStylesheet()
  target.head.prepend(element)
}
