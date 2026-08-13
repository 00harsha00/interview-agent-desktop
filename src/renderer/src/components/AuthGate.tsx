import React, { useCallback, useEffect, useRef, useState } from 'react'
import { FRONTEND_URL } from '@/config'

// ─── Snap-position grid (matches SessionOverlay) ────────────────────────────
const SNAP_POSITIONS = [
  ['top-left', 'top-center', 'top-right'],
  ['bottom-left', 'bottom-center', 'bottom-right'],
] as const
type SnapPos = (typeof SNAP_POSITIONS)[number][number]
const SNAP_ICONS: Record<string, string> = {
  'top-left': '↖', 'top-center': '↑', 'top-right': '↗',
  'bottom-left': '↙', 'bottom-center': '↓', 'bottom-right': '↘',
}
const SNAP_NEIGHBORS: Record<SnapPos, SnapPos[]> = {
  'top-left':      ['top-center', 'bottom-left'],
  'top-center':    ['top-left', 'top-right', 'bottom-center'],
  'top-right':     ['top-center', 'bottom-right'],
  'bottom-left':   ['top-left', 'bottom-center'],
  'bottom-center': ['bottom-left', 'bottom-right', 'top-center'],
  'bottom-right':  ['top-right', 'bottom-center'],
}
function MiniPositionGrid({ snapPos, onMove, size = 14, gap = 2 }: {
  snapPos: SnapPos; onMove: (p: SnapPos) => void; size?: number; gap?: number
}) {
  const neighbors = SNAP_NEIGHBORS[snapPos] ?? []
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', width: size * 3 + gap * 2, gap }}>
      {SNAP_POSITIONS.flat().map((pos) => {
        const isActive = snapPos === pos
        const isNeighbor = neighbors.includes(pos)
        const isDisabled = !isActive && !isNeighbor
        return (
          <button
            key={pos}
            onClick={() => { if (!isDisabled) onMove(pos) }}
            disabled={isDisabled}
            title={pos.replace('-', ' ')}
            style={{
              width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.5)),
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 4, border: 'none', cursor: isDisabled ? 'default' : 'pointer',
              transition: 'all 0.15s',
              opacity: isDisabled ? 0.15 : 1,
              background: isActive ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.05)',
              color: isActive ? '#a5b4fc' : 'rgba(255,255,255,0.4)',
              boxShadow: isActive ? 'inset 0 0 0 1px rgba(99,102,241,0.3)' : 'none',
            } as React.CSSProperties}
          >
            {SNAP_ICONS[pos]}
          </button>
        )
      })}
    </div>
  )
}

interface Props {
  state: 'loading' | 'unauthenticated'
  onHide: (height?: number) => void
  onAuthSuccess: () => void
}

// ─── Header (shared across auth screens) ─────────────────────────────────────
function AuthHeader({ onHide, snapPos, onSnapMove }: { onHide: () => void; snapPos: SnapPos; onSnapMove: (p: SnapPos) => void }) {
  return (
    <div
      className="flex items-center gap-2 px-4 h-10 flex-shrink-0"
      style={{
        background: 'rgba(0,0,0,0.25)',
        boxShadow: 'inset 0 -1px 0 rgba(255,255,255,0.06)',
      }}
    >
      <div className="flex items-center gap-2 flex-shrink-0">
        <div
          className="h-5 w-5 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', boxShadow: '0 2px 8px rgba(99,102,241,0.4)' }}
        >
          <span className="text-white font-black text-[8.5px] tracking-tight">IA</span>
        </div>
        <span className="text-white/70 text-[11px] font-semibold tracking-wide">
          Interview <span className="text-indigo-400">Agent</span>
        </span>
      </div>
      <div className="flex-1" />
      <MiniPositionGrid snapPos={snapPos} onMove={onSnapMove} />
      <div className="flex items-center gap-1">
        <button
          onClick={onHide}
          title="Collapse"
          className="flex items-center justify-center h-6 w-6 rounded-md hover:bg-white/8 transition-all opacity-85 hover:opacity-100"
          style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)' }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <polyline points="2,10 7,4 12,10" stroke="rgba(255,255,255,0.85)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          onClick={() => window.electronAPI.window.close()}
          className="flex items-center justify-center h-6 w-6 rounded-md text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-all"
        >
          <svg viewBox="0 0 10 10" className="h-2.5 w-2.5">
            <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
          </svg>
        </button>
      </div>
    </div>
  )
}

