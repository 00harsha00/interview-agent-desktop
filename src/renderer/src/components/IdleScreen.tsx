import React from 'react'
import type { AuthUser } from '@/types'

interface Props {
  user: AuthUser
}

export function IdleScreen({ user }: Props) {
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
        <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button onClick={() => window.electronAPI.window.hide()}
            className="h-5 px-2 rounded text-[10px] text-white/50 hover:text-white/90 hover:bg-white/10 transition-colors border border-white/10">
            Hide
          </button>
          <button onClick={() => window.electronAPI.window.close()}
            className="h-5 w-5 rounded flex items-center justify-center text-white/40 hover:text-red-400 hover:bg-red-500/10 transition-colors">
            <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" fill="currentColor">
              <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
            </svg>
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="px-5 py-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-green-500/15 border border-green-500/20 flex items-center justify-center flex-shrink-0">
            <span className="text-green-400 text-lg">✓</span>
          </div>
          <div>
            <p className="text-white font-semibold text-sm">Ready</p>
            <p className="text-white/40 text-[11px]">{user.email}</p>
            <p className="text-white/30 text-[11px]">{user.credits?.toFixed?.(1) ?? '—'} credits</p>
          </div>
        </div>

        <p className="text-white/40 text-[12px] leading-relaxed">
          Start a session from your browser — click <strong className="text-white/60">Desktop App</strong> on any session and this overlay will activate.
        </p>

        <div className="space-y-2">
          <button
            onClick={() => window.electronAPI.shell.openExternal('http://localhost:4000/dashboard')}
            className="flex items-center justify-center gap-2 w-full py-2 px-4 bg-white/8 hover:bg-white/15 border border-white/10 rounded-xl text-[13px] font-medium text-white transition-colors"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            Open Dashboard
          </button>
        </div>

        <p className="text-white/20 text-[10px] text-center">
          ⌘⇧A Answer · ⌘⇧S Screenshot · ⌘⇧H Hide
        </p>
      </div>
    </div>
  )
}
