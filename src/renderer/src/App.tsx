/**
 * App — root component.
 * Manages auth state, session routing, and protocol deep-link handling.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth }          from '@/hooks/useAuth'
import { getSession }       from '@/lib/api'
import { TitleBar }         from '@/components/TitleBar'
import { AuthGate }         from '@/components/AuthGate'
import { IdleScreen }       from '@/components/IdleScreen'
import { SessionOverlay }   from '@/components/SessionOverlay'
import type { CallSession, SessionProtocolPayload } from '@/types'

type View = 'idle' | 'session'

export default function App() {
  const { state: authState, user } = useAuth()
  const [view,         setView]        = useState<View>('idle')
  const [activeSession, setActiveSession] = useState<CallSession | null>(null)
  const [loadingSession, setLoadingSession] = useState(false)
  const [sessionError,  setSessionError]  = useState<string | null>(null)

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
      if (payload?.sessionId) void loadSession(payload.sessionId)
    })
    return unsub
  }, [loadSession])

  const handleSessionEnd = useCallback(() => {
    setActiveSession(null)
    setView('idle')
  }, [])

  // ── Render ──────────────────────────────────────────────────────────────────
  const isActive = view === 'session' && !!activeSession

  return (
    <div className="flex flex-col h-screen bg-gray-900 overflow-hidden text-white">
      <TitleBar isActive={isActive} />

      {/* Auth loading / unauthenticated */}
      {(authState === 'loading' || authState === 'unauthenticated') && (
        <AuthGate state={authState} />
      )}

      {/* Authenticated */}
      {authState === 'authenticated' && user && (
        <>
          {loadingSession && (
            <div className="flex-1 flex items-center justify-center text-white/30 text-sm gap-2">
              <div className="h-4 w-4 border-2 border-white/20 border-t-green-400 rounded-full animate-spin" />
              Loading session…
            </div>
          )}

          {sessionError && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-red-400 text-sm">{sessionError}</p>
              <button
                onClick={() => { setSessionError(null); setView('idle') }}
                className="text-xs text-white/40 hover:text-white/70 underline"
              >
                Back to idle
              </button>
            </div>
          )}

          {!loadingSession && !sessionError && view === 'idle' && (
            <IdleScreen user={user} />
          )}

          {!loadingSession && !sessionError && view === 'session' && activeSession && (
            <SessionOverlay
              session={activeSession}
              onEnd={handleSessionEnd}
            />
          )}
        </>
      )}
    </div>
  )
}
