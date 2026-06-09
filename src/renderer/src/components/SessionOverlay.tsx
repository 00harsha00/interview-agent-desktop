/**
 * SessionOverlay — live interview assistant.
 *
 * Toolbar (always visible):
 *   [🔊] [💻●] [🎤●]  |  [Answer ⌘↵] [Screenshot ⌘⇧↵] [Chat ⌘⇧—]  |  9:22  [⋮] [⊕] [^]
 *
 * Chat panel (below toolbar when Chat is toggled):
 *   [Enter a message…                     ] [📷 ⌘⌥↵] [Send ↵] [×]
 *   Listening…                    [Clear ⌘⇧⌫] [✓] [×]
 *
 * Answer panel (shown when AI has responses):
 *   [← →] [n/N] Question…  [↺] [Clear]
 *   ⭐ Answer text…
 */
import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react'
import { cn } from '@/lib/utils'
import { SESSION_PING_MS, TRANSCRIPT_SAVE_MS, SILENCE_TRIGGER_MS } from '@/config'
import {
  getSpeechmaticsJwt, updateSessionStatus, saveTranscriptions, pingSession,
} from '@/lib/api'
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

// Window heights (px) communicated to Electron main for auto-resize
const TOOLBAR_H  = 48
const MODAL_H    = 340
const CHAT_H     = 88  // input row (52) + status row (36)
const ANSWER_H   = 300 // Q&A panel

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Animated waveform bars — green idle, red when audio active */
function WaveBars({ active }: { active: boolean }) {
  return (
    <div className="flex items-end gap-[2px] h-4 w-6">
      {[60, 100, 40, 80, 50].map((pct, i) => (
        <div
          key={i}
          className={cn('w-[3px] rounded-full transition-colors', active ? 'bg-green-400' : 'bg-white/25')}
          style={{
            height: active ? `${4 + pct * 0.1}px` : '3px',
            animation: active ? `wave ${0.4 + i * 0.1}s ease-in-out infinite alternate` : 'none',
            animationDelay: `${i * 0.07}s`,
          }}
        />
      ))}
    </div>
  )
}

/** Red dot badge overlay for icon buttons */
function RedDot() {
  return (
    <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-red-500 border border-black" />
  )
}

/** Keyboard shortcut chip */
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[9px] font-mono text-white/40 tracking-tight">{children}</span>
  )
}

/** Pill toolbar button */
function TBtn({
  children, onClick, active = false, disabled = false, className = '',
  title = '',
}: {
  children: React.ReactNode
  onClick: () => void
  active?: boolean
  disabled?: boolean
  className?: string
  title?: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      className={cn(
        'flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] font-medium transition-all select-none',
        'border disabled:opacity-30 disabled:cursor-not-allowed',
        active
          ? 'bg-white/15 border-white/25 text-white'
          : 'bg-white/6 border-white/10 hover:bg-white/12 hover:border-white/20 text-white/85',
        className,
      )}
    >
      {children}
    </button>
  )
}

/** Icon-only button */
function IBtn({
  onClick, children, className = '', title = '',
}: {
  onClick: () => void
  children: React.ReactNode
  className?: string
  title?: string
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      className={cn(
        'h-7 w-7 rounded-lg flex items-center justify-center text-white/50',
        'hover:text-white hover:bg-white/10 transition-colors select-none',
        className,
      )}
    >
      {children}
    </button>
  )
}

// ─── Fixed-position Settings dropdown ────────────────────────────────────────
// Rendered fixed so overflow:hidden on parents never clips it
interface SettingsProps {
  anchorRect: DOMRect
  zoom: number
  opacity: number
  autoGen: boolean
  onZoom: (d: number) => void
  onOpacity: (d: number) => void
  onAutoGen: (v: boolean) => void
  onEnd: () => void
  onClose: () => void
}

