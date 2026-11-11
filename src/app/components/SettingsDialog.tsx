import type { CSSProperties, ReactNode } from 'react'
import { X } from 'lucide-react'
import { FocusTrap } from './FocusTrap'
import type { DocumentWorkspace, Settings } from '../useDocumentWorkspace'
import { fontFamilies, fontOptions, fontPresetOptions } from '../appearance'
import { documentFontFamily } from '../readingSettings'
import { MAX_EDITOR_FONT_SIZE, MIN_EDITOR_FONT_SIZE, zoomedFontSize } from '../textZoom'
import type { Language } from '../i18n'
import { groupLabels, readingStyles, type ReadingStyle, type StyleGroup } from '../../features/reading/styles'
import { textureUrl } from '../../features/reading/textures'

type Update = (patch: Partial<Settings>) => void

function Segmented<T extends string | boolean>({ value, options, onChange, t }: { value: T; options: readonly (readonly [T, string])[]; onChange: (value: T) => void; t: (text: string) => string }) {
  return <div className="settings-segmented">{options.map(([option, label]) => <button key={String(option)} type="button" aria-pressed={value === option} onClick={() => onChange(option)}>{t(label)}</button>)}</div>
}

function Row({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return <div className="settings-row"><span>{title}{note && <small>{note}</small>}</span>{children}</div>
}

/** A miniature page drawn from the style data itself: paper, texture, ink, link and font. */
function StyleCard({ style, active, onPick, t }: { style: ReadingStyle; active: boolean; onPick: () => void; t: (text: string) => string }) {
  const texture = textureUrl(style.texture)
  const page: CSSProperties = { backgroundColor: style.paper, backgroundImage: texture ? `url("${texture}")` : undefined, color: style.text, borderColor: style.edge, fontFamily: documentFontFamily({ fontPreset: 'auto', editorFont: 'system' }, style) }
  return <button type="button" className="style-card" aria-pressed={active} onClick={onPick} style={{ background: style.desk }}>
    <span className="style-card-page" style={page}><strong style={{ color: style.heading }}>{t('文')} Aa</strong><span>{t('读书是一件安静的事')}</span><em style={{ color: style.link }}>{t('链接')}</em></span>
    <span className="style-card-name" style={{ color: style.text }}>{t(style.name)}</span>
  </button>
}

export function SettingsDialog({ workspace: w }: { workspace: DocumentWorkspace }) {
  const { setSettings, setSettingsOpen, setSettingsTab, settings, settingsOpen, settingsTab, style: active, t } = w
  if (!settingsOpen) return null
  const update: Update = (patch) => setSettings((current) => ({ ...current, ...patch }))
  const following = settings.theme === 'system'
  const pick = (style: ReadingStyle) => {
    if (!following) update({ theme: style.id })
    else update(style.dark ? { nightTheme: style.id } : { dayTheme: style.id })
  }
  const groups: StyleGroup[] = ['paper', 'eye', 'night', 'other']
  return <FocusTrap><div className="settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false) }}>
    <section className="settings-dialog" role="dialog" aria-modal="true" aria-label={t('设置')}>
      <header className="settings-title"><div><h2>{t('设置')}</h2><p>{t('自定义阅读、写作和工作区')}</p></div><button type="button" aria-label={t('关闭设置')} onClick={() => setSettingsOpen(false)}><X aria-hidden="true" /></button></header>
      <nav className="settings-tabs" aria-label={t('设置分类')}>
        {([['appearance', '外观'], ['typography', '排版'], ['reading', '阅读与导出'], ['workspace', '工作区']] as const).map(([key, label]) => <button key={key} type="button" aria-current={settingsTab === key ? 'page' : undefined} onClick={() => setSettingsTab(key)}>{t(label)}</button>)}
      </nav>
      <div className="settings-content">
        {settingsTab === 'appearance' && <>
          <label className="settings-row"><span>{t('界面语言')}<small>{t('菜单、按钮和提示使用的语言')}</small></span><select value={settings.language} onChange={(event) => update({ language: event.target.value as Language })}><option value="zh-CN">中文</option><option value="en-US">English</option></select></label>
          <label className="settings-row settings-toggle"><span>{t('跟随系统外观')}<small>{t('白天和夜间各用一种风格，随 macOS 外观切换')}</small></span><input type="checkbox" checked={following} onChange={(event) => update(event.target.checked ? { theme: 'system' } : { theme: active.id })} /></label>
          {following && <div className="settings-pair">
            <label>{t('白天')}<select value={settings.dayTheme} onChange={(event) => update({ dayTheme: event.target.value as Settings['dayTheme'] })}>{readingStyles.filter((style) => !style.dark).map((style) => <option key={style.id} value={style.id}>{t(style.name)}</option>)}</select></label>
            <label>{t('夜间')}<select value={settings.nightTheme} onChange={(event) => update({ nightTheme: event.target.value as Settings['nightTheme'] })}>{readingStyles.filter((style) => style.dark).map((style) => <option key={style.id} value={style.id}>{t(style.name)}</option>)}</select></label>
          </div>}
          {groups.map((group) => <div key={group}>
            <div className="settings-section-heading"><strong>{t(groupLabels[group])}</strong></div>
            <div className="style-gallery">{readingStyles.filter((style) => style.group === group).map((style) => <StyleCard key={style.id} style={style} t={t} active={following ? (style.dark ? settings.nightTheme : settings.dayTheme) === style.id : settings.theme === style.id} onPick={() => pick(style)} />)}</div>
          </div>)}
        </>}
        {settingsTab === 'typography' && <>
          <div className="settings-section-heading"><strong>{t('字体')}</strong><small>{t('书宋与文楷随应用提供，离线可用')}</small></div>
          <div className="font-options">{fontPresetOptions.map((option) => <button key={option.id} type="button" className="font-option" aria-pressed={settings.fontPreset === option.id} onClick={() => update({ fontPreset: option.id })}><span className="font-option-sample" style={{ fontFamily: documentFontFamily({ fontPreset: option.id, editorFont: settings.editorFont }, active) }}>Aa 字</span><span className="font-option-copy"><strong>{t(option.label)}</strong><small>{t(option.note)}</small></span></button>)}</div>
          {settings.fontPreset === 'system' && <label className="settings-row"><span>{t('本机字体')}<small>{t('使用 macOS 已安装的字体')}</small></span><select value={settings.editorFont} onChange={(event) => update({ editorFont: event.target.value as Settings['editorFont'] })}>{fontOptions.map((option) => <option key={option.id} value={option.id} style={{ fontFamily: fontFamilies[option.id] }}>{t(option.label)}</option>)}</select></label>}
          <Row title={t('字号')} note={t('正文大小，标题按比例调整')}><div className="settings-stepper"><button type="button" aria-label={t('缩小字号')} disabled={settings.editorFontSize <= MIN_EDITOR_FONT_SIZE} onClick={() => update({ editorFontSize: zoomedFontSize(settings.editorFontSize, 'zoom-out') })}>−</button><output>{settings.editorFontSize} px</output><button type="button" aria-label={t('增大字号')} disabled={settings.editorFontSize >= MAX_EDITOR_FONT_SIZE} onClick={() => update({ editorFontSize: zoomedFontSize(settings.editorFontSize, 'zoom-in') })}>+</button></div></Row>
          <Row title={t('行距')}><Segmented t={t} value={settings.editorLineHeight} onChange={(value) => update({ editorLineHeight: value })} options={[['compact', '紧凑'], ['comfortable', '舒适'], ['relaxed', '宽松']]} /></Row>
          <Row title={t('段间距')}><Segmented t={t} value={settings.paragraphSpacing} onChange={(value) => update({ paragraphSpacing: value })} options={[['compact', '紧凑'], ['standard', '标准'], ['relaxed', '宽松']]} /></Row>
          <Row title={t('行宽')} note={t('页面视图中每行大约容纳的汉字数')}><Segmented t={t} value={settings.measure} onChange={(value) => update({ measure: value })} options={[['30', '30 字'], ['36', '36 字'], ['42', '42 字'], ['unlimited', '不限']]} /></Row>
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
          <Row title={t('PDF 底色')} note={t('打印时页边距总是白色；与屏幕一致只给正文区域铺纸色')}><Segmented t={t} value={settings.pdfMode} onChange={(value) => update({ pdfMode: value })} options={[['print', '打印友好'], ['screen', '与屏幕一致']]} /></Row>
          <Row title={t('纸型')}><Segmented t={t} value={settings.pageSize} onChange={(value) => update({ pageSize: value })} options={[['a4', 'A4'], ['letter', 'Letter']]} /></Row>
          <Row title={t('页边距')}><Segmented t={t} value={settings.pageMargin} onChange={(value) => update({ pageMargin: value })} options={[['narrow', '窄'], ['standard', '标准'], ['wide', '宽']]} /></Row>
        </>}
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
