import { useCallback, useEffect, useRef, useState } from 'react'
import { getAuthSession } from '@/lib/api'
import type { AuthUser } from '@/types'

type AuthState = 'loading' | 'authenticated' | 'unauthenticated'

export function useAuth() {
  const [state, setState]   = useState<AuthState>('loading')
  const [user,  setUser]    = useState<AuthUser | null>(null)
  const stateRef            = useRef<AuthState>('loading')
  const intervalRef         = useRef<ReturnType<typeof setInterval> | null>(null)

  // Keep stateRef in sync so the interval closure reads the latest state
  // without needing `state` in the effect dep array (which would re-create
  // the interval on every auth state change → multiple intervals running).
  stateRef.current = state

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

    // Poll every 4 s while unauthenticated — picks up browser sign-in
    // Use stateRef (not captured `state`) so we don't re-create this interval.
    intervalRef.current = setInterval(() => {
      if (stateRef.current !== 'authenticated') void check()
    }, 4_000)

    // Listen for auth deep link — main process fires this after cookie injection
    const unsub = window.electronAPI.on('protocol:auth', () => {
      setTimeout(() => void check(), 500)
    })

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      unsub()
    }
  }, [check]) // ← no `state` dep — interval is created exactly once

  return { state, user, refetch: check }
}
