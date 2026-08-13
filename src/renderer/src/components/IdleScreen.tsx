import React, { useEffect, useRef, useState } from 'react'
import type { AIModel, AuthUser, CallSession } from '@/types'
import { AI_MODEL_LABELS, FRONTEND_URL } from '@/config'
import { createSession, getUserResumes, getUserDocuments } from '@/lib/api'
import type { UserResume, UserDocument } from '@/lib/api'

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
function PositionGrid({ snapPos, onMove, size = 14, gap = 2 }: {
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
              WebkitAppRegion: 'no-drag',
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
  user: AuthUser
  onHide: (height?: number) => void
  onSignOut: () => void
  onStartSession: (session: CallSession) => void
}

const IDLE_H   = 300
const CREATE_H = 560

// ─── shared field style ───────────────────────────────────────────────────────
const fieldStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.05)',
  boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.09)',
  color: '#fff',
  WebkitTextFillColor: '#fff',
  borderRadius: 10,
  outline: 'none',
  width: '100%',
  fontSize: 12,
  padding: '7px 10px',
  resize: 'none',
}
const focusStyle = 'inset 0 0 0 1.5px rgba(99,102,241,0.55)'
const blurStyle  = 'inset 0 0 0 1px rgba(255,255,255,0.09)'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-[10.5px] text-white/40 font-medium">{label}</label>
      {children}
    </div>
  )
}

