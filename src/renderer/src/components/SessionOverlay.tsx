/**
 * SessionOverlay — the live interview assistant UI.
 *
 * Layout (top position):
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │  TopBar: [audio] Answer Screenshot Chat [timer] [+/-] [⋮] [⊕] │
 *   ├─────────────────────────────────────────────────────────────┤
 *   │  Transcript row (horizontal scroll)            [Clear]       │
 *   │  ← [Q: question text]                               →       │
 *   │  ⭐ Answer: ...                                              │
 *   ├─────────────────────────────────────────────────────────────┤
 *   │  [Enter message…]                             [Send ⌘↵]    │
 *   │  [📷] [📷]   Listening…                       [Clear]       │
 *   └─────────────────────────────────────────────────────────────┘
 */
import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react'
import { cn } from '@/lib/utils'
import {
  SESSION_PING_MS, TRANSCRIPT_SAVE_MS, SILENCE_TRIGGER_MS,
} from '@/config'
import {
  getSpeechmaticsJwt, updateSessionStatus, saveTranscriptions, pingSession,
} from '@/lib/api'
import { useSpeechmatics } from '@/hooks/useSpeechmatics'
import { useSystemAudio }  from '@/hooks/useSystemAudio'
import { useAIStream }     from '@/hooks/useAIStream'
import type { CallSession, TranscriptEntry, AudioSource, SmConnectionState } from '@/types'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2) }
function fmt(s: number) {
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

interface QAPair {
  id: string
  question: string
  answer: string
  timestamp: Date
}

type Position = 'top' | 'left' | 'bottom' | 'right'

// Heights for the Electron window resize
const TOOLBAR_H   = 48
const MODAL_H     = 340
const PANEL_H     = 360 // Q&A panel without chat
const CHAT_H      = 180 // chat area extra height
const TRANSCRIPT_H = 40 // transcript row height

// ─── ActivationModal ──────────────────────────────────────────────────────────
interface ActivationProps {
  session: CallSession
  onActivate: () => void
  onBack: () => void
  error: string | null
  activating: boolean
}

function ActivationModal({ session, onActivate, onBack, error, activating }: ActivationProps) {
  const isFree = session.mode === 'FREE'

  return (
    <div className="rounded-2xl overflow-hidden shadow-2xl border border-white/10" style={{ background: 'rgba(15,18,28,0.97)' }}>
      {/* Header bar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-black/40 border-b border-white/8"
           style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        {/* Logo */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <div className="h-6 w-6 rounded-lg bg-green-500 flex items-center justify-center">
            <span className="text-white font-black text-[10px]">P</span>
          </div>
          <span className="text-white text-xs font-semibold">Parakeet<span className="text-green-400">AI</span></span>
        </div>

        {/* Credits badge */}
        <div className={cn(
          'flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ml-1',
          isFree ? 'bg-gray-700/60 text-gray-300 border-gray-600/50' : 'bg-green-500/20 text-green-400 border-green-500/30',
        )}>
          <span className={cn('h-1.5 w-1.5 rounded-full', isFree ? 'bg-gray-400' : 'bg-green-400')} />
          {isFree ? 'No Credits' : 'Credits Available'}
        </div>

        <div className="flex-1" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />

        {/* Controls */}
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

      {/* Modal body */}
      <div className="px-5 py-5">
        <h2 className="text-white font-bold text-base mb-4">Activate Call Session</h2>

        <div className="space-y-3 mb-5">
          {isFree && (
            <div className="flex items-start gap-2.5 text-[13px]">
              <span className="text-base leading-none mt-0.5">⏰</span>
              <div>
                <span className="text-white/90 font-medium">This is a 10 minute free session.</span>
                <p className="text-white/45 text-[12px] mt-0.5">
                  You won't be able to create another free session for the next 15 minutes.
                </p>
              </div>
            </div>
          )}

          <div className="flex items-start gap-2.5 text-[13px]">
            <span className="text-base leading-none mt-0.5">✅</span>
            <p className="text-white/70">
              Instead of a call tab, you can also share a{' '}
              <span className="font-semibold text-white">mock call</span> on YouTube and test
              ParakeetAI that way. Example video:{' '}
              <button
                onClick={() => window.electronAPI.shell.openExternal('https://youtu.be/mock-call')}
                className="text-green-400 hover:underline"
              >
                Mock Call
              </button>
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[12px]">
            {error}
          </div>
        )}

        {/* Session info */}
        <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg bg-white/5 border border-white/8">
          <div className="h-8 w-8 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
            <span className="text-green-400 text-[11px] font-bold">
              {session.companyName?.[0]?.toUpperCase() ?? 'P'}
            </span>
          </div>
          <div className="min-w-0">
            <p className="text-white text-[13px] font-medium truncate">{session.companyName ?? 'Interview Session'}</p>
            <p className="text-white/40 text-[11px]">{session.jobTitle ?? 'Position'}</p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2.5">
          <button
            onClick={onBack}
            className="flex-1 py-2 rounded-xl border border-white/15 text-white/60 hover:text-white hover:border-white/30 text-[13px] font-medium transition-colors"
          >
            Back
          </button>
          <button
            onClick={onActivate}
            disabled={activating}
            className="flex-1 py-2 rounded-xl bg-gray-900 hover:bg-gray-800 border border-white/20 text-white text-[13px] font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {activating ? (
              <>
                <svg className="h-3.5 w-3.5 animate-spin text-green-400" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Activating…
              </>
            ) : (
              <>Activate {isFree ? '(Free)' : ''}</>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── AudioBars — animated level indicator ─────────────────────────────────────
function AudioBars({ active, color = 'green' }: { active: boolean; color?: 'green' | 'red' }) {
  return (
    <div className="flex items-end gap-[2px] h-4">
      {[3, 5, 4, 6, 3].map((h, i) => (
        <div
          key={i}
          className={cn(
            'w-[3px] rounded-full transition-all',
            active
              ? color === 'red' ? 'bg-red-500' : 'bg-green-400'
              : 'bg-white/20',
          )}
          style={{
            height: active ? `${h + Math.random() * 4}px` : '3px',
            animation: active ? `pulse ${0.3 + i * 0.1}s ease-in-out infinite alternate` : 'none',
          }}
        />
      ))}
    </div>
  )
}

// ─── KbdShortcut ──────────────────────────────────────────────────────────────
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[9px] text-white/30 font-mono bg-white/8 px-1 py-0.5 rounded">
      {children}
    </span>
  )
}

