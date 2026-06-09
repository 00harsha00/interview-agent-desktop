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
    return () => { document.removeEventListener('mousemove', onMove); setIgnoreMouse(false) }
  }, [])
}

// ── Mini-bar shown when "hidden" ───────────────────────────────────────────
function MiniBar({ onRestore }: { onRestore: () => void }) {
  useEffect(() => {
    window.electronAPI.window.setSize(160, 28)
  }, [])

  return (
    <button
      data-overlay
      onClick={onRestore}
      className="flex items-center gap-1.5 h-7 px-3 rounded-full select-none transition-all hover:scale-105 active:scale-95"
      style={{
        background: 'rgba(8,8,12,0.94)',
        boxShadow: '0 0 0 1px rgba(255,255,255,0.1), 0 4px 16px rgba(0,0,0,0.6)',
        backdropFilter: 'blur(32px)',
      }}
    >
      <span className="h-2 w-2 rounded-full bg-indigo-400 animate-pulse flex-shrink-0" />
      <span className="text-white text-[11px] font-semibold tracking-wide">Interview <span className="text-indigo-400">Agent</span></span>
      <svg className="h-2.5 w-2.5 text-white/40 ml-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
      </svg>
    </button>
  )
}

type View = 'idle' | 'session'

export default function App() {
  useMousePassthrough()

  const { state: authState, user } = useAuth()
  const [view,          setView]          = useState<View>('idle')
  const [activeSession, setActiveSession] = useState<CallSession | null>(null)
  const [loadingSession,setLoadingSession]= useState(false)
  const [sessionError,  setSessionError]  = useState<string | null>(null)
  const [miniMode,      setMiniMode]      = useState(false)
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
  }, [])

  // ── Mini mode ─────────────────────────────────────────────────────────────
  if (miniMode) {
    return <div className="flex justify-center"><MiniBar onRestore={handleRestore} /></div>
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
      <div data-overlay className="w-full">
        <AuthGate state={authState} onHide={handleHide} />
      </div>
    )
  }

  // ── Idle ───────────────────────────────────────────────────────────────────
  if (authState === 'authenticated' && user && view === 'idle') {
    return (
      <div data-overlay className="w-full">
        <IdleScreen user={user} onHide={handleHide} />
      </div>
    )
  }

  // ── Session ────────────────────────────────────────────────────────────────
  if (authState === 'authenticated' && view === 'session' && activeSession) {
    return (
      <div data-overlay className="w-full">
        <SessionOverlay
          session={activeSession}
          userCredits={user?.credits ?? 0}
          isAdmin={user?.isAdmin ?? false}
          onEnd={handleSessionEnd}
          onHide={handleHide}
        />
      </div>
    )
  }

  return null
}