export function IdleScreen({ user, onHide, onSignOut, onStartSession }: Props) {
  const [view,         setView]         = useState<'idle' | 'create'>('idle')
  const [signingOut,   setSigningOut]   = useState(false)
  const [creating,     setCreating]     = useState(false)
  const [createErr,    setCreateErr]    = useState<string | null>(null)
  const [resumes,      setResumes]      = useState<UserResume[]>([])
  const [documents,    setDocuments]    = useState<UserDocument[]>([])

  // Snap position — persisted in localStorage, shared with SessionOverlay
  const [snapPos, setSnapPos] = useState<SnapPos>(() =>
    (localStorage.getItem('overlay-snap-pos') as SnapPos | null) ?? 'top-center'
  )
  const handleSnapMove = (pos: SnapPos) => {
    setSnapPos(pos)
    localStorage.setItem('overlay-snap-pos', pos)
    void window.electronAPI.window.moveTo(pos)
  }

  // form fields
  const [company,      setCompany]      = useState('')
  const [jobTitle,     setJobTitle]     = useState('')
  const [jd,           setJd]           = useState('')
  const [extraCtx,     setExtraCtx]     = useState('')
  const [resumeId,     setResumeId]     = useState('')
  const [documentIds,  setDocumentIds]  = useState<string[]>([])
  const [lang,         setLang]         = useState('en')
  const [mode,         setMode]         = useState<'FREE' | 'DESKTOP'>('DESKTOP')
  const [aiModel,      setAiModel]      = useState<AIModel>('GPT4O')

  const companyRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    window.electronAPI.window.setHeight(IDLE_H)
  }, [])

  useEffect(() => {
    if (view === 'create') {
      window.electronAPI.window.setHeight(CREATE_H)
      getUserResumes().then(setResumes).catch(() => {})
      getUserDocuments().then(setDocuments).catch(() => {})
      setTimeout(() => companyRef.current?.focus(), 80)
    } else {
      window.electronAPI.window.setHeight(IDLE_H)
    }
  }, [view])

  const handleSignOut = async () => {
    setSigningOut(true)
    try { await window.electronAPI.auth.clear(); onSignOut() }
    finally { setSigningOut(false) }
  }

  const handleCreate = async () => {
    if (!company.trim()) { setCreateErr('Company name is required.'); return }
    if (!jd.trim()) { setCreateErr('Job description is required.'); return }
    setCreating(true); setCreateErr(null)
    try {
      // Merge extra context into the job description text — there's no
      // dedicated column for it on CallSession, so this is the same trick
      // the browser's NewSessionModal uses. Without this, extraCtx was pure
      // dead UI: typed into the textarea but never sent anywhere.
      const fullJobDescription = extraCtx?.trim()
        ? `${jd.trim()}\n\n---\nExtra Context:\n${extraCtx.trim()}`
        : jd.trim()
      const session = await createSession({
        companyName:   company.trim(),
        jobDescription: fullJobDescription,
        resumeId:      resumeId || undefined,
        documentIds,
        language:      lang,
        mode,
        autoGenerate:  false,
        aiModel,
      })
      onStartSession(session)
    } catch (err) {
      setCreateErr((err as Error).message ?? 'Failed to create session.')
    } finally { setCreating(false) }
  }

  const toggleDocument = (id: string) => {
    setDocumentIds((prev) => prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id])
  }

  const initials = (user.name ?? user.email)
    .split(/[\s@]/).filter(Boolean).slice(0, 2).map(s => s[0]?.toUpperCase() ?? '').join('')
  const creditsLabel = user.isAdmin ? '∞' : (user.credits ?? 0).toFixed(1)
  const hasLowCredits = !user.isAdmin && (user.credits ?? 0) < 1
  const hasPaidCredits = user.isAdmin || (user.credits ?? 0) >= 0.5

  return (
    <div
      data-overlay
      className="overflow-hidden anim-in"
      style={{
        borderRadius: 14,
        background: 'linear-gradient(135deg,rgba(18,18,30,0.97),rgba(10,10,22,0.97))',
        backdropFilter: 'none',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
        maxWidth: 420,
        margin: '0 auto',
      }}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div
        className="flex items-center gap-2 px-4 h-10 flex-shrink-0"
        style={{ background: 'rgba(0,0,0,0.25)', boxShadow: 'inset 0 -1px 0 rgba(255,255,255,0.06)' }}
      >
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="h-5 w-5 rounded-lg flex items-center justify-center flex-shrink-0"
               style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
            <span className="text-white font-black text-[8.5px] tracking-tight">IA</span>
          </div>
          <span className="text-white/70 text-[11px] font-semibold tracking-wide">
            Interview <span className="text-indigo-400">Agent</span>
          </span>
        </div>
        <div className="flex-1" />
        <PositionGrid snapPos={snapPos} onMove={handleSnapMove} />
        <div className="flex items-center gap-1">
          {view === 'create' && (
            <button onClick={() => { setView('idle'); setCreateErr(null) }}
              className="text-[10px] text-white/35 hover:text-white/70 px-2 h-5 rounded-md transition-colors"
              style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)' }}>
              ← Back
            </button>
          )}
          <button onClick={() => onHide(view === 'create' ? CREATE_H : IDLE_H)}
            title="Collapse"
            className="flex items-center justify-center h-6 w-6 rounded-md hover:bg-white/8 transition-all opacity-85 hover:opacity-100"
            style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)' }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <polyline points="2,10 7,4 12,10" stroke="rgba(255,255,255,0.85)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button onClick={() => window.electronAPI.window.close()}
            className="flex items-center justify-center h-6 w-6 rounded-md text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-all">
            <svg viewBox="0 0 10 10" className="h-2.5 w-2.5">
              <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── User bar (always visible) ───────────────────────────────────────── */}
      <div className="flex items-center gap-2.5 px-4 py-2.5"
           style={{ boxShadow: 'inset 0 -1px 0 rgba(255,255,255,0.05)' }}>
        <div className="h-7 w-7 rounded-lg flex items-center justify-center flex-shrink-0 text-[10px] font-bold text-indigo-300"
             style={{ background: 'rgba(99,102,241,0.14)', boxShadow: 'inset 0 0 0 1px rgba(99,102,241,0.2)' }}>
          {initials || '?'}
        </div>
        <div className="flex-1 min-w-0">
          {user.name && <p className="text-white/80 text-[11.5px] font-semibold truncate">{user.name}</p>}
          <p className="text-white/35 text-[10px] truncate">{user.email}</p>
        </div>
        <div className={`px-2 py-0.5 rounded-full text-[9px] font-bold flex-shrink-0 ${hasLowCredits ? 'text-yellow-300' : 'text-green-300'}`}
             style={{ background: hasLowCredits ? 'rgba(234,179,8,0.1)' : 'rgba(34,197,94,0.1)', boxShadow: `inset 0 0 0 1px ${hasLowCredits ? 'rgba(234,179,8,0.2)' : 'rgba(34,197,94,0.2)'}` }}>
          {creditsLabel} {!user.isAdmin && 'cr'}
        </div>
        <button onClick={handleSignOut} disabled={signingOut}
          className="flex items-center justify-center h-6 w-6 rounded-lg text-white/25 hover:text-white/60 transition-colors disabled:opacity-30"
          title="Sign out">
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
        </button>
      </div>

      {/* ── IDLE view ──────────────────────────────────────────────────────────── */}
      {view === 'idle' && (
        <div className="px-4 py-3.5 space-y-3">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse flex-shrink-0" />
            <p className="text-white/40 text-[11px]">Ready · create a session below or open your dashboard</p>
          </div>

          {/* Primary CTA */}
          <button onClick={() => setView('create')}
            className="w-full py-2.5 rounded-xl text-white text-[12.5px] font-semibold transition-all flex items-center justify-center gap-2"
            style={{ background: 'linear-gradient(135deg,rgba(99,102,241,0.85),rgba(139,92,246,0.85))', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.12)' }}
            onMouseOver={(e) => { e.currentTarget.style.filter = 'brightness(1.1)' }}
            onMouseOut={(e) => { e.currentTarget.style.filter = '' }}>
            <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V7z" clipRule="evenodd" />
            </svg>
            New Session
          </button>

          <button
            onClick={() => window.electronAPI.shell.openExternal(`${FRONTEND_URL}/dashboard`)}
            className="w-full py-2 rounded-xl text-[11.5px] font-medium text-white/50 hover:text-white/80 transition-all flex items-center justify-center gap-1.5"
            style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)' }}>
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            Open Dashboard
          </button>

          <div className="flex items-center justify-center gap-4 pt-0.5">
            {[{ key: '⌘↵', label: 'Answer' }, { key: '⌘⇧↵', label: 'Screenshot' }, { key: '⌘⇧H', label: 'Hide' }].map(({ key, label }) => (
              <div key={key} className="flex items-center gap-1">
                <span className="text-[9px] font-mono text-white/25 px-1 py-0.5 rounded"
                      style={{ background: 'rgba(255,255,255,0.05)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)' }}>
                  {key}
                </span>
                <span className="text-[9px] text-white/18">{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── CREATE SESSION view ─────────────────────────────────────────────── */}
      {view === 'create' && (
        <div className="px-4 py-3 space-y-3 overflow-y-auto" style={{ maxHeight: CREATE_H - 90, scrollbarWidth: 'none' }}>

          {/* Session mode */}
          <div className="flex gap-2">
            {(['FREE', 'DESKTOP'] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)}
                className="flex-1 py-2 rounded-xl text-[11.5px] font-semibold transition-all"
                style={{
                  background: mode === m
                    ? m === 'FREE' ? 'rgba(99,102,241,0.22)' : 'rgba(139,92,246,0.22)'
                    : 'rgba(255,255,255,0.04)',
                  boxShadow: mode === m
                    ? `inset 0 0 0 1.5px ${m === 'FREE' ? 'rgba(99,102,241,0.5)' : 'rgba(139,92,246,0.5)'}`
                    : 'inset 0 0 0 1px rgba(255,255,255,0.08)',
                  color: mode === m ? (m === 'FREE' ? '#a5b4fc' : '#c4b5fd') : 'rgba(255,255,255,0.35)',
                }}>
                {m === 'FREE' ? '🆓 Free Trial' : '⚡ Full Session'}
              </button>
            ))}
          </div>
          {mode === 'FREE' && (
            <p className="text-[10px] text-indigo-300/60 -mt-1">10-minute free trial · no credits used</p>
          )}
          {mode === 'DESKTOP' && !hasPaidCredits && (
            <p className="text-[10px] text-yellow-300/70 -mt-1">You have {creditsLabel} credits — need at least 0.5 for a full session</p>
          )}

          {/* Company */}
          <Field label="Company / Interviewer *">
            <input ref={companyRef} value={company} onChange={e => setCompany(e.target.value)}
              placeholder="e.g. Google, Amazon…"
              style={fieldStyle}
              onFocus={e => (e.currentTarget.style.boxShadow = focusStyle)}
              onBlur={e => (e.currentTarget.style.boxShadow = blurStyle)} />
          </Field>

          {/* Job title */}
          <Field label="Job Title">
            <input value={jobTitle} onChange={e => setJobTitle(e.target.value)}
              placeholder="e.g. Software Engineer"
              style={fieldStyle}
              onFocus={e => (e.currentTarget.style.boxShadow = focusStyle)}
              onBlur={e => (e.currentTarget.style.boxShadow = blurStyle)} />
          </Field>

          {/* Job description */}
          <Field label="Job Description">
            <textarea value={jd} onChange={e => setJd(e.target.value)} rows={4}
              placeholder="Paste the JD here — the AI will use it to tailor answers…"
              style={{ ...fieldStyle, padding: '8px 10px' }}
              onFocus={e => (e.currentTarget.style.boxShadow = focusStyle)}
              onBlur={e => (e.currentTarget.style.boxShadow = blurStyle)} />
          </Field>

          {/* Extra context */}
          <Field label="Extra Context">
            <textarea value={extraCtx} onChange={e => setExtraCtx(e.target.value)} rows={3}
              placeholder="Your background, skills, things to emphasise…"
              style={{ ...fieldStyle, padding: '8px 10px' }}
              onFocus={e => (e.currentTarget.style.boxShadow = focusStyle)}
              onBlur={e => (e.currentTarget.style.boxShadow = blurStyle)} />
          </Field>

          {/* Resume */}
          <Field label="Resume">
            <select value={resumeId} onChange={e => setResumeId(e.target.value)}
              style={{ ...fieldStyle, appearance: 'none', cursor: 'pointer' }}
              onFocus={e => (e.currentTarget.style.boxShadow = focusStyle)}
              onBlur={e => (e.currentTarget.style.boxShadow = blurStyle)}>
              <option value="">— None —</option>
              {resumes.map(r => (
                <option key={r.id} value={r.id}>{r.fileName}</option>
              ))}
            </select>
          </Field>

          {/* Documents — multi-select, mirrors the browser's NewSessionModal */}
          <Field label={`Documents${documentIds.length ? ` (${documentIds.length} selected)` : ''}`}>
            {documents.length === 0 ? (
              <p className="text-[11px] text-white/25">No documents uploaded yet.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {documents.map((d) => {
                  const selected = documentIds.includes(d.id)
                  return (
                    <button key={d.id} type="button" onClick={() => toggleDocument(d.id)}
                      className="px-2 py-1 rounded-lg text-[10.5px] font-medium transition-all truncate max-w-[160px]"
                      style={{
                        background: selected ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.05)',
                        boxShadow: selected ? 'inset 0 0 0 1.5px rgba(99,102,241,0.55)' : 'inset 0 0 0 1px rgba(255,255,255,0.09)',
                        color: selected ? '#a5b4fc' : 'rgba(255,255,255,0.55)',
                      }}
                      title={d.name}
                    >
                      {selected ? '✓ ' : ''}{d.name}
                    </button>
                  )
                })}
              </div>
            )}
          </Field>

          {/* Language */}
          <Field label="Language">
            <select value={lang} onChange={e => setLang(e.target.value)}
              style={{ ...fieldStyle, appearance: 'none', cursor: 'pointer' }}
              onFocus={e => (e.currentTarget.style.boxShadow = focusStyle)}
              onBlur={e => (e.currentTarget.style.boxShadow = blurStyle)}>
              <option value="en">English</option>
              <option value="hi">Hindi</option>
              <option value="te">Telugu</option>
              <option value="ta">Tamil</option>
              <option value="es">Spanish</option>
              <option value="fr">French</option>
              <option value="de">German</option>
              <option value="zh">Chinese</option>
              <option value="ja">Japanese</option>
              <option value="ko">Korean</option>
              <option value="ar">Arabic</option>
              <option value="pt">Portuguese</option>
            </select>
          </Field>

          {/* AI Model */}
          <Field label="AI Model">
            <select value={aiModel} onChange={e => setAiModel(e.target.value as AIModel)}
              style={{ ...fieldStyle, appearance: 'none', cursor: 'pointer' }}
              onFocus={e => (e.currentTarget.style.boxShadow = focusStyle)}
              onBlur={e => (e.currentTarget.style.boxShadow = blurStyle)}>
              {Object.entries(AI_MODEL_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </Field>

          {createErr && (
            <div className="px-3 py-2 rounded-xl text-[11px] text-red-300"
                 style={{ background: 'rgba(239,68,68,0.1)', boxShadow: 'inset 0 0 0 1px rgba(239,68,68,0.2)' }}>
              {createErr}
            </div>
          )}

          {/* Submit */}
          <button onClick={handleCreate} disabled={creating || !company.trim() || !jd.trim() || (mode === 'DESKTOP' && !hasPaidCredits)}
            className="w-full py-2.5 rounded-xl text-white text-[12.5px] font-semibold transition-all flex items-center justify-center gap-2 disabled:opacity-40"
            style={{
              background: creating ? 'rgba(34,197,94,0.3)' : 'linear-gradient(135deg,rgba(34,197,94,0.8),rgba(16,185,129,0.8))',
              boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.14)',
            }}>
            {creating ? (
              <>
                <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Creating session…
              </>
            ) : (
              <>
                <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                </svg>
                Start Session
              </>
            )}
          </button>
        </div>
      )}
    </div>
  )
}