function SettingsDropdown({
  anchorRect, zoom, opacity, autoGen, onZoom, onOpacity, onAutoGen, onEnd, onClose,
}: SettingsProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    setTimeout(() => document.addEventListener('mousedown', fn), 50)
    return () => document.removeEventListener('mousedown', fn)
  }, [onClose])

  const top   = anchorRect.bottom + 4
  const right = window.innerWidth - anchorRect.right

  return (
    <div
      ref={ref}
      style={{ position: 'fixed', top, right, zIndex: 9999 }}
      className="w-52 rounded-xl py-1 text-[12px] shadow-2xl border border-white/10"
      css-bg="settings"
      // Inline style for background since this is outside normal Tailwind flow
    >
      <style>{`.settings-bg { background: rgba(15,15,18,0.98); backdrop-filter: blur(16px); }`}</style>
      <div className="rounded-xl overflow-hidden border border-white/10"
           style={{ background: 'rgba(15,15,18,0.98)', backdropFilter: 'blur(20px)' }}>

        <div className="px-3 py-1.5 border-b border-white/8 mb-0.5">
          <p className="text-white/30 text-[10px] uppercase tracking-wider">Settings</p>
        </div>

        {/* Zoom */}
        <Row label="Zoom">
          <AdjustRow value={`${Math.round(zoom * 100)}%`}
            onMinus={() => onZoom(-0.1)} onPlus={() => onZoom(+0.1)} onReset={() => onZoom(1 - zoom)} />
        </Row>

        {/* Opacity */}
        <Row label="Opacity">
          <AdjustRow value={`${Math.round(opacity * 100)}%`}
            onMinus={() => onOpacity(-0.1)} onPlus={() => onOpacity(+0.1)} onReset={() => onOpacity(1 - opacity)} />
        </Row>

        {/* Auto Generate */}
        <Row label="Auto Generate">
          <Toggle on={autoGen} onToggle={() => onAutoGen(!autoGen)} />
        </Row>

        <div className="border-t border-white/8 my-0.5" />

        <MenuBtn label="Dashboard" onClick={() => { window.electronAPI.shell.openExternal('http://localhost:4000/dashboard'); onClose() }}>
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
        </MenuBtn>
        <MenuBtn label="Hide" onClick={() => { window.electronAPI.window.hide(); onClose() }} />
        <MenuBtn label="End Session" onClick={() => { onEnd(); onClose() }} className="text-red-400 hover:bg-red-500/10" />
      </div>
    </div>
  )
}

// ─── Fixed-position Move dropdown ─────────────────────────────────────────────
function MoveDropdown({
  anchorRect, onMove, onClose,
}: {
  anchorRect: DOMRect
  onMove: (pos: 'top' | 'left' | 'bottom' | 'right') => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    setTimeout(() => document.addEventListener('mousedown', fn), 50)
    return () => document.removeEventListener('mousedown', fn)
  }, [onClose])

  const top   = anchorRect.bottom + 4
  const right = window.innerWidth - anchorRect.right

  return (
    <div ref={ref} style={{ position: 'fixed', top, right, zIndex: 9999 }}>
      <div className="w-32 rounded-xl overflow-hidden border border-white/10 py-1"
           style={{ background: 'rgba(15,15,18,0.98)', backdropFilter: 'blur(20px)' }}>
        <div className="px-3 py-1 text-[10px] text-white/30 uppercase tracking-wider">Move to</div>
        {(['top','left','bottom','right'] as const).map((pos) => (
          <MenuBtn key={pos} label={pos.charAt(0).toUpperCase() + pos.slice(1)}
            onClick={() => { onMove(pos); onClose() }} />
        ))}
      </div>
    </div>
  )
}

// ─── Shared mini-components ───────────────────────────────────────────────────
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5">
      <span className="text-white/60 flex-1">{label}</span>
      {children}
    </div>
  )
}
function AdjustRow({ value, onMinus, onPlus, onReset }: { value: string; onMinus: () => void; onPlus: () => void; onReset: () => void }) {
  return (
    <div className="flex items-center gap-1">
      <SmBtn onClick={onMinus}>−</SmBtn>
      <span className="text-white/40 text-[10px] w-8 text-center">{value}</span>
      <SmBtn onClick={onPlus}>+</SmBtn>
      <SmBtn onClick={onReset}>↺</SmBtn>
    </div>
  )
}
function SmBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className="h-5 w-5 rounded bg-white/8 hover:bg-white/15 text-white/60 hover:text-white flex items-center justify-center text-[11px] transition-colors">
      {children}
    </button>
  )
}
function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle}
      className={cn('relative h-4 w-7 rounded-full transition-colors', on ? 'bg-green-500' : 'bg-white/20')}>
      <span className={cn('absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform',
        on ? 'translate-x-3.5' : 'translate-x-0.5')} />
    </button>
  )
}
function MenuBtn({ label, onClick, children, className = '' }: { label: string; onClick: () => void; children?: React.ReactNode; className?: string }) {
  return (
    <button onClick={onClick}
      className={cn('w-full flex items-center justify-between px-3 py-1.5 text-white/70 hover:text-white hover:bg-white/8 transition-colors', className)}>
      <span>{label}</span>
      {children}
    </button>
  )
}

