import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ArrowUp, Copy, CornerDownLeft, Eraser, RefreshCw, Replace, Square, X, FilePlus2 } from 'lucide-react'
import { PaneResizer } from './PaneResizer'
import { AI_MAX, AI_MIN } from '../readingSettings'
import type { DocumentWorkspace } from '../useDocumentWorkspace'
import type { AiTurn } from '../aiAssistant'
import { providerLabels } from '../../features/ai/client'
import { presets, selectionActions } from '../../features/ai/prompts'
import { FocusTrap } from './FocusTrap'

function host(baseUrl: string): string {
  try { return new URL(baseUrl).host } catch { return baseUrl }
}

function Answer({ turn, workspace: w }: { turn: AiTurn; workspace: DocumentWorkspace }) {
  const { ai, reading, setStatus, t } = w
  const finished = turn.status === 'done' || turn.status === 'cancelled'
  // While the answer arrives its text comes from the stream, so each piece renders this answer and nothing else.
  const text = useSyncExternalStore(ai.stream.subscribe, () => turn.status === 'streaming' ? ai.stream.get(turn.id) : undefined) ?? turn.text
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => { if (turn.status === 'streaming') { const list = root.current?.closest('.ai-turns'); list?.scrollTo({ top: list.scrollHeight }) } }, [text, turn.status])
  return <div ref={root} className="ai-turn ai-answer" data-status={turn.status}>
    {turn.progress && <p className="ai-progress" role="status">{t(turn.progress)}</p>}
    {turn.status === 'done' && turn.html
      // The HTML comes from the preview renderer, which sanitizes it; remote images are blocked by the app's CSP.
      ? <div className="ai-text mino-doc" dangerouslySetInnerHTML={{ __html: turn.html }} />
      : text ? <div className="ai-text ai-text-plain">{text}{turn.status === 'streaming' && <i className="ai-caret" aria-hidden="true" />}</div>
      : turn.status === 'streaming' && !turn.progress ? <p className="ai-progress" role="status">{t('正在思考…')}</p> : null}
    {turn.status === 'cancelled' && <p className="ai-note">{t('已停止。')}</p>}
    {turn.error && <p className="ai-error" role="alert">{t(turn.error)}</p>}
    {turn.note && <p className="ai-note">{t(turn.note)}</p>}
    {finished && turn.text && <div className="ai-actions">
      <button type="button" onClick={() => { void navigator.clipboard?.writeText(turn.text).then(() => setStatus('已复制回答'), () => setStatus('复制失败')) }}><Copy aria-hidden="true" />{t('复制')}</button>
      <button type="button" disabled={reading} title={reading ? t('阅读模式下不能修改文档') : undefined} onClick={() => ai.insertAnswer(turn, 'after')}><CornerDownLeft aria-hidden="true" />{t('插入文档')}</button>
      <button type="button" title={t('保存为单独的文档，默认放在当前文档旁边')} onClick={() => void ai.saveNote(turn)}><FilePlus2 aria-hidden="true" />{t('存为文档')}</button>
      {turn.selectionAction && ai.canReplace(turn.selectionAction) && <button type="button" disabled={reading} title={reading ? t('阅读模式下不能修改文档') : undefined} onClick={() => ai.insertAnswer(turn, 'replace')}><Replace aria-hidden="true" />{t('替换选区')}</button>}
    </div>}
  </div>
}

