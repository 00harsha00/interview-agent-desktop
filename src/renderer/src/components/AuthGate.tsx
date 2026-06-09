import React from 'react'
import { FRONTEND_URL } from '@/config'

interface Props {
  state: 'loading' | 'unauthenticated'
  onHide: (height?: number) => void
}

export function AuthGate({ state, onHide }: Props) {
  return (
    <div className="overlay-card overflow-hidden">
      {/* Header */}
      <div className="overlay-header" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <div className="flex items-center gap-1.5">
          <div className="h-5 w-5 rounded-md bg-indigo-500 flex items-center justify-center shadow-sm">
            <span className="text-white font-black text-[9px]">IA</span>
          </div>
          <span className="text-white/75 text-[11px] font-semibold tracking-wide">
            Interview <span className="text-indigo-400">Agent</span>
          </span>
        </div>
        <div className="flex-1" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />
        <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button onClick={() => onHide(280)} className="overlay-btn-ghost text-[10px] px-2 h-5">Hide</button>
          <button
            onClick={() => window.electronAPI.window.close()}
            className="overlay-icon-btn hover:text-red-400"
          >
            <svg viewBox="0 0 10 10" className="h-2.5 w-2.5">
              <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
            </svg>
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="px-5 py-5 space-y-4">
        {state === 'loading' ? (
          <div className="flex items-center gap-3 py-2">
            <svg className="h-5 w-5 animate-spin text-indigo-400 flex-shrink-0" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-white/45 text-[13px]">Connecting…</span>
          </div>
        ) : (
          <>
            <div>
              <p className="text-white font-semibold text-[13px] mb-1">Sign in to get started</p>
              <p className="text-white/35 text-[11px] leading-relaxed">
                Open the dashboard in your browser and sign in, then click{' '}
                <span className="text-indigo-400 font-medium">Connect App</span> to link your account.
              </p>
            </div>

            {/* Primary CTA */}
            <button
              onClick={() => window.electronAPI.shell.openExternal(`${FRONTEND_URL}/auth/desktop-bridge`)}
              className="w-full py-2.5 rounded-xl text-[13px] font-semibold text-white transition-all flex items-center justify-center gap-2"
              style={{
                background: 'linear-gradient(135deg, rgba(99,102,241,0.9), rgba(139,92,246,0.9))',
                boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.15), 0 4px 12px rgba(99,102,241,0.3)',
              }}
              onMouseOver={(e) => (e.currentTarget.style.filter = 'brightness(1.1)')}
              onMouseOut={(e) => (e.currentTarget.style.filter = '')}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              Connect App
            </button>

            {/* Secondary: sign in fresh */}
            <button
              onClick={() => window.electronAPI.shell.openExternal(`${FRONTEND_URL}/auth/signin`)}
              className="overlay-btn w-full py-2 text-[12px]"
            >
              Sign In First
            </button>

            <p className="text-white/18 text-[10px] text-center pt-1">
              Already connected? The overlay will activate automatically when you start a session.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
