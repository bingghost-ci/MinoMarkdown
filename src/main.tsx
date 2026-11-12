import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import './features/reading/bundledFonts.css'
import './styles.css'
import { installReadingStyles } from './features/reading/install'

installReadingStyles()

createRoot(document.getElementById('root')!).render(<App />)