// ─── Loading screen ───────────────────────────────────────────────────────────
function LoadingScreen({ onHide, snapPos, onSnapMove }: { onHide: () => void; snapPos: SnapPos; onSnapMove: (p: SnapPos) => void }) {
  return (
    <div
      data-overlay
      className="overflow-hidden anim-in"
      style={{
        borderRadius: 14,
        background: 'linear-gradient(135deg,rgba(20,20,35,0.95),rgba(10,10,20,0.95))',
        backdropFilter: 'none',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
        maxWidth: 400,
        margin: '0 auto',
      }}
    >
      <AuthHeader onHide={onHide} snapPos={snapPos} onSnapMove={onSnapMove} />
      <div className="flex items-center gap-3 px-5 py-6">
        <div className="h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0"
             style={{ background: 'rgba(99,102,241,0.1)', boxShadow: 'inset 0 0 0 1px rgba(99,102,241,0.2)' }}>
          <svg className="h-4 w-4 animate-spin text-indigo-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
        <div>
          <p className="text-white/70 text-[13px] font-medium">Checking session…</p>
          <p className="text-white/30 text-[11px]">One moment</p>
        </div>
      </div>
    </div>
  )
}

// ─── Main AuthGate ────────────────────────────────────────────────────────────
export function AuthGate({ state, onHide, onAuthSuccess }: Props) {
  const [email,      setEmail]      = useState('')
  const [password,   setPassword]   = useState('')
  const [signing,    setSigning]    = useState(false)
  const [error,      setError]      = useState<string | null>(null)
  const [showBrowser,setShowBrowser]= useState(false)
  const emailRef    = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)

  const [snapPos, setSnapPos] = useState<SnapPos>(() =>
    (localStorage.getItem('overlay-snap-pos') as SnapPos | null) ?? 'top-center'
  )
  const handleSnapMove = (pos: SnapPos) => {
    setSnapPos(pos)
    localStorage.setItem('overlay-snap-pos', pos)
    void window.electronAPI.window.moveTo(pos)
  }

  // Resize window and focus email when sign-in form appears
  useEffect(() => {
    if (state === 'unauthenticated') {
      window.electronAPI.window.setHeight(390)
      setTimeout(() => emailRef.current?.focus(), 80)
    }
  }, [state])

  const handleSignIn = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedEmail = email.trim()
    if (!trimmedEmail || !password) return
    setSigning(true)
    setError(null)
    try {
      const result = await window.electronAPI.auth.signin(trimmedEmail, password)
      if (result.success) {
        onAuthSuccess()
      } else {
        setError(result.error ?? 'Sign in failed. Please try again.')
        setPassword('')
        setTimeout(() => passwordRef.current?.focus(), 50)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSigning(false)
    }
  }, [email, password, onAuthSuccess])

  if (state === 'loading') {
    return <LoadingScreen onHide={() => onHide(390)} snapPos={snapPos} onSnapMove={handleSnapMove} />
  }

  const inputStyle: React.CSSProperties = {
    background: 'rgba(255,255,255,0.06)',
    boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.1)',
    color: '#ffffff',
    WebkitTextFillColor: '#ffffff',
    caretColor: '#818cf8',
  }

  return (
    <div
      data-overlay
      className="overflow-hidden anim-in"
      style={{
        borderRadius: 14,
        background: 'linear-gradient(135deg,rgba(20,20,35,0.96),rgba(10,10,22,0.96))',
        backdropFilter: 'none',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
        maxWidth: 400,
        margin: '0 auto',
      }}
    >
      <AuthHeader onHide={() => onHide(390)} snapPos={snapPos} onSnapMove={handleSnapMove} />

      <div className="px-5 py-5">

        {/* Brand + heading */}
        <div className="mb-5">
          <p className="text-white font-semibold text-[15px] leading-tight">Sign in to Interview Agent</p>
          <p className="text-white/38 text-[11.5px] mt-1">
            {showBrowser ? 'Open the dashboard to authenticate' : 'Enter your account credentials below'}
          </p>
        </div>

        {showBrowser ? (
          /* ── Browser login mode ── */
          <div className="space-y-3">
            <button
              onClick={() => window.electronAPI.shell.openExternal(`${FRONTEND_URL}/auth/desktop-bridge`)}
              className="w-full py-3 rounded-xl text-[13px] font-semibold text-white transition-all flex items-center justify-center gap-2.5"
              style={{
                background: 'linear-gradient(135deg,rgba(99,102,241,0.85),rgba(139,92,246,0.85))',
                boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.15),0 4px 16px rgba(99,102,241,0.35)',
              }}
              onMouseOver={(e) => { e.currentTarget.style.filter = 'brightness(1.1)' }}
              onMouseOut={(e) => { e.currentTarget.style.filter = '' }}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              Connect via Browser
            </button>
            <button
              onClick={() => { setShowBrowser(false); setTimeout(() => emailRef.current?.focus(), 50) }}
              className="w-full py-2 rounded-xl text-[12px] font-medium text-white/45 hover:text-white/75 transition-colors"
              style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)' }}
            >
              ← Sign in with email instead
            </button>
            <p className="text-white/20 text-[10px] text-center pt-1 leading-relaxed">
              Opens your browser · You'll be redirected back automatically
            </p>
          </div>
        ) : (
          /* ── Email/password form ── */
          <form onSubmit={handleSignIn} className="space-y-2.5">
            <div className="space-y-2">
              <input
                ref={emailRef}
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(null) }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); passwordRef.current?.focus() } }}
                placeholder="Email address"
                autoComplete="email"
                required
                disabled={signing}
                className="w-full px-3.5 py-2.5 rounded-xl text-[12.5px] outline-none transition-all disabled:opacity-50"
                style={inputStyle}
                onFocus={(e) => { e.currentTarget.style.boxShadow = 'inset 0 0 0 1.5px rgba(99,102,241,0.6),0 0 0 3px rgba(99,102,241,0.1)' }}
                onBlur={(e) => { e.currentTarget.style.boxShadow = 'inset 0 0 0 1px rgba(255,255,255,0.1)' }}
              />
              <div className="relative">
                <input
                  ref={passwordRef}
                  type="password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(null) }}
                  placeholder="Password"
                  autoComplete="current-password"
                  required
                  disabled={signing}
                  className="w-full px-3.5 py-2.5 rounded-xl text-[12.5px] outline-none transition-all disabled:opacity-50"
                  style={inputStyle}
                  onFocus={(e) => { e.currentTarget.style.boxShadow = 'inset 0 0 0 1.5px rgba(99,102,241,0.6),0 0 0 3px rgba(99,102,241,0.1)' }}
                  onBlur={(e) => { e.currentTarget.style.boxShadow = 'inset 0 0 0 1px rgba(255,255,255,0.1)' }}
                />
              </div>
            </div>

            {/* Error */}
            {error && (
              <div
                className="px-3 py-2.5 rounded-xl text-red-300 text-[11.5px] flex items-start gap-2 anim-in"
                style={{ background: 'rgba(239,68,68,0.1)', boxShadow: 'inset 0 0 0 1px rgba(239,68,68,0.2)' }}
              >
                <svg className="h-3.5 w-3.5 flex-shrink-0 mt-0.5 text-red-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <span className="flex-1 leading-snug">{error}</span>
              </div>
            )}

            {/* Sign In button */}
            <button
              type="submit"
              disabled={signing || !email.trim() || !password}
              className="w-full py-2.5 rounded-xl text-[13px] font-semibold text-white transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: signing
                  ? 'rgba(99,102,241,0.5)'
                  : 'linear-gradient(135deg,rgba(99,102,241,0.9),rgba(139,92,246,0.9))',
                boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.15),0 4px 14px rgba(99,102,241,0.3)',
              }}
              onMouseOver={(e) => { if (!signing) e.currentTarget.style.filter = 'brightness(1.08)' }}
              onMouseOut={(e) => { e.currentTarget.style.filter = '' }}
            >
              {signing ? (
                <>
                  <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Signing in…
                </>
              ) : 'Sign In'}
            </button>

            {/* Divider */}
            <div className="flex items-center gap-3 py-0.5">
              <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.07)' }} />
              <span className="text-[10px] text-white/25 font-medium">or</span>
              <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.07)' }} />
            </div>

            {/* Browser fallback */}
            <button
              type="button"
              onClick={() => setShowBrowser(true)}
              className="w-full py-2 rounded-xl text-[12px] font-medium text-white/45 hover:text-white/75 transition-all flex items-center justify-center gap-2"
              style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.09)' }}
              onMouseOver={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
              onMouseOut={(e) => { e.currentTarget.style.background = '' }}
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              Sign in via browser instead
            </button>

            {/* Sign up link */}
            <p className="text-white/20 text-[10px] text-center pt-0.5">
              No account?{' '}
              <button
                type="button"
                onClick={() => window.electronAPI.shell.openExternal(`${FRONTEND_URL}/auth/signup`)}
                className="text-indigo-400/60 hover:text-indigo-400 transition-colors underline underline-offset-2"
              >
                Sign up free
              </button>
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
