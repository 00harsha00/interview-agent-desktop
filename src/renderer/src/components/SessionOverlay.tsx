/**
 * SessionOverlay — premium live interview assistant.
 *
 *  ┌──────────────────────────────────────────────────────────────────┐
 *  │  [🔊] [💻●] [🎤●]  ║  [⚡Answer ⌘↵] [📷 ⌘⇧↵] [💬 Chat ⌘⇧—]  ║  9:22  [⋮] [⊕] [^]  │
 *  ├──────────────────────────────────────────────────────────────────┤
 *  │  [Enter a message…]                     [📷 ⌘⌥↵]  [Send ↵]  [×]  │
 *  │  ● Listening…                           [Clear ⌘⇧⌫]  [✓]  [×]  │
 *  ├──────────────────────────────────────────────────────────────────┤
 *  │  [← →] [1/N] 💬 Question…  [↺] [×]                             │
 *  │         ⭐ Answer streaming live…▋                               │
 *  └──────────────────────────────────────────────────────────────────┘
 */
import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react'
import { cn } from '@/lib/utils'
import { SESSION_PING_MS, TRANSCRIPT_SAVE_MS, SILENCE_TRIGGER_MS } from '@/config'
import {
  getSpeechmaticsJwt, updateSessionStatus, saveTranscriptions, pingSession, extendSession,
} from '@/lib/api'
import { FRONTEND_URL } from '@/config'
import { useSpeechmatics } from '@/hooks/useSpeechmatics'
import { useSystemAudio }  from '@/hooks/useSystemAudio'
import { useAIStream }     from '@/hooks/useAIStream'
import type { CallSession, TranscriptEntry, SmConnectionState } from '@/types'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2) }
function fmt(s: number) {
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

interface QAPair { id: string; question: string; answer: string; ts: Date }

// Electron window heights
const TOOLBAR_H  = 48
const MODAL_H    = 320
const CHAT_H     = 92
const ANSWER_H   = 320

// ─── Tiny shared components ───────────────────────────────────────────────────

function Kbd({ s }: { s: string }) {
  return <span className="text-[9px] text-white/30 font-mono ml-0.5">{s}</span>
}

function Sep() {
  return <div className="w-px h-4 flex-shrink-0" style={{ background: 'rgba(255,255,255,0.1)' }} />
}

/**
 * Real-time VU meter bars.
 * When `level` > 0 the bars reflect actual PCM amplitude (from AudioWorklet RMS).
 * Falls back to CSS wave animation while active but before audio arrives.
 */
function WaveBars({ active, level = 0 }: { active: boolean; level?: number }) {
  const weights = [0.5, 1, 0.65, 0.85, 0.45]
  const hasLevel = active && level > 0.01
  return (
    <div className="flex items-end gap-[2px] h-4 w-5 flex-shrink-0">
      {weights.map((w, i) => (
        <div
          key={i}
          className={cn('w-[2.5px] rounded-full', active ? 'bg-indigo-400' : 'bg-white/20')}
          style={{
            // Real level: scale each bar by its weight so they look natural
            height: hasLevel
              ? `${Math.max(2, level * w * 14)}px`
              : active
                ? `${4 + w * 9}px`
                : '2.5px',
            animation: !hasLevel && active
              ? `wave ${0.45 + i * 0.08}s ease-in-out infinite alternate`
              : 'none',
            animationDelay: `${i * 0.06}s`,
            transition: hasLevel ? 'height 0.07s ease' : 'height 0.2s ease, background 0.2s ease',
          }}
        />
      ))}
    </div>
  )
}

/** Red dot badge for audio icons */
function Dot({ color = 'red' }: { color?: 'red' | 'green' }) {
  return (
    <span
      className={cn(
        'absolute -top-[2px] -right-[2px] h-[7px] w-[7px] rounded-full',
        color === 'red' ? 'bg-red-500' : 'bg-green-400',
      )}
      style={{ boxShadow: color === 'red' ? '0 0 0 1.5px rgba(8,8,12,0.9)' : '0 0 0 1.5px rgba(8,8,12,0.9)' }}
    />
  )
}

/** Primary answer-style button (subtle green glow) */
function AnswerBtn({ disabled, onClick, streaming }: { disabled?: boolean; onClick: () => void; streaming?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex items-center gap-1.5 px-2.5 h-7 rounded-lg text-[11.5px] font-semibold select-none transition-all',
        'disabled:opacity-30 disabled:cursor-not-allowed',
        streaming
          ? 'text-green-300 cursor-wait'
          : 'text-green-300 hover:text-green-200',
      )}
      style={{
        background: disabled ? 'rgba(34,197,94,0.07)' : 'rgba(34,197,94,0.13)',
        boxShadow: 'inset 0 0 0 1px rgba(34,197,94,0.25)',
        WebkitAppRegion: 'no-drag',
      } as React.CSSProperties}
    >
      {streaming ? (
        <svg className="h-3 w-3 animate-spin opacity-70" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3.5" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : (
        <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
          <path d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" />
        </svg>
      )}
      Answer <Kbd s="⌘↵" />
    </button>
  )
}

/** Standard toolbar pill button */
function TBtn({
  children, onClick, active = false, disabled = false,
}: {
  children: React.ReactNode; onClick: () => void; active?: boolean; disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex items-center gap-1.5 px-2.5 h-7 rounded-lg text-[11.5px] font-medium select-none transition-all',
        'disabled:opacity-25 disabled:cursor-not-allowed',
        active
          ? 'text-white'
          : 'text-white/70 hover:text-white/90',
      )}
      style={{
        background: active ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.065)',
        boxShadow: active ? 'inset 0 0 0 1px rgba(255,255,255,0.22)' : 'inset 0 0 0 1px rgba(255,255,255,0.1)',
        WebkitAppRegion: 'no-drag',
      } as React.CSSProperties}
    >
      {children}
    </button>
  )
}

/** Icon-only toolbar button */
function IBtn({
  onClick, children, title = '', className = '',
  onClickWithRect,
}: {
  onClick?: () => void
  children: React.ReactNode
  title?: string
  className?: string
  onClickWithRect?: (rect: DOMRect) => void
}) {
  return (
    <button
      title={title}
      onClick={(e) => {
        if (onClickWithRect) onClickWithRect(e.currentTarget.getBoundingClientRect())
        else onClick?.()
      }}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      className={cn(
        'flex items-center justify-center h-7 w-7 rounded-lg text-white/40 hover:text-white/85',
        'hover:bg-white/8 transition-all select-none',
        className,
      )}
    >
      {children}
    </button>
  )
}

