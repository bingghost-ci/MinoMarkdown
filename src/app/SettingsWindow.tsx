import { SettingsDialog } from './components/SettingsDialog'
import { useSettingsWindow } from './useSettingsWindow'

/** The page of the settings window (T113): the settings alone, filling a native window. */
export function SettingsWindow() {
  return <SettingsDialog workspace={useSettingsWindow()} windowed />
}
