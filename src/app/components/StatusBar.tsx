import type { DocumentWorkspace } from '../useDocumentWorkspace'
import type { Settings } from '../useDocumentWorkspace'
import { samples, uiPreview } from '../useDocumentWorkspace'
import { themeOptions } from '../appearance'
import { translateStatus } from '../i18n'

export function StatusBar({ workspace: w }: { workspace: DocumentWorkspace }) {
  const { document, setSettings, settings, status, t } = w
  return <>
      <footer className="app-status"><span className="status-message" role="status" title={translateStatus(status, settings.language)}>{translateStatus(status, settings.language)}</span><span className="status-mode">{document.mode === 'source-protected' ? t('源码保护') : 'Markdown'}</span><label className="theme-control">{t('外观')} <select aria-label={t('外观主题')} value={settings.theme} onChange={(event) => setSettings((current) => ({ ...current, theme: event.target.value as Settings['theme'] }))}>{themeOptions.map((option) => <option key={option.id} value={option.id}>{t(option.label)}</option>)}</select></label></footer>
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
