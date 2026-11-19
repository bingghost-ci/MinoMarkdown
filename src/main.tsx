import { createRoot } from 'react-dom/client'
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { App } from './app/App'
import { SettingsWindow } from './app/SettingsWindow'
import { SETTINGS_WINDOW } from './app/useSettingsWindow'
import './features/reading/bundledFonts.css'
import './styles.css'
import { installReadingStyles } from './features/reading/install'

installReadingStyles()

// The settings window (T113) loads the same page and shows the settings alone.
const settingsWindow = isTauri() && getCurrentWindow().label === SETTINGS_WINDOW
createRoot(document.getElementById('root')!).render(settingsWindow ? <SettingsWindow /> : <App />)
