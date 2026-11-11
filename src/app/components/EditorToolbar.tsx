import { TableSizePicker } from '../TableSizePicker'
import { errorText, type DocumentWorkspace } from '../useDocumentWorkspace'
import { BookOpen, Bold, Code2, IndentDecrease, IndentIncrease, Italic, Link2, List, ListChecks, ListOrdered, ListTree, Minus, MoreHorizontal, Pencil, Quote, Redo2, RemoveFormatting, Strikethrough, Table2, Undo2, type LucideIcon, Image as ImageIcon } from 'lucide-react'
import type { EditorCommand } from '../../features/editor/EditorAdapter'

const toolbarItems: { command: EditorCommand; label: string; icon: LucideIcon; primary?: boolean }[] = [
  { command: 'bold', label: '加粗', icon: Bold, primary: true },
  { command: 'italic', label: '斜体', icon: Italic, primary: true },
  { command: 'strike', label: '删除线', icon: Strikethrough },
  { command: 'inlineCode', label: '行内代码', icon: Code2 },
  { command: 'clearFormat', label: '清除格式', icon: RemoveFormatting },
  { command: 'bullet', label: '项目列表', icon: List, primary: true },
  { command: 'ordered', label: '编号列表', icon: ListOrdered },
  { command: 'task', label: '任务列表', icon: ListChecks },
  { command: 'indent', label: '增加缩进', icon: IndentIncrease },
  { command: 'outdent', label: '减少缩进', icon: IndentDecrease },
  { command: 'quote', label: '引用', icon: Quote, primary: true },
  { command: 'rule', label: '分割线', icon: Minus },
  { command: 'codeBlock', label: '代码块', icon: Code2, primary: true },
  { command: 'undo', label: '撤销', icon: Undo2, primary: true },
  { command: 'redo', label: '重做', icon: Redo2, primary: true },
]

