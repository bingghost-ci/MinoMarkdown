import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { AiTransport } from '../features/ai/client'
import { typographyVariables } from '../features/reading/css'
import type { ReadingStyle } from '../features/reading/styles'
import { applyRemoteSettings } from './settingsSync'
import { untilCleanup } from './subscription'

/** What the document windows and the settings window both do with the settings, so the two cannot drift apart. */

/** Whether macOS is in its dark appearance, following changes while the window is open. */
export function useSystemDark(): boolean {
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false)
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystemDark(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])
  return systemDark
}

/** Writes the typography of a style onto `<html>` as CSS variables; nothing is rebuilt. */
export function writeTypography(typography: Parameters<typeof typographyVariables>[0], style: ReadingStyle): void {
  const root = window.document.documentElement
  for (const [name, value] of Object.entries(typographyVariables(typography, style))) root.style.setProperty(name, value)
  root.style.setProperty('--editor-font', typography.fontFamily)
  root.style.setProperty('--editor-font-size', `${typography.fontSize}px`)
  // The layout's rules are all in the app stylesheet, chosen by this attribute (T122).
  root.dataset.layout = typography.layout ?? 'standard'
}

/** The assistant's way to Rust from a window of the app: commands, and events sent to this window. */
export function tauriAiTransport(): AiTransport {
  return {
    invoke: (command, args) => invoke(command, args),
    listen: (event, handler) => getCurrentWindow().listen(event, (message) => handler(message.payload as never)),
  }
}

type Held<T> = { current: T }

/**
 * Takes in the settings another window saved, for as long as the effect lives: fields this window has not
 * changed itself follow, and `persisted` records what is on disk. Returns the cleanup.
 */
export function followSavedSettings<T extends object>(current: Held<T>, persisted: Held<T>, apply: (settings: T) => void): () => void {
  return untilCleanup(listen<T>('settings-changed', (event) => {
    const merged = applyRemoteSettings(current.current, persisted.current, event.payload)
    persisted.current = merged.persisted
    if (merged.current !== current.current) apply(merged.current)
  }))
}

/** Saves changed settings after `delay` ms, so a run of changes is one write; the cleanup drops a save not yet sent. */
export function saveSettingsLater<T extends object>(persisted: Held<T>, patch: Partial<T>, delay: number, onError: (error: unknown) => void = () => undefined): () => void {
  const timer = window.setTimeout(() => {
    invoke('update_settings', { patch }).then(() => { persisted.current = { ...persisted.current, ...patch } }).catch(onError)
  }, delay)
  return () => window.clearTimeout(timer)
}

/** Gives the system window the appearance of the reading style: its light or dark chrome, and the color shown while it is resized. */
export function paintWindow(dark: boolean, background: string): void {
  const current = getCurrentWindow()
  void current.setTheme(dark ? 'dark' : 'light').catch(() => undefined)
  void current.setBackgroundColor(background).catch(() => undefined)
}
