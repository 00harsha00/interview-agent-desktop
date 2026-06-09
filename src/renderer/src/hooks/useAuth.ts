import { useCallback, useEffect, useRef, useState } from 'react'
import { getAuthSession } from '@/lib/api'
import type { AuthUser } from '@/types'

type AuthState = 'loading' | 'authenticated' | 'unauthenticated'

export function useAuth() {
  const [state, setState]   = useState<AuthState>('loading')
  const [user, setUser]     = useState<AuthUser | null>(null)
  const intervalRef         = useRef<ReturnType<typeof setInterval> | null>(null)

  const check = useCallback(async () => {
    const u = await getAuthSession()
    if (u) {
      setUser(u)
      setState('authenticated')
    } else {
      setUser(null)
      setState('unauthenticated')
    }
  }, [])

  useEffect(() => {
    void check()

    // Poll every 4s while unauthenticated — picks up browser sign-in automatically
    intervalRef.current = setInterval(() => {
      if (state !== 'authenticated') void check()
    }, 4_000)

    // Listen for auth deep link
    const unsub = window.electronAPI.on('protocol:auth', (payload: unknown) => {
      // The web bridge already set the cookie via IPC; just re-check
      setTimeout(() => void check(), 500)
      console.log('[useAuth] Auth deep link received', payload)
    })

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      unsub()
    }
  }, [check, state])

  return { state, user, refetch: check }
}