/** The AI drawer (T71–T73): presets, questions about the document, and actions on the selected text. */
export function AiDrawer({ workspace: w }: { workspace: DocumentWorkspace }) {
  const { ai, document, t } = w
  const [draft, setDraft] = useState('')
  const [composing, setComposing] = useState(false)
  const list = useRef<HTMLDivElement>(null)
  const last = ai.turns[ai.turns.length - 1]
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight }) }, [ai.turns.length, last?.text, last?.html])
  if (!ai.open || !ai.config.enabled) return null
  const send = () => { const text = draft.trim(); if (!text || ai.busy) return; setDraft(''); void ai.ask(text) }
  return <aside className="ai-drawer" aria-label={t('AI 问书')} style={{ width: w.settings.aiWidth }}>
    <PaneResizer edge="left" width={w.settings.aiWidth} min={AI_MIN} max={AI_MAX} fallback={400} label={t('调整 AI 栏宽度')} onCommit={(aiWidth) => w.updateSettings({ aiWidth })} />
    <header className="ai-header">
      <div><h2>{t('AI 问书')}</h2><p title={document.name}>{document.name}</p></div>
      <button type="button" className="icon-button" title={t('清空对话')} aria-label={t('清空对话')} disabled={ai.turns.length === 0} onClick={ai.clear}><Eraser aria-hidden="true" /></button>
      <button type="button" className="icon-button" title={t('关闭')} aria-label={t('关闭')} onClick={() => ai.setOpen(false)}><X aria-hidden="true" /></button>
    </header>
    <p className="ai-destination">{t('提问时，文档内容会发送到')} <strong>{t(providerLabels[ai.config.provider])}</strong> · <span className="ai-model" title={t('回答使用的模型，可在设置的“AI”页更换')}>{ai.config.model}</span> · {host(ai.config.baseUrl)}{!ai.config.hasKey && <> · <button type="button" className="ai-key-missing" onClick={() => { w.setSettingsTab('ai'); w.setSettingsOpen(true) }}>{t('尚未填写密钥，去设置')}</button></>}</p>
    <div ref={list} className="ai-turns" aria-live="polite">
      {ai.turns.length === 0 && <p className="ai-empty">{t('可以让 AI 概括这篇文档、解释选中的文字，或回答你的问题。')}<small>{t('为了节省用量，文档只在你提问时随问题一起发送；打开这个面板不会发送任何内容。')}</small></p>}
      {ai.turns.map((turn) => turn.role === 'user' ? <div key={turn.id} className="ai-turn ai-question">{t(turn.text)}</div> : <Answer key={turn.id} turn={turn} workspace={w} />)}
    </div>
    <footer className="ai-footer">
      {ai.turns.length === 0 && <div className="ai-chips ai-suggestions">
        {ai.suggestions.map((question) => <button key={question} type="button" disabled={ai.busy} onClick={() => void ai.ask(question)}>{question}</button>)}
        <button type="button" className="ai-chip-quiet" disabled={ai.busy} title={t('让 AI 根据文档提出问题')} onClick={() => void ai.refreshSuggestions()}><RefreshCw aria-hidden="true" />{t('推荐问题')}</button>
      </div>}
      <div className="ai-chips" role="group" aria-label={t('整篇文档')}>{presets.map((preset) => <button key={preset.id} type="button" disabled={ai.busy} onClick={() => void ai.runPreset(preset.id)}>{t(preset.label)}</button>)}</div>
      <div className="ai-chips ai-selection" role="group" aria-label={t('选中的文字')}><span>{t('选中文字')}</span>{selectionActions.map((action) => <button key={action.id} type="button" disabled={ai.busy} onClick={() => void ai.runSelection(action.id)}>{t(action.label)}</button>)}</div>
      <div className="ai-input">
        <textarea rows={1} value={draft} placeholder={t('就这篇文档提问…')} aria-label={t('就这篇文档提问…')} onChange={(event) => setDraft(event.target.value)} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)}
          // Enter sends; Shift+Enter breaks the line; Enter that confirms an IME candidate does neither.
          onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !composing && !event.nativeEvent.isComposing) { event.preventDefault(); send() } }} />
        {ai.busy
          ? <button type="button" className="ai-send" title={t('停止')} aria-label={t('停止')} onClick={() => void ai.stop()}><Square aria-hidden="true" /></button>
          : <button type="button" className="ai-send" title={t('发送')} aria-label={t('发送')} disabled={!draft.trim()} onClick={send}><ArrowUp aria-hidden="true" /></button>}
      </div>
    </footer>
  </aside>
}

/** Shown every time AI is switched on (T73): what leaves this Mac, where it goes, and that it is optional. */
export function AiConsentDialog({ workspace: w }: { workspace: DocumentWorkspace }) {
  const { ai, t } = w
  if (!ai.consentOpen) return null
  return <FocusTrap><div className="settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) ai.setConsentOpen(false) }}>
    <section className="consent-dialog" role="alertdialog" aria-modal="true" aria-labelledby="ai-consent-title">
      <h2 id="ai-consent-title">{t('开启 AI 功能')}</h2>
      <p>{t('Mino 默认不联网。开启后，只有在你点击提问、摘要或处理选中文字时，才会把下列内容发送到你配置的服务：')}</p>
      <ul>
        <li>{t('当前文档的标题和正文（长文档会分段或截断）')}</li>
        <li>{t('你输入的问题，以及本次对话里之前的问答')}</li>
      </ul>
      <p>{t('发送到：')}<strong>{t(providerLabels[ai.config.provider])}</strong> · {host(ai.config.baseUrl)}</p>
      <p>{t('图片和其他文件不会发送。API 密钥保存在 macOS 钥匙串里。对方如何保存和使用这些内容，由该服务的条款决定。可随时在设置里关闭。')}</p>
      <div className="consent-actions"><button type="button" onClick={() => ai.setConsentOpen(false)}>{t('取消')}</button><button type="button" className="primary" autoFocus onClick={() => void ai.confirmConsent()}>{t('同意并开启')}</button></div>
    </section>
  </div></FocusTrap>
}