// ─── SettingsMenu ─────────────────────────────────────────────────────────────
interface SettingsMenuProps {
  userEmail?: string
  zoom: number
  opacity: number
  onZoom: (d: number) => void
  onOpacity: (d: number) => void
  autoGenerate: boolean
  onAutoGenerate: (v: boolean) => void
  onEndSession: () => void
  onClose: () => void
}

function SettingsMenu({
  userEmail, zoom, opacity, onZoom, onOpacity, autoGenerate, onAutoGenerate, onEndSession, onClose,
}: SettingsMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    setTimeout(() => document.addEventListener('mousedown', handler), 0)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return (
    <div ref={ref}
      className="absolute right-0 top-full mt-1 w-52 rounded-xl bg-gray-900/98 border border-white/12 shadow-2xl z-50 py-1 text-[12px]"
      style={{ backdropFilter: 'blur(16px)' }}>

      {userEmail && (
        <div className="px-3 py-2 text-white/40 truncate border-b border-white/8 mb-1">{userEmail}</div>
      )}

      <MenuRow label="Dashboard" onClick={() => { window.electronAPI.shell.openExternal('http://localhost:4000/dashboard'); onClose() }}>
        <svg className="h-3 w-3 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
      </MenuRow>

      <div className="border-t border-white/8 my-1" />

      {/* Zoom */}
      <div className="flex items-center gap-2 px-3 py-1.5">
        <span className="text-white/60 flex-1">Zoom</span>
        <button onClick={() => onZoom(-0.1)} className="h-5 w-5 rounded bg-white/8 hover:bg-white/15 text-white/60 flex items-center justify-center">−</button>
        <span className="text-white/40 w-8 text-center">{Math.round(zoom * 100)}%</span>
        <button onClick={() => onZoom(+0.1)} className="h-5 w-5 rounded bg-white/8 hover:bg-white/15 text-white/60 flex items-center justify-center">+</button>
        <button onClick={() => onZoom(1 - zoom)} className="h-5 w-5 rounded bg-white/8 hover:bg-white/15 text-white/40 flex items-center justify-center text-[9px]">↺</button>
      </div>

      {/* Opacity */}
      <div className="flex items-center gap-2 px-3 py-1.5">
        <span className="text-white/60 flex-1">Opacity</span>
        <button onClick={() => onOpacity(-0.1)} className="h-5 w-5 rounded bg-white/8 hover:bg-white/15 text-white/60 flex items-center justify-center">−</button>
        <span className="text-white/40 w-8 text-center">{Math.round(opacity * 100)}%</span>
        <button onClick={() => onOpacity(+0.1)} className="h-5 w-5 rounded bg-white/8 hover:bg-white/15 text-white/60 flex items-center justify-center">+</button>
        <button onClick={() => onOpacity(1 - opacity)} className="h-5 w-5 rounded bg-white/8 hover:bg-white/15 text-white/40 flex items-center justify-center text-[9px]">↺</button>
      </div>

      {/* Auto generate */}
      <div className="flex items-center gap-2 px-3 py-1.5">
        <span className="text-white/60 flex-1">Auto Generate</span>
        <button
          onClick={() => onAutoGenerate(!autoGenerate)}
          className={cn(
            'relative h-4 w-7 rounded-full transition-colors',
            autoGenerate ? 'bg-green-500' : 'bg-white/20',
          )}
        >
          <span className={cn(
            'absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform',
            autoGenerate ? 'translate-x-3.5' : 'translate-x-0.5',
          )} />
        </button>
      </div>

      <div className="border-t border-white/8 my-1" />

      <MenuRow label="Hide" onClick={() => { window.electronAPI.window.hide(); onClose() }} />
      <MenuRow label="End Session" onClick={() => { onEndSession(); onClose() }}
        className="text-red-400 hover:bg-red-500/10" />
    </div>
  )
}

