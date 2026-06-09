/**
 * App — root component.
 * Manages auth state, session routing, and protocol deep-link handling.
 * The window is transparent; each child renders its own visible background.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth }          from '@/hooks/useAuth'
import { getSession }       from '@/lib/api'
import { AuthGate }         from '@/components/AuthGate'
import { IdleScreen }       from '@/components/IdleScreen'
import { SessionOverlay }   from '@/components/SessionOverlay'
import type { CallSession, SessionProtocolPayload } from '@/types'

// Mouse-passthrough helper: make transparent areas click-through
function setIgnoreMouse(v: boolean) {
  try { window.electronAPI?.window?.setIgnoreMouse?.(v) } catch { /* ignore */ }
}

function useMousePassthrough() {
  const over = useRef(false)

  useEffect(() => {
    const enable  = () => { if (!over.current) { over.current = true;  setIgnoreMouse(false) } }
    const disable = () => { if (over.current)  { over.current = false; setIgnoreMouse(true) } }

    const onMove = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
      const isInteractive = !!el?.closest('[data-overlay]')
      isInteractive ? enable() : disable()
    }

    document.addEventListener('mousemove', onMove, { passive: true })
    setIgnoreMouse(true)
    return () => {
      document.removeEventListener('mousemove', onMove)
      setIgnoreMouse(false)
    }
  }, [])
}

type View = 'idle' | 'session'

export default function App() {
  useMousePassthrough()

  const { state: authState, user } = useAuth()
  const [view,           setView]           = useState<View>('idle')
  const [activeSession,  setActiveSession]  = useState<CallSession | null>(null)
  const [loadingSession, setLoadingSession] = useState(false)
  const [sessionError,   setSessionError]  = useState<string | null>(null)

  const loadSession = useCallback(async (sessionId: string) => {
    setLoadingSession(true)
    setSessionError(null)
    try {
      const s = await getSession(sessionId)
      if (!s) { setSessionError('Session not found.'); return }
      if (s.status === 'ENDED') { setSessionError('This session has already ended.'); return }
      setActiveSession(s)
      setView('session')
    } catch (err) {
      setSessionError(`Failed to load session: ${(err as Error).message}`)
    } finally {
      setLoadingSession(false)
    }
  }, [])

  // Handle parakeetai://session?payload=... deep link
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

  // Auth + idle: compact modal at top
  if (authState === 'loading' || authState === 'unauthenticated') {
    return (
      <div className="flex items-start justify-center pt-0">
        <div data-overlay className="w-full">
          <AuthGate state={authState} />
        </div>
      </div>
    )
  }

  // Session loading / error
  if (loadingSession) {
    return (
      <div data-overlay className="flex items-center gap-2 px-4 py-3 bg-gray-900/95 rounded-xl border border-white/10 mx-2 mt-2 text-sm text-white/50">
        <div className="h-4 w-4 border-2 border-white/20 border-t-green-400 rounded-full animate-spin" />
        Loading session…
      </div>
    )
  }

  if (sessionError) {
    return (
      <div data-overlay className="flex items-center gap-3 px-4 py-3 bg-gray-900/95 rounded-xl border border-red-500/20 mx-2 mt-2">
        <p className="text-red-400 text-sm flex-1">{sessionError}</p>
        <button onClick={() => { setSessionError(null); setView('idle') }}
          className="text-xs text-white/40 hover:text-white/70 underline">Dismiss</button>
      </div>
    )
  }

  // Authenticated + no session → idle
  if (authState === 'authenticated' && user && view === 'idle') {
    return (
      <div className="flex items-start justify-center">
        <div data-overlay className="w-full">
          <IdleScreen user={user} />
        </div>
      </div>
    )
  }

  // Active session
  if (authState === 'authenticated' && view === 'session' && activeSession) {
    return (
      <div data-overlay className="w-full">
        <SessionOverlay session={activeSession} onEnd={handleSessionEnd} />
      </div>
    )
  }

  return null
}
