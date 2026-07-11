import React from 'react'
import ReactDOM from 'react-dom/client'
import App, { FocusToast, AuthNoticeToast, UpdateBanner } from './App'
import { SettingsPopoverWindow } from './components/SessionOverlay'
import { ErrorBoundary } from './components/ErrorBoundary'
import './index.css'

// The settings popover is a separate BrowserWindow (see main process
// createPopoverWindow) that loads this SAME bundle with ?view=popover, so it
// gets its own preload/IPC bridge for free. Branching here — before <App/>
// (and its useAuth polling, mousemove passthrough tracking, etc.) ever
// mounts — is what keeps that window from doing any of that pointless work;
// gating inside App itself wouldn't be enough, since hooks can't be called
// conditionally partway through a component that already started rendering.
const view = new URLSearchParams(window.location.search).get('view')
const isPopoverView = view === 'popover'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      {isPopoverView ? <SettingsPopoverWindow /> : <><App /><FocusToast /><AuthNoticeToast /><UpdateBanner /></>}
    </ErrorBoundary>
  </React.StrictMode>,
)
