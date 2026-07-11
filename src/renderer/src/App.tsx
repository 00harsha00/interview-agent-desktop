/**
 * App — root component.
 * Manages auth, session routing, deep-link handling, and mini-mode.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal }   from 'react-dom'
import { useAuth }        from '@/hooks/useAuth'
import { getSession }     from '@/lib/api'
import { AuthGate }       from '@/components/AuthGate'
import { IdleScreen }     from '@/components/IdleScreen'
import { SessionOverlay, WaveformBars } from '@/components/SessionOverlay'
import type { CallSession, SessionProtocolPayload } from '@/types'

// Mouse-passthrough: transparent areas stay click-through
function setIgnoreMouse(v: boolean) {
  try { window.electronAPI?.window?.setIgnoreMouse?.(v) } catch { /* ignore */ }
}
function useMousePassthrough() {
  const over = useRef(false)
  useEffect(() => {
    const enable  = () => { if (!over.current) { over.current = true;  setIgnoreMouse(false) } }
    const disable = () => { if (over.current)  { over.current = false; setIgnoreMouse(true)  } }
    const onMove  = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
      el?.closest('[data-overlay]') ? enable() : disable()
    }
    document.addEventListener('mousemove', onMove, { passive: true })
    setIgnoreMouse(true)
    // DEV verification: run `localStorage.setItem('debug-passthrough','1')` in
    // DevTools and reload — the transparent (click-through) area tints red so
    // you can confirm only the solid dialog captures clicks.
    if (import.meta.env.DEV && localStorage.getItem('debug-passthrough')) {
      document.body.style.background = 'rgba(255,0,0,0.12)'
    }
    return () => { document.removeEventListener('mousemove', onMove); setIgnoreMouse(false) }
  }, [])
}

// Converts an Electron accelerator string (e.g. 'Control+Command+I') into
// its on-screen keyboard-symbol form (e.g. '⌃⌘I') for the focus toast —
// main sends whichever accelerator actually ended up registered (it tries
// several in order, see registerShortcuts in main/index.ts), so this can't
// be a hardcoded label.
const ACCELERATOR_SYMBOLS: Record<string, string> = {
  Control: '⌃', Ctrl: '⌃',
  Command: '⌘', Cmd: '⌘',
  CommandOrControl: '⌘', CmdOrCtrl: '⌘',
  Alt: '⌥', Option: '⌥',
  Shift: '⇧',
  Space: 'Space',
}
function formatAccelerator(accelerator: string | null | undefined): string {
  if (!accelerator) return ''
  return accelerator.split('+').map((part) => ACCELERATOR_SYMBOLS[part] ?? part).join('')
}

// ── Focus toast — brief "App focused" acknowledgment for the global
// bring-to-front shortcut. Mounted as its own always-present sibling of
// <App/> (see main.tsx) rather than inside App's own JSX, since App has
// several early-return branches (loading/auth/idle/mini/session) and the
// toast needs to show regardless of which one is currently active.
export function FocusToast() {
  const [visible, setVisible] = useState(false)
  const [accelerator, setAccelerator] = useState<string | null>(null)
  useEffect(() => {
    let hideTimer: ReturnType<typeof setTimeout> | undefined
    const unsub = window.electronAPI.on('shortcut:app-focused', (accel: unknown) => {
      setAccelerator((accel as string) ?? null)
      setVisible(true)
      clearTimeout(hideTimer)
      hideTimer = setTimeout(() => setVisible(false), 1500)
    })
    return () => { unsub(); clearTimeout(hideTimer) }
  }, [])

  return createPortal(
    <div
      style={{
        position: 'fixed',
        top: 10,
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(20,20,30,0.92)',
        border: '1px solid rgba(139,92,246,0.4)',
        color: 'rgba(255,255,255,0.9)',
        fontSize: 11.5,
        fontWeight: 500,
        padding: '5px 12px',
        borderRadius: 999,
        pointerEvents: 'none',
        zIndex: 999999,
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.3s ease',
      }}
    >
      App focused{accelerator ? ` ${formatAccelerator(accelerator)}` : ''}
    </div>,
    document.body,
  )
}

