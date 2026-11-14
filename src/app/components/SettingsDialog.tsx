import { useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { FocusTrap } from './FocusTrap'
import type { DocumentWorkspace, Settings } from '../useDocumentWorkspace'
import { MAX_EDITOR_FONT_SIZE, MIN_EDITOR_FONT_SIZE, zoomedFontSize } from '../textZoom'
import { translateStatus, type Language } from '../i18n'
import { readingStyles, type ReadingStyle } from '../../features/reading/styles'
import { diagramCurveLabels, diagramCurves, diagramLineLabels, diagramLines, diagramLookLabels, diagramLooks, diagramVariables, resolvedCurve, resolvedLine, type DiagramCurve, type DiagramLine, type DiagramLook } from '../../features/diagrams/looks'
import { modelChoices, providerHasKey, providerIds, providerLabels, type AiProvider } from '../../features/ai/client'
import { StyleSwatches } from './AppearancePanel'
import { FontPicker } from './FontPicker'

type Update = (patch: Partial<Settings>) => void

function Segmented<T extends string | boolean>({ value, options, onChange, t }: { value: T; options: readonly (readonly [T, string])[]; onChange: (value: T) => void; t: (text: string) => string }) {
  return <div className="settings-segmented">{options.map(([option, label]) => <button key={String(option)} type="button" aria-pressed={value === option} onClick={() => onChange(option)}>{t(label)}</button>)}</div>
}

function Row({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return <div className="settings-row"><span>{title}{note && <small>{note}</small>}</span>{children}</div>
}

/** A two-node sketch of a diagram look in the current style, drawn without loading Mermaid. */
function DiagramSketch({ style, look, line, curve }: { style: ReadingStyle; look: DiagramLook; line: DiagramLine; curve: DiagramCurve }) {
  const v = diagramVariables(style.id, look) as Record<string, string>
  const pattern = resolvedLine(look, line), route = resolvedCurve(look, curve)
  const radius = { page: 3, hand: 0, program: 0, scifi: 1, ink: 0, color: 4 }[look]
  const width = { page: 1, hand: 1.3, program: 1.5, scifi: 1.1, ink: 1, color: 1 }[look]
  const glow = look === 'scifi' ? { filter: `drop-shadow(0 0 1.5px ${style.link})` } : undefined
  const box = (x: number, y: number, fill: string, stroke: string) => look === 'hand'
    ? <path d={`M${x + 1} ${y} Q${x + 14} ${y - 1.5} ${x + 27} ${y + 0.5} Q${x + 28.5} ${y + 7} ${x + 27} ${y + 14} Q${x + 14} ${y + 15.5} ${x + 1.5} ${y + 13.5} Q${x - 0.5} ${y + 7} ${x + 1} ${y}`} fill={fill} stroke={stroke} strokeWidth={width} />
    : <rect x={x} y={y} width="27" height="14" rx={radius} fill={fill} stroke={stroke} strokeWidth={width} style={glow} />
  const edge = route === 'angular' ? 'M35 13 H46 V27 H55' : route === 'straight' ? 'M35 13 L55 27' : 'M35 13 C47 13 43 27 55 27'
  const dash = pattern === 'dashed' ? '4 2.5' : pattern === 'dotted' ? '0.3 2.6' : undefined
  return <svg viewBox="0 0 96 40" width="96" height="40" aria-hidden="true">
    <rect width="96" height="40" rx="6" fill={style.paper} />
    {box(7, 6, v.primaryColor, v.primaryBorderColor)}
    {box(61, 20, v.secondaryColor, v.secondaryBorderColor)}
    <path d={edge} fill="none" stroke={v.lineColor} strokeWidth={pattern === 'dotted' ? 1.6 : width} strokeDasharray={dash} strokeLinecap="round" style={glow} />
    <path d="M55.5 24.5 L60 27 L55.5 29.5 Z" fill={v.lineColor} />
  </svg>
}

function DiagramLookPicker({ style, settings, onChange, t }: { style: ReadingStyle; settings: Pick<Settings, 'diagramStyle' | 'diagramLine' | 'diagramCurve'>; onChange: (value: DiagramLook) => void; t: (text: string) => string }) {
  return <div className="diagram-looks" role="group" aria-label={t('图表风格')}>
    {diagramLooks.map((look) => <button key={look} type="button" aria-pressed={settings.diagramStyle === look} title={t(diagramLookLabels[look].note)} onClick={() => onChange(look)}>
      <DiagramSketch style={style} look={look} line={settings.diagramLine} curve={settings.diagramCurve} /><span>{t(diagramLookLabels[look].name)}</span>
    </button>)}
  </div>
}

function isLoopback(baseUrl: string): boolean {
  try { return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseUrl).hostname) } catch { return false }
}