function MenuRow({
  label, onClick, children, className,
}: {
  label: string
  onClick: () => void
  children?: React.ReactNode
  className?: string
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center justify-between px-3 py-1.5 text-white/70 hover:text-white hover:bg-white/8 transition-colors',
        className,
      )}
    >
      <span>{label}</span>
      {children}
    </button>
  )
}

// ─── MoveMenu ─────────────────────────────────────────────────────────────────
function MoveMenu({ onMove, onClose }: { onMove: (pos: Position) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    setTimeout(() => document.addEventListener('mousedown', handler), 0)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const positions: Array<{ pos: Position; label: string; icon: string }> = [
    { pos: 'top',    label: 'Top',    icon: '⬆' },
    { pos: 'left',   label: 'Left',   icon: '⬅' },
    { pos: 'bottom', label: 'Bottom', icon: '⬇' },
    { pos: 'right',  label: 'Right',  icon: '➡' },
  ]

  return (
    <div ref={ref}
      className="absolute right-0 top-full mt-1 w-36 rounded-xl bg-gray-900/98 border border-white/12 shadow-2xl z-50 py-1 text-[12px]"
      style={{ backdropFilter: 'blur(16px)' }}>
      <div className="px-3 py-1.5 text-white/30 text-[10px] uppercase tracking-wider">Move to</div>
      {positions.map(({ pos, label, icon }) => (
        <button key={pos}
          onClick={() => { onMove(pos); onClose() }}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-white/70 hover:text-white hover:bg-white/8 transition-colors">
          <span>{icon}</span>
          <span>{label}</span>
        </button>
      ))}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────
interface Props {
  session: CallSession
  onEnd: () => void
}

export function SessionOverlay({ session, onEnd }: Props) {
  // ── Activation state ──────────────────────────────────────────────────────
  const [isActivated,  setIsActivated]  = useState(false)
  const [activating,   setActivating]   = useState(false)
  const [activateErr,  setActivateErr]  = useState<string | null>(null)

  // ── Session state ──────────────────────────────────────────────────────────
  const [isRunning,    setIsRunning]    = useState(false)
  const [elapsed,      setElapsed]      = useState(0)
  const [audioSrc,     setAudioSrc]     = useState<AudioSource>('system')
  const [smState,      setSmState]      = useState<SmConnectionState>('idle')
  const [transcript,   setTranscript]   = useState<TranscriptEntry[]>([])
  const [partial,      setPartial]      = useState('')
  const [qaPairs,      setQaPairs]      = useState<QAPair[]>([])
  const [currentQA,    setCurrentQA]    = useState(-1)   // index into qaPairs
  const [streaming,    setStreaming]     = useState('')
  const [manualQ,      setManualQ]      = useState('')
  const [error,        setError]        = useState<string | null>(null)

  // ── UI state ───────────────────────────────────────────────────────────────
  const [showPanel,    setShowPanel]    = useState(true)   // content panel visible
  const [showChat,     setShowChat]     = useState(true)   // chat area visible
  const [showSettings, setShowSettings] = useState(false)
  const [showMove,     setShowMove]     = useState(false)
  const [zoom,         setZoom]         = useState(1)
  const [opacity,      setOpacity]      = useState(1)
  const [autoGenerate, setAutoGenerate] = useState(session.autoGenerate ?? true)
  const [screenshots,  setScreenshots]  = useState<string[]>([])  // base64 thumbnails
  const [screenshotCount, setScreenshotCount] = useState(0)

  // ── Refs ───────────────────────────────────────────────────────────────────
  const sessionRef      = useRef(session)
  sessionRef.current    = session
  const isRunningRef    = useRef(false)
  const saveQueueRef    = useRef<string[]>([])
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const questionBufRef  = useRef<string[]>([])
  const pingRef         = useRef<ReturnType<typeof setInterval> | null>(null)
  const timerRef        = useRef<ReturnType<typeof setInterval> | null>(null)
  const transcriptRowRef = useRef<HTMLDivElement>(null)
  const inputRef        = useRef<HTMLInputElement>(null)

  // ── Speechmatics ──────────────────────────────────────────────────────────
  const sm = useSpeechmatics({
    language: session.language ?? 'en',
    onPartial: setPartial,
    onFinal: useCallback((text: string) => {
      if (!isRunningRef.current) return
      setPartial('')
      setTranscript((p) => [...p, { id: uid(), text, isFinal: true, timestamp: Date.now() }])
      saveQueueRef.current.push(text)
      questionBufRef.current.push(text)

      if (autoGenerate) {
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
        silenceTimerRef.current = setTimeout(() => {
          const q = questionBufRef.current.join(' ').trim()
          questionBufRef.current = []
          if (q) askAI(q)
        }, SILENCE_TRIGGER_MS)
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoGenerate]),
    onStateChange: setSmState,
  })

  // ── System audio ──────────────────────────────────────────────────────────
  const audio = useSystemAudio({
    onPCMChunk: sm.sendAudio,
    onError: (msg) => setError(msg),
  })

  // ── Current QA pair for display ────────────────────────────────────────────
  const currentPair = currentQA >= 0 && currentQA < qaPairs.length ? qaPairs[currentQA] : null

  // ── AI stream ─────────────────────────────────────────────────────────────
  // We keep the current question in a ref so the onDone callback can access it
  const pendingQuestionRef = useRef('')
  const ai = useAIStream({
    callSessionId: session.id,
    onChunk: useCallback((chunk: string) => {
      setStreaming((p) => p + chunk)
    }, []),
    onDone: useCallback((full: string) => {
      if (!full.trim()) return
      setStreaming('')
      const pair: QAPair = {
        id: uid(),
        question: pendingQuestionRef.current,
        answer: full,
        timestamp: new Date(),
      }
      setQaPairs((p) => {
        const next = [...p, pair]
        setCurrentQA(next.length - 1)
        return next
      })
    }, []),
    onError: useCallback((msg: string) => {
      setStreaming('')
      setError(msg.includes('credits') ? 'Out of credits. Buy more to continue.' : `AI error: ${msg}`)
    }, []),
  })

  const askAI = useCallback((q: string) => {
    pendingQuestionRef.current = q
    ai.ask(q)
  }, [ai])

  // ── Activation ────────────────────────────────────────────────────────────
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
      // Expand window to toolbar + panel
      const totalH = TOOLBAR_H + TRANSCRIPT_H + PANEL_H + (showChat ? CHAT_H : 0)
      window.electronAPI.window.setHeight(totalH)
    } catch (err) {
      setActivateErr(`Activation failed: ${(err as Error).message}`)
    } finally {
      setActivating(false)
    }
  }, [session.id, audioSrc, sm, audio, showChat])

  // ── End session ───────────────────────────────────────────────────────────
  const endSession = useCallback(async () => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
    if (pingRef.current)         clearInterval(pingRef.current)
    if (timerRef.current)        clearInterval(timerRef.current)
    sm.disconnect()
    audio.stop()
    ai.abort()
    isRunningRef.current = false
    setIsRunning(false)

    const remaining = saveQueueRef.current.splice(0)
    if (remaining.length > 0) {
      await saveTranscriptions(session.id, remaining.map((t) => ({ speaker: 'SYSTEM', text: t }))).catch(() => {})
    }
    await updateSessionStatus(session.id, 'ENDED').catch(() => {})
    onEnd()
  }, [session.id, sm, audio, ai, onEnd])

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const u1 = window.electronAPI.on('shortcut:answer', () => {
      const q = questionBufRef.current.join(' ').trim()
      questionBufRef.current = []
      if (q) askAI(q)
    })
    const u2 = window.electronAPI.on('shortcut:screenshot', () => void captureScreenshot())
    const u3 = window.electronAPI.on('shortcut:clear', () => {
      setQaPairs([])
      setTranscript([])
      setStreaming('')
      setCurrentQA(-1)
    })
    return () => { u1(); u2(); u3() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askAI])

  // ── Batch save transcript ─────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(async () => {
      const pending = saveQueueRef.current.splice(0)
      if (!pending.length || !isRunningRef.current) return
      await saveTranscriptions(
        session.id,
        pending.map((t) => ({ speaker: 'SYSTEM', text: t })),
      ).catch(() => { saveQueueRef.current.unshift(...pending) })
    }, TRANSCRIPT_SAVE_MS)
    return () => clearInterval(id)
  }, [session.id])

  // ── Auto-scroll transcript row ────────────────────────────────────────────
  useEffect(() => {
    if (transcriptRowRef.current) {
      transcriptRowRef.current.scrollLeft = transcriptRowRef.current.scrollWidth
    }
  }, [transcript, partial])

  // ── Cleanup ───────────────────────────────────────────────────────────────
  useEffect(() => () => {
    sm.disconnect(); audio.stop(); ai.abort()
    if (pingRef.current)  clearInterval(pingRef.current)
    if (timerRef.current) clearInterval(timerRef.current)
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Window resize when panel/chat toggled ─────────────────────────────────
  useEffect(() => {
    if (!isActivated) return
    let h = TOOLBAR_H
    if (showPanel) h += TRANSCRIPT_H + PANEL_H
    if (showPanel && showChat) h += CHAT_H
    window.electronAPI.window.setHeight(h)
  }, [isActivated, showPanel, showChat])

  // ── Zoom / opacity ────────────────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.style.fontSize = `${zoom * 16}px`
  }, [zoom])
  useEffect(() => {
    window.electronAPI.window.setOpacity(opacity)
  }, [opacity])

  // ── Screenshot ────────────────────────────────────────────────────────────
  const captureScreenshot = useCallback(async () => {
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
      const dataUrl = canvas.toDataURL('image/jpeg', 0.7)

      setScreenshots((p) => [...p, dataUrl])
      setScreenshotCount((c) => c + 1)
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setError('Screenshot failed — check screen recording permission.')
    }
  }, [])

  // ── Send with screenshots ─────────────────────────────────────────────────
  const handleSend = useCallback(() => {
    const q = manualQ.trim()
    if (!isRunning) return
    const hasQuestion = q.length > 0
    const hasShots    = screenshots.length > 0
    if (!hasQuestion && !hasShots) return

    let prompt = q
    if (hasShots) {
      prompt += `\n[${screenshots.length} screenshot(s) attached - analyze the visual content shown]`
    }

    setManualQ('')
    setScreenshots([])
    askAI(prompt || 'Please analyze the screenshots and provide relevant interview assistance.')
  }, [manualQ, isRunning, screenshots, askAI])

  // ── Move overlay ──────────────────────────────────────────────────────────
  const handleMove = useCallback((pos: Position) => {
    window.electronAPI.window.moveTo(pos as Parameters<typeof window.electronAPI.window.moveTo>[0])
  }, [])

  // ── Zoom/opacity helpers ──────────────────────────────────────────────────
  const handleZoom = useCallback((delta: number) => {
    setZoom((z) => Math.max(0.7, Math.min(1.5, parseFloat((z + delta).toFixed(1)))))
  }, [])
  const handleOpacity = useCallback((delta: number) => {
    setOpacity((o) => Math.max(0.3, Math.min(1, parseFloat((o + delta).toFixed(1)))))
  }, [])

  // ── Transcript text for display ───────────────────────────────────────────
  const transcriptText = useMemo(() =>
    [...transcript.map((t) => t.text), partial ? partial : ''].filter(Boolean).join(' '),
  [transcript, partial])

  // ────────────────────────────────────────────────────────────────────────────
  // ── Before activation: show activation modal ───────────────────────────────
  // ────────────────────────────────────────────────────────────────────────────
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

  // ────────────────────────────────────────────────────────────────────────────
  // ── Active overlay ────────────────────────────────────────────────────────
  // ────────────────────────────────────────────────────────────────────────────
  const isMicActive    = isRunning && (audioSrc === 'mic' || audioSrc === 'both')
  const isSysActive    = isRunning && (audioSrc === 'system' || audioSrc === 'both')
  const smOk           = smState === 'connected'
  const chatCount      = screenshots.length
  const answerCount    = qaPairs.length

  return (
    <div className="flex flex-col overflow-hidden rounded-b-xl" style={{ background: 'rgba(0,0,0,0)' }}>

      {/* ══════════════ TOP BAR ══════════════ */}
      <div
        className="flex items-center gap-1.5 px-2 h-12 flex-shrink-0 rounded-t-xl select-none relative"
        style={{
          background: 'rgba(10,10,15,0.92)',
          backdropFilter: 'blur(20px)',
          WebkitAppRegion: 'drag',
          borderBottom: showPanel ? '1px solid rgba(255,255,255,0.06)' : 'none',
        } as React.CSSProperties}
      >
        {/* Audio indicators */}
        <div className="flex items-center gap-1 flex-shrink-0" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {/* Mic indicator */}
          <div className={cn('flex items-center gap-0.5 p-1 rounded', isMicActive && 'bg-red-500/10')}>
            <svg className={cn('h-3 w-3', isMicActive ? 'text-red-400' : 'text-white/25')} fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
            </svg>
            <AudioBars active={isMicActive} color="red" />
          </div>
          {/* System audio indicator */}
          <div className={cn('flex items-center gap-0.5 p-1 rounded', isSysActive && 'bg-red-500/10')}>
            <svg className={cn('h-3 w-3', isSysActive ? 'text-red-400' : 'text-white/25')} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <AudioBars active={isSysActive} color="red" />
          </div>
        </div>

        <div className="w-px h-5 bg-white/10 mx-0.5 flex-shrink-0" />

        {/* Answer button */}
        <button
          onClick={() => {
            const q = questionBufRef.current.join(' ').trim()
            questionBufRef.current = []
            if (q) askAI(q)
          }}
          disabled={!isRunning || ai.isStreaming}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-green-500 hover:bg-green-400 text-white text-[11px] font-semibold disabled:opacity-40 transition-colors flex-shrink-0"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
            <path d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" />
          </svg>
          Answer <Kbd>⌘↑</Kbd>
        </button>

        {/* Screenshot button */}
        <button
          onClick={() => void captureScreenshot()}
          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white/8 hover:bg-white/15 text-white/70 text-[11px] font-medium transition-colors flex-shrink-0 relative"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Screenshot <Kbd>⌘⇧↓</Kbd>
          {screenshotCount > 0 && (
            <span className="absolute -top-1 -right-1 h-3.5 min-w-[14px] px-0.5 rounded-full bg-green-500 text-white text-[8px] font-bold flex items-center justify-center">
              {screenshotCount}
            </span>
          )}
        </button>

        {/* Chat button */}
        <button
          onClick={() => setShowChat((v) => !v)}
          className={cn(
            'flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-colors flex-shrink-0 relative',
            showChat ? 'bg-white/15 text-white' : 'bg-white/8 hover:bg-white/15 text-white/70',
          )}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
          Chat <Kbd>⌘⇧</Kbd>
          {chatCount > 0 && (
            <span className="absolute -top-1 -right-1 h-3.5 min-w-[14px] px-0.5 rounded-full bg-blue-500 text-white text-[8px] font-bold flex items-center justify-center">
              {chatCount}
            </span>
          )}
        </button>

        <div className="w-px h-5 bg-white/10 mx-0.5 flex-shrink-0" />

        {/* Timer */}
        <span className="text-[13px] font-mono text-white/70 flex-shrink-0 tabular-nums"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {fmt(elapsed)}
        </span>

        {/* Zoom +/- */}
        <div className="flex items-center gap-0.5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button onClick={() => handleZoom(+0.1)}
            className="h-6 w-6 rounded flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 text-[14px] transition-colors">+</button>
          <button onClick={() => handleZoom(-0.1)}
            className="h-6 w-6 rounded flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 text-[14px] transition-colors">−</button>
        </div>

        {/* Expand/collapse content panel */}
        <button
          onClick={() => setShowPanel((v) => !v)}
          className="h-6 w-6 rounded flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition-colors flex-shrink-0"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          title={showPanel ? 'Collapse panel' : 'Expand panel'}
        >
          <svg className={cn('h-3.5 w-3.5 transition-transform', showPanel ? 'rotate-180' : '')} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        <div className="flex-1" />

        {/* SM connection status dot */}
        <div className={cn(
          'h-1.5 w-1.5 rounded-full flex-shrink-0',
          smOk ? 'bg-green-400' : smState === 'connecting' ? 'bg-yellow-400 animate-pulse' : 'bg-gray-600',
        )} title={smState} style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties} />

        {/* Settings ⋮ */}
        <div className="relative flex-shrink-0" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            onClick={() => { setShowSettings((v) => !v); setShowMove(false) }}
            className="h-7 w-7 rounded-lg flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition-colors"
          >
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
              <path d="M6 10a2 2 0 11-4 0 2 2 0 014 0zM12 10a2 2 0 11-4 0 2 2 0 014 0zM16 12a2 2 0 100-4 2 2 0 000 4z" />
            </svg>
          </button>
          {showSettings && (
            <SettingsMenu
              zoom={zoom}
              opacity={opacity}
              onZoom={handleZoom}
              onOpacity={handleOpacity}
              autoGenerate={autoGenerate}
              onAutoGenerate={setAutoGenerate}
              onEndSession={endSession}
              onClose={() => setShowSettings(false)}
            />
          )}
        </div>

        {/* Move ⊕ */}
        <div className="relative flex-shrink-0" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            onClick={() => { setShowMove((v) => !v); setShowSettings(false) }}
            className="h-7 w-7 rounded-lg flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition-colors"
            title="Move overlay"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
            </svg>
          </button>
          {showMove && (
            <MoveMenu onMove={handleMove} onClose={() => setShowMove(false)} />
          )}
        </div>
      </div>

      {/* ══════════════ CONTENT PANEL ══════════════ */}
      {showPanel && (
        <div
          className="flex flex-col overflow-hidden rounded-b-xl"
          style={{
            background: 'rgba(10,12,20,0.93)',
            backdropFilter: 'blur(20px)',
          }}
        >
          {/* Transcript row */}
          <div className="flex items-center gap-2 px-3 flex-shrink-0 border-b border-white/5"
               style={{ height: TRANSCRIPT_H }}>
            <div
              ref={transcriptRowRef}
              className="flex-1 overflow-x-auto whitespace-nowrap text-[11px] text-white/50 scrollbar-none"
              style={{ scrollbarWidth: 'none' }}
            >
              {transcriptText || (
                <span className="italic text-white/20">
                  {isRunning ? 'Listening…' : 'Start speaking to see transcript'}
                </span>
              )}
            </div>
            {transcript.length > 0 && (
              <button
                onClick={() => { setTranscript([]); setPartial(''); questionBufRef.current = [] }}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-white/30 hover:text-white/70 hover:bg-white/8 transition-colors flex-shrink-0"
              >
                Clear <span className="text-[9px] opacity-50">⌘⊗</span>
                <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* Q&A display */}
          <div className="flex-1 px-3 py-3 overflow-y-auto" style={{ minHeight: PANEL_H }}>
            {/* Navigation + clear */}
            <div className="flex items-center gap-1 mb-2">
              <button
                onClick={() => setCurrentQA((i) => Math.max(0, i - 1))}
                disabled={currentQA <= 0}
                className="h-5 w-5 rounded flex items-center justify-center text-white/30 hover:text-white disabled:opacity-20 transition-colors"
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <button
                onClick={() => setCurrentQA((i) => Math.min(qaPairs.length - 1, i + 1))}
                disabled={currentQA >= qaPairs.length - 1}
                className="h-5 w-5 rounded flex items-center justify-center text-white/30 hover:text-white disabled:opacity-20 transition-colors"
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
              {answerCount > 0 && (
                <span className="text-[10px] text-white/25 ml-1">{currentQA + 1}/{answerCount}</span>
              )}
              <div className="flex-1" />
              {(qaPairs.length > 0 || streaming) && (
                <button
                  onClick={() => { setQaPairs([]); setCurrentQA(-1); setStreaming(''); ai.abort() }}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-white/30 hover:text-white/70 hover:bg-white/8 transition-colors"
                >
                  Clear <span className="text-[9px] opacity-50">⌘⊗</span>
                  <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2 mb-2 px-2.5 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
                <span className="text-red-400 text-[11px] flex-1">{error}</span>
                <button onClick={() => setError(null)} className="text-red-400/50 hover:text-red-400 text-xs">✕</button>
              </div>
            )}

            {/* Current Q&A pair */}
            {currentPair ? (
              <div className="space-y-2">
                <div className="flex items-start gap-1.5">
                  <span className="text-base leading-none mt-0.5">💬</span>
                  <div className="flex-1">
                    <span className="text-[11px] font-semibold text-white/50">Question: </span>
                    <span className="text-[12px] text-white/80">{currentPair.question}</span>
                  </div>
                  <button
                    onClick={() => askAI(currentPair.question)}
                    disabled={ai.isStreaming}
                    className="h-5 w-5 rounded flex items-center justify-center text-white/20 hover:text-white/60 transition-colors flex-shrink-0"
                    title="Re-generate answer"
                  >
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </button>
                </div>
                <div className="flex items-start gap-1.5">
                  <span className="text-base leading-none mt-0.5">⭐</span>
                  <div className="flex-1">
                    <span className="text-[11px] font-semibold text-green-400/80">Answer: </span>
                    <span className="text-[12px] text-white/85 leading-relaxed whitespace-pre-wrap">{currentPair.answer}</span>
                  </div>
                </div>
                <div className="text-[10px] text-white/25 text-right">
                  Chat · {currentPair.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            ) : streaming ? (
              <div className="space-y-2">
                <div className="flex items-start gap-1.5">
                  <span className="text-base leading-none mt-0.5">⭐</span>
                  <div className="flex-1">
                    <span className="text-[11px] font-semibold text-green-400/80">Answer: </span>
                    <span className="text-[12px] text-white/85 leading-relaxed whitespace-pre-wrap">{streaming}</span>
                    <span className="inline-block h-3 w-0.5 bg-green-400 animate-pulse ml-0.5 align-middle" />
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-32 text-white/20 gap-2">
                <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                <p className="text-[11px] text-center">
                  {isRunning ? 'Speak to auto-generate an answer, or press Answer' : 'Session active — speak to get started'}
                </p>
              </div>
            )}
          </div>

          {/* ── Chat area ────────────────────────────────────────────── */}
          {showChat && (
            <div className="flex-shrink-0 border-t border-white/8 px-3 py-2 space-y-2" style={{ minHeight: CHAT_H }}>
              {/* Screenshot thumbnails */}
              {screenshots.length > 0 && (
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                  {screenshots.map((src, i) => (
                    <div key={i} className="relative flex-shrink-0">
                      <img src={src} alt="screenshot" className="h-12 w-20 object-cover rounded-lg border border-white/10" />
                      <button
                        onClick={() => setScreenshots((p) => p.filter((_, j) => j !== i))}
                        className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-gray-800 border border-white/20 flex items-center justify-center text-white/60 hover:text-white text-[9px]"
                      >✕</button>
                    </div>
                  ))}
                  <button
                    onClick={() => void captureScreenshot()}
                    className="flex-shrink-0 h-12 w-20 rounded-lg border border-dashed border-white/20 hover:border-white/40 flex items-center justify-center text-white/30 hover:text-white/60 transition-colors"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </button>
                </div>
              )}

              {/* Input row */}
              <div className="flex items-center gap-2">
                <input
                  ref={inputRef}
                  value={manualQ}
                  onChange={(e) => setManualQ(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())}
                  placeholder="Enter a message..."
                  disabled={!isRunning}
                  className="flex-1 bg-white/6 border border-white/10 rounded-lg px-3 py-1.5 text-[12px] text-white placeholder:text-white/25 focus:outline-none focus:border-green-500/40 focus:bg-white/8 transition-colors disabled:opacity-40"
                />
                {/* Screenshot add button */}
                <button
                  onClick={() => void captureScreenshot()}
                  className="h-7 w-7 rounded-lg bg-white/8 hover:bg-white/15 text-white/50 hover:text-white flex items-center justify-center transition-colors flex-shrink-0"
                  title="Add screenshot"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </button>
                {/* Send */}
                <button
                  onClick={handleSend}
                  disabled={!isRunning || (!manualQ.trim() && screenshots.length === 0) || ai.isStreaming}
                  className="h-7 px-2.5 rounded-lg bg-white/8 hover:bg-white/15 text-white/60 hover:text-white disabled:opacity-30 flex items-center gap-1 text-[11px] transition-colors flex-shrink-0"
                  title="Send (⌘↵)"
                >
                  {ai.isStreaming ? (
                    <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : (
                    <>
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                      </svg>
                      <Kbd>⌘↵</Kbd>
                    </>
                  )}
                </button>
              </div>

              {/* Status */}
              <div className="flex items-center gap-1 text-[10px] text-white/30">
                {isRunning && smState === 'connected' && (
                  <>
                    <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
                    Listening…
                  </>
                )}
                {isRunning && smState === 'connecting' && (
                  <>
                    <span className="h-1.5 w-1.5 rounded-full bg-yellow-400 animate-pulse" />
                    Connecting…
                  </>
                )}
                <div className="flex-1" />
                <span>{session.mode === 'FREE' ? `${Math.max(0, 600 - elapsed)}s remaining` : fmt(elapsed)}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
