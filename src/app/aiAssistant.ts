import { useEffect, useMemo, useRef, useState } from 'react'
import { AiClient, disabledConfig, type AiConfig, type AiProvider, type AiTransport } from '../features/ai/client'
import { aiErrorText, answerReplacesSelection, askMessages, combinedSummaryMessages, CONTEXT_BUDGET, documentContext, insertableMarkdown, localSuggestions, noteFileName, noteMarkdown, parseSuggestions, partSummaryMessages, presets, selectionActions, selectionMessages, suggestionPrompt, summaryParts, type AiLanguage, type AiPresetId, type AiSelectionAction, type ChatMessage } from '../features/ai/prompts'

export type AiTurn = {
  id: number
  role: 'user' | 'assistant'
  text: string
  status: 'streaming' | 'done' | 'error' | 'cancelled'
  /** Shown above an answer while parts of a long document are being read. */
  progress?: string
  /** Shown under an answer: what was left out of a long document. */
  note?: string
  error?: string
  /** Sanitized HTML of a finished answer; the plain text is shown until it is ready. */
  html?: string | null
  /** Set on answers to a selection action, which can be inserted into the document. */
  selectionAction?: AiSelectionAction
}

export type AiSelection = { selection: string; before: string; after: string }
export type AiDocument = { title: string; markdown: string }
export type InsertPlacement = 'replace' | 'after'

export type AiAssistantInput = {
  /** Null outside the desktop app, where no Rust commands exist. */
  transport: AiTransport | null
  documentId: number
  language: AiLanguage
  getDocument: () => AiDocument
  /**
   * Called before the document is read for a question. A PDF has its text extracted here (T88); it rejects
   * with `PDF_NO_TEXT` for a scan, and then nothing is sent.
   */
  prepareDocument?: () => Promise<void>
  getHeadings: () => { level: number; text: string }[]
  getSelection: () => AiSelection | null
  /** Renders an answer with the preview pipeline, so it is sanitized the same way. */
  renderMarkdown: (markdown: string) => Promise<string | null>
  insertMarkdown: (markdown: string, placement: InsertPlacement) => void
  /** Saves a note through a save dialog that starts beside the document; resolves to the file name, or null when cancelled. */
  saveNote: (name: string, markdown: string) => Promise<string | null>
  onStatus: (message: string) => void
}

let nextTurnId = 1

