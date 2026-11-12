import { BookOpen, FileText, ListTree, Moon, Pencil, Sparkles, Sun, Table2, Type } from 'lucide-react'
import { delimiterOf } from '../../features/document/kinds'
import type { DocumentWorkspace } from '../useDocumentWorkspace'
import { AppearancePanel } from './AppearancePanel'

/**
 * The column of round buttons at the right edge of the page (T64). They stay in reading mode, where the
 * toolbar and status bar are hidden, so everything a reader needs is one click away.
 */
export function FloatingControls({ workspace: w }: { workspace: DocumentWorkspace }) {
  const { ai, document, isPdf, panel, reading, setPanel, setReading, setSettings, setTableView, settings, style, t, tableView, toggleDayNight, toolbar } = w
  const button = (label: string, pressed: boolean | undefined, onClick: () => void, icon: React.ReactNode, disabled = false) => <button type="button" className="float-button" title={label} aria-label={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}>{icon}</button>
  return <div className="float-controls" role="toolbar" aria-orientation="vertical" aria-label={t('阅读控制')}>
    {button(settings.showOutline ? t('隐藏大纲') : t('显示大纲'), settings.showOutline, () => setSettings((current) => ({ ...current, showOutline: !current.showOutline })), <ListTree aria-hidden="true" />)}
    {button(t('字体与风格'), panel === 'appearance', () => setPanel(panel === 'appearance' ? null : 'appearance'), <Type aria-hidden="true" />)}
    {ai.available && button(t('AI 问书'), ai.open, ai.toggleOpen, <Sparkles aria-hidden="true" />)}
    {button(style.dark ? t('切换到浅色') : t('切换到深色'), undefined, toggleDayNight, style.dark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />)}
    {reading && document.kind === 'code' && delimiterOf(document.name) !== null && button(tableView ? t('显示原文') : t('显示为表格'), tableView, () => setTableView(!tableView), tableView ? <FileText aria-hidden="true" /> : <Table2 aria-hidden="true" />)}
    {/* A PDF is only read, so it has no editing button. */}
    {!isPdf && button(reading ? t('开始编辑 (⌘⇧R)') : t('阅读模式 (⌘⇧R)'), undefined, () => setReading(!reading), reading ? <Pencil aria-hidden="true" /> : <BookOpen aria-hidden="true" />, toolbar.composing)}
    {panel === 'appearance' && <AppearancePanel workspace={w} />}
  </div>
}