// ── Auth notice toast — "couldn't verify, working offline" / "signed out
// elsewhere" acknowledgments. Mounted as an always-present sibling of <App/>
// (see main.tsx), same reasoning as FocusToast: App has several early-return
// branches and this needs to show regardless of which one is active.
export function AuthNoticeToast() {
  const [message, setMessage] = useState<string | null>(null)
  useEffect(() => {
    let hideTimer: ReturnType<typeof setTimeout> | undefined
    const show = (text: string, durationMs: number) => {
      setMessage(text)
      clearTimeout(hideTimer)
      hideTimer = setTimeout(() => setMessage(null), durationMs)
    }
    const u1 = window.electronAPI.on('auth:verify-warning', () => {
      show("Couldn't verify with the server — working offline", 4_000)
    })
    const u2 = window.electronAPI.on('auth:force-logout', () => {
      show("You've been signed out on another device", 5_000)
    })
    const u3 = window.electronAPI.on('display:moved-to-primary', (msg: unknown) => {
      show((msg as string) || 'External display disconnected — moved to main screen', 4_000)
    })
    return () => { u1(); u2(); u3(); clearTimeout(hideTimer) }
  }, [])

  return createPortal(
    <div
      style={{
        position: 'fixed',
        top: 10,
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(20,20,30,0.92)',
        border: '1px solid rgba(245,158,11,0.4)',
        color: 'rgba(255,255,255,0.9)',
        fontSize: 11.5,
        fontWeight: 500,
        padding: '5px 12px',
        borderRadius: 999,
        pointerEvents: 'none',
        zIndex: 999999,
        opacity: message ? 1 : 0,
        transition: 'opacity 0.3s ease',
      }}
    >
      {message}
    </div>,
    document.body,
  )
}

// ── Mini-bar shown when "hidden" ───────────────────────────────────────────
// When a session is running (endsAt set), shows a pulsing red "recording/billing"
// dot plus the live countdown so the user always knows credits are being spent.
function MiniBar({ onRestore, active, endsAt }: { onRestore: () => void; active: boolean; endsAt: number | null }) {
  const [isDragging, setIsDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const positionRef = useRef({ x: 0, y: 0 })
  const [now, setNow] = useState(() => Date.now())

  const showTimer = active && endsAt !== null
  useEffect(() => {
    if (!showTimer) return
    const id = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(id)
  }, [showTimer])

  const remaining = showTimer ? Math.max(0, Math.floor((endsAt! - now) / 1000)) : null
  const timerLabel = remaining !== null
    ? `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`
    : null

  useEffect(() => {
    window.electronAPI.window.setSize(showTimer ? 130 : 48, 48)
  }, [showTimer])

  useEffect(() => {
    // Load saved position from localStorage (once, on entering mini mode)
    const saved = localStorage.getItem('minibar-position')
    if (saved) {
      try {
        const pos = JSON.parse(saved)
        positionRef.current = pos
        window.electronAPI.window.setPosition(pos.x, pos.y)
      } catch (e) {
        console.warn('Failed to restore minibar position:', e)
      }
    }
  }, [])

  const handleMouseDown = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return // only left click
    setIsDragging(true)
    // Get current window position
    // We'll track movement relative to the click point
    setDragOffset({ x: e.clientX, y: e.clientY })
  }

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - dragOffset.x
      const deltaY = e.clientY - dragOffset.y
      positionRef.current.x += deltaX
      positionRef.current.y += deltaY
      setDragOffset({ x: e.clientX, y: e.clientY })
      window.electronAPI.window.setPosition(positionRef.current.x, positionRef.current.y)
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      // Save position to localStorage
      localStorage.setItem('minibar-position', JSON.stringify(positionRef.current))
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, dragOffset])

  return (
    <button
      data-overlay
      onMouseDown={handleMouseDown}
      onClick={onRestore}
      title={showTimer ? 'Session running — click to expand' : 'Expand overlay'}
      className="relative select-none transition-all hover:scale-105 active:scale-95 flex items-center"
      style={{
        // Glossy brand-color glass pill. Brand color = indigo #6366f1 →
        // violet #8b5cf6 (the same gradient as the app icon/logo and every
        // other accent in the app — see resources/icon.svg and
        // tailwind.config's "accent-primary/secondary" — NOT the Answer
        // button's green, which tailwind.config itself labels "legacy...
        // for backwards compatibility" rather than the brand identity).
        //
        // No boxShadow/filter/backdropFilter anywhere on this pill: it's the
        // only content on screen in front of a fully transparent Electron
        // window (transparent:true), so there's nothing real behind it for a
        // blur/shadow to composite against — that's the mechanism behind the
        // recurring "white ring/halo" reports. Opacity and a plain border
        // carry the depth instead.
        background: 'linear-gradient(135deg, rgba(99,102,241,0.95) 0%, rgba(139,92,246,0.92) 100%)',
        border: '1px solid rgba(139,92,246,0.6)',
        borderRadius: 999,
        padding: '6px 14px',
        gap: 8,
        cursor: isDragging ? 'grabbing' : 'grab',
        userSelect: 'none',
      } as React.CSSProperties}
    >
      <span className="relative flex items-center flex-shrink-0">
        <WaveformBars active={active} />
        {showTimer && (
          // Recording/billing indicator — session is live and charging.
          // Only shown once a session is actually running; otherwise the
          // waveform's own static/animating state is the only status cue.
          <span className="absolute -bottom-1 -right-1 h-2 w-2 rounded-full bg-red-500 animate-pulse" />
        )}
      </span>
      {showTimer && (
        <span style={{ color: 'rgba(255,255,255,0.9)', fontWeight: 500, fontSize: 13 }} className="font-mono tabular-nums">
          {timerLabel}
        </span>
      )}
    </button>
  )
}

