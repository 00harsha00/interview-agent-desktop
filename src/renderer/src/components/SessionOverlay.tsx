/**
 * SessionOverlay — the live interview assistant UI.
 * Handles: audio capture → transcription → auto/manual AI answers → display.
 */
import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react'
import { cn } from '@/lib/utils'
import { AI_MODEL_LABELS, SESSION_PING_MS, TRANSCRIPT_SAVE_MS, SILENCE_TRIGGER_MS } from '@/config'
import {
  getSpeechmaticsJwt, updateSessionStatus, saveTranscriptions, pingSession,
} from '@/lib/api'
import { useSpeechmatics } from '@/hooks/useSpeechmatics'
import { useSystemAudio }   from '@/hooks/useSystemAudio'
import { useAIStream }      from '@/hooks/useAIStream'
import {
  Mic, MicOff, Monitor, MonitorOff,
  Send, Camera, Trash2, Copy, Check,
  Zap, Square, Loader2, AlertCircle, Sparkles,
} from './Icons'
import type { CallSession, TranscriptEntry, AIMessage, AudioSource, SmConnectionState } from '@/types'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2) }
function fmt(s: number) {
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

// ─── Component ────────────────────────────────────────────────────────────────
interface Props {
  session: CallSession
  onEnd: () => void
}

export function SessionOverlay({ session, onEnd }: Props) {
  // ── State ──────────────────────────────────────────────────────────────────
  const [isActive,    setIsActive]    = useState(false)
  const [elapsed,     setElapsed]     = useState(0)
  const [audioSrc,    setAudioSrc]    = useState<AudioSource>('system')
  const [smState,     setSmState]     = useState<SmConnectionState>('idle')
  const [transcript,  setTranscript]  = useState<TranscriptEntry[]>([])
  const [partial,     setPartial]     = useState('')
  const [messages,    setMessages]    = useState<AIMessage[]>([])
  const [streaming,   setStreaming]   = useState('')     // current streaming text
  const [manualQ,     setManualQ]     = useState('')
  const [copied,      setCopied]      = useState<string | null>(null)
  const [error,       setError]       = useState<string | null>(null)

  // ── Refs (never trigger re-renders) ───────────────────────────────────────
  const sessionRef      = useRef(session)
  sessionRef.current    = session
  const isActiveRef     = useRef(false)
  const saveQueueRef    = useRef<string[]>([])
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const questionBufRef  = useRef<string[]>([])
  const pingRef         = useRef<ReturnType<typeof setInterval> | null>(null)
  const timerRef        = useRef<ReturnType<typeof setInterval> | null>(null)
  const transcriptEndRef = useRef<HTMLDivElement>(null)
  const messagesEndRef   = useRef<HTMLDivElement>(null)
  const inputRef         = useRef<HTMLInputElement>(null)

  // ── Speechmatics ──────────────────────────────────────────────────────────
  const sm = useSpeechmatics({
    language: session.language ?? 'en',
    onPartial: setPartial,
    onFinal: useCallback((text: string) => {
      if (!isActiveRef.current) return
      setPartial('')
      const entry: TranscriptEntry = { id: uid(), text, isFinal: true, timestamp: Date.now() }
      setTranscript((p) => [...p, entry])
      saveQueueRef.current.push(text)
      questionBufRef.current.push(text)

      // Reset silence timer — auto-answer after SILENCE_TRIGGER_MS of quiet
      if (sessionRef.current.autoGenerate) {
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
        silenceTimerRef.current = setTimeout(() => {
          const q = questionBufRef.current.join(' ').trim()
          questionBufRef.current = []
          if (q) ai.ask(q)
        }, SILENCE_TRIGGER_MS)
      }
    }, []),  // eslint-disable-line react-hooks/exhaustive-deps
    onStateChange: setSmState,
  })

  // ── System audio ──────────────────────────────────────────────────────────
  const audio = useSystemAudio({
    onPCMChunk: sm.sendAudio,
    onError: (msg) => setError(msg),
  })

  // ── AI streaming ──────────────────────────────────────────────────────────
  const ai = useAIStream({
    callSessionId: session.id,
    onChunk: useCallback((chunk: string) => {
      setStreaming((p) => p + chunk)
    }, []),
    onDone: useCallback((full: string) => {
      if (!full.trim()) return
      setStreaming('')
      setMessages((p) => [
        ...p,
        { id: uid(), role: 'ASSISTANT', content: full },
      ])
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
    }, []),
    onError: useCallback((msg: string) => {
      setStreaming('')
      setError(msg.includes('credits') ? 'Out of credits. Buy more at localhost:4000.' : `AI error: ${msg}`)
    }, []),
  })

  // ── Start session ─────────────────────────────────────────────────────────
  const startSession = useCallback(async () => {
    setError(null)
    try {
      await updateSessionStatus(session.id, 'ACTIVE')
      const jwt = await getSpeechmaticsJwt(session.id)
      sm.connect(jwt)
      await audio.start(audioSrc)
      setIsActive(true)
      isActiveRef.current = true

      // Timer
      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1_000)

      // Ping keep-alive
      pingRef.current = setInterval(() => pingSession(session.id), SESSION_PING_MS)
    } catch (err) {
      setError(`Start failed: ${(err as Error).message}`)
    }
  }, [session.id, audioSrc, sm, audio])

  // ── End session ───────────────────────────────────────────────────────────
  const endSession = useCallback(async () => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
    if (pingRef.current)         clearInterval(pingRef.current)
    if (timerRef.current)        clearInterval(timerRef.current)
    sm.disconnect()
    audio.stop()
    ai.abort()
    isActiveRef.current = false
    setIsActive(false)

    // Flush transcript save queue
    const remaining = saveQueueRef.current.splice(0)
    if (remaining.length > 0) {
      await saveTranscriptions(session.id, remaining.map((t) => ({ speaker: 'SYSTEM', text: t }))).catch(() => {})
    }
    await updateSessionStatus(session.id, 'ENDED').catch(() => {})
    onEnd()
  }, [session.id, sm, audio, ai, onEnd])

  // ── Keyboard shortcuts from main process ─────────────────────────────────
  useEffect(() => {
    const u1 = window.electronAPI.on('shortcut:answer', () => {
      const q = questionBufRef.current.join(' ').trim()
      questionBufRef.current = []
      if (q) ai.ask(q)
      else if (transcript.length > 0) ai.ask(transcript[transcript.length - 1].text)
    })
    const u2 = window.electronAPI.on('shortcut:screenshot', () => takeScreenshot())
    const u3 = window.electronAPI.on('shortcut:clear', () => {
      setMessages([])
      setTranscript([])
      setStreaming('')
    })
    return () => { u1(); u2(); u3() }
  }, [ai, transcript])

  // ── Batch save transcript every 5s ───────────────────────────────────────
  useEffect(() => {
    const id = setInterval(async () => {
      const pending = saveQueueRef.current.splice(0)
      if (!pending.length || !isActiveRef.current) return
      await saveTranscriptions(
        session.id,
        pending.map((t) => ({ speaker: 'SYSTEM', text: t })),
      ).catch(() => { saveQueueRef.current.unshift(...pending) })
    }, TRANSCRIPT_SAVE_MS)
    return () => clearInterval(id)
  }, [session.id])

  // ── Auto-scroll transcript ────────────────────────────────────────────────
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [transcript, partial])

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => () => {
    sm.disconnect(); audio.stop(); ai.abort()
    if (pingRef.current)  clearInterval(pingRef.current)
    if (timerRef.current) clearInterval(timerRef.current)
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Screenshot ────────────────────────────────────────────────────────────
  const takeScreenshot = useCallback(async () => {
    if (!isActive) return
    try {
      const stream   = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      const track    = stream.getVideoTracks()[0]
      const cap      = new ImageCapture(track)
      const bitmap   = await cap.grabFrame()
      track.stop()

      const canvas   = document.createElement('canvas')
      canvas.width   = bitmap.width
      canvas.height  = bitmap.height
      const ctx2d    = canvas.getContext('2d')!
      ctx2d.drawImage(bitmap, 0, 0)
      const dataUrl  = canvas.toDataURL('image/png')

      // Ask AI with screenshot context
      ai.ask(`[Screenshot taken at ${new Date().toLocaleTimeString()}] Analyze the content shown on screen and provide relevant interview assistance.`)

      // Optionally store dataUrl if we want to show a preview
      void dataUrl
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setError('Screenshot failed — check screen recording permission.')
    }
  }, [isActive, ai])

  // ── Manual ask ────────────────────────────────────────────────────────────
  const handleManualAsk = useCallback(() => {
    const q = manualQ.trim()
    if (!q || !isActive) return
    setMessages((p) => [...p, { id: uid(), role: 'USER', content: q }])
    setManualQ('')
    ai.ask(q)
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
  }, [manualQ, isActive, ai])

  // ── Derived ───────────────────────────────────────────────────────────────
  const smDot = useMemo(() => ({
    idle:         'bg-gray-600',
    connecting:   'bg-yellow-400 animate-pulse',
    connected:    'bg-green-400 animate-pulse',
    error:        'bg-red-500',
    disconnected: 'bg-gray-600',
  }[smState]), [smState])

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Session header ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-2 bg-gray-900 border-b border-white/8 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-7 w-7 rounded-lg bg-green-500 flex items-center justify-center flex-shrink-0">
            <span className="text-white font-bold text-[10px]">P</span>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-white truncate leading-tight">{session.companyName}</p>
            <p className="text-[10px] text-white/40 leading-tight">{AI_MODEL_LABELS[session.aiModel] ?? session.aiModel}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {isActive && (
            <span className="text-[11px] font-mono text-white/60">{fmt(elapsed)}</span>
          )}
          <div className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${smDot}`} title={smState} />
          {!isActive ? (
            <button
              onClick={startSession}
              className="flex items-center gap-1 px-2.5 py-1 bg-green-500 hover:bg-green-400 rounded-lg text-[11px] font-bold text-white transition-colors"
            >
              <Zap className="h-3 w-3" /> Start
            </button>
          ) : (
            <button
              onClick={endSession}
              className="flex items-center gap-1 px-2.5 py-1 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 rounded-lg text-[11px] font-bold text-red-400 transition-colors"
            >
              <Square className="h-3 w-3" /> End
            </button>
          )}
        </div>
      </div>

      {/* ── Error banner ───────────────────────────────────────────── */}
      {error && (
        <div className="flex items-start gap-2 px-3 py-2 bg-red-500/10 border-b border-red-500/20 flex-shrink-0 animate-fade-in">
          <AlertCircle className="h-3.5 w-3.5 text-red-400 flex-shrink-0 mt-0.5" />
          <span className="text-[11px] text-red-300 leading-relaxed">{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-red-400/60 hover:text-red-400 text-xs">✕</button>
        </div>
      )}

      {/* ── Audio source toggles ───────────────────────────────────── */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-950 border-b border-white/5 flex-shrink-0">
        {(['system', 'mic', 'both'] as const).map((src) => (
          <button
            key={src}
            disabled={isActive}
            onClick={() => setAudioSrc(src)}
            className={cn(
              'flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium transition-colors',
              audioSrc === src
                ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                : 'text-white/30 hover:text-white/50',
              isActive && 'opacity-50 cursor-not-allowed',
            )}
          >
            {src === 'system' ? <Monitor className="h-3 w-3" /> : src === 'mic' ? <Mic className="h-3 w-3" /> : <span className="text-[9px]">MIC+SYS</span>}
            {src === 'system' ? 'System' : src === 'mic' ? 'Mic' : 'Both'}
          </button>
        ))}
        <div className="ml-auto text-[10px] text-white/20">
          {session.mode === 'FREE' ? '🆓 Free' : '⚡ Paid'}
        </div>
      </div>

      {/* ── Transcript panel ──────────────────────────────────────── */}
      <div className="flex-none h-[30%] overflow-y-auto px-3 py-2 space-y-1 border-b border-white/8 bg-gray-950/50">
        <div className="text-[9px] font-semibold text-white/20 uppercase tracking-widest mb-1">Live Transcript</div>
        {transcript.length === 0 && !partial && (
          <p className="text-[11px] text-white/20 italic">
            {isActive ? 'Listening for speech…' : 'Start the session to begin transcribing.'}
          </p>
        )}
        {transcript.map((t) => (
          <p key={t.id} className="text-[12px] text-white/80 leading-relaxed animate-fade-in">{t.text}</p>
        ))}
        {partial && (
          <p className="text-[12px] text-white/40 italic leading-relaxed">{partial}</p>
        )}
        <div ref={transcriptEndRef} />
      </div>

      {/* ── AI answers panel ──────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2.5 min-h-0">
        <div className="text-[9px] font-semibold text-white/20 uppercase tracking-widest mb-1">AI Answers</div>

        {messages.length === 0 && !streaming && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-white/20 py-6">
            <Sparkles className="h-6 w-6" />
            <p className="text-[11px] text-center">AI answers appear here.<br/>Press Cmd+Shift+A or ask below.</p>
          </div>
        )}

        {messages.map((m) => (
          <MessageBubble key={m.id} msg={m} copied={copied} onCopy={(id, text) => {
            navigator.clipboard.writeText(text).catch(() => {})
            setCopied(id)
            setTimeout(() => setCopied(null), 2_000)
          }} />
        ))}

        {/* Streaming answer */}
        {streaming && (
          <div className="rounded-xl bg-green-500/8 border border-green-500/20 p-3 animate-fade-in">
            <div className="flex items-center gap-1.5 mb-1.5">
              <div className="h-4 w-4 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
                <span className="text-green-400 text-[8px] font-bold">P</span>
              </div>
              <Loader2 className="h-3 w-3 text-green-400 animate-spin" />
            </div>
            <p className="text-[12px] text-green-100/90 leading-relaxed whitespace-pre-wrap">{streaming}</p>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Action bar + input ────────────────────────────────────── */}
      <div className="flex-shrink-0 border-t border-white/8 bg-gray-950 px-3 py-2 space-y-2">
        {/* Quick action buttons */}
        <div className="flex items-center gap-1.5">
          <ActionBtn
            disabled={!isActive || ai.isStreaming}
            onClick={() => {
              const q = questionBufRef.current.join(' ').trim() || transcript[transcript.length - 1]?.text
              if (q) { questionBufRef.current = []; ai.ask(q) }
            }}
            title="Answer (⌘⇧A)"
            className="bg-green-500 hover:bg-green-400 text-white"
          >
            <Zap className="h-3 w-3" /> Answer
          </ActionBtn>

          <ActionBtn
            disabled={!isActive}
            onClick={takeScreenshot}
            title="Screenshot (⌘⇧S)"
            className="bg-white/8 hover:bg-white/15 text-white/70"
          >
            <Camera className="h-3 w-3" /> Screen
          </ActionBtn>

          <ActionBtn
            onClick={() => { setMessages([]); setTranscript([]); setStreaming(''); ai.abort() }}
            title="Clear (⌘⇧K)"
            className="bg-white/5 hover:bg-white/10 text-white/40"
          >
            <Trash2 className="h-3 w-3" />
          </ActionBtn>
        </div>

        {/* Manual input */}
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            value={manualQ}
            onChange={(e) => setManualQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleManualAsk())}
            placeholder={isActive ? 'Type a question…' : 'Start session first'}
            disabled={!isActive}
            className="flex-1 bg-white/6 border border-white/10 rounded-lg px-3 py-1.5 text-[12px] text-white placeholder:text-white/25 focus:outline-none focus:border-green-500/40 focus:bg-white/8 transition-colors disabled:opacity-40"
          />
          <button
            onClick={handleManualAsk}
            disabled={!isActive || !manualQ.trim() || ai.isStreaming}
            className="h-7 w-7 rounded-lg bg-green-500 hover:bg-green-400 disabled:opacity-30 flex items-center justify-center transition-colors flex-shrink-0"
          >
            {ai.isStreaming
              ? <Loader2 className="h-3.5 w-3.5 text-white animate-spin" />
              : <Send className="h-3.5 w-3.5 text-white" />}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function MessageBubble({
  msg, copied, onCopy,
}: {
  msg: AIMessage
  copied: string | null
  onCopy: (id: string, text: string) => void
}) {
  if (msg.role === 'USER') {
    return (
      <div className="flex justify-end animate-slide-up">
        <div className="max-w-[85%] bg-white/8 border border-white/10 rounded-2xl rounded-tr-sm px-3 py-2">
          <p className="text-[11px] text-white/70 leading-relaxed">{msg.content}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="animate-slide-up">
      <div className="flex items-center gap-1.5 mb-1">
        <div className="h-4 w-4 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
          <span className="text-green-400 text-[8px] font-bold">P</span>
        </div>
        <button
          onClick={() => onCopy(msg.id, msg.content)}
          className="ml-auto h-5 w-5 rounded flex items-center justify-center text-white/20 hover:text-white/50 transition-colors"
          title="Copy"
        >
          {copied === msg.id ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
        </button>
      </div>
      <div className="rounded-xl bg-green-500/8 border border-green-500/15 px-3 py-2">
        <AnswerContent content={msg.content} />
      </div>
    </div>
  )
}

function AnswerContent({ content }: { content: string }) {
  // Detect code blocks
  const parts = content.split(/(```[\s\S]*?```)/g)
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('```')) {
          const lines  = part.slice(3, -3).split('\n')
          const lang   = lines[0].trim()
          const code   = lines.slice(1).join('\n')
          return (
            <div key={i} className="mt-1.5 mb-1 rounded-lg bg-gray-900 border border-white/10 overflow-hidden">
              {lang && (
                <div className="flex items-center justify-between px-3 py-1 border-b border-white/8">
                  <span className="text-[9px] text-white/30 font-mono">{lang}</span>
                </div>
              )}
              <pre className="px-3 py-2 text-[11px] font-mono text-green-200/80 overflow-x-auto leading-relaxed whitespace-pre">{code}</pre>
            </div>
          )
        }
        return <p key={i} className="text-[12px] text-green-100/90 leading-relaxed whitespace-pre-wrap">{part}</p>
      })}
    </>
  )
}

function ActionBtn({
  children, onClick, disabled, title, className,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  title?: string
  className?: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-30 disabled:cursor-not-allowed',
        className,
      )}
    >
      {children}
    </button>
  )
}
