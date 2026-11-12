import type { DocumentWorkspace } from '../useDocumentWorkspace'
import { samples, uiPreview } from '../useDocumentWorkspace'
import { translateStatus } from '../i18n'
import { extensionOf } from '../../features/document/kinds'

export function StatusBar({ workspace: w }: { workspace: DocumentWorkspace }) {
  const { document, pdfPages, settings, status, t, wordCounts } = w
  // What the document is, and for text how it is stored on disk (T82).
  const kindLabel = document.kind === 'pdf' ? 'PDF' : document.kind === 'text' ? t('纯文本') : document.kind === 'code' ? extensionOf(document.name).toUpperCase() : null
  const encoding = document.kind !== 'pdf' && document.encoding && (document.kind !== 'markdown' || document.encoding !== 'UTF-8') ? ` · ${document.encoding}` : ''
  return <>
      <footer className="app-status"><span className="status-message" role="status" title={translateStatus(status, settings.language)}>{translateStatus(status, settings.language)}</span><span className="status-mode">{document.kind === 'pdf' ? (pdfPages === null ? '' : `${pdfPages} ${t('页')}`) : `${wordCounts.selected !== null ? `${t('已选')} ${wordCounts.selected} / ` : ''}${wordCounts.total} ${t('字')}`}</span><span className="status-mode">{w.previewPartial ? t('正在加载余下内容…') : kindLabel !== null ? `${kindLabel}${encoding}` : `${document.deferredVisual ? t('快速阅读') : document.mode === 'source-protected' ? t('源码保护') : 'Markdown'}${encoding}`}</span></footer>
  </>
}

export function VerificationPanel({ workspace: w }: { workspace: DocumentWorkspace }) {
  const { busy, checkRoundTrip, document, selectSample, t } = w
  return <>
      {import.meta.env.DEV && !uiPreview && <details className="verification-panel">
        <summary>{t('编辑器验证样本')}</summary>
        <div className="spike-controls">
          <label htmlFor="sample-select">{t('样本')}</label>
          <select id="sample-select" value={document.sampleId ?? ''} disabled={busy} onChange={(event) => void selectSample(event.target.value)}>
            <option value="">{t('当前文档')}</option>
            {samples.map((item) => <option key={item.id} value={item.id}>{t(item.label)}</option>)}
          </select>
          <button type="button" onClick={checkRoundTrip}>{t('检查语义往返')}</button>
        </div>
      </details>}
  </>
}