export function EditorToolbar({ workspace: w }: { workspace: DocumentWorkspace }) {
  const { reading, setReading, tablePicker, setTablePicker, adapter, applyLink, document, flushSourceText, imageAltOpen, imageAltText, imageInput, imageInputAction, linkHref, linkOpen, openTablePickerFromToolbar, previewHtml, setImageAltOpen, setImageAltText, setLinkHref, setLinkOpen, setSettings, setSourceView, setStatus, settings, sourceView, t, toolbar } = w
  function renderToolbarButton(item: (typeof toolbarItems)[number], inMenu = false) {
    const active = ({ bold: 'strong', italic: 'emphasis', strike: 'strike_through', inlineCode: 'inlineCode', bullet: 'bullet_list', ordered: 'ordered_list', task: 'task_list', quote: 'blockquote', codeBlock: 'code_block' } as Record<string, string>)[item.command]
    const pressed = active ? (['bullet', 'ordered', 'task', 'quote', 'codeBlock'].includes(item.command) ? toolbar.block === active : toolbar.marks.includes(active)) : undefined
    const Icon = item.icon
    return <button key={item.command} type="button" className={inMenu ? 'menu-command' : 'icon-button'} title={t(item.label)} aria-label={t(item.label)} aria-pressed={pressed} disabled={!toolbar.ready || toolbar.composing || item.command === 'undo' && !toolbar.canUndo || item.command === 'redo' && !toolbar.canRedo || (item.command === 'indent' || item.command === 'outdent') && !toolbar.inList} onClick={() => adapter.current?.runCommand(item.command)}><Icon aria-hidden="true" />{inMenu && <span>{t(item.label)}</span>}</button>
  }
  const widthSwitch = <div className="editor-width-switch" role="group" aria-label={t('正文显示模式')}>
    <button type="button" aria-pressed={settings.editorWidth === 'centered'} onClick={() => setSettings((current) => ({ ...current, editorWidth: 'centered' }))}>{t('页面')}</button>
    <button type="button" aria-pressed={settings.editorWidth === 'wide'} onClick={() => setSettings((current) => ({ ...current, editorWidth: 'wide' }))}>{t('宽屏')}</button>
  </div>
  const outlineButton = <button type="button" className="icon-button" aria-pressed={settings.showOutline} title={settings.showOutline ? t('隐藏大纲') : t('显示大纲')} aria-label={settings.showOutline ? t('隐藏大纲') : t('显示大纲')} onClick={() => setSettings((current) => ({ ...current, showOutline: !current.showOutline }))}><ListTree aria-hidden="true" /></button>
  if (reading) return <div className="editor-toolbar reading-toolbar" role="toolbar" aria-label={t('阅读工具栏')}>
    <span className="reading-label"><BookOpen aria-hidden="true" />{t('阅读模式')}</span>
    <span className="toolbar-spacer" />
    {outlineButton}
    {widthSwitch}
    <button type="button" className="control-button reading-edit" title={t('开始编辑 (⌘⇧R)')} onClick={() => setReading(false)}><Pencil aria-hidden="true" />{t('编辑')}</button>
  </div>
  return <>
          <div className="editor-toolbar" role="toolbar" aria-label={t('编辑工具栏')} onMouseDown={(event) => { if ((event.target as HTMLElement).closest('button')) event.preventDefault() }}>
            {document.mode === 'visual' && <>
            <select aria-label={t('段落样式')} value={toolbar.block.startsWith('heading') ? toolbar.block : 'paragraph'} disabled={!toolbar.ready || toolbar.composing} onChange={(event) => adapter.current?.runCommand(event.target.value as EditorCommand)}>
              <option value="paragraph">{t('正文')}</option>
              {[1, 2, 3, 4, 5, 6].map((level) => <option key={level} value={`heading${level}`}>{t('标题')} {level}</option>)}
            </select>
            <span className="toolbar-divider" aria-hidden="true" />
            <div className="toolbar-group">{toolbarItems.filter((item) => item.primary && item.command !== 'undo' && item.command !== 'redo').map((item) => renderToolbarButton(item))}</div>
            <span className="toolbar-divider" aria-hidden="true" />
            <button type="button" className="icon-button" title={t('插入链接')} aria-label={t('插入链接')} disabled={!toolbar.ready || toolbar.composing} onClick={() => { setLinkHref(adapter.current?.captureSelection() ?? ''); setLinkOpen(true) }}><Link2 aria-hidden="true" /></button>
            <button type="button" className="icon-button" title={t('插入图片')} aria-label={t('插入图片')} disabled={!toolbar.ready || toolbar.composing} onClick={() => { imageInputAction.current = 'insert'; imageInput.current?.click() }}><ImageIcon aria-hidden="true" /></button>
            <input ref={imageInput} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => { const file = event.target.files?.[0]; if (file) { try { if (imageInputAction.current === 'replace') adapter.current?.replaceSelectedImage(file); else adapter.current?.insertFile(file) } catch (error) { setStatus(errorText(error)) } } event.target.value = '' }} />
            <details className="toolbar-more"><summary title={t('更多编辑工具')} aria-label={t('更多编辑工具')}><MoreHorizontal aria-hidden="true" /></summary><div className="toolbar-more-menu">
              {toolbarItems.filter((item) => !item.primary).map((item) => renderToolbarButton(item, true))}
              <div className="menu-separator" />
              <button type="button" className="menu-command" disabled={!toolbar.ready || toolbar.composing} onClick={openTablePickerFromToolbar}><Table2 aria-hidden="true" />{t('插入表格')}</button>
              {toolbar.inTable && <><div className="menu-separator" />{([['row', '加行'], ['column', '加列'], ['deleteRow', '删行'], ['deleteColumn', '删列'], ['alignLeft', '左对齐'], ['alignCenter', '居中'], ['alignRight', '右对齐']] as const).map(([command, label]) => <button key={command} type="button" className="menu-command" onClick={() => adapter.current?.runTableCommand(command)}><Table2 aria-hidden="true" />{t(label)}</button>)}</>}
              {toolbar.imageAlt !== null && <><div className="menu-separator" /><button type="button" className="menu-command" onClick={() => { adapter.current?.captureSelection(); setImageAltText(toolbar.imageAlt ?? ''); setImageAltOpen(true) }}><Pencil aria-hidden="true" />{t('图片说明')}</button><button type="button" className="menu-command" onClick={() => { adapter.current?.captureSelection(); imageInputAction.current = 'replace'; imageInput.current?.click() }}><ImageIcon aria-hidden="true" />{t('替换图片')}</button></>}
            </div></details>
            </>}
            {document.mode === 'source-protected' && <div className="editor-width-switch" role="group" aria-label={t('文档视图')}>
              <button type="button" aria-pressed={!sourceView} onClick={() => { flushSourceText(); setSourceView(false) }}>{t('预览')}</button>
              <button type="button" aria-pressed={sourceView || previewHtml === null} onClick={() => setSourceView(true)}>{t('编辑源码')}</button>
            </div>}
            <span className="toolbar-spacer" />
            {document.mode === 'visual' && <div className="toolbar-group">{toolbarItems.filter((item) => item.command === 'undo' || item.command === 'redo').map((item) => renderToolbarButton(item))}</div>}
            <span className="toolbar-divider" aria-hidden="true" />
            {outlineButton}
            {widthSwitch}
            <button type="button" className="control-button reading-edit" title={t('阅读模式 (⌘⇧R)')} disabled={toolbar.composing} onClick={() => setReading(true)}><BookOpen aria-hidden="true" />{t('阅读')}</button>
          </div>
          {linkOpen && <div className="editor-popover" role="dialog" aria-label={t('编辑链接')}>
            <label>{t('链接地址')} <input autoFocus value={linkHref} onChange={(event) => setLinkHref(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') applyLink(); if (event.key === 'Escape') { setLinkOpen(false); adapter.current?.focus() } }} /></label>
            <button type="button" onClick={applyLink}>{t('确定')}</button><button type="button" onClick={() => { setLinkOpen(false); adapter.current?.focus() }}>{t('取消')}</button>
          </div>}
          {imageAltOpen && <div className="editor-popover" role="dialog" aria-label={t('编辑图片说明')}>
            <label>{t('替代文本')} <input autoFocus value={imageAltText} onChange={(event) => setImageAltText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { setImageAltOpen(false); adapter.current?.focus() } }} /></label>
            <button type="button" onClick={() => { adapter.current?.setImageAlt(imageAltText); setImageAltOpen(false) }}>{t('确定')}</button><button type="button" onClick={() => { setImageAltOpen(false); adapter.current?.focus() }}>{t('取消')}</button>
          </div>}
          {tablePicker && <TableSizePicker anchor={tablePicker} label={t} onClose={() => { setTablePicker(null); adapter.current?.focus() }} onSelect={({ rows, columns }) => { adapter.current?.runTableCommand('insert', rows, columns); setTablePicker(null) }} />}
  </>
}
