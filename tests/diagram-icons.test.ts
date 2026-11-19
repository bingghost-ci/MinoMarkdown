// @vitest-environment jsdom
import rough from 'roughjs'
import { describe, expect, it } from 'vitest'
import { centerRemarkLabels, iconBody, loadIconPack, mayHoldIconTokens, placeLabelIcons, remarkIds, remarkNodes, withIconPlaces } from '../src/features/diagrams/icons'
import { sketchDiagram, type SketchPalette } from '../src/features/diagrams/sketch'

const palette: SketchPalette = { fills: ['#ff8fb0', '#7fd6c0'], frames: ['#2f8f5f', '#8a2a3a', '#2a4f8a'], plain: '#dbe8ff', paper: '#ffffff' }
const mount = (inner: string) => { document.body.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">${inner}</svg>`; return document.body.querySelector('svg')! }

describe('icons in diagram labels (T116)', () => {
  it('ships the Lucide set with the app and follows its aliases', async () => {
    const icons = await loadIconPack()
    expect(icons.prefix).toBe('lucide')
    expect(Object.keys(icons.icons).length).toBeGreaterThan(1500)
    expect(iconBody(icons, 'database')).toContain('<ellipse')
    const [alias, target] = Object.entries(icons.aliases ?? {})[0]
    expect(iconBody(icons, alias)).toBe(icons.icons[target.parent].body)
    for (const missing of ['no-such-icon', 'constructor', 'toString', '__proto__']) expect(iconBody(icons, missing)).toBeNull()
    // The set draws with strokes only: nothing in it can load a file or run.
    expect(JSON.stringify(icons.icons)).not.toMatch(/<script|href|url\(|<image|<foreignObject|on[a-z]+=/i)
  })

  it('swaps only the names of real icons for one-character places', async () => {
    const icons = await loadIconPack()
    const source = 'flowchart TD\n  A[:database: 保存] --> B[:egg: 加鸡蛋 :database:]\n  B:::warm --> C[10:30:00 :not-an-icon: :X:]\n  用户->>编辑器: 输入'
    expect(mayHoldIconTokens(source)).toBe(true)
    expect(mayHoldIconTokens('graph TD\n A-->B\n A:::warm')).toBe(false)
    const placed = withIconPlaces(source, icons)
    expect(placed.names).toEqual(['database', 'egg', 'database'])
    expect(placed.source).toBe('flowchart TD\n  A[ 保存] --> B[ 加鸡蛋 ]\n  B:::warm --> C[10:30:00 :not-an-icon: :X:]\n  用户->>编辑器: 输入')
    expect(withIconPlaces('A[plain]', icons)).toEqual({ source: 'A[plain]', names: [] })
  })

  it('draws each icon over its place in the label\'s color and hides the place', async () => {
    const icons = await loadIconPack()
    const svg = mount('<g class="node"><g class="label"><text style="fill:#223344"><tspan> 保存</tspan></text></g></g>')
    const ranges = Range.prototype as unknown as { getBoundingClientRect?: (this: Range) => unknown }
    ranges.getBoundingClientRect = function () { return { left: 10 + this.startOffset * 20, top: 4, right: 26 + this.startOffset * 20, bottom: 24, width: 16, height: 20 } }
    ;(SVGElement.prototype as unknown as { getScreenCTM: () => unknown }).getScreenCTM = () => ({ inverse: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) })
    expect(placeLabelIcons(svg, ['database', 'egg'], icons)).toBe(2)
    const groups = Array.from(svg.querySelectorAll('g.mino-label-icon'))
    expect(groups).toHaveLength(2)
    expect(groups.map((group) => group.parentElement?.getAttribute('class'))).toEqual(['label', 'label'])
    // 16 wide and 20 high leaves a 20 px icon, centered on the place.
    expect(groups.some((group) => group.getAttribute('transform') === 'translate(8.00 4.00) scale(0.8333)')).toBe(true)
    for (const shape of Array.from(svg.querySelectorAll('g.mino-label-icon ellipse, g.mino-label-icon path'))) expect(shape.getAttribute('style')).toContain('fill:none;stroke:#223344;stroke-width:2px')
    expect(svg.innerHTML).not.toContain('currentColor')
    const hidden = Array.from(svg.querySelectorAll('tspan[style="visibility:hidden"]'))
    expect(hidden.map((tspan) => tspan.textContent)).toEqual(['', ''])
    expect(svg.querySelector('text')!.textContent).toBe(' 保存')
    delete (SVGElement.prototype as unknown as { getScreenCTM?: unknown }).getScreenCTM
    delete ranges.getBoundingClientRect
  })

  it('hides a place it cannot measure rather than showing a stray character', async () => {
    const svg = mount('<text><tspan>x</tspan></text>')
    expect(placeLabelIcons(svg, ['database'], await loadIconPack())).toBe(0)
    expect(svg.querySelector('tspan[style="visibility:hidden"]')?.textContent).toBe('')
  })
})

describe('remarks beside a diagram (T116)', () => {
  const source = 'flowchart TD\n  A[步骤] --> B\n  tip@{ shape: cloud, label: "小技巧" }\n  tip -.-> A\n  n1@{ shape: text, label: "耐心" }\n  备注@{shape: "bang", label: "现做现吃"}\n  db@{ icon: "lucide:database", shape: rect }\n  C@{ shape: diam }'
  const drawn = () => mount('<defs><marker id="m_flowchart-v2-pointEnd" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="8" markerHeight="8"><path d="M 0 0 L 10 5 L 0 10 z" style="fill:#333333"/></marker></defs>'
    + '<path id="L_tip_A_0" d="M0 0 L50 80" marker-end="url(#m_flowchart-v2-pointEnd)" style="fill:none;stroke:#333333;stroke-dasharray:3 3"/>'
    + '<path id="L_A_B_0" d="M0 0 L90 80" marker-end="url(#m_flowchart-v2-pointEnd)" style="fill:none;stroke:#333333"/>'
    + '<g class="node" id="d-flowchart-A-0" transform="translate(5,5)"><rect x="0" y="0" width="120" height="50" style="fill:#dbe8ff;stroke:#333333"/></g>'
    + '<g class="node" id="d-flowchart-tip-2" transform="translate(40,9)"><path class="basic label-container" d="M0 0 L100 0 L100 60 L0 60 Z" style="fill:#dbe8ff;stroke:#333333"/><g class="label"><text>小技巧</text></g></g>'
    + '<g class="node" id="d-flowchart-n1-4"><rect class="text" x="0" y="0" width="80" height="30" style="fill:none;stroke:#333333"/><g class="label"><text>耐心</text></g></g>')

  it('reads which nodes are remarks from the source', () => {
    expect([...remarkIds(source)].sort()).toEqual(['n1', 'tip', '备注'])
    expect(remarkIds('graph TD\n A-->B').size).toBe(0)
    const svg = drawn()
    expect(remarkNodes(svg, remarkIds(source)).map((node) => node.getAttribute('id'))).toEqual(['d-flowchart-tip-2', 'd-flowchart-n1-4'])
    // Without layout there is nothing to center on; the labels stay where Mermaid put them.
    expect(() => centerRemarkLabels(svg, remarkIds(source))).not.toThrow()
  })

  it('draws a remark in one pen: outline unfilled, words and its edge in the pen\'s color, a little askew', () => {
    const svg = drawn()
    sketchDiagram(svg, rough.generator(), { ...palette, remarks: remarkNodes(svg, remarkIds(source)) })
    const tip = svg.querySelector('#d-flowchart-tip-2')!
    expect(tip.getAttribute('transform')).toBe('translate(40,9) rotate(-2.5)')
    const strokes = Array.from(tip.querySelectorAll('g.mino-sketch path'))
    expect(strokes).toHaveLength(1)
    expect(strokes[0].getAttribute('style')).toContain('fill:none;stroke:#8a2a3a')
    expect(tip.querySelector('text')!.getAttribute('style')).toContain('fill:#8a2a3a!important')
    // Its edge takes the pen and an arrowhead of its own; the other edge and the shared arrowhead stay in ink.
    const edge = svg.querySelector('#L_tip_A_0 path')!
    expect(edge.getAttribute('style')).toContain('stroke:#8a2a3a')
    expect(edge.getAttribute('marker-end')).toBe('url(#m_flowchart-v2-pointEnd-pen0)')
    expect(svg.querySelector('[id="m_flowchart-v2-pointEnd-pen0"] path')!.getAttribute('style')).toContain('stroke:#8a2a3a')
    expect(svg.querySelector('[id="m_flowchart-v2-pointEnd"] path')!.getAttribute('style')).toContain('stroke:#333333')
    expect(svg.querySelector('#L_A_B_0 path')!.getAttribute('style')).toContain('stroke:#333333')
    // Bare text keeps no box, and an ordinary node is hatched as before.
    expect(svg.querySelector('#d-flowchart-n1-4 rect.text')).not.toBeNull()
    expect(svg.querySelector('#d-flowchart-n1-4 text')!.getAttribute('style')).toContain('fill:#2a4f8a')
    expect(svg.querySelectorAll('#d-flowchart-A-0 g.mino-sketch path')).toHaveLength(3)
  })
})