// ─── Activation Modal ─────────────────────────────────────────────────────────
function ActivationModal({
  session, onActivate, onBack, error, activating,
}: {
  session: CallSession
  onActivate: () => void
  onBack: () => void
  error: string | null
  activating: boolean
}) {
  const isFree = session.mode === 'FREE'
  return (
    <div className="rounded-2xl overflow-hidden shadow-2xl border border-white/10"
         style={{ background: 'rgba(12,12,16,0.97)' }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 h-10 border-b border-white/8"
           style={{ WebkitAppRegion: 'drag', background: 'rgba(0,0,0,0.4)' } as React.CSSProperties}>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <div className="h-5 w-5 rounded-md bg-green-500 flex items-center justify-center">
            <span className="text-white font-black text-[9px]">I</span>
          </div>
          <span className="text-white/80 text-[11px] font-semibold tracking-wide">I<span className="text-green-400">AI</span></span>
        </div>
        <div className={cn(
          'flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold ml-1',
          isFree ? 'bg-gray-700/60 text-gray-400 border border-gray-600/40' : 'bg-green-500/20 text-green-400 border border-green-500/30',
        )}>
          <span className={cn('h-1 w-1 rounded-full', isFree ? 'bg-gray-400' : 'bg-green-400')} />
          {isFree ? 'No Credits' : 'Credits Available'}
        </div>
        <div className="flex-1" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />
        <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button onClick={() => window.electronAPI.window.hide()}
            className="h-5 px-1.5 rounded text-[9px] text-white/40 hover:text-white/80 border border-white/10 hover:bg-white/8 transition-colors">
            Hide
          </button>
          <button onClick={() => window.electronAPI.window.close()}
            className="h-5 w-5 rounded flex items-center justify-center text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-colors">
            <svg viewBox="0 0 10 10" className="h-2.5 w-2.5">
              <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
            </svg>
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="px-5 py-4">
        <h2 className="text-white font-semibold text-[15px] mb-3">Activate Call Session</h2>

        {isFree && (
          <div className="flex items-start gap-2 mb-3 text-[12px]">
            <span className="text-[14px] leading-none mt-0.5">⏰</span>
            <div>
              <span className="text-white/85 font-medium">This is a 10 minute free session.</span>
              <p className="text-white/40 text-[11px] mt-0.5">
                You won't be able to create another free session for the next 15 minutes.
              </p>
            </div>
          </div>
        )}

        <div className="flex items-start gap-2 mb-4 text-[12px]">
          <span className="text-[14px] leading-none mt-0.5">✅</span>
          <p className="text-white/60">
            You can also share a <span className="text-white font-medium">mock call</span> on YouTube to test IAI.
          </p>
        </div>

        {/* Session card */}
        <div className="flex items-center gap-2.5 mb-4 px-3 py-2 rounded-xl border border-white/8"
             style={{ background: 'rgba(255,255,255,0.04)' }}>
          <div className="h-8 w-8 rounded-full bg-green-500/15 border border-green-500/20 flex items-center justify-center flex-shrink-0">
            <span className="text-green-400 text-[11px] font-bold">
              {session.companyName?.[0]?.toUpperCase() ?? 'I'}
            </span>
          </div>
          <div className="min-w-0">
            <p className="text-white text-[13px] font-medium truncate">{session.companyName ?? 'Interview'}</p>
            <p className="text-white/35 text-[10px]">{session.mode === 'FREE' ? 'Free session · 10 min' : 'Paid session'}</p>
          </div>
        </div>

        {error && (
          <div className="mb-3 px-3 py-2 rounded-lg border border-red-500/20 text-red-400 text-[11px]"
               style={{ background: 'rgba(239,68,68,0.08)' }}>
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={onBack}
            className="flex-1 py-2 rounded-xl border border-white/12 text-white/55 hover:text-white hover:border-white/25 text-[12px] font-medium transition-colors">
            Back
          </button>
          <button onClick={onActivate} disabled={activating}
            className="flex-1 py-2 rounded-xl border border-white/15 text-white text-[12px] font-semibold transition-colors disabled:opacity-40 flex items-center justify-center gap-1.5"
            style={{ background: activating ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.08)' }}>
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
interface Props { session: CallSession; onEnd: () => void }

export function SessionOverlay({ session, onEnd }: Props) {
  // ── Activation ─────────────────────────────────────────────────────────────
  const [isActivated, setIsActivated] = useState(false)
  const [activating,  setActivating]  = useState(false)
  const [activateErr, setActivateErr] = useState<string | null>(null)

  // ── Session state ──────────────────────────────────────────────────────────
  const [isRunning,   setIsRunning]   = useState(false)
  const [elapsed,     setElapsed]     = useState(0)
  const [smState,     setSmState]     = useState<SmConnectionState>('idle')
  const [transcript,  setTranscript]  = useState<TranscriptEntry[]>([])
  const [partial,     setPartial]     = useState('')
  const [qaPairs,     setQaPairs]     = useState<QAPair[]>([])
  const [currentQA,   setCurrentQA]   = useState(-1)
  const [streaming,   setStreaming]    = useState('')
  const [error,       setError]       = useState<string | null>(null)

  // ── Audio source — two independent toggles ─────────────────────────────────
  const [micOn,       setMicOn]       = useState(false)
  const [sysOn,       setSysOn]       = useState(true)

  // ── UI state ───────────────────────────────────────────────────────────────
  const [showChat,    setShowChat]    = useState(false)
  const [showAnswer,  setShowAnswer]  = useState(false)
  const [zoom,        setZoom]        = useState(1)
  const [opacity,     setOpacity]     = useState(1)
  const [autoGen,     setAutoGen]     = useState(session.autoGenerate ?? true)
  const [screenshots, setScreenshots] = useState<string[]>([])
  const [manualQ,     setManualQ]     = useState('')
  const [showSettings,setShowSettings]= useState(false)
  const [showMove,    setShowMove]    = useState(false)
  const [settingsRect,setSettingsRect]= useState<DOMRect | null>(null)
  const [moveRect,    setMoveRect]    = useState<DOMRect | null>(null)

  // ── Refs ───────────────────────────────────────────────────────────────────
  const isRunningRef    = useRef(false)
  const saveQueueRef    = useRef<string[]>([])
  const silenceRef      = useRef<ReturnType<typeof setTimeout> | null>(null)
  const questionBufRef  = useRef<string[]>([])
  const partialRef      = useRef('')          // Fix 5: mirror partial for real-time Answer
  const pingRef         = useRef<ReturnType<typeof setInterval> | null>(null)
  const timerRef        = useRef<ReturnType<typeof setInterval> | null>(null)
  const transcriptRowRef= useRef<HTMLDivElement>(null)
  const inputRef        = useRef<HTMLInputElement>(null)
  const pendingQRef     = useRef('')

  // Keep partialRef in sync (Fix 5)
  useEffect(() => { partialRef.current = partial }, [partial])

  // ── Derived audio source ───────────────────────────────────────────────────
  const audioSrc = useMemo(() => {
    if (micOn && sysOn) return 'both' as const
    if (micOn)          return 'mic' as const
    return 'system' as const  // default — system audio
  }, [micOn, sysOn])

  // ── Speechmatics ──────────────────────────────────────────────────────────
  const sm = useSpeechmatics({
    language: session.language ?? 'en',
    onPartial: setPartial,
    onFinal: useCallback((text: string) => {
      if (!isRunningRef.current) return
      setPartial('')
      partialRef.current = ''
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

  const audio = useSystemAudio({ onPCMChunk: sm.sendAudio, onError: (m) => setError(m) })

  const ai = useAIStream({
    callSessionId: session.id,
    onChunk: useCallback((c: string) => setStreaming((p) => p + c), []),
    onDone: useCallback((full: string) => {
      if (!full.trim()) return
      setStreaming('')
      setQaPairs((p) => {
        const next = [...p, { id: uid(), question: pendingQRef.current, answer: full, ts: new Date() }]
        setCurrentQA(next.length - 1)
        setShowAnswer(true)
        return next
      })
    }, []),
    onError: useCallback((msg: string) => {
      setStreaming('')
      setError(msg.includes('credits') ? 'Out of credits. Buy more to continue.' : `AI error: ${msg}`)
    }, []),
  })

  // ── triggerAnswer — includes partial + pending screenshots ─────────────────
  const triggerAnswer = useCallback((question?: string, imgs?: string[]) => {
    // Fix 5: combine finalized + any in-flight partial
    const finalParts = questionBufRef.current.join(' ').trim()
    const partial    = partialRef.current.trim()
    const q = question ?? ([finalParts, partial].filter(Boolean).join(' ').trim())
    if (!q && !imgs?.length) return

    questionBufRef.current = []
    pendingQRef.current = q || '[screenshot]'

    const snapshots = imgs ?? (screenshots.length ? [...screenshots] : undefined)
    if (snapshots?.length) setScreenshots([])

    ai.ask(q || 'Analyze this screenshot and provide relevant interview assistance.', snapshots)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ai, screenshots])

  // ── Activation ─────────────────────────────────────────────────────────────
  const handleActivate = useCallback(async () => {
    setActivating(true)
    setActivateErr(null)
    try {
      await updateSessionStatus(session.id, 'ACTIVE')
      const jwt = await getSpeechmaticsJwt(session.id)
      sm.connect(jwt)
      await audio.start(audioSrc)
      setIsRunning(true)
      isRunningRef.current = true
      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1_000)
      pingRef.current  = setInterval(() => pingSession(session.id), SESSION_PING_MS)
      setIsActivated(true)
      window.electronAPI.window.setHeight(TOOLBAR_H)
    } catch (err) {
      setActivateErr(`Activation failed: ${(err as Error).message}`)
    } finally {
      setActivating(false)
    }
  }, [session.id, audioSrc, sm, audio])

  // ── End session ────────────────────────────────────────────────────────────
  const endSession = useCallback(async () => {
    if (silenceRef.current) clearTimeout(silenceRef.current)
    if (pingRef.current)    clearInterval(pingRef.current)
    if (timerRef.current)   clearInterval(timerRef.current)
    sm.disconnect(); audio.stop(); ai.abort()
    isRunningRef.current = false
    setIsRunning(false)
    const remaining = saveQueueRef.current.splice(0)
    if (remaining.length > 0) {
      await saveTranscriptions(session.id, remaining.map((t) => ({ speaker: 'SYSTEM', text: t }))).catch(() => {})
    }
    await updateSessionStatus(session.id, 'ENDED').catch(() => {})
    onEnd()
  }, [session.id, sm, audio, ai, onEnd])

  // ── Screenshot capture ─────────────────────────────────────────────────────
  const captureScreenshot = useCallback(async (sendNow = false) => {
    try {
      const stream  = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      const track   = stream.getVideoTracks()[0]
      const cap     = new ImageCapture(track)
      const bitmap  = await cap.grabFrame()
      track.stop()
      const canvas  = document.createElement('canvas')
      canvas.width  = bitmap.width
      canvas.height = bitmap.height
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
      const dataUrl = canvas.toDataURL('image/jpeg', 0.75)

      if (sendNow) {
        // Immediately send as single screenshot (toolbar Screenshot button)
        pendingQRef.current = 'Please analyze this screenshot and provide relevant interview assistance.'
        ai.ask(pendingQRef.current, [dataUrl])
        setShowAnswer(true)
      } else {
        // Accumulate in chat area
        setScreenshots((p) => [...p, dataUrl])
        setShowChat(true)
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setError('Screenshot failed — check Screen Recording permission.')
    }
  }, [ai])

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    const u1 = window.electronAPI.on('shortcut:answer', () => triggerAnswer())
    const u2 = window.electronAPI.on('shortcut:screenshot', () => void captureScreenshot(true))
    const u3 = window.electronAPI.on('shortcut:toggle-chat', () => setShowChat((v) => !v))
    const u4 = window.electronAPI.on('shortcut:clear', () => {
      setTranscript([]); setPartial(''); questionBufRef.current = []
    })
    return () => { u1(); u2(); u3(); u4() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerAnswer, captureScreenshot])

  // ── Batch save transcript ──────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(async () => {
      const pending = saveQueueRef.current.splice(0)
      if (!pending.length || !isRunningRef.current) return
      await saveTranscriptions(session.id, pending.map((t) => ({ speaker: 'SYSTEM', text: t }))).catch(
        () => { saveQueueRef.current.unshift(...pending) },
      )
    }, TRANSCRIPT_SAVE_MS)
    return () => clearInterval(id)
  }, [session.id])

  // ── Auto-scroll transcript row ─────────────────────────────────────────────
  useEffect(() => {
    if (transcriptRowRef.current) {
      transcriptRowRef.current.scrollLeft = transcriptRowRef.current.scrollWidth
    }
  }, [transcript, partial])

  // ── Cleanup ────────────────────────────────────────────────────────────────
  useEffect(() => () => {
    sm.disconnect(); audio.stop(); ai.abort()
    if (pingRef.current)  clearInterval(pingRef.current)
    if (timerRef.current) clearInterval(timerRef.current)
  }, [])  // eslint-disable-line

  // ── Window resize when panels toggle ──────────────────────────────────────
  useEffect(() => {
    if (!isActivated) return
    let h = TOOLBAR_H
    if (showChat)   h += CHAT_H
    if (showAnswer) h += ANSWER_H
    window.electronAPI.window.setHeight(h)
  }, [isActivated, showChat, showAnswer])

  // ── Zoom / opacity ─────────────────────────────────────────────────────────
  useEffect(() => { document.documentElement.style.fontSize = `${zoom * 16}px` }, [zoom])
  useEffect(() => { window.electronAPI.window.setOpacity(opacity) }, [opacity])

  // ── Transcript text ────────────────────────────────────────────────────────
  const transcriptText = useMemo(
    () => [...transcript.map((t) => t.text), partial].filter(Boolean).join(' '),
    [transcript, partial],
  )
  const currentPair = currentQA >= 0 ? qaPairs[currentQA] : null

  // ─────────────────────────────────────────────────────────────────────────
  // ── Pre-activation: show modal ────────────────────────────────────────────
  if (!isActivated) {
    return (
      <ActivationModal
        session={session}
        onActivate={handleActivate}
        onBack={onEnd}
        error={activateErr}
        activating={activating}
      />
    )
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ── Active overlay ────────────────────────────────────────────────────────
  const isMicActive = isRunning && (micOn)
  const isSysActive = isRunning && (sysOn)

  const BG = 'rgba(8,8,10,0.93)'
  const BORDER = '1px solid rgba(255,255,255,0.07)'

  return (
    <div style={{ background: 'transparent' }}>

      {/* ══════════ TOOLBAR ══════════ */}
      <div
        className="flex items-center gap-1.5 px-2.5 select-none rounded-t-xl"
        style={{
          height: TOOLBAR_H,
          background: BG,
          backdropFilter: 'blur(24px)',
          borderBottom: (showChat || showAnswer) ? BORDER : 'none',
          WebkitAppRegion: 'drag',
          borderRadius: (!showChat && !showAnswer) ? '12px' : '12px 12px 0 0',
        } as React.CSSProperties}
      >
        {/* Audio indicators */}
        <div className="flex items-center gap-1.5 flex-shrink-0"
             style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <WaveBars active={isRunning} />

          {/* System audio toggle */}
          <button
            onClick={() => setSysOn((v) => !v)}
            className={cn(
              'relative flex items-center justify-center h-6 w-6 rounded transition-colors',
              isSysActive ? 'text-red-400' : 'text-white/30 hover:text-white/60',
            )}
            title={sysOn ? 'System audio ON (click to disable)' : 'System audio OFF (click to enable)'}
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            {sysOn && <RedDot />}
          </button>

          {/* Mic toggle */}
          <button
            onClick={() => setMicOn((v) => !v)}
            className={cn(
              'relative flex items-center justify-center h-6 w-6 rounded transition-colors',
              isMicActive ? 'text-red-400' : 'text-white/30 hover:text-white/60',
            )}
            title={micOn ? 'Mic ON (click to disable)' : 'Mic OFF (click to enable)'}
          >
            <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
            </svg>
            {micOn && <RedDot />}
          </button>
        </div>

        {/* Separator */}
        <div className="w-px h-5 bg-white/10 flex-shrink-0" />

        {/* Answer */}
        <TBtn
          onClick={() => { if (silenceRef.current) clearTimeout(silenceRef.current); triggerAnswer() }}
          disabled={!isRunning || ai.isStreaming}
          title="Get AI answer"
        >
          <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
            <path d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" />
          </svg>
          Answer <Kbd>⌘↵</Kbd>
        </TBtn>

        {/* Screenshot */}
        <TBtn
          onClick={() => void captureScreenshot(true)}
          title="Take screenshot and ask AI"
        >
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Screenshot <Kbd>⌘⇧↵</Kbd>
        </TBtn>

        {/* Chat */}
        <TBtn
          active={showChat}
          onClick={() => setShowChat((v) => !v)}
        >
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
          Chat <Kbd>⌘⇧—</Kbd>
        </TBtn>

        {/* Flex spacer */}
        <div className="flex-1" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />

        {/* Timer */}
        <span
          className="text-[13px] font-mono text-white/70 tabular-nums flex-shrink-0"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {fmt(elapsed)}
        </span>

        {/* SM dot */}
        <div
          className={cn('h-1.5 w-1.5 rounded-full flex-shrink-0',
            smState === 'connected' ? 'bg-green-400' : smState === 'connecting' ? 'bg-yellow-400 animate-pulse' : 'bg-white/20',
          )}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          title={smState}
        />

        {/* Settings ⋮ */}
        <IBtn
          onClick={(e) => {
            const el = (e as unknown as React.MouseEvent<HTMLButtonElement>).currentTarget
            setSettingsRect(el.getBoundingClientRect())
            setShowSettings((v) => !v)
            setShowMove(false)
          }}
          title="Settings"
        >
          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
            <path d="M6 10a2 2 0 11-4 0 2 2 0 014 0zM12 10a2 2 0 11-4 0 2 2 0 014 0zM16 12a2 2 0 100-4 2 2 0 000 4z" />
          </svg>
        </IBtn>

        {/* Move ⊕ */}
        <IBtn
          onClick={(e) => {
            const el = (e as unknown as React.MouseEvent<HTMLButtonElement>).currentTarget
            setMoveRect(el.getBoundingClientRect())
            setShowMove((v) => !v)
            setShowSettings(false)
          }}
          title="Move overlay"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
          </svg>
        </IBtn>

        {/* Collapse ^ */}
        <IBtn
          onClick={() => { setShowChat(false); setShowAnswer(false) }}
          title="Collapse panels"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
          </svg>
        </IBtn>
      </div>

      {/* Dropdowns — fixed-position, never clipped */}
      {showSettings && settingsRect && (
        <SettingsDropdown
          anchorRect={settingsRect}
          zoom={zoom}
          opacity={opacity}
          autoGen={autoGen}
          onZoom={(d) => setZoom((z) => Math.max(0.7, Math.min(1.5, parseFloat((z + d).toFixed(1)))))}
          onOpacity={(d) => setOpacity((o) => Math.max(0.3, Math.min(1, parseFloat((o + d).toFixed(1)))))}
          onAutoGen={setAutoGen}
          onEnd={endSession}
          onClose={() => setShowSettings(false)}
        />
      )}
      {showMove && moveRect && (
        <MoveDropdown
          anchorRect={moveRect}
          onMove={(pos) => window.electronAPI.window.moveTo(pos)}
          onClose={() => setShowMove(false)}
        />
      )}

      {/* ══════════ CHAT PANEL ══════════ */}
      {showChat && (
        <div style={{ background: BG, backdropFilter: 'blur(24px)', borderBottom: showAnswer ? BORDER : 'none' }}>

          {/* Screenshot thumbnails */}
          {screenshots.length > 0 && (
            <div className="flex gap-1.5 px-2.5 pt-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
              {screenshots.map((src, i) => (
                <div key={i} className="relative flex-shrink-0">
                  <img src={src} alt="sc" className="h-10 w-16 object-cover rounded-lg border border-white/10" />
                  <button
                    onClick={() => setScreenshots((p) => p.filter((_, j) => j !== i))}
                    className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full bg-black border border-white/20 flex items-center justify-center text-white/60 hover:text-white text-[8px]"
                  >✕</button>
                </div>
              ))}
            </div>
          )}

          {/* Input row */}
          <div className="flex items-center gap-1.5 px-2.5 h-[52px]"
               style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
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
              className="flex-1 rounded-lg px-3 py-1.5 text-[12px] border border-white/10 outline-none focus:border-green-500/40 transition-colors disabled:opacity-40"
              style={{
                background: 'rgba(255,255,255,0.06)',
                color: '#ffffff',
                WebkitTextFillColor: '#ffffff',
                caretColor: '#4ade80',
              }}
            />

            {/* Add screenshot */}
            <button
              onClick={() => void captureScreenshot(false)}
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-white/10 text-white/50 hover:text-white hover:border-white/20 transition-colors text-[10px]"
              style={{ background: 'rgba(255,255,255,0.05)' }}
              title="Add screenshot"
            >
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <Kbd>⌘⌥↵</Kbd>
            </button>

            {/* Send */}
            <button
              onClick={() => {
                triggerAnswer(manualQ.trim() || undefined, screenshots.length ? screenshots : undefined)
                setManualQ('')
              }}
              disabled={!isRunning || (!manualQ.trim() && screenshots.length === 0) || ai.isStreaming}
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-white/10 text-white/60 hover:text-white hover:border-white/20 transition-colors text-[12px] font-medium disabled:opacity-30"
              style={{ background: 'rgba(255,255,255,0.05)' }}
            >
              {ai.isStreaming
                ? <svg className="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                : <>Send <Kbd>↵</Kbd></>
              }
            </button>

            {/* Close chat */}
            <IBtn onClick={() => setShowChat(false)}>
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </IBtn>
          </div>

          {/* Status row */}
          <div className="flex items-center gap-2 px-2.5 h-9"
               style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
            <span className={cn('text-[12px] font-medium', isRunning && smState === 'connected' ? 'text-white/80' : 'text-white/30')}>
              {isRunning && smState === 'connected' ? 'Listening…' :
               isRunning && smState === 'connecting' ? 'Connecting…' : 'Ready'}
            </span>
            {transcriptText && (
              <span className="text-[11px] text-white/30 truncate flex-1 ml-1">{transcriptText}</span>
            )}
            <div className="flex items-center gap-1 flex-shrink-0 ml-auto">
              {/* Clear transcript */}
              <button
                onClick={() => { setTranscript([]); setPartial(''); questionBufRef.current = [] }}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded-lg border border-white/8 text-white/40 hover:text-white hover:border-white/20 text-[10px] transition-colors"
                style={{ background: 'rgba(255,255,255,0.04)' }}
              >
                Clear <Kbd>⌘⇧⌫</Kbd>
              </button>
              {/* Accept transcript as question */}
              <IBtn
                onClick={() => { triggerAnswer(); setTranscript([]); setPartial('') }}
                title="Send transcript as question (✓)"
                className="h-6 w-6 text-green-400/60 hover:text-green-400 hover:bg-green-500/10"
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              </IBtn>
              {/* Dismiss */}
              <IBtn onClick={() => setShowChat(false)} className="h-6 w-6">
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </IBtn>
            </div>
          </div>
        </div>
      )}

      {/* ══════════ ANSWER PANEL ══════════ */}
      {showAnswer && (
        <div
          className="overflow-y-auto"
          style={{
            background: BG,
            backdropFilter: 'blur(24px)',
            maxHeight: ANSWER_H,
            borderRadius: '0 0 12px 12px',
          }}
        >
          {/* Nav row */}
          <div className="flex items-center gap-1.5 px-2.5 h-9 flex-shrink-0"
               style={{ borderTop: BORDER }}>
            <button
              onClick={() => setCurrentQA((i) => Math.max(0, i - 1))}
              disabled={currentQA <= 0}
              className="h-6 w-6 rounded flex items-center justify-center text-white/30 hover:text-white disabled:opacity-15 transition-colors"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              onClick={() => setCurrentQA((i) => Math.min(qaPairs.length - 1, i + 1))}
              disabled={currentQA >= qaPairs.length - 1}
              className="h-6 w-6 rounded flex items-center justify-center text-white/30 hover:text-white disabled:opacity-15 transition-colors"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
            {qaPairs.length > 0 && (
              <span className="text-[10px] text-white/25">{currentQA + 1}/{qaPairs.length}</span>
            )}

            {/* Error */}
            {error && (
              <span className="text-red-400 text-[11px] truncate flex-1">{error}
                <button onClick={() => setError(null)} className="ml-1 text-red-400/50 hover:text-red-400">✕</button>
              </span>
            )}

            <div className="flex-1" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />

            {/* Re-ask */}
            {currentPair && (
              <IBtn
                onClick={() => { pendingQRef.current = currentPair.question; ai.ask(currentPair.question) }}
                disabled={ai.isStreaming}
                title="Re-generate answer"
                className="h-6 w-6"
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </IBtn>
            )}

            {/* Clear answers */}
            <button
              onClick={() => { setQaPairs([]); setCurrentQA(-1); setStreaming(''); setShowAnswer(false); ai.abort() }}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded-lg border border-white/8 text-white/35 hover:text-white hover:border-white/20 text-[10px] transition-colors"
              style={{ background: 'rgba(255,255,255,0.04)', WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              Clear
            </button>

            {/* Close answer panel */}
            <IBtn onClick={() => setShowAnswer(false)} className="h-6 w-6">
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </IBtn>
          </div>

          {/* Q&A content */}
          <div className="px-3 pb-4 space-y-2.5">
            {currentPair ? (
              <>
                <div className="flex items-start gap-1.5">
                  <span className="text-base leading-none mt-0.5 flex-shrink-0">💬</span>
                  <p className="text-[12px] text-white/65 leading-relaxed">
                    <span className="font-semibold text-white/50">Question: </span>
                    {currentPair.question}
                  </p>
                </div>
                <div className="flex items-start gap-1.5">
                  <span className="text-base leading-none mt-0.5 flex-shrink-0">⭐</span>
                  <div className="flex-1">
                    <AnswerText content={currentPair.answer} />
                  </div>
                </div>
                <p className="text-[10px] text-white/20 text-right pr-0.5">
                  Chat · {currentPair.ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </>
            ) : streaming ? (
              <div className="flex items-start gap-1.5">
                <span className="text-base leading-none mt-0.5 flex-shrink-0">⭐</span>
                <p className="text-[12px] text-white/85 leading-relaxed whitespace-pre-wrap flex-1">
                  {streaming}
                  <span className="inline-block h-3.5 w-0.5 bg-green-400 animate-pulse ml-0.5 align-middle" />
                </p>
              </div>
            ) : ai.isStreaming ? (
              <div className="flex items-center gap-2 py-2 text-white/40 text-[12px]">
                <svg className="h-3.5 w-3.5 animate-spin text-green-400" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Generating answer…
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* Show answer panel trigger when AI is streaming (if not already shown) */}
      {!showAnswer && (streaming || ai.isStreaming) && (
        <div
          className="flex items-center gap-2 px-3 h-9"
          style={{ background: BG, backdropFilter: 'blur(24px)', borderTop: BORDER, borderRadius: '0 0 12px 12px' }}
        >
          <svg className="h-3.5 w-3.5 animate-spin text-green-400 flex-shrink-0" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-[12px] text-white/50">Generating answer…</span>
          <button onClick={() => setShowAnswer(true)}
            className="ml-auto text-[11px] text-green-400 hover:underline">Show</button>
        </div>
      )}
    </div>
  )
}

// ─── AnswerText — renders markdown-lite: code blocks, bold, etc. ───────────────
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
            <div key={i} className="mt-1.5 rounded-lg border border-white/8 overflow-hidden"
                 style={{ background: 'rgba(255,255,255,0.04)' }}>
              {lang && <div className="px-3 py-0.5 text-[9px] text-white/30 font-mono border-b border-white/6">{lang}</div>}
              <pre className="px-3 py-2 text-[11px] font-mono text-green-200/80 overflow-x-auto whitespace-pre leading-relaxed">{code}</pre>
            </div>
          )
        }
        return <p key={i} className="text-[12px] text-white/85 leading-relaxed whitespace-pre-wrap">{part}</p>
      })}
    </>
  )
}
