export async function printHtml(html: string): Promise<'dialogOpened'> {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.setAttribute('sandbox', 'allow-same-origin allow-modals')
  iframe.style.position = 'absolute'
  iframe.style.left = '-10000px'
  iframe.style.top = '0'
  iframe.style.width = '1000px'
  iframe.style.height = '1000px'
  iframe.style.pointerEvents = 'none'
  document.body.append(iframe)
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('打印页面加载超时')), 20_000)
      iframe.onload = () => { window.clearTimeout(timer); resolve() }
      iframe.onerror = () => { window.clearTimeout(timer); reject(new Error('打印页面加载失败')) }
      iframe.srcdoc = html
    })
    const page = iframe.contentDocument
    const printer = iframe.contentWindow
    if (!page || !printer) throw new Error('无法访问打印页面')
    await page.fonts.ready
    await Promise.all(Array.from(page.images, async (image) => {
      if (typeof image.decode === 'function') await image.decode()
      else if (!image.complete || image.naturalWidth === 0) throw new Error('打印图片未就绪')
    }))
    printer.focus()
    printer.print()
    return 'dialogOpened'
  } finally {
    window.setTimeout(() => iframe.remove(), 120_000)
  }
}
