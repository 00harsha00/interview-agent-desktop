/**
 * useNetworkStatus — tracks browser online/offline state so the UI can warn
 * the user (offline pill, disabled Answer button) instead of silently
 * failing the next time they try to generate an answer.
 */
import { useEffect, useState } from 'react'

export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  // Brief true pulse right after coming back online, for a "Back online ✓"
  // toast — caller is responsible for clearing/consuming it.
  const [justCameBackOnline, setJustCameBackOnline] = useState(false)

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true)
      setJustCameBackOnline(true)
      setTimeout(() => setJustCameBackOnline(false), 2_000)
    }
    const handleOffline = () => setIsOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return { isOnline, justCameBackOnline }
}
