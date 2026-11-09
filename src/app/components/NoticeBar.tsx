import { X } from 'lucide-react'
import { translateStatus } from '../i18n'
import { FocusTrap } from './FocusTrap'
import type { DocumentWorkspace } from '../useDocumentWorkspace'

export function NoticeBar({ workspace: w }: { workspace: DocumentWorkspace }) {
  const { notice, setNotice, activeConflict, showDiskDiff, useDiskVersion, saveConflictCopyAs, setDraftsOpen, refreshDrafts, busy, settings, t } = w
  return <>
    {activeConflict && <div className="notice-bar notice-conflict" role="alert">
      <span>{t('磁盘上的文件已被其他程序修改，你的未保存内容仍保留在这里。')}</span>
      <button type="button" disabled={busy} onClick={() => void showDiskDiff()}>{t('查看差异')}</button>
      <button type="button" disabled={busy} onClick={() => void useDiskVersion()}>{t('使用磁盘版本')}</button>
      <button type="button" disabled={busy} onClick={() => void saveConflictCopyAs()}>{t('另存为')}</button>
    </div>}
    {notice && <div className={`notice-bar notice-${notice.kind}`} role="alert">
      <span>{translateStatus(notice.message, settings.language)}</span>
      {notice.kind === 'drafts' && <button type="button" onClick={() => { refreshDrafts(); setDraftsOpen(true); setNotice(null) }}>{t('查看草稿')}</button>}
      <button type="button" className="icon-button" title={t('关闭提示')} aria-label={t('关闭提示')} onClick={() => setNotice(null)}><X aria-hidden="true" /></button>
    </div>}
  </>
}

export function DiffDialog({ workspace: w }: { workspace: DocumentWorkspace }) {
  const { diskDiff, setDiskDiff, t } = w
  if (!diskDiff) return null
  const changes = diskDiff.lines?.filter((line) => line.kind !== 'same').slice(0, 2000)
  return <FocusTrap><div className="settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDiskDiff(null) }}>
    <section className="drafts-dialog diff-dialog" role="dialog" aria-modal="true" aria-label={t('与磁盘版本的差异')}>
      <div className="settings-title"><h2>{t('与磁盘版本的差异')}</h2><button type="button" aria-label={t('关闭')} onClick={() => setDiskDiff(null)}><X aria-hidden="true" /></button></div>
      {changes === undefined ? <p>{t('差异过大，无法在此显示。')}</p> : changes.length === 0 ? <p>{t('内容相同。')}</p> : <pre className="diff-lines">{changes.map((line, index) => <div key={index} className={`diff-${line.kind}`}>{line.kind === 'added' ? '+ ' : '- '}{line.text}</div>)}</pre>}
      <p className="diff-legend">{t('“-”为磁盘版本，“+”为当前编辑内容。')}</p>
    </section>
  </div></FocusTrap>
}