// ─── Fixed-position Settings dropdown ────────────────────────────────────────
function SettingsMenu({
  rect, zoom, opacity, autoGen,
  onZoom, onOpacity, onAutoGen, onEnd, onClose,
}: {
  rect: DOMRect; zoom: number; opacity: number; autoGen: boolean
  onZoom: (d: number) => void; onOpacity: (d: number) => void
  onAutoGen: (v: boolean) => void; onEnd: () => void; onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    setTimeout(() => document.addEventListener('mousedown', fn), 50)
    return () => document.removeEventListener('mousedown', fn)
  }, [onClose])

  return (
    <div
      ref={ref}
      className="anim-in"
      style={{
        position: 'fixed',
        top: rect.bottom + 6,
        right: window.innerWidth - rect.right,
        zIndex: 99999,
        width: 210,
        borderRadius: 14,
        background: 'rgba(12,12,18,0.97)',
        backdropFilter: 'blur(32px)',
        boxShadow: '0 0 0 1px rgba(255,255,255,0.1), 0 12px 40px rgba(0,0,0,0.8)',
        overflow: 'hidden',
      }}
    >
      <div className="px-3 py-2" style={{ boxShadow: 'inset 0 -1px 0 rgba(255,255,255,0.06)' }}>
        <p className="text-[10px] text-white/30 uppercase tracking-wider font-semibold">Settings</p>
      </div>

      <div className="py-1">
        <SliderRow label="Zoom" value={`${Math.round(zoom * 100)}%`}
          onMinus={() => onZoom(-0.1)} onPlus={() => onZoom(+0.1)} onReset={() => onZoom(1 - zoom)} />
        <SliderRow label="Opacity" value={`${Math.round(opacity * 100)}%`}
          onMinus={() => onOpacity(-0.1)} onPlus={() => onOpacity(+0.1)} onReset={() => onOpacity(1 - opacity)} />

        <div className="flex items-center px-3 py-1.5">
          <span className="text-[12px] text-white/60 flex-1">Auto Answer</span>
          <Toggle on={autoGen} onToggle={() => onAutoGen(!autoGen)} />
        </div>
      </div>

      <div style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)' }} className="py-1">
        <SMenuBtn label="Dashboard" onClick={() => { window.electronAPI.shell.openExternal(`${FRONTEND_URL}/dashboard`); onClose() }}>
          <svg className="h-3 w-3 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </SMenuBtn>
        <SMenuBtn label="End Session" onClick={() => { onEnd(); onClose() }} danger />
      </div>
    </div>
  )
}

function SliderRow({ label, value, onMinus, onPlus, onReset }: {
  label: string; value: string
  onMinus: () => void; onPlus: () => void; onReset: () => void
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5">
      <span className="text-[12px] text-white/55 flex-1">{label}</span>
      <MiniBtn onClick={onMinus}>−</MiniBtn>
      <span className="text-[10px] text-white/35 w-9 text-center tabular-nums">{value}</span>
      <MiniBtn onClick={onPlus}>+</MiniBtn>
      <MiniBtn onClick={onReset}>↺</MiniBtn>
    </div>
  )
}
function MiniBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className="h-5 w-5 rounded-md flex items-center justify-center text-white/50 hover:text-white text-[12px] hover:bg-white/10 transition-colors">
      {children}
    </button>
  )
}
function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle}
      className={cn('relative h-4 w-7 rounded-full transition-colors duration-200', on ? 'bg-green-500' : 'bg-white/15')}>
      <span className={cn('absolute top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform duration-200',
        on ? 'translate-x-3.5' : 'translate-x-0.5')} />
    </button>
  )
}
function SMenuBtn({ label, onClick, children, danger = false }: {
  label: string; onClick: () => void; children?: React.ReactNode; danger?: boolean
}) {
  return (
    <button onClick={onClick}
      className={cn('w-full flex items-center justify-between px-3 py-1.5 text-[12px] transition-colors',
        danger ? 'text-red-400 hover:bg-red-500/10' : 'text-white/60 hover:text-white hover:bg-white/6')}>
      <span>{label}</span>
      {children}
    </button>
  )
}

// ─── Move dropdown ────────────────────────────────────────────────────────────
function MoveMenu({ rect, onMove, onClose }: {
  rect: DOMRect
  onMove: (p: 'top' | 'left' | 'bottom' | 'right') => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    setTimeout(() => document.addEventListener('mousedown', fn), 50)
    return () => document.removeEventListener('mousedown', fn)
  }, [onClose])

  return (
    <div ref={ref} className="anim-in"
      style={{
        position: 'fixed', top: rect.bottom + 6, right: window.innerWidth - rect.right,
        zIndex: 99999, width: 130, borderRadius: 12,
        background: 'rgba(12,12,18,0.97)', backdropFilter: 'blur(32px)',
        boxShadow: '0 0 0 1px rgba(255,255,255,0.1), 0 12px 40px rgba(0,0,0,0.8)',
        overflow: 'hidden',
      }}>
      <div className="px-3 py-2" style={{ boxShadow: 'inset 0 -1px 0 rgba(255,255,255,0.06)' }}>
        <p className="text-[10px] text-white/30 uppercase tracking-wider font-semibold">Move to</p>
      </div>
      <div className="py-1">
        {(['top','left','bottom','right'] as const).map((pos) => (
          <SMenuBtn key={pos} label={pos.charAt(0).toUpperCase() + pos.slice(1)}
            onClick={() => { onMove(pos); onClose() }} />
        ))}
      </div>
    </div>
  )
}

