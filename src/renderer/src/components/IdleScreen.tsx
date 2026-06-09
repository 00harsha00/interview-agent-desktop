import React from 'react'
import type { AuthUser } from '@/types'
import { FRONTEND_URL } from '@/config'

interface Props {
  user: AuthUser
  onHide: (height?: number) => void
}

export function IdleScreen({ user, onHide }: Props) {
  return (
    <div className="overlay-card overflow-hidden">
      {/* Header */}
      <div className="overlay-header" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <div className="flex items-center gap-1.5">
          <div className="h-5 w-5 rounded-md bg-indigo-500 flex items-center justify-center shadow-sm">
            <span className="text-white font-black text-[9px]">IA</span>
          </div>
          <span className="text-white/75 text-[11px] font-semibold tracking-wide">Interview <span className="text-indigo-400">Agent</span></span>
        </div>
        <div className="flex-1" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />
        <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button onClick={() => onHide(280)} className="overlay-btn-ghost text-[10px] px-2 h-5">Hide</button>
          <button onClick={() => window.electronAPI.window.close()} className="overlay-icon-btn hover:text-red-400">
            <svg viewBox="0 0 10 10" className="h-2.5 w-2.5"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" /></svg>
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="px-5 py-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-green-500/12 border border-green-500/20 flex items-center justify-center flex-shrink-0">
            <svg className="h-4 w-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <p className="text-white font-semibold text-[13px]">Ready</p>
            <p className="text-white/35 text-[10px]">{user.email}</p>
            <p className="text-white/25 text-[10px]">
            {user.isAdmin ? '∞ credits (admin)' : `${user.credits?.toFixed?.(1) ?? '—'} credits`}
          </p>
          </div>
        </div>

        <p className="text-white/35 text-[11px] leading-relaxed">
          Start a session from your browser — click <strong className="text-white/55">Desktop App</strong> and this overlay activates automatically.
        </p>

        <button
          onClick={() => window.electronAPI.shell.openExternal(`${FRONTEND_URL}/dashboard`)}
          className="overlay-btn w-full py-2 text-[12px]"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
          Open Dashboard
        </button>

        <p className="text-white/18 text-[10px] text-center">
          ⌘↵ Answer · ⌘⇧↵ Screenshot · ⌘⇧H Hide
        </p>
      </div>
    </div>
  )
}
