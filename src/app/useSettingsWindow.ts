import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { ReadingStyle } from '../features/reading/styles'
import { useAiAssistant } from './aiAssistant'
import { translate } from './i18n'
import { whenStyled } from './whenStyled'
import { activeStyle, documentTypography, pickedStyle } from './readingSettings'
import { settingsPatch } from './settingsSync'
import { followSavedSettings, paintWindow, saveSettingsLater, tauriAiTransport, useSystemDark, writeTypography } from './settingsEffects'
import { defaultSettings, type Settings, type SettingsHost, type SettingsTab } from './useDocumentWorkspace'

/** The label of the settings window; `windows.rs` creates it under this name. */
export const SETTINGS_WINDOW = 'settings'
/** A change is written this soon, so the document windows follow a slider almost as it moves. */
const SAVE_DELAY_MS = 80
const tabs: readonly SettingsTab[] = ['appearance', 'code', 'diagrams', 'typography', 'reading', 'workspace', 'ai']

/**
 * The state behind the settings window (T113). It is a native window of its own, so it can be put beside the
 * document or on another display; it holds no document. Settings travel as in any other window: a change is
 * written with `update_settings`, and Rust broadcasts `settings-changed` to every window, which is how the
 * document windows show a change while it is being made.
 */
export function useSettingsWindow(): SettingsHost {
  const [settings, setSettings] = useState<Settings>(defaultSettings)
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const persisted = useRef<Settings>(defaultSettings)
  const [loaded, setLoaded] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('appearance')
  const systemDark = useSystemDark()
  const [systemFonts, setSystemFonts] = useState<string[] | null>(null)
  const t = useCallback((value: string) => translate(value, settings.language), [settings.language])

  function updateSettings(patch: Partial<Settings> | ((current: Settings) => Partial<Settings>)) {
    setSettings((current) => ({ ...current, ...(typeof patch === 'function' ? patch(current) : patch) }))
  }

  useEffect(() => {
    void invoke<Settings>('get_settings').then((value) => { persisted.current = value; setSettings(value) }).catch(() => undefined).finally(() => setLoaded(true))
    return followSavedSettings(settingsRef, persisted, setSettings)
  }, [])

  // The size of a document window is that window's own, and this window never writes it.
  useEffect(() => {
    if (!loaded) return
    const patch = settingsPatch(persisted.current, settings)
    if (!patch) return
    delete patch.windowWidth
    delete patch.windowHeight
    if (Object.keys(patch).length === 0) return
    return saveSettingsLater(persisted, patch, SAVE_DELAY_MS)
  }, [loaded, settings])

  // Shown once the saved settings are in, so the default style never flashes; Rust answers with the page to open.
  useEffect(() => {
    if (!loaded) return
    let canceled = false
    let stop: (() => void) | undefined
    const open = (tab: string) => { if ((tabs as readonly string[]).includes(tab)) setSettingsTab(tab as SettingsTab) }
    whenStyled(() => void invoke<string>('settings_window_ready').then((tab) => { if (!canceled) open(tab) }).catch(() => undefined))
    void getCurrentWindow().listen<string>('settings-tab', (event) => open(event.payload)).then((unlisten) => { if (canceled) unlisten(); else stop = unlisten })
    return () => { canceled = true; stop?.() }
  }, [loaded])

  const style = activeStyle(settings, systemDark)
  const typography = documentTypography(settings, style)
  const typographyKey = JSON.stringify(typography)
  useEffect(() => {
    const root = window.document.documentElement
    root.dataset.theme = style.id
    root.lang = settings.language
    writeTypography(typography, style)
  }, [typographyKey, style.id, settings.language])
  useEffect(() => {
    paintWindow(style.dark, style.ui.chrome)
  }, [style.id])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) void invoke('close_settings_window').catch(() => undefined) }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  function loadSystemFonts() {
    if (systemFonts !== null) return
    void invoke<string[]>('list_system_fonts').then(setSystemFonts, () => setSystemFonts([]))
  }
  const pickStyle = (picked: ReadingStyle) => updateSettings((current) => ({ ...pickedStyle(picked, current, systemDark) }))

  const transport = useMemo(tauriAiTransport, [])
  // Only the configuration half of the assistant is used here; there is no document to ask about.
  const ai = useAiAssistant({
    transport, documentId: 0, language: settings.language,
    getDocument: () => ({ title: '', markdown: '' }), getHeadings: () => [], getSelection: () => null,
    renderMarkdown: async () => null, insertMarkdown: () => undefined, saveNote: async () => null, onStatus: () => undefined,
  })

  return {
    ai, loadSystemFonts, pickStyle, settings, settingsTab, setSettingsTab, style, systemFonts, t, updateSettings,
    settingsOpen: true,
    setSettingsOpen: (open) => { if (!open) void invoke('close_settings_window').catch(() => undefined) },
  }
}