/** One provider's key: whether it is stored, and a field to save or remove it. The key itself is never read back. */
function KeyRow({ workspace: w, provider }: { workspace: DocumentWorkspace; provider: AiProvider }) {
  const { ai, t } = w
  const [key, setKey] = useState('')
  const saved = providerHasKey(ai.config, provider)
  const label = t(providerLabels[provider])
  const save = () => { const value = key.trim(); if (value) void ai.setKey(value, provider).then((done) => { if (done) setKey('') }) }
  return <div className="settings-row"><span>{label}{provider === ai.config.provider && <em className="settings-badge">{t('当前使用')}</em>}<small className="settings-key-status" data-saved={saved}>{saved ? t('已保存') : t('未设置')}</small></span>
    <span className="settings-key"><input type="password" value={key} autoComplete="off" spellCheck={false} placeholder={saved ? '••••••••' : 'sk-…'} aria-label={`${label} ${t('API 密钥')}`} onChange={(event) => setKey(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); save() } }} />
      <button type="button" disabled={!key.trim()} onClick={save}>{t('保存')}</button>
      <button type="button" disabled={!saved} onClick={() => void ai.clearKey(provider)}>{t('删除')}</button></span></div>
}

/** The AI page (T70, T73): off by default; keys go to the macOS Keychain and are never shown again. */
function AiSettings({ workspace: w }: { workspace: DocumentWorkspace }) {
  const { ai, settings, t } = w
  const { config } = ai
  const [baseUrl, setBaseUrl] = useState(config.baseUrl)
  const [model, setModel] = useState(config.model)
  const [synced, setSynced] = useState(`${config.provider}|${config.baseUrl}|${config.model}`)
  // Another window or a provider switch changed the saved values: show those.
  if (synced !== `${config.provider}|${config.baseUrl}|${config.model}`) { setSynced(`${config.provider}|${config.baseUrl}|${config.model}`); setBaseUrl(config.baseUrl); setModel(config.model) }
  if (!ai.available) return <p className="settings-note">{t('AI 功能只在桌面应用中可用。')}</p>
  const changed = baseUrl.trim() !== config.baseUrl || model.trim() !== config.model
  const save = () => void ai.saveConfig({ baseUrl: baseUrl.trim(), model: model.trim() })
  const suggested = modelChoices(config.provider)
  const fetched = (ai.fetchedModels ?? []).filter((id) => !suggested.includes(id))
  // Fetching is a network request, so it needs what a question needs: AI switched on and a key (a local service needs none).
  const blocked = !config.enabled || !config.consented ? t('开启 AI 功能后才能获取') : !config.hasKey && !isLoopback(config.baseUrl) ? t('请先保存当前服务商的密钥') : null
  const modelsStatus = blocked ?? (ai.modelsBusy ? t('正在获取…') : ai.modelsError ? translateStatus(ai.modelsError, settings.language) : ai.fetchedModels ? `${t('已获取模型：')}${ai.fetchedModels.length}` : t('向当前服务商查询可用的模型，只发送密钥，不发送文档'))
  return <>
    <label className="settings-row settings-toggle"><span>{t('开启 AI 功能')}<small>{t('默认关闭。关闭时 Mino 不发出任何网络请求。')}</small></span><input type="checkbox" checked={config.enabled} onChange={(event) => ai.setEnabled(event.target.checked)} /></label>
    <Row title={t('服务商')} note={t('提问时使用的服务；各服务商的模型和密钥分别记住')}><Segmented t={t} value={config.provider} onChange={(value: AiProvider) => void ai.saveConfig({ provider: value })} options={providerIds.map((id) => [id, providerLabels[id]] as const)} /></Row>
    <label className="settings-row"><span>{t('接口地址')}<small>{t('须以 https:// 开头；本机地址可用 http://')}</small></span><input type="url" value={baseUrl} spellCheck={false} disabled={config.provider !== 'custom'} onChange={(event) => setBaseUrl(event.target.value)} /></label>
    <div className="settings-row"><span>{t('模型')}<small>{t('从列表选择，或输入任意模型名后按回车')}</small></span>
      <span className="settings-key settings-model">
        <input type="text" value={model} spellCheck={false} aria-label={t('模型')} onChange={(event) => setModel(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && model.trim()) { event.preventDefault(); save() } }} />
        <select aria-label={t('选择模型')} value={suggested.includes(config.model) || fetched.includes(config.model) ? config.model : ''} onChange={(event) => { if (event.target.value) void ai.pickModel(event.target.value) }}>
          <option value="">{t('选择模型…')}</option>
          {suggested.length > 0 && <optgroup label={t('常用模型')}>{suggested.map((id) => <option key={id} value={id}>{id}</option>)}</optgroup>}
          {fetched.length > 0 && <optgroup label={t('服务商提供的模型')}>{fetched.map((id) => <option key={id} value={id}>{id}</option>)}</optgroup>}
        </select>
      </span></div>
    <div className="settings-model-tools"><span role={ai.modelsError && !blocked ? 'alert' : 'status'} data-error={Boolean(ai.modelsError) && !blocked && !ai.modelsBusy}>{modelsStatus}</span><button type="button" disabled={blocked !== null || ai.modelsBusy} title={blocked ?? undefined} onClick={() => void ai.fetchModels()}>{t('获取模型列表')}</button></div>
    {changed && <div className="settings-actions"><button type="button" onClick={() => { setBaseUrl(config.baseUrl); setModel(config.model) }}>{t('取消')}</button><button type="button" className="primary" onClick={save}>{t('保存')}</button></div>}
    <div className="settings-section-heading"><strong>{t('API 密钥')}</strong><small>{t('每个服务商的密钥分开保存在 macOS 钥匙串中，不写入设置文件，保存后不会再次显示')}</small></div>
    {providerIds.filter((id) => id !== 'custom' || config.provider === 'custom' || providerHasKey(config, 'custom')).map((id) => <KeyRow key={id} workspace={w} provider={id} />)}
    <p className="settings-note">{t('提问时，当前文档的标题和正文、你的问题和本次对话会发送到当前选中的服务商；图片和其他文件不会发送。')}</p>
  </>
}

