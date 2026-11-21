import { lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { App } from './app/App'
import { SETTINGS_WINDOW } from './app/useSettingsWindow'
import './features/reading/bundledFonts.css'
import './styles.css'
import { installReadingStyles } from './features/reading/install'

installReadingStyles()

const SettingsWindow = lazy(() => import('./app/SettingsWindow').then((module) => ({ default: module.SettingsWindow })))

// The settings window (T113) loads the same page and shows the settings alone.
const settingsWindow = isTauri() && getCurrentWindow().label === SETTINGS_WINDOW
createRoot(document.getElementById('root')!).render(settingsWindow ? <Suspense fallback={null}><SettingsWindow /></Suspense> : <App />)