/** State and actions of the AI drawer. The workspace hook owns the IPC and passes it in as `transport`. */
export function useAiAssistant(input: AiAssistantInput) {
  const inputRef = useRef(input)
  inputRef.current = input
  const { transport, documentId } = input
  const client = useMemo(() => transport ? new AiClient(transport) : null, [transport])
  const [config, setConfig] = useState<AiConfig>(disabledConfig)
  const [open, setOpen] = useState(false)
  const openAfterConsent = useRef(false)
  const [consentOpen, setConsentOpen] = useState(false)
  const [conversations, setConversations] = useState<Map<number, AiTurn[]>>(() => new Map())
  const [suggested, setSuggested] = useState<Map<number, string[]>>(() => new Map())
  const [busy, setBusy] = useState(false)
  /** The models a service listed, kept with the provider and address they came from. */
  const [listed, setListed] = useState<{ source: string; ids: string[] } | null>(null)
  const [modelsBusy, setModelsBusy] = useState(false)
  const [modelsFailure, setModelsFailure] = useState<{ source: string; text: string } | null>(null)
  const modelsRequest = useRef(0)
  const modelSource = `${config.provider}|${config.baseUrl}`
  const running = useRef<{ requestId: string | null; cancelled: boolean; documentId: number } | null>(null)
  const turns = conversations.get(documentId) ?? []

  useEffect(() => {
    if (!transport || !client) return
    let stopped = false
    const stops: (() => void)[] = []
    const keep = (stop: () => void) => { if (stopped) stop(); else stops.push(stop) }
    void client.listen().then(keep)
    void transport.listen<AiConfig>('ai-config-changed', (next) => setConfig(next)).then(keep)
    void transport.invoke<AiConfig>('ai_get_config').then(setConfig).catch(() => undefined)
    return () => { stopped = true; stops.forEach((stop) => stop()) }
  }, [transport, client])

  // The drawer belongs to an enabled assistant: switching AI off anywhere closes it and stops a request.
  useEffect(() => {
    if (config.enabled) return
    setOpen(false)
    void stop()
  }, [config.enabled])

  function updateTurn(forDocument: number, id: number, patch: Partial<AiTurn>) {
    setConversations((current) => {
      const list = current.get(forDocument)
      if (!list) return current
      const next = new Map(current)
      next.set(forDocument, list.map((turn) => turn.id === id ? { ...turn, ...patch } : turn))
      return next
    })
  }

  function appendTurns(forDocument: number, added: AiTurn[]) {
    setConversations((current) => new Map(current).set(forDocument, [...(current.get(forDocument) ?? []), ...added]))
  }

  /** Earlier exchanges that finished: a question whose answer failed or was stopped is left out with it. */
  function history(forDocument: number): ChatMessage[] {
    const list = conversations.get(forDocument) ?? []
    const messages: ChatMessage[] = []
    for (let index = 0; index + 1 < list.length; index++) {
      const [question, answer] = [list[index], list[index + 1]]
      if (question.role === 'user' && answer.role === 'assistant' && answer.status === 'done' && answer.text) messages.push({ role: 'user', content: question.text }, { role: 'assistant', content: answer.text })
    }
    return messages
  }

  /** Runs one exchange: shows the question, streams the answer and renders it when it is complete. */
  async function exchange(shown: string, produce: (step: (messages: ChatMessage[], visible: boolean) => Promise<string>, progress: (text: string) => void) => Promise<{ note?: string }>, selectionAction?: AiSelectionAction) {
    if (!client || busy) return
    if (!config.enabled) { inputRef.current.onStatus(aiErrorText('AI_DISABLED')); return }
    if (!config.consented) { setConsentOpen(true); return }
    const forDocument = documentId
    const answer: AiTurn = { id: nextTurnId++, role: 'assistant', text: '', status: 'streaming', selectionAction }
    appendTurns(forDocument, [{ id: nextTurnId++, role: 'user', text: shown, status: 'done' }, answer])
    const state = { requestId: null as string | null, cancelled: false, documentId: forDocument }
    running.current = state
    setBusy(true)
    let text = ''
    const step = async (messages: ChatMessage[], visible: boolean) => {
      if (state.cancelled) throw new Error('AI_CANCELLED')
      const chat = client.chat(messages, visible ? (_piece, whole) => { text = whole; updateTurn(forDocument, answer.id, { text: whole, progress: undefined }) } : undefined)
      state.requestId = chat.requestId
      try { return await chat.done } finally { state.requestId = null }
    }
    try {
      const { note } = await produce(step, (progress) => updateTurn(forDocument, answer.id, { progress }))
      updateTurn(forDocument, answer.id, { status: 'done', text, note, progress: undefined })
      void inputRef.current.renderMarkdown(text).then((html) => updateTurn(forDocument, answer.id, { html }), () => undefined)
    } catch (error) {
      const code = state.cancelled ? 'AI_CANCELLED' : error instanceof Error ? error.message : 'AI_NETWORK'
      updateTurn(forDocument, answer.id, code === 'AI_CANCELLED' ? { status: 'cancelled', text, progress: undefined } : { status: 'error', text, error: aiErrorText(code), progress: undefined })
    } finally {
      if (running.current === state) running.current = null
      setBusy(false)
    }
  }

  async function documentReady(): Promise<boolean> {
    const prepare = inputRef.current.prepareDocument
    if (!prepare) return true
    try { await prepare(); return true }
    catch (error) {
      inputRef.current.onStatus(error instanceof Error && error.message === 'PDF_NO_TEXT' ? '这个 PDF 没有文字层（可能是扫描件），无法分析；Mino 不做文字识别。' : '还不能读取这个文档的文字，请等它打开后再试。')
      return false
    }
  }
  async function ask(question: string, shown: string = question): Promise<void> {
    if (await documentReady()) await askNow(question, shown)
  }
  async function runPreset(id: AiPresetId): Promise<void> {
    if (await documentReady()) await runPresetNow(id)
  }

  /** A question about the whole document. A long document is cut to the budget and the cut is reported. */
  function askNow(question: string, shown: string = question) {
    const text = question.trim()
    if (!text) return Promise.resolve()
    const { title, markdown } = inputRef.current.getDocument()
    const { language } = inputRef.current
    const context = documentContext(markdown)
    const past = history(documentId)
    return exchange(shown.trim(), async (step) => {
      await step(askMessages({ title, context: context.text, question: text, history: past, language }), true)
      return { note: context.truncated ? `文档较长，中间约 ${context.omitted} 字没有发送。` : undefined }
    })
  }

  /** A preset. The summary of a long document reads it part by part and then combines the notes. */
  function runPresetNow(id: AiPresetId) {
    const preset = presets.find((item) => item.id === id)
    if (!preset) return Promise.resolve()
    const { title, markdown } = inputRef.current.getDocument()
    const { language } = inputRef.current
    const question = preset.prompt[language]
    if (id !== 'summary' || markdown.length <= CONTEXT_BUDGET) return askNow(question, preset.label)
    const plan = summaryParts(markdown)
    return exchange(preset.label, async (step, progress) => {
      const notes: string[] = []
      for (const [index, part] of plan.parts.entries()) {
        progress(`正在阅读第 ${index + 1} / ${plan.parts.length} 部分…`)
        notes.push(await step(partSummaryMessages(title, part, index, plan.parts.length, language), false))
      }
      progress('正在汇总…')
      await step(combinedSummaryMessages(title, notes, question, language), true)
      return { note: plan.omitted > 0 ? `文档过长，分 ${plan.parts.length} 部分阅读，末尾约 ${plan.omitted} 字没有发送。` : `文档较长，已分 ${plan.parts.length} 部分阅读后汇总。` }
    })
  }

  function runSelection(action: AiSelectionAction) {
    const picked = inputRef.current.getSelection()
    const label = selectionActions.find((item) => item.id === action)!.label
    if (!picked || !picked.selection.trim()) { inputRef.current.onStatus('请先在文档中选中一段文字。'); return Promise.resolve() }
    if (picked.selection.length > CONTEXT_BUDGET) { inputRef.current.onStatus(`选中的文字超过 ${CONTEXT_BUDGET} 字，请缩小选区。`); return Promise.resolve() }
    const { title } = inputRef.current.getDocument()
    const { language } = inputRef.current
    const excerpt = picked.selection.trim().replace(/\s+/g, ' ')
    return exchange(`${label}：${excerpt.length > 60 ? `${excerpt.slice(0, 60)}…` : excerpt}`, async (step) => {
      await step(selectionMessages({ title, action, language, ...picked }), true)
      return {}
    }, action)
  }

  async function stop() {
    const state = running.current
    if (!state) return
    state.cancelled = true
    if (state.requestId && client) await client.cancel(state.requestId)
  }

  function clear() {
    void stop()
    setConversations((current) => { const next = new Map(current); next.delete(documentId); return next })
  }

  /** Puts an answer into the document; the editor applies it as one undoable change. */
  function insertAnswer(turn: AiTurn, placement: InsertPlacement) {
    const markdown = insertableMarkdown(turn.text)
    if (!markdown) return
    try { inputRef.current.insertMarkdown(markdown, placement); inputRef.current.onStatus(placement === 'replace' ? '已用回答替换选中的文字，可撤销' : '已把回答插入文档，可撤销') }
    catch (error) { inputRef.current.onStatus(error instanceof Error && error.message === 'READING_MODE' ? '阅读模式下不能修改文档，按 ⌘⇧R 开始编辑。' : '当前无法插入，请先把光标放到文档中。') }
  }

  /** Asks the model for three questions about the document; the heading-based ones show until then. */
  async function refreshSuggestions() {
    if (!client || busy || !config.enabled || !config.consented) return
    if (!await documentReady()) return
    const forDocument = documentId
    const { title, markdown } = inputRef.current.getDocument()
    const { language } = inputRef.current
    setBusy(true)
    const chat = client.chat(askMessages({ title, context: documentContext(markdown, CONTEXT_BUDGET / 2).text, question: suggestionPrompt(language), language }))
    const state = { requestId: chat.requestId as string | null, cancelled: false, documentId: forDocument }
    running.current = state
    try {
      const questions = parseSuggestions(await chat.done)
      if (questions.length) setSuggested((current) => new Map(current).set(forDocument, questions))
    } catch (error) {
      if (!state.cancelled) inputRef.current.onStatus(aiErrorText(error instanceof Error ? error.message : 'AI_NETWORK'))
    } finally {
      if (running.current === state) running.current = null
      setBusy(false)
    }
  }

  async function command(name: string, args?: Record<string, unknown>): Promise<boolean> {
    if (!transport) return false
    try { setConfig(await transport.invoke<AiConfig>(name, args)); return true }
    catch (error) { inputRef.current.onStatus(aiErrorText(error instanceof Error ? error.message : String(error))); return false }
  }

  const saveConfig = (patch: Partial<Pick<AiConfig, 'enabled' | 'consented' | 'baseUrl' | 'model'>> & { provider?: AiProvider }) => command('ai_set_config', { patch })
  /** Without a provider, the key of the selected one is meant. */
  const setKey = (key: string, provider?: AiProvider) => command('ai_set_key', provider ? { key, provider } : { key })
  const clearKey = (provider?: AiProvider) => command('ai_clear_key', provider ? { provider } : undefined)
  /** Any model name can be chosen, from the list or typed. */
  const pickModel = (model: string) => { const name = model.trim(); return name && name !== config.model ? saveConfig({ model: name }) : Promise.resolve(name !== '') }

  /** Asks the selected provider for its models. The result is dropped if the provider changed meanwhile. */
  async function fetchModels(): Promise<boolean> {
    if (!client || modelsBusy) return false
    const source = modelSource
    const request = ++modelsRequest.current
    setModelsBusy(true)
    setModelsFailure(null)
    try {
      const ids = await client.listModels()
      if (request === modelsRequest.current) setListed({ source, ids })
      return true
    } catch (error) {
      if (request === modelsRequest.current) setModelsFailure({ source, text: aiErrorText(error instanceof Error ? error.message : 'AI_NETWORK') })
      return false
    } finally {
      if (request === modelsRequest.current) setModelsBusy(false)
    }
  }
  /** Switching AI on always passes through the notice about what is sent and where. */
  const setEnabled = (enabled: boolean) => { openAfterConsent.current = false; if (enabled) setConsentOpen(true); else void saveConfig({ enabled: false }) }
  const confirmConsent = async () => {
    if (!await saveConfig({ enabled: true, consented: true })) return
    setConsentOpen(false)
    if (openAfterConsent.current) { openAfterConsent.current = false; setOpen(true) }
  }
  /** The AI button is always there. While AI is off it leads to the notice about what is sent, and on agreement to the drawer. */
  const toggleOpen = () => {
    if (!config.enabled || !config.consented) { openAfterConsent.current = true; setConsentOpen(true); return }
    setOpen((current) => !current)
  }

  /** Saves an answer as a Markdown note; the save dialog starts in the document's folder with a suggested name. */
  async function saveNote(turn: AiTurn) {
    const answer = insertableMarkdown(turn.text)
    if (!answer) return
    const { title } = inputRef.current.getDocument()
    const index = turns.findIndex((item) => item.id === turn.id)
    const question = index > 0 && turns[index - 1].role === 'user' ? turns[index - 1].text : ''
    try {
      const saved = await inputRef.current.saveNote(noteFileName(title), noteMarkdown({ title, question, answer, source: `${config.provider} · ${config.model}`, date: new Date(), language: inputRef.current.language }))
      if (saved) inputRef.current.onStatus(`已保存 ${saved}`)
    } catch (error) { inputRef.current.onStatus(error instanceof Error && error.message === 'TARGET_EXISTS' ? '同名文件已存在，请换一个名字。' : '保存失败，请重试。') }
  }

  // Heading-based questions are only worked out while the empty drawer shows them.
  const suggestions = !open || turns.length > 0 ? [] : suggested.get(documentId) ?? localSuggestions(input.getHeadings(), input.language)
  return { saveNote, available: transport !== null, config, open, setOpen, toggleOpen, consentOpen, setConsentOpen, confirmConsent, setEnabled, saveConfig, setKey, clearKey, pickModel, fetchModels, fetchedModels: listed?.source === modelSource ? listed.ids : null, modelsBusy, modelsError: modelsFailure?.source === modelSource ? modelsFailure.text : null, turns, busy, ask, runPreset, runSelection, stop, clear, insertAnswer, suggestions, refreshSuggestions, canReplace: answerReplacesSelection }
}

export type AiAssistant = ReturnType<typeof useAiAssistant>