export function SettingsDialog({ workspace: w }: { workspace: DocumentWorkspace }) {
  const { updateSettings, setSettingsOpen, setSettingsTab, settings, settingsOpen, settingsTab, style: active, t } = w
  if (!settingsOpen) return null
  const update: Update = updateSettings
  const following = settings.theme === 'system'
  return <FocusTrap><div className="settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false) }}>
    <section className="settings-dialog" role="dialog" aria-modal="true" aria-label={t('设置')}>
      <header className="settings-title"><div><h2>{t('设置')}</h2><p>{t('自定义阅读、写作和工作区')}</p></div><button type="button" aria-label={t('关闭设置')} onClick={() => setSettingsOpen(false)}><X aria-hidden="true" /></button></header>
      <nav className="settings-tabs" aria-label={t('设置分类')}>
        {([['appearance', '外观'], ['typography', '排版'], ['reading', '阅读与导出'], ['workspace', '工作区'], ['ai', 'AI']] as const).map(([key, label]) => <button key={key} type="button" aria-current={settingsTab === key ? 'page' : undefined} onClick={() => setSettingsTab(key)}>{t(label)}</button>)}
      </nav>
      <div className="settings-content">
        {settingsTab === 'appearance' && <>
          <label className="settings-row"><span>{t('界面语言')}<small>{t('菜单、按钮和提示使用的语言')}</small></span><select value={settings.language} onChange={(event) => update({ language: event.target.value as Language })}><option value="zh-CN">中文</option><option value="en-US">English</option></select></label>
          <label className="settings-row settings-toggle"><span>{t('跟随系统外观')}<small>{t('白天和夜间各用一种风格，随 macOS 外观切换')}</small></span><input type="checkbox" checked={following} onChange={(event) => update(event.target.checked ? { theme: 'system' } : { theme: active.id })} /></label>
          {following && <div className="settings-pair">
            <label>{t('白天')}<select value={settings.dayTheme} onChange={(event) => update({ dayTheme: event.target.value as Settings['dayTheme'] })}>{readingStyles.filter((style) => !style.dark).map((style) => <option key={style.id} value={style.id}>{t(style.name)}</option>)}</select></label>
            <label>{t('夜间')}<select value={settings.nightTheme} onChange={(event) => update({ nightTheme: event.target.value as Settings['nightTheme'] })}>{readingStyles.filter((style) => style.dark).map((style) => <option key={style.id} value={style.id}>{t(style.name)}</option>)}</select></label>
          </div>}
          <div className="settings-section-heading"><strong>{t('阅读风格')}</strong><small>{t('画布和界面保持中性灰，颜色只在纸面和标题上')}</small></div>
          <StyleSwatches workspace={w} />
          {active.texture && <Row title={t('纸张纹理')} note={t('纸面纤维、压纹和做旧的明显程度')}><input type="range" aria-label={t('纸张纹理')} min={0} max={100} step={10} value={settings.textureStrength} onChange={(event) => update({ textureStrength: Number(event.target.value) })} /></Row>}
          <div className="settings-section-heading"><strong>{t('图表风格')}</strong><small>{t('Mermaid 流程图、时序图等的画法：字体、笔触、边角和连线；颜色始终取自当前纸张，导出也用这里的选择')}</small></div>
          <DiagramLookPicker style={active} settings={settings} onChange={(diagramStyle) => update({ diagramStyle })} t={t} />
          <p className="settings-note">{t(diagramLookLabels[settings.diagramStyle].note)}</p>
          <Row title={t('连线样式')} note={t('普通连线的线型；图里本来写成虚线的连线不变')}><Segmented t={t} value={settings.diagramLine} onChange={(value) => update({ diagramLine: value })} options={diagramLines.map((line) => [line, diagramLineLabels[line]] as const)} /></Row>
          <Row title={t('连线走向')} note={t('流程图和状态图的连线怎样绕到下一个节点')}><Segmented t={t} value={settings.diagramCurve} onChange={(value) => update({ diagramCurve: value })} options={diagramCurves.map((curve) => [curve, diagramCurveLabels[curve]] as const)} /></Row>
        </>}
        {settingsTab === 'typography' && <>
          <div className="settings-section-heading"><strong>{t('字体')}</strong><small>{t('中文和西文分开选择；随应用提供的字体离线可用')}</small></div>
          <FontPicker workspace={w} />
          <Row title={t('字号')} note={t('正文大小，标题按比例调整')}><div className="settings-stepper"><button type="button" aria-label={t('缩小字号')} disabled={settings.editorFontSize <= MIN_EDITOR_FONT_SIZE} onClick={() => update({ editorFontSize: zoomedFontSize(settings.editorFontSize, 'zoom-out') })}>−</button><output>{settings.editorFontSize} px</output><button type="button" aria-label={t('增大字号')} disabled={settings.editorFontSize >= MAX_EDITOR_FONT_SIZE} onClick={() => update({ editorFontSize: zoomedFontSize(settings.editorFontSize, 'zoom-in') })}>+</button></div></Row>
          <Row title={t('行距')}><Segmented t={t} value={settings.editorLineHeight} onChange={(value) => update({ editorLineHeight: value })} options={[['compact', '紧凑'], ['comfortable', '舒适'], ['relaxed', '宽松']]} /></Row>
          <Row title={t('段间距')}><Segmented t={t} value={settings.paragraphSpacing} onChange={(value) => update({ paragraphSpacing: value })} options={[['compact', '紧凑'], ['standard', '标准'], ['relaxed', '宽松']]} /></Row>
          <Row title={t('行宽')} note={t('页面视图中每行大约容纳的汉字数')}><Segmented t={t} value={settings.measure} onChange={(value) => update({ measure: value })} options={[['30', '30 字'], ['36', '36 字'], ['42', '42 字'], ['unlimited', '不限']]} /></Row>
          <Row title={t('西文排版')} note={t('以西文为主的文档自动两端对齐、按音节断词，并使用较小的行高和行宽')}><Segmented t={t} value={settings.latinLayout} onChange={(value) => update({ latinLayout: value })} options={[['auto', '自动'], ['off', '关闭']]} /></Row>
          <Row title={t('对齐')}><Segmented t={t} value={settings.textAlign} onChange={(value) => update({ textAlign: value })} options={[['left', '左对齐'], ['justify', '两端对齐']]} /></Row>
          <Row title={t('首行缩进')} note={t('只作用于正文段落')}><Segmented t={t} value={settings.firstLineIndent} onChange={(value) => update({ firstLineIndent: value })} options={[[false, '无'], [true, '2 字']]} /></Row>
          <Row title={t('表格')} note={t('只含数字的列自动右对齐，不改动文档')}><Segmented t={t} value={settings.tableStyle} onChange={(value) => update({ tableStyle: value })} options={[['three-line', '三线表'], ['grid', '全框线']]} /></Row>
          <div className="settings-preview mino-doc"><p>{t('清晰的文字和合适的间距，让注意力留在内容上。好的排版让眼睛在行与行之间自然移动，读长文也不觉得累。')}</p><p>{t('English words mix in with 中文 naturally.')}</p></div>
        </>}
        {settingsTab === 'reading' && <>
          <div className="settings-section-heading"><strong>{t('阅读')}</strong></div>
          <label className="settings-row settings-toggle"><span>{t('打开文件时进入阅读模式')}<small>{t('新建、从草稿恢复和有未保存修改的文档直接编辑；⌘⇧R 切换')}</small></span><input type="checkbox" checked={settings.openInReadingMode} onChange={(event) => update({ openInReadingMode: event.target.checked })} /></label>
          <Row title={t('正文显示模式')} note={t('页面像一张纸，宽屏铺满窗口')}><Segmented t={t} value={settings.editorWidth} onChange={(value) => update({ editorWidth: value })} options={[['centered', '页面'], ['wide', '宽屏']]} /></Row>
          <label className="settings-row settings-toggle"><span>{t('显示图注')}<small>{t('在图片下方显示标题或替代文本，不改动文档')}</small></span><input type="checkbox" checked={settings.imageCaptions} onChange={(event) => update({ imageCaptions: event.target.checked })} /></label>
          <label className="settings-row settings-toggle"><span>{t('夜间降低图片亮度')}<small>{t('夜间风格下图片亮度降到 90%')}</small></span><input type="checkbox" checked={settings.imageDimming} onChange={(event) => update({ imageDimming: event.target.checked })} /></label>
          <div className="settings-section-heading"><strong>{t('导出 HTML 与 PDF')}</strong></div>
          <Row title={t('导出风格')}><Segmented t={t} value={settings.exportStyle} onChange={(value) => update({ exportStyle: value })} options={[['current', '当前风格'], ['plain', '简洁白底']]} /></Row>
          <Row title={t('打印底色')} note={t('只影响打印；导出 PDF 总是整页铺满导出风格的底色')}><Segmented t={t} value={settings.pdfMode} onChange={(value) => update({ pdfMode: value })} options={[['print', '打印友好'], ['screen', '与屏幕一致']]} /></Row>
          <Row title={t('纸型')}><Segmented t={t} value={settings.pageSize} onChange={(value) => update({ pageSize: value })} options={[['a4', 'A4'], ['letter', 'Letter']]} /></Row>
          <Row title={t('页边距')}><Segmented t={t} value={settings.pageMargin} onChange={(value) => update({ pageMargin: value })} options={[['narrow', '窄'], ['standard', '标准'], ['wide', '宽']]} /></Row>
        </>}
        {settingsTab === 'ai' && <AiSettings workspace={w} />}
        {settingsTab === 'workspace' && <>
          <Row title={t('自动保存')} note={t('定时把已有文件的修改写回磁盘，新建文档仍需手动保存')}><div className="settings-segmented"><button type="button" aria-pressed={!settings.autoSave} onClick={() => update({ autoSave: false })}>{t('不自动保存')}</button>{[15, 30, 60, 120, 300].map((seconds) => <button key={seconds} type="button" aria-pressed={settings.autoSave && settings.autoSaveSeconds === seconds} onClick={() => update({ autoSave: true, autoSaveSeconds: seconds })}>{seconds < 60 ? `${seconds} ${t('秒')}` : `${seconds / 60} ${t('分钟')}`}</button>)}</div></Row>
          <label className="settings-row settings-toggle"><span>{t('恢复上次打开的文档')}<small>{t('启动时重新打开主窗口上次的标签；未保存的新文档仍从恢复草稿找回')}</small></span><input type="checkbox" checked={settings.restoreSession} onChange={(event) => update({ restoreSession: event.target.checked })} /></label>
          <label className="settings-row settings-toggle"><span>{t('显示文件栏')}<small>{t('在左侧显示文件夹目录')}</small></span><input type="checkbox" checked={settings.showSidebar} onChange={(event) => update({ showSidebar: event.target.checked })} /></label>
          <label className="settings-row settings-toggle"><span>{t('显示文件操作栏')}<small>{t('打开、新建、保存等按钮；也可从菜单栏使用这些功能')}</small></span><input type="checkbox" checked={settings.showFileToolbar} onChange={(event) => update({ showFileToolbar: event.target.checked })} /></label>
        </>}
      </div>
    </section>
  </div></FocusTrap>
}