type View = 'idle' | 'session'

export default function App() {
  useMousePassthrough()

  const { state: authState, user, refetch } = useAuth()
  const [view,          setView]          = useState<View>('idle')
  const [activeSession, setActiveSession] = useState<CallSession | null>(null)
  const [loadingSession,setLoadingSession]= useState(false)
  const [sessionError,  setSessionError]  = useState<string | null>(null)
  const [miniMode,      setMiniMode]      = useState(false)
  // Reported by SessionOverlay so the mini bar can show a live timer + billing dot
  const [sessionMeta,   setSessionMeta]   = useState<{ running: boolean; endsAt: number | null }>({ running: false, endsAt: null })
  const restoreHeightRef = useRef(340)
  // The app's real width (1/3 of the screen, computed once in main) — fetched
  // once so restoring from the mini-bar doesn't fall back to a hardcoded guess.
  const appWidthRef = useRef(860)
  useEffect(() => {
    let cancelled = false
    window.electronAPI.window.getWorkAreaSize?.().then((size) => {
      if (!cancelled && size?.appWidth) appWidthRef.current = size.appWidth
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  const handleHide = useCallback((currentHeight = 340) => {
    restoreHeightRef.current = currentHeight
    setMiniMode(true)
  }, [])

  const handleRestore = useCallback(() => {
    setMiniMode(false)
    window.electronAPI.window.setHeight(restoreHeightRef.current)
    window.electronAPI.window.setSize(appWidthRef.current, restoreHeightRef.current)
  }, [])

  // ⌃⌘H on macOS / Ctrl+H on Windows (main-registered global shortcut) —
  // same toggle as clicking the ∧/∨ button. Not ⌘H — that's macOS's
  // system-wide "Hide app" shortcut.
  useEffect(() => {
    return window.electronAPI.on('shortcut:toggle-collapse', () => {
      if (miniMode) handleRestore()
      else handleHide()
    })
  }, [miniMode, handleHide, handleRestore])

  // Ctrl+Cmd+I (main-registered global "bring to front" shortcut) — restore
  // out of the mini pill first, so the app doesn't just float forward still
  // collapsed to a tiny bar.
  useEffect(() => {
    return window.electronAPI.on('shortcut:restore-from-mini', () => {
      if (miniMode) handleRestore()
    })
  }, [miniMode, handleRestore])

  const loadSession = useCallback(async (sessionId: string) => {
    setLoadingSession(true)
    setSessionError(null)
    // Belt-and-suspenders alongside main's own bringToFront() on the deep
    // link itself — makes sure the window is actually in front by the time
    // session data is ready to display, regardless of what state it was in.
    void window.electronAPI.window.forceShow()
    try {
      const s = await getSession(sessionId)
      if (!s) { setSessionError('Session not found.'); return }
      if (s.status === 'ENDED') { setSessionError('This session has already ended.'); return }
      setActiveSession(s)
      setView('session')
      setMiniMode(false)
    } catch (err) {
      setSessionError(`Failed to load: ${(err as Error).message}`)
    } finally {
      setLoadingSession(false)
    }
  }, [])

  useEffect(() => {
    const unsub = window.electronAPI.on('protocol:session', (raw: unknown) => {
      const payload = raw as SessionProtocolPayload
      const id = payload?.callSessionId ?? payload?.sessionId
      if (id) void loadSession(id)
    })
    return unsub
  }, [loadSession])

  const handleSessionEnd = useCallback(() => {
    setActiveSession(null)
    setView('idle')
    setSessionMeta({ running: false, endsAt: null })
  }, [])

  // Server revoked this token (e.g. user signed out on the website) — reset
  // straight to idle/unauthenticated. If a session was active, SessionOverlay
  // is unmounted by this state change; its own unmount cleanup effect still
  // tears down audio/Speechmatics/AI, so nothing is left running silently.
  useEffect(() => {
    return window.electronAPI.on('auth:force-logout', () => {
      handleSessionEnd()
      setMiniMode(false)
      void refetch()
    })
  }, [handleSessionEnd, refetch])

  const inSession = authState === 'authenticated' && view === 'session' && !!activeSession

  // ── Mini mode (no active session) ───────────────────────────────────────────
  // With a session active we do NOT return early here — the session branch below
  // keeps SessionOverlay MOUNTED (hidden via CSS) so audio/transcription/timer/
  // ping/billing all keep running in the background while only the logo shows.
  if (miniMode && !inSession) {
    return <div className="flex justify-center"><MiniBar onRestore={handleRestore} active={false} endsAt={null} /></div>
  }

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loadingSession) {
    return (
      <div data-overlay className="overlay-card flex items-center gap-2 px-4 py-3 text-sm text-white/50">
        <div className="h-4 w-4 border-2 border-white/20 border-t-green-400 rounded-full animate-spin" />
        Loading session…
      </div>
    )
  }
  if (sessionError) {
    return (
      <div data-overlay className="overlay-card flex items-center gap-3 px-4 py-3">
        <p className="text-red-400 text-sm flex-1">{sessionError}</p>
        <button onClick={() => { setSessionError(null); setView('idle') }}
          className="text-xs text-white/40 hover:text-white/70 underline">Dismiss</button>
      </div>
    )
  }

  // ── Auth ───────────────────────────────────────────────────────────────────
  if (authState === 'loading' || authState === 'unauthenticated') {
    return (
      <div className="w-full">
        <AuthGate state={authState} onHide={handleHide} onAuthSuccess={refetch} />
      </div>
    )
  }

  // ── Idle ───────────────────────────────────────────────────────────────────
  if (authState === 'authenticated' && user && view === 'idle') {
    return (
      <div className="w-full">
        <IdleScreen
          user={user}
          onHide={handleHide}
          onSignOut={refetch}
          onStartSession={(session) => {
            setActiveSession(session)
            setView('session')
            setMiniMode(false)
          }}
        />
      </div>
    )
  }

  // ── Session ────────────────────────────────────────────────────────────────
  // "Exit"/hide keeps SessionOverlay mounted (display:none) so nothing tears
  // down; the mini bar renders alongside it with the live timer/billing dot.
  if (inSession && activeSession) {
    return (
      <>
        {miniMode && (
          <div className="flex justify-center">
            <MiniBar onRestore={handleRestore} active={sessionMeta.running} endsAt={sessionMeta.endsAt} />
          </div>
        )}
        <div className="w-full" style={miniMode ? { display: 'none' } : undefined}>
          <SessionOverlay
            session={activeSession}
            userCredits={user?.credits ?? 0}
            isAdmin={user?.isAdmin ?? false}
            userEmail={user?.email}
            hidden={miniMode}
            onSessionMeta={setSessionMeta}
            onEnd={handleSessionEnd}
            onHide={handleHide}
          />
        </div>
      </>
    )
  }

  return null
}
