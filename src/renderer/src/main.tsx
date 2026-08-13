import React from 'react'
import ReactDOM from 'react-dom/client'
import App, { FocusToast, AuthNoticeToast, UpdateBanner } from './App'
import { SettingsPopoverWindow } from './components/SessionOverlay'
import { TooltipView } from './components/TooltipView'
import { MicSelectorView } from './components/MicSelectorView'
import { ErrorBoundary } from './components/ErrorBoundary'
import './index.css'

// Electron's setDisplayMediaRequestHandler can throw a TypeError ("Video was
// requested, but no video stream was provided") in its internal plumbing —
// this bypasses the renderer's try/catch around getDisplayMedia and surfaces
// as an unhandled rejection. Suppress it here; the application-level catch
// already handles the fallback (e.g. switching to mic-only).
window.addEventListener('unhandledrejection', (e) => {
  if (e.reason instanceof TypeError && /video.*stream/i.test(e.reason.message)) {
    console.warn('[main.tsx] Suppressed Electron video stream TypeError:', e.reason.message)
    e.preventDefault()
  }
})

// Separate BrowserWindows (popover, tooltip) load this SAME bundle with a
// ?view= query parameter. Branching here — before <App/> and its hooks ever
// mount — keeps those windows from doing any pointless work.
const view = new URLSearchParams(window.location.search).get('view')

function Root() {
  if (view === 'tooltip') return <TooltipView />
  if (view === 'popover') return <SettingsPopoverWindow />
  if (view === 'mic-selector') return <MicSelectorView />
  return <><App /><FocusToast /><AuthNoticeToast /><UpdateBanner /></>
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </React.StrictMode>,
)
