import { FocusTrap } from './FocusTrap'
import { errorText, type DocumentWorkspace } from '../useDocumentWorkspace'
import { X } from 'lucide-react'
import { fontFamilies, fontOptions, themeOptions } from '../appearance'
import { MAX_EDITOR_FONT_SIZE, MIN_EDITOR_FONT_SIZE, zoomedFontSize } from '../textZoom'
import type { Language } from '../i18n'

export function TabContextMenu({ workspace: w }: { workspace: DocumentWorkspace }) {
  const { closeTabs, detachTab, t, tabMenu, tabs } = w
  return <>
      {tabMenu && <div className="tab-context-menu" role="menu" style={{ left: Math.min(tabMenu.x, window.innerWidth - 180), top: Math.min(tabMenu.y, window.innerHeight - 120) }} onClick={(event) => event.stopPropagation()}><button type="button" role="menuitem" onClick={() => void detachTab(tabMenu.key)}>{t('移到新窗口')}</button><button type="button" role="menuitem" onClick={() => void closeTabs([tabMenu.key])}>{t('关闭当前')}</button><button type="button" role="menuitem" onClick={() => void closeTabs(tabs.slice(tabs.findIndex((tab) => tab.key === tabMenu.key) + 1).map((tab) => tab.key))} disabled={tabs.findIndex((tab) => tab.key === tabMenu.key) === tabs.length - 1}>{t('关闭右边')}</button><button type="button" role="menuitem" onClick={() => void closeTabs(tabs.map((tab) => tab.key))}>{t('关闭所有文档')}</button></div>}
  </>
}