// ─── Activation Modal ─────────────────────────────────────────────────────────
function ActivationModal({
  session, onActivate, onBack, error, activating, onHide,
}: {
  session: CallSession; onActivate: () => void; onBack: () => void
  error: string | null; activating: boolean; onHide: () => void
}) {
  const isFree = session.mode === 'FREE'
  return (
    <div className="overlay-card overflow-hidden anim-in">
      <div className="overlay-header" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <div className="h-5 w-5 rounded-md bg-indigo-500 flex items-center justify-center shadow-sm">
            <span className="text-white font-black text-[9px]">IA</span>
          </div>
          <span className="text-white/75 text-[11px] font-semibold tracking-wide">Interview <span className="text-indigo-400">Agent</span></span>
        </div>
        <div className={cn(
          'flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold',
          isFree ? 'text-indigo-300/70' : 'text-indigo-400',
        )}
          style={{ boxShadow: isFree ? 'inset 0 0 0 1px rgba(129,140,248,0.2)' : 'inset 0 0 0 1px rgba(129,140,248,0.35)' }}>
          <span className={cn('h-1.5 w-1.5 rounded-full', isFree ? 'bg-indigo-400/40' : 'bg-indigo-400')} />
          {isFree ? 'Free · 10 min' : 'Paid · 30 min'}
        </div>
        <div className="flex-1" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />
        <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button onClick={onHide} className="overlay-btn-ghost text-[10px] px-2 h-5">Hide</button>
          <button onClick={onBack} className="overlay-icon-btn hover:text-red-400">
            <svg viewBox="0 0 10 10" className="h-2.5 w-2.5">
              <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
            </svg>
          </button>
        </div>
      </div>

      <div className="px-5 py-4">
        <h2 className="text-white font-semibold text-[15px] mb-3.5">Activate Call Session</h2>

        {isFree && (
          <div className="flex gap-2 mb-3">
            <span className="text-base leading-none mt-0.5 flex-shrink-0">⏰</span>
            <div>
              <p className="text-white/80 text-[12.5px] font-medium">10-minute free trial.</p>
              <p className="text-white/35 text-[11px] mt-0.5 leading-relaxed">
                Timer counts down from 10:00. Buy credits to continue as a full session.
              </p>
            </div>
          </div>
        )}

        <div className="flex gap-2 mb-4">
          <span className="text-base leading-none mt-0.5 flex-shrink-0">✅</span>
          <p className="text-white/45 text-[11.5px] leading-relaxed">
            Share a <span className="text-white/75 font-medium">mock call</span> on YouTube to test IA before your interview.
          </p>
        </div>

        {/* Session info card */}
        <div className="flex items-center gap-2.5 mb-4 px-3 py-2.5 rounded-xl"
             style={{ background: 'rgba(255,255,255,0.04)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.07)' }}>
          <div className="h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0 text-[12px] font-bold text-green-300"
               style={{ background: 'rgba(34,197,94,0.12)', boxShadow: 'inset 0 0 0 1px rgba(34,197,94,0.2)' }}>
            {session.companyName?.[0]?.toUpperCase() ?? 'I'}
          </div>
          <div className="min-w-0">
            <p className="text-white/85 text-[13px] font-medium truncate">{session.companyName ?? 'Interview'}</p>
            <p className="text-white/30 text-[10px]">{session.mode === 'FREE' ? 'Free · 10 min limit' : 'Paid session'}</p>
          </div>
        </div>

        {error && (
          <div className="mb-3 px-3 py-2 rounded-xl text-red-300 text-[11px]"
               style={{ background: 'rgba(239,68,68,0.1)', boxShadow: 'inset 0 0 0 1px rgba(239,68,68,0.2)' }}>
            {error}
          </div>
        )}

        <div className="flex gap-2.5">
          <button onClick={onBack}
            className="flex-1 py-2 rounded-xl text-white/45 hover:text-white/75 text-[12px] font-medium transition-colors"
            style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.1)' }}>
            Back
          </button>
          <button onClick={onActivate} disabled={activating}
            className="flex-1 py-2 rounded-xl text-white text-[12px] font-semibold transition-all flex items-center justify-center gap-1.5 disabled:opacity-40"
            style={{ background: 'rgba(255,255,255,0.09)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.16)' }}>
            {activating ? (
              <><svg className="h-3 w-3 animate-spin text-green-400" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>Activating…</>
            ) : `Activate${isFree ? ' (Free)' : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main SessionOverlay ──────────────────────────────────────────────────────
interface Props {
  session: CallSession
  userCredits?: number   // passed from App so the free-expired overlay can show smart messaging
  isAdmin?: boolean
  onEnd: () => void
  onHide: (height?: number) => void
}

export function SessionOverlay({ session, userCredits = 0, isAdmin = false, onEnd, onHide }: Props) {
  const [isActivated,  setIsActivated]  = useState(false)
  const [activating,   setActivating]   = useState(false)
  const [activateErr,  setActivateErr]  = useState<string | null>(null)

  const [isRunning,    setIsRunning]    = useState(false)
  // Countdown: seconds remaining in the current window. null = not started yet.
  const [remaining,    setRemaining]    = useState<number | null>(null)
  const [smState,      setSmState]      = useState<SmConnectionState>('idle')
  const [transcript,   setTranscript]   = useState<TranscriptEntry[]>([])
  const [partial,      setPartial]      = useState('')
  const [qaPairs,      setQaPairs]      = useState<QAPair[]>([])
  const [currentQA,    setCurrentQA]    = useState(-1)
  const [streaming,    setStreaming]     = useState('')
  const [error,        setError]        = useState<string | null>(null)
  const [freeExpired,  setFreeExpired]  = useState(false)
  const [outOfCredits, setOutOfCredits] = useState(false)

  // Independent mic/system toggles
  const [micOn,        setMicOn]        = useState(false)
  const [sysOn,        setSysOn]        = useState(true)

  const [showChat,     setShowChat]     = useState(false)
  const [showAnswer,   setShowAnswer]   = useState(false)
  const [zoom,         setZoom]         = useState(1)
  const [opacity,      setOpacity]      = useState(1)
  const [autoGen,      setAutoGen]      = useState(session.autoGenerate ?? true)
  const [screenshots,  setScreenshots]  = useState<string[]>([])
  const [manualQ,      setManualQ]      = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [showMove,     setShowMove]     = useState(false)
  const [settingsRect, setSettingsRect] = useState<DOMRect | null>(null)
  const [moveRect,     setMoveRect]     = useState<DOMRect | null>(null)

  const [audioLevel,   setAudioLevel]   = useState(0)  // 0–1 RMS from AudioWorklet
  const [copied,       setCopied]       = useState<string | null>(null)  // id of copied answer

  const isRunningRef   = useRef(false)
  const saveQueueRef   = useRef<string[]>([])
  const silenceRef     = useRef<ReturnType<typeof setTimeout> | null>(null)
  const questionBufRef = useRef<string[]>([])
  const partialRef     = useRef('')
  const pingRef        = useRef<ReturnType<typeof setInterval> | null>(null)
  const timerRef       = useRef<ReturnType<typeof setInterval> | null>(null)
  const txRowRef       = useRef<HTMLDivElement>(null)
  const inputRef       = useRef<HTMLInputElement>(null)
  const pendingQRef    = useRef('')
  const prevHeightRef  = useRef(TOOLBAR_H)
  const answerScrollRef = useRef<HTMLDivElement>(null)  // auto-scroll target in answer panel

  useEffect(() => { partialRef.current = partial }, [partial])

  const audioSrc = useMemo(() => {
    if (micOn && sysOn) return 'both' as const
    if (micOn)          return 'mic'  as const
    return 'system' as const
  }, [micOn, sysOn])

  // ── Speechmatics ──────────────────────────────────────────────────────────
  const sm = useSpeechmatics({
    language: session.language ?? 'en',
    onPartial: setPartial,
    onFinal: useCallback((text: string) => {
      if (!isRunningRef.current) return
      setPartial(''); partialRef.current = ''
      setTranscript((p) => [...p, { id: uid(), text, isFinal: true, timestamp: Date.now() }])
      saveQueueRef.current.push(text)
      questionBufRef.current.push(text)
      if (autoGen) {
        if (silenceRef.current) clearTimeout(silenceRef.current)
        silenceRef.current = setTimeout(() => {
          const q = questionBufRef.current.join(' ').trim()
          questionBufRef.current = []
          if (q) triggerAnswer(q)
        }, SILENCE_TRIGGER_MS)
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoGen]),
    onStateChange: setSmState,
  })

  const audio = useSystemAudio({
    onPCMChunk: sm.sendAudio,
    onError: (m) => setError(m),
    onLevel: setAudioLevel,
  })

  const ai = useAIStream({
    callSessionId: session.id,
    onChunk: useCallback((c: string) => setStreaming((p) => p + c), []),
    onDone: useCallback((full: string) => {
      if (!full.trim()) return
      setStreaming('')
      setQaPairs((p) => {
        const next = [...p, { id: uid(), question: pendingQRef.current, answer: full, ts: new Date() }]
        setCurrentQA(next.length - 1)
        return next
      })
    }, []),
    onError: useCallback((msg: string) => {
      setStreaming('')
      setError(msg.includes('credits') ? 'Out of credits.' : `AI error: ${msg}`)
    }, []),
  })

  // Fix 5: triggerAnswer includes partial + shows answer panel immediately
  const triggerAnswer = useCallback((question?: string, imgs?: string[]) => {
    const finalQ   = questionBufRef.current.join(' ').trim()
    const partialQ = partialRef.current.trim()
    const q = question ?? [finalQ, partialQ].filter(Boolean).join(' ').trim()
    if (!q && !imgs?.length) return

    if (silenceRef.current) { clearTimeout(silenceRef.current); silenceRef.current = null }
    questionBufRef.current = []

    const snapshots = imgs ?? (screenshots.length ? [...screenshots] : undefined)
    if (snapshots?.length) setScreenshots([])

    pendingQRef.current = q || '[screenshot analysis]'
    setShowAnswer(true)   // Fix 3: show immediately, not just on done
    ai.ask(q || 'Analyze this screenshot and provide relevant interview assistance.', snapshots)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ai, screenshots])

  // ── Activate ──────────────────────────────────────────────────────────────
  const handleActivate = useCallback(async () => {
    setActivating(true); setActivateErr(null)
    try {
      await updateSessionStatus(session.id, 'ACTIVE')
      const jwt = await getSpeechmaticsJwt(session.id)
      sm.connect(jwt)
      await audio.start(audioSrc)
      setIsRunning(true); isRunningRef.current = true

      // Countdown: FREE = 10 min, PAID = 30 min; admin = no expiry (set large value)
      const windowSecs = isAdmin ? 99 * 60 : session.mode === 'FREE' ? 10 * 60 : 30 * 60
      setRemaining(windowSecs)
      timerRef.current = setInterval(() => {
        setRemaining((s) => (s !== null ? Math.max(0, s - 1) : null))
      }, 1_000)

      pingRef.current  = setInterval(() => pingSession(session.id), SESSION_PING_MS)
      setIsActivated(true)
      window.electronAPI.window.setHeight(TOOLBAR_H)
    } catch (err) {
      setActivateErr(`Activation failed: ${(err as Error).message}`)
    } finally { setActivating(false) }
  }, [session.id, audioSrc, sm, audio])

  // ── Fix 2: restart audio when mic/sys toggles change while running ─────────
  const prevAudioSrc = useRef(audioSrc)
  useEffect(() => {
    if (!isRunning || audioSrc === prevAudioSrc.current) return
    prevAudioSrc.current = audioSrc
    const restart = async () => {
      audio.stop()
      await audio.start(audioSrc).catch((err: Error) => setError(`Audio: ${err.message}`))
    }
    void restart()
  }, [audioSrc, isRunning, audio])

  // ── End session ────────────────────────────────────────────────────────────
  const endSession = useCallback(async () => {
    if (silenceRef.current) clearTimeout(silenceRef.current)
    if (pingRef.current)    clearInterval(pingRef.current)
    if (timerRef.current)   clearInterval(timerRef.current)
    sm.disconnect(); audio.stop(); ai.abort()
    isRunningRef.current = false; setIsRunning(false)
    const remaining = saveQueueRef.current.splice(0)
    if (remaining.length > 0) {
      await saveTranscriptions(session.id, remaining.map((t) => ({ speaker: 'SYSTEM', text: t }))).catch(() => {})
    }
    await updateSessionStatus(session.id, 'ENDED').catch(() => {})
    onEnd()
  }, [session.id, sm, audio, ai, onEnd])

  // ── Timer expiry ────────────────────────────────────────────────────────────
  // Runs exactly once when countdown hits 0 while the session is live
  useEffect(() => {
    if (remaining !== 0 || !isRunning) return

    if (session.mode === 'FREE') {
      // Free trial ended — stop everything, show overlay
      if (timerRef.current)  clearInterval(timerRef.current)
      if (pingRef.current)   clearInterval(pingRef.current)
      sm.disconnect(); audio.stop(); ai.abort()
      isRunningRef.current = false; setIsRunning(false)
      // Fire-and-forget end + transcript save
      void updateSessionStatus(session.id, 'ENDED').catch(() => {})
      const pending = saveQueueRef.current.splice(0)
      if (pending.length) {
        void saveTranscriptions(session.id, pending.map((t) => ({ speaker: 'SYSTEM', text: t }))).catch(() => {})
      }
      setFreeExpired(true)
      // Expand window to show the overlay card
      window.electronAPI.window.setHeight(MODAL_H)
    } else {
      // PAID — auto-extend: deduct 0.5 credits, reset countdown
      void extendSession(session.id)
        .then((data) => {
          // Reset timer to fresh 30-min window
          setRemaining(30 * 60)
          setError(`Auto-extended ⚡ ${data.newBalance.toFixed(1)} credits left`)
          setTimeout(() => setError(null), 4_000)
        })
        .catch(() => {
          // No credits left — end session
          if (timerRef.current)  clearInterval(timerRef.current)
          if (pingRef.current)   clearInterval(pingRef.current)
          sm.disconnect(); audio.stop(); ai.abort()
          isRunningRef.current = false; setIsRunning(false)
          void updateSessionStatus(session.id, 'ENDED').catch(() => {})
          const pending = saveQueueRef.current.splice(0)
          if (pending.length) {
            void saveTranscriptions(session.id, pending.map((t) => ({ speaker: 'SYSTEM', text: t }))).catch(() => {})
          }
          setOutOfCredits(true)
          window.electronAPI.window.setHeight(MODAL_H)
        })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining])

  // ── Screenshot ─────────────────────────────────────────────────────────────
  const captureScreenshot = useCallback(async (sendNow = false) => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      const track  = stream.getVideoTracks()[0]
      const bitmap = await new ImageCapture(track).grabFrame()
      track.stop()
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width; canvas.height = bitmap.height
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
      const dataUrl = canvas.toDataURL('image/jpeg', 0.75)
      if (sendNow) {
        pendingQRef.current = 'Analyze this screenshot and provide relevant interview assistance.'
        setShowAnswer(true)
        ai.ask(pendingQRef.current, [dataUrl])
      } else {
        setScreenshots((p) => [...p, dataUrl])
        setShowChat(true)
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setError('Screenshot failed — check Screen Recording permission.')
    }
  }, [ai])

  // ── Copy answer helper ─────────────────────────────────────────────────────
  const copyAnswer = useCallback((text: string, id: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(id)
      setTimeout(() => setCopied(null), 2_000)
    }).catch(() => {})
  }, [])

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    const u1 = window.electronAPI.on('shortcut:answer', () => triggerAnswer())
    const u2 = window.electronAPI.on('shortcut:screenshot', () => void captureScreenshot(true))
    const u3 = window.electronAPI.on('shortcut:toggle-chat', () => setShowChat((v) => !v))
    const u4 = window.electronAPI.on('shortcut:clear', () => { setTranscript([]); setPartial(''); questionBufRef.current = [] })
    return () => { u1(); u2(); u3(); u4() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerAnswer, captureScreenshot])

  // ── Batch save transcript ──────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(async () => {
      const pending = saveQueueRef.current.splice(0)
      if (!pending.length || !isRunningRef.current) return
      await saveTranscriptions(session.id, pending.map((t) => ({ speaker: 'SYSTEM', text: t }))).catch(
        () => { saveQueueRef.current.unshift(...pending) }
      )
    }, TRANSCRIPT_SAVE_MS)
    return () => clearInterval(id)
  }, [session.id])

  // ── Auto-scroll transcript row (horizontal) ────────────────────────────────
  useEffect(() => {
    if (txRowRef.current) txRowRef.current.scrollLeft = txRowRef.current.scrollWidth
  }, [transcript, partial])

  // ── Auto-scroll answer panel (vertical) during streaming ───────────────────
  useEffect(() => {
    if (streaming && answerScrollRef.current) {
      answerScrollRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [streaming])

  // ── Cleanup ────────────────────────────────────────────────────────────────
  useEffect(() => () => {
    sm.disconnect(); audio.stop(); ai.abort()
    if (pingRef.current)  clearInterval(pingRef.current)
    if (timerRef.current) clearInterval(timerRef.current)
  }, []) // eslint-disable-line

  // ── Window resize on panel toggle ──────────────────────────────────────────
  useEffect(() => {
    if (!isActivated) return
    let h = TOOLBAR_H
    if (showChat)   h += CHAT_H
    if (showAnswer) h += ANSWER_H
    prevHeightRef.current = h
    window.electronAPI.window.setHeight(h)
  }, [isActivated, showChat, showAnswer])

  // ── Zoom / opacity ─────────────────────────────────────────────────────────
  useEffect(() => { document.documentElement.style.fontSize = `${zoom * 16}px` }, [zoom])
  useEffect(() => { window.electronAPI.window.setOpacity(opacity) }, [opacity])

  const txText = useMemo(() => [...transcript.map((t) => t.text), partial].filter(Boolean).join(' '), [transcript, partial])
  const currentPair = currentQA >= 0 ? qaPairs[currentQA] : null

  // ── FREE trial expired ────────────────────────────────────────────────────
  if (freeExpired) {
    const hasCredits = isAdmin || userCredits >= 0.5
    return (
      <div className="overlay-card overflow-hidden anim-in">
        <div className="overlay-header" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
          <div className="flex items-center gap-1.5">
            <div className="h-5 w-5 rounded-md bg-indigo-500 flex items-center justify-center shadow-sm">
              <span className="text-white font-black text-[9px]">IA</span>
            </div>
            <span className="text-white/75 text-[11px] font-semibold tracking-wide">Interview <span className="text-indigo-400">Agent</span></span>
          </div>
          <div className="flex-1" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />
        </div>
        <div className="px-5 py-4 text-center">
          <div className="text-3xl mb-3">⏱</div>
          <p className="text-white font-semibold text-[14px] mb-1">Free Trial Ended</p>
          <p className="text-white/40 text-[11px] mb-4 leading-relaxed">
            {hasCredits
              ? 'You have credits available — start a paid session to continue.'
              : 'Your 10-minute free trial is up. Buy credits to run full sessions.'}
          </p>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => window.electronAPI.shell.openExternal(`${FRONTEND_URL}/dashboard/callSessions`)}
              className="w-full py-2 rounded-xl text-white text-[12px] font-semibold transition-all"
              style={{ background: 'rgba(99,102,241,0.8)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.15)' }}>
              {hasCredits ? '⚡ Start Paid Session' : '💳 Buy Credits'}
            </button>
            <button onClick={onEnd}
              className="w-full py-2 rounded-xl text-white/40 hover:text-white/75 text-[12px] font-medium transition-colors"
              style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.1)' }}>
              Close
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Out of credits (paid session auto-ended) ──────────────────────────────
  if (outOfCredits) {
    return (
      <div className="overlay-card overflow-hidden anim-in">
        <div className="overlay-header" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
          <div className="flex items-center gap-1.5">
            <div className="h-5 w-5 rounded-md bg-indigo-500 flex items-center justify-center shadow-sm">
              <span className="text-white font-black text-[9px]">IA</span>
            </div>
            <span className="text-white/75 text-[11px] font-semibold tracking-wide">Interview <span className="text-indigo-400">Agent</span></span>
          </div>
          <div className="flex-1" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />
        </div>
        <div className="px-5 py-4 text-center">
          <div className="text-3xl mb-3">⚡</div>
          <p className="text-white font-semibold text-[14px] mb-1">Out of Credits</p>
          <p className="text-white/40 text-[11px] mb-4 leading-relaxed">
            Your session auto-ended — you have no credits left to extend it.
            Buy more credits to continue.
          </p>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => window.electronAPI.shell.openExternal(`${FRONTEND_URL}/dashboard/buyCredits`)}
              className="w-full py-2 rounded-xl text-white text-[12px] font-semibold transition-all"
              style={{ background: 'rgba(99,102,241,0.8)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.15)' }}>
              💳 Buy Credits
            </button>
            <button onClick={onEnd}
              className="w-full py-2 rounded-xl text-white/40 hover:text-white/75 text-[12px] font-medium transition-colors"
              style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.1)' }}>
              Close
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Pre-activation ────────────────────────────────────────────────────────
  if (!isActivated) {
    return (
      <ActivationModal
        session={session} onActivate={handleActivate} onBack={onEnd}
        error={activateErr} activating={activating} onHide={() => onHide(MODAL_H)}
      />
    )
  }

  // ── Active overlay ────────────────────────────────────────────────────────
  const isMicActive = isRunning && micOn
  const isSysActive = isRunning && sysOn
  const panelOpen   = showChat || showAnswer

  // Fix 1: use box-shadow for internal dividers, no border-top/bottom
  const PANEL_BG: React.CSSProperties = {
    background: 'rgba(8,8,12,0.94)',
    backdropFilter: 'blur(40px) saturate(180%)',
  }
  const toolbarStyle: React.CSSProperties = {
    ...PANEL_BG,
    borderRadius: panelOpen ? '14px 14px 0 0' : '14px',
    boxShadow: panelOpen
      ? '0 0 0 1px rgba(255,255,255,0.08), 0 8px 32px rgba(0,0,0,0.7)'
      : '0 0 0 1px rgba(255,255,255,0.08), 0 8px 32px rgba(0,0,0,0.7)',
  }

  return (
    <div className="anim-in" style={{ background: 'transparent' }}>

      {/* ══ TOOLBAR ══════════════════════════════════════════════════════════ */}
      <div
        className="flex items-center gap-1.5 px-2.5 select-none"
        style={{ ...toolbarStyle, height: TOOLBAR_H, WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* Logo + company name */}
        <div className="flex items-center gap-1.5 flex-shrink-0 min-w-0"
             style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <div className="h-5 w-5 rounded-md bg-indigo-500 flex items-center justify-center shadow-sm flex-shrink-0">
            <span className="text-white font-black text-[8px]">IA</span>
          </div>
          <span className="text-white/50 text-[10px] font-medium truncate max-w-[100px]" title={session.companyName}>
            {session.companyName}
          </span>
          <span className={cn(
            'text-[8px] font-semibold px-1 py-0.5 rounded-full flex-shrink-0',
            session.mode === 'FREE'
              ? 'text-indigo-300/60 bg-indigo-500/10'
              : 'text-violet-300/60 bg-violet-500/10',
          )}>
            {session.mode}
          </span>
        </div>

        <Sep />

        {/* Audio indicators */}
        <div className="flex items-center gap-1.5 flex-shrink-0"
             style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <WaveBars active={isRunning} level={audioLevel} />

          {/* System audio toggle with label */}
          <button
            onClick={() => setSysOn((v) => !v)}
            title={sysOn ? 'System audio enabled — click to disable' : 'System audio disabled — click to enable'}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            className={cn(
              'relative flex items-center justify-center h-6 w-6 rounded-lg transition-all',
              isSysActive ? 'text-red-400' : sysOn ? 'text-white/50 hover:text-white/80' : 'text-white/20 hover:text-white/50',
              isSysActive && 'bg-red-500/10',
            )}
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            {sysOn && <Dot color={isSysActive ? 'red' : 'green'} />}
          </button>
          <span className="text-[9px] text-white/40 font-medium">System</span>

          {/* Separator */}
          <Sep />
          <button
            onClick={() => setMicOn((v) => !v)}
            title={micOn ? 'Microphone enabled — click to disable' : 'Microphone disabled — click to enable'}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            className={cn(
              'relative flex items-center justify-center h-6 w-6 rounded-lg transition-all',
              isMicActive ? 'text-red-400' : micOn ? 'text-white/50 hover:text-white/80' : 'text-white/20 hover:text-white/50',
              isMicActive && 'bg-red-500/10',
            )}
          >
            <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
            </svg>
            {micOn && <Dot color={isMicActive ? 'red' : 'green'} />}
          </button>
          <span className="text-[9px] text-white/40 font-medium">Mic</span>
        </div>

        <Sep />

        {/* Answer */}
        <AnswerBtn
          onClick={() => triggerAnswer()}
          disabled={!isRunning}
          streaming={ai.isStreaming}
        />

        {/* Screenshot */}
        <TBtn onClick={() => void captureScreenshot(true)}>
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Screenshot <Kbd s="⌘⇧↵" />
        </TBtn>

        {/* Chat */}
        <TBtn active={showChat} onClick={() => setShowChat((v) => !v)}>
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
          Chat <Kbd s="⌘⇧—" />
          {showAnswer && qaPairs.length > 0 && (
            <span className="ml-0.5 h-4 min-w-[16px] px-1 rounded-full bg-green-500/80 text-white text-[8px] font-bold flex items-center justify-center">
              {qaPairs.length}
            </span>
          )}
        </TBtn>

        <div className="flex-1" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />

        {/* Countdown timer */}
        {remaining !== null && (
          <span
            className={cn(
              'text-[12px] font-mono font-semibold tabular-nums flex-shrink-0 transition-colors',
              remaining <= 60
                ? 'text-red-400 animate-pulse'
                : remaining <= 5 * 60
                  ? 'text-yellow-400'
                  : 'text-white/55',
            )}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            title={session.mode === 'FREE' ? 'Free trial remaining' : 'Until auto-extend'}
          >
            {fmt(remaining)}
          </span>
        )}

       {/* Answer/Question status badge */}
        <div className="flex items-center justify-center px-2.5 py-1 rounded-lg text-[12px] font-semibold"
             style={{
               background: isRunning 
                 ? smState === 'connected' ? 'rgba(34,197,94,0.15)' : 'rgba(251,146,60,0.15)'
                 : 'rgba(255,255,255,0.08)',
               color: isRunning
                 ? smState === 'connected' ? '#86efac' : '#fca5a5'
                 : '#ffffff80',
               boxShadow: isRunning && smState === 'connected' 
                 ? 'inset 0 0 0 1px rgba(34,197,94,0.3)' 
                 : 'inset 0 0 0 1px rgba(255,255,255,0.15)',
               minWidth: '70px',
               textAlign: 'center',
             }}>
          {isRunning && smState === 'connected' ? '🎙️ Listening' :
           isRunning && smState === 'connecting' ? '⏳ Connecting' :
           ai.isStreaming ? '✨ Thinking' :
           'Ready'}
        </div>

        {/* Settings */}
        <IBtn title="Settings" onClickWithRect={(r) => { setSettingsRect(r); setShowSettings((v) => !v); setShowMove(false) }}>
          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
            <path d="M6 10a2 2 0 11-4 0 2 2 0 014 0zM12 10a2 2 0 11-4 0 2 2 0 014 0zM16 12a2 2 0 100-4 2 2 0 000 4z" />
          </svg>
        </IBtn>

        {/* Move */}
        <IBtn title="Move" onClickWithRect={(r) => { setMoveRect(r); setShowMove((v) => !v); setShowSettings(false) }}>
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11l5-5m0 0l5 5m-5-5v12" />
          </svg>
        </IBtn>

        {/* Collapse / Hide */}
        <IBtn title="Collapse panels" onClick={() => { setShowChat(false); setShowAnswer(false) }}>
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
          </svg>
        </IBtn>

        {/* Hide to mini */}
        <IBtn title="Hide to mini bar" onClick={() => onHide(prevHeightRef.current)}>
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
          </svg>
        </IBtn>
      </div>

      {/* Fixed-position dropdowns — never clipped */}
      {showSettings && settingsRect && (
        <SettingsMenu
          rect={settingsRect} zoom={zoom} opacity={opacity} autoGen={autoGen}
          onZoom={(d) => setZoom((z) => Math.max(0.7, Math.min(1.5, +((z + d).toFixed(1)))))}
          onOpacity={(d) => setOpacity((o) => Math.max(0.3, Math.min(1, +((o + d).toFixed(1)))))}
          onAutoGen={setAutoGen} onEnd={endSession} onClose={() => setShowSettings(false)}
        />
      )}
      {showMove && moveRect && (
        <MoveMenu
          rect={moveRect}
          onMove={(pos) => window.electronAPI.window.moveTo(pos)}
          onClose={() => setShowMove(false)}
        />
      )}

      {/* ══ CHAT PANEL ══════════════════════════════════════════════════════ */}
      {showChat && (
        <div
          className="anim-in"
          style={{
            ...PANEL_BG,
            boxShadow: showAnswer
              ? '0 0 0 1px rgba(255,255,255,0.08)'
              : '0 0 0 1px rgba(255,255,255,0.08), 0 8px 32px rgba(0,0,0,0.7)',
            borderRadius: showAnswer ? 0 : '0 0 14px 14px',
          }}
        >
          {/* Screenshot thumbnails */}
          {screenshots.length > 0 && (
            <div className="flex gap-1.5 px-2.5 pt-2.5 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
              {screenshots.map((src, i) => (
                <div key={i} className="relative flex-shrink-0">
                  <img src={src} alt="sc" className="h-14 w-20 object-cover rounded-lg hover:shadow-lg transition-shadow"
                       style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.1), 0 4px 12px rgba(0,0,0,0.3)' }} />
                  <button
                    onClick={() => setScreenshots((p) => p.filter((_, j) => j !== i))}
                    className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full bg-black/80 text-white/60 hover:text-white text-[8px] flex items-center justify-center"
                    style={{ boxShadow: '0 0 0 1px rgba(255,255,255,0.15)' }}
                  >✕</button>
                </div>
              ))}
            </div>
          )}

          {/* Input row */}
          <div className="flex items-center gap-1.5 px-2.5 h-[52px]"
               style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)' }}>
            <input
              ref={inputRef}
              value={manualQ}
              onChange={(e) => setManualQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  triggerAnswer(manualQ.trim() || undefined, screenshots.length ? screenshots : undefined)
                  setManualQ('')
                }
              }}
              placeholder="Enter a message..."
              disabled={!isRunning}
              className="flex-1 rounded-xl px-3 py-1.5 text-[12px] outline-none transition-all disabled:opacity-40"
              style={{
                background: 'rgba(255,255,255,0.06)',
                boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.1)',
                color: '#ffffff',
                WebkitTextFillColor: '#ffffff',
                caretColor: '#4ade80',
              }}
              onFocus={(e) => (e.currentTarget.style.boxShadow = 'inset 0 0 0 1px rgba(34,197,94,0.4)')}
              onBlur={(e) => (e.currentTarget.style.boxShadow = 'inset 0 0 0 1px rgba(255,255,255,0.1)')}
            />

            <button onClick={() => void captureScreenshot(false)}
              className="overlay-btn h-8 px-2 text-[10px] gap-1 flex-shrink-0"
              title="Add screenshot">
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <Kbd s="⌘⌥↵" />
            </button>

            <button
              onClick={() => { triggerAnswer(manualQ.trim() || undefined, screenshots.length ? screenshots : undefined); setManualQ('') }}
              disabled={!isRunning || (!manualQ.trim() && !screenshots.length) || ai.isStreaming}
              className="overlay-btn h-8 px-2.5 text-[12px] font-semibold flex-shrink-0 disabled:opacity-25"
            >
              {ai.isStreaming
                ? <svg className="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                : <>Send <Kbd s="↵" /></>
              }
            </button>

            <IBtn onClick={() => setShowChat(false)} className="flex-shrink-0 h-7 w-7">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </IBtn>
          </div>

          {/* Status row */}
          <div className="flex items-center gap-2 px-2.5 h-10"
               style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)' }}>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <span className={cn('h-1.5 w-1.5 rounded-full flex-shrink-0 transition-colors',
                isRunning && smState === 'connected' ? 'bg-green-400 animate-pulse' : 'bg-white/20')} />
              <span className={cn('text-[11.5px] font-medium',
                isRunning && smState === 'connected' ? 'text-white/70' : 'text-white/25')}>
                {isRunning && smState === 'connected' ? 'Listening…'
                 : isRunning && smState === 'connecting' ? 'Connecting…' : 'Ready'}
              </span>
            </div>

            {txText && (
              <span ref={txRowRef}
                className="text-[10.5px] text-white/28 truncate flex-1 overflow-hidden whitespace-nowrap">
                {txText}
              </span>
            )}

            <div className="flex items-center gap-1 flex-shrink-0 ml-auto">
              <button
                onClick={() => { setTranscript([]); setPartial(''); questionBufRef.current = [] }}
                className="overlay-btn h-6 px-2 text-[10px] gap-1">
                Clear <Kbd s="⌘⇧⌫" />
              </button>
              <IBtn onClick={() => { triggerAnswer(); setTranscript([]); setPartial('') }}
                title="Send transcript as answer" className="h-6 w-6 text-green-400/60 hover:text-green-300 hover:bg-green-500/10">
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              </IBtn>
              <IBtn onClick={() => setShowChat(false)} className="h-6 w-6">
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </IBtn>
            </div>
          </div>
        </div>
      )}

      {/* ══ ANSWER PANEL ════════════════════════════════════════════════════ */}
      {showAnswer && (
        <div
          className="anim-in overflow-hidden"
          style={{
            ...PANEL_BG,
            maxHeight: ANSWER_H,
            borderRadius: '0 0 14px 14px',
            boxShadow: '0 0 0 1px rgba(255,255,255,0.08), 0 8px 32px rgba(0,0,0,0.7)',
          }}
        >
          {/* Nav row */}
          <div className="flex items-center gap-1 px-2.5 h-9 flex-shrink-0"
               style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)' }}>
            <IBtn onClick={() => setCurrentQA((i) => Math.max(0, i - 1))}
              className={cn('h-6 w-6', currentQA <= 0 && 'opacity-20 cursor-not-allowed')}>
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </IBtn>
            <IBtn onClick={() => setCurrentQA((i) => Math.min(qaPairs.length - 1, i + 1))}
              className={cn('h-6 w-6', currentQA >= qaPairs.length - 1 && 'opacity-20 cursor-not-allowed')}>
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </IBtn>
            {qaPairs.length > 0 && (
              <span className="text-[10px] text-white/35 font-medium tracking-wider">
                Q&A: <span className="font-semibold text-white/50">{currentQA + 1}</span>/<span className="text-white/35">{qaPairs.length}</span>
              </span>
            )}

            {error && (
              <span className="text-red-400 text-[10.5px] truncate flex-1 mx-2">{error}
                <button onClick={() => setError(null)} className="ml-1 opacity-50 hover:opacity-100">✕</button>
              </span>
            )}

            <div className="flex-1" />

            {currentPair && !ai.isStreaming && (
              <IBtn onClick={() => { pendingQRef.current = currentPair.question; ai.ask(currentPair.question) }}
                title="Re-generate" className="h-6 w-6">
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </IBtn>
            )}

            <button
              onClick={() => { setQaPairs([]); setCurrentQA(-1); setStreaming(''); setShowAnswer(false); ai.abort() }}
              className="overlay-btn h-6 px-2 text-[10px]">
              Clear
            </button>

            <IBtn onClick={() => setShowAnswer(false)} className="h-6 w-6">
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </IBtn>
          </div>

          {/* Q&A content */}
          <div className="px-3 pt-2.5 pb-4 overflow-y-auto space-y-3" style={{ maxHeight: ANSWER_H - 36 }}>
            {currentPair ? (
              <>
                <div className="flex gap-2">
                  <span className="text-[14px] leading-none mt-0.5 flex-shrink-0">💬</span>
                  <p className="text-[12px] text-white/60 leading-relaxed">
                    <span className="font-semibold text-white/45">Q: </span>{currentPair.question}
                  </p>
                </div>
                <div className="flex gap-2">
                  <span className="text-[14px] leading-none mt-0.5 flex-shrink-0">⭐</span>
                  <div className="flex-1 min-w-0">
                    <AnswerText content={currentPair.answer} />
                  </div>
                </div>
                <p className="text-[10px] text-white/18 text-right">
                  {currentPair.ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </>
            ) : (streaming || ai.isStreaming) ? (
              <div className="flex gap-2">
                <span className="text-[14px] leading-none mt-0.5 flex-shrink-0">⭐</span>
                <p className="text-[12px] text-white/82 leading-relaxed whitespace-pre-wrap flex-1 min-w-0">
                  {streaming}
                  {ai.isStreaming && !streaming && (
                    <span className="text-white/35 text-[11px]">Thinking…</span>
                  )}
                  {ai.isStreaming && (
                    <span className="inline-block h-3.5 w-0.5 bg-green-400 cursor-blink ml-0.5 align-middle rounded-full" />
                  )}
                </p>
              </div>
            ) : (
              <div className="flex items-center justify-center h-20 text-white/20">
                <p className="text-[11px]">Press Answer or speak — AI response appears here</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── AnswerText — markdown-lite renderer ─────────────────────────────────────
function AnswerText({ content }: { content: string }) {
  const parts = content.split(/(```[\s\S]*?```)/g)
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('```')) {
          const lines = part.slice(3, -3).split('\n')
          const lang  = lines[0].trim()
          const code  = lines.slice(1).join('\n')
          return (
            <div key={i} className="mt-2 mb-1 rounded-xl overflow-hidden"
                 style={{ background: 'rgba(255,255,255,0.04)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.07)' }}>
              {lang && (
                <div className="px-3 py-1 text-[9px] text-white/30 font-mono"
                     style={{ boxShadow: 'inset 0 -1px 0 rgba(255,255,255,0.06)' }}>{lang}</div>
              )}
              <pre className="px-3 py-2.5 text-[11px] font-mono text-green-200/75 overflow-x-auto whitespace-pre leading-relaxed">{code}</pre>
            </div>
          )
        }
        return <p key={i} className="text-[13.5px] text-white/85 leading-relaxed whitespace-pre-wrap">{part}</p>
      })}
    </>
  )
}
