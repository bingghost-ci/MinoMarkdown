import { appStylesheet } from './css'
import { bundledFaces, fontFaceCss } from './fonts'

/** Adds the generated style and font rules once; switching styles only changes `data-theme`. */
export function installReadingStyles(target: Document = document): void {
  if (target.getElementById('mino-reading-styles')) return
  const element = target.createElement('style')
  element.id = 'mino-reading-styles'
  element.textContent = `${fontFaceCss(bundledFaces)}\n${appStylesheet()}`
  target.head.prepend(element)
}