export function DraftsDialog({ workspace: w }: { workspace: DocumentWorkspace }) {
  const { busy, discardDraft, draftPreview, drafts, draftsOpen, previewDraft, recoverDraft, setDraftsOpen, setStatus, t } = w
  return <>
      {draftsOpen && <FocusTrap><div className="settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDraftsOpen(false) }}><section className="drafts-dialog" role="dialog" aria-modal="true" aria-label={t('恢复草稿')}><div className="settings-title"><h2>{t('恢复草稿')}</h2><button type="button" aria-label={t('关闭恢复草稿')} onClick={() => setDraftsOpen(false)}><X aria-hidden="true" /></button></div>{drafts.length === 0 ? <p>{t('没有可恢复的草稿')}</p> : drafts.map((item) => <div key={item.draftId} className="recovery-item"><span>{item.name}{t(item.targetStatus === 'changed' ? ' · 原文件已变化' : item.targetStatus === 'deleted' ? ' · 原文件已删除' : '')}</span><button type="button" disabled={busy} onClick={() => void previewDraft(item.draftId)}>{t('预览')}</button><button type="button" disabled={busy} onClick={() => void recoverDraft(item.draftId)}>{t('恢复')}</button><button type="button" disabled={busy} onClick={() => void discardDraft(item.draftId).catch((error: unknown) => setStatus(errorText(error)))}>{t('丢弃')}</button></div>)}{draftPreview && <div className="draft-preview"><strong>{draftPreview.name} · {draftPreview.assetCount} {t('张图片')}</strong><pre>{draftPreview.markdown.slice(0, 100_000)}</pre></div>}</section></div></FocusTrap>}
  </>
}

export function SettingsDialog({ workspace: w }: { workspace: DocumentWorkspace }) {
  const { setSettings, setSettingsOpen, setSettingsTab, settings, settingsOpen, settingsTab, t } = w
  return <>
      {settingsOpen && <FocusTrap><div className="settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false) }}>
        <section className="settings-dialog" role="dialog" aria-modal="true" aria-label={t('设置')}>
          <header className="settings-title"><div><h2>{t('设置')}</h2><p>{t('自定义阅读、写作和工作区')}</p></div><button type="button" aria-label={t('关闭设置')} onClick={() => setSettingsOpen(false)}><X aria-hidden="true" /></button></header>
          <nav className="settings-tabs" aria-label={t('设置分类')}>
            {([['appearance', '外观'], ['editor', '编辑器'], ['workspace', '工作区']] as const).map(([key, label]) => <button key={key} type="button" aria-current={settingsTab === key ? 'page' : undefined} onClick={() => setSettingsTab(key)}>{t(label)}</button>)}
          </nav>
          <div className="settings-content">
            {settingsTab === 'appearance' && <>
              <label className="settings-row"><span>{t('界面语言')}<small>{t('菜单、按钮和提示使用的语言')}</small></span><select value={settings.language} onChange={(event) => setSettings((current) => ({ ...current, language: event.target.value as Language }))}><option value="zh-CN">中文</option><option value="en-US">English</option></select></label>
              <div className="settings-section-heading"><strong>{t('外观主题')}</strong><small>{t('选择适合当前环境的配色')}</small></div>
              <div className="theme-options">{themeOptions.map((option) => <button key={option.id} type="button" className="theme-option" aria-pressed={settings.theme === option.id} onClick={() => setSettings((current) => ({ ...current, theme: option.id }))}><span className={`theme-swatch theme-swatch-${option.id}`}><i /><b /><em /></span><span>{t(option.label)}</span></button>)}</div>
            </>}
            {settingsTab === 'editor' && <>
              <div className="settings-section-heading"><strong>{t('正文字体')}</strong><small>{t('选择适合写作或阅读的字形')}</small></div>
              <div className="font-options">{fontOptions.map((option) => <button key={option.id} type="button" className="font-option" aria-pressed={settings.editorFont === option.id} onClick={() => setSettings((current) => ({ ...current, editorFont: option.id }))}><span className="font-option-sample" style={{ fontFamily: fontFamilies[option.id] }}>Aa 字</span><span className="font-option-copy"><strong>{t(option.label)} {option.recommended && <em>{t('推荐')}</em>}</strong><small>{t(option.note)}</small></span></button>)}</div>
              <div className="settings-row"><span>{t('字号')}<small>{t('正文大小，标题按比例调整')}</small></span><div className="settings-stepper"><button type="button" aria-label={t('缩小字号')} disabled={settings.editorFontSize <= MIN_EDITOR_FONT_SIZE} onClick={() => setSettings((current) => ({ ...current, editorFontSize: zoomedFontSize(current.editorFontSize, 'zoom-out') }))}>−</button><output>{settings.editorFontSize} px</output><button type="button" aria-label={t('增大字号')} disabled={settings.editorFontSize >= MAX_EDITOR_FONT_SIZE} onClick={() => setSettings((current) => ({ ...current, editorFontSize: zoomedFontSize(current.editorFontSize, 'zoom-in') }))}>+</button></div></div>
              <div className="settings-row"><span>{t('行距')}<small>{t('控制正文段落的疏密')}</small></span><div className="settings-segmented">{([['compact', '紧凑'], ['comfortable', '舒适'], ['relaxed', '宽松']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={settings.editorLineHeight === value} onClick={() => setSettings((current) => ({ ...current, editorLineHeight: value }))}>{t(label)}</button>)}</div></div>
              <div className="settings-row"><span>{t('正文显示模式')}<small>{t('控制文章在窗口中的宽度')}</small></span><div className="settings-segmented">{([['centered', '居中'], ['wide', '宽屏']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={settings.editorWidth === value} onClick={() => setSettings((current) => ({ ...current, editorWidth: value }))}>{t(label)}</button>)}</div></div>
              <div className="settings-row"><span>{t('自动保存')}<small>{t('定时把已有文件的修改写回磁盘，新建文档仍需手动保存')}</small></span><div className="settings-segmented"><button type="button" aria-pressed={!settings.autoSave} onClick={() => setSettings((current) => ({ ...current, autoSave: false }))}>{t('不自动保存')}</button>{[15, 30, 60, 120, 300].map((seconds) => <button key={seconds} type="button" aria-pressed={settings.autoSave && settings.autoSaveSeconds === seconds} onClick={() => setSettings((current) => ({ ...current, autoSave: true, autoSaveSeconds: seconds }))}>{seconds < 60 ? `${seconds} ${t('秒')}` : `${seconds / 60} ${t('分钟')}`}</button>)}</div></div>
              <div className="settings-preview" style={{ fontFamily: 'var(--editor-font)', fontSize: 'var(--editor-font-size)', lineHeight: 'var(--editor-line-height)' }}><strong>{t('写作预览')}</strong><p>{t('清晰的文字和合适的间距，让注意力留在内容上。')}</p></div>
            </>}
            {settingsTab === 'workspace' && <>
              <label className="settings-row settings-toggle"><span>{t('恢复上次打开的文档')}<small>{t('启动时重新打开主窗口上次的标签；未保存的新文档仍从恢复草稿找回')}</small></span><input type="checkbox" checked={settings.restoreSession} onChange={(event) => setSettings((current) => ({ ...current, restoreSession: event.target.checked }))} /></label>
              <label className="settings-row settings-toggle"><span>{t('显示文件栏')}<small>{t('在左侧显示文件夹目录')}</small></span><input type="checkbox" checked={settings.showSidebar} onChange={(event) => setSettings((current) => ({ ...current, showSidebar: event.target.checked }))} /></label>
              <label className="settings-row settings-toggle"><span>{t('显示文件操作栏')}<small>{t('打开、新建、保存等按钮；也可从菜单栏使用这些功能')}</small></span><input type="checkbox" checked={settings.showFileToolbar} onChange={(event) => setSettings((current) => ({ ...current, showFileToolbar: event.target.checked }))} /></label>
            </>}
          </div>
        </section>
      </div></FocusTrap>}
  </>
}
