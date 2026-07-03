/**
 * App — root component.
 * Manages auth, session routing, deep-link handling, and mini-mode.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth }        from '@/hooks/useAuth'
import { getSession }     from '@/lib/api'
import { AuthGate }       from '@/components/AuthGate'
import { IdleScreen }     from '@/components/IdleScreen'
import { SessionOverlay } from '@/components/SessionOverlay'
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
      className={`relative h-9 select-none transition-all hover:scale-105 active:scale-95 flex items-center justify-center gap-1.5 ${showTimer ? 'rounded-full px-1.5 pr-3' : 'rounded-full w-9'}`}
      style={{
        background: showTimer ? 'rgba(8,8,12,0.95)' : 'linear-gradient(135deg,#6366f1,#8b5cf6)',
        boxShadow: showTimer
          ? '0 2px 10px rgba(239,68,68,0.25), 0 0 0 1px rgba(239,68,68,0.35)'
          : '0 2px 10px rgba(99,102,241,0.4), 0 0 0 1px rgba(255,255,255,0.12)',
        cursor: isDragging ? 'grabbing' : 'grab',
        userSelect: 'none',
      } as React.CSSProperties}
    >
      {showTimer ? (
        <>
          <span className="relative h-6 w-6 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
            <span className="text-white font-black text-[9px] tracking-tight">IA</span>
            {/* Recording/billing indicator — session is live and charging */}
            <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse"
                  style={{ boxShadow: '0 0 0 2px rgba(8,8,12,0.95), 0 0 6px rgba(239,68,68,0.8)' }} />
          </span>
          <span className="text-red-300 text-[11px] font-mono font-bold tabular-nums">{timerLabel}</span>
        </>
      ) : (
        <>
          <span className="text-white font-black text-[12px] tracking-tight">IA</span>
          <span
            className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full ${active ? 'bg-green-400 animate-pulse' : 'bg-white/30'}`}
            style={{ boxShadow: '0 0 0 2px rgba(8,8,12,0.9)' }}
          />
        </>
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

  const handleHide = useCallback((currentHeight = 340) => {
    restoreHeightRef.current = currentHeight
    setMiniMode(true)
  }, [])

  const handleRestore = useCallback(() => {
    setMiniMode(false)
    window.electronAPI.window.setHeight(restoreHeightRef.current)
    window.electronAPI.window.setSize(860, restoreHeightRef.current)
  }, [])

  const loadSession = useCallback(async (sessionId: string) => {
    setLoadingSession(true)
    setSessionError(null)
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
