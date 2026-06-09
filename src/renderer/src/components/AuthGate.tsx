import React from 'react'

interface Props {
  state: 'loading' | 'unauthenticated'
}

export function AuthGate({ state }: Props) {
  return (
    <div
      className="rounded-2xl overflow-hidden shadow-2xl border border-white/10"
      style={{ background: 'rgba(15,18,28,0.97)' }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2 bg-black/40 border-b border-white/8"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="flex items-center gap-1.5">
          <div className="h-6 w-6 rounded-lg bg-green-500 flex items-center justify-center">
            <span className="text-white font-black text-[10px]">P</span>
          </div>
          <span className="text-white text-xs font-semibold">Parakeet<span className="text-green-400">AI</span></span>
        </div>
        <div className="flex-1" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />
        <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button onClick={() => window.electronAPI.window.close()}
            className="h-5 w-5 rounded flex items-center justify-center text-white/40 hover:text-red-400 hover:bg-red-500/10 transition-colors">
            <svg viewBox="0 0 10 10" className="h-2.5 w-2.5">
              <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
            </svg>
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="px-5 py-5 space-y-4">
        {state === 'loading' ? (
          <div className="flex items-center gap-3 py-3">
            <svg className="h-5 w-5 animate-spin text-green-400" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-white/50 text-sm">Connecting…</span>
          </div>
        ) : (
          <>
            <div>
              <p className="text-white font-semibold text-sm mb-1">Sign in to get started</p>
              <p className="text-white/40 text-[12px] leading-relaxed">
                Already signed in at <span className="text-white/70">localhost:4000</span>?
                Click <span className="text-green-400">Connect App</span> to link your session.
              </p>
            </div>

            <button
              onClick={() => window.electronAPI.shell.openExternal('http://localhost:4000/auth/desktop-bridge')}
              className="flex items-center justify-center gap-2 w-full py-2.5 px-4 bg-green-600 hover:bg-green-500 rounded-xl text-[13px] font-semibold text-white transition-colors"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              Connect App
            </button>

            <button
              onClick={() => window.electronAPI.shell.openExternal('http://localhost:4000/auth/signin')}
              className="flex items-center justify-center gap-2 w-full py-2 px-4 bg-white/8 hover:bg-white/15 border border-white/10 rounded-xl text-[13px] font-medium text-white/70 transition-colors"
            >
              Sign In First
            </button>
          </>
        )}
      </div>
    </div>
  )
}
