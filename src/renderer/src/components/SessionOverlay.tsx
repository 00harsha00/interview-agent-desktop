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
import { SESSION_PING_MS, TRANSCRIPT_SAVE_MS, SILENCE_TRIGGER_MS, AI_MODEL_LABELS } from '@/config'
import {
  getSpeechmaticsJwt, updateSessionStatus, saveTranscriptions, pingSession, extendSession,
  updateSessionModel,
} from '@/lib/api'
import { FRONTEND_URL } from '@/config'
import { useSpeechmatics } from '@/hooks/useSpeechmatics'
import { useSystemAudio }  from '@/hooks/useSystemAudio'
import { useAIStream }     from '@/hooks/useAIStream'
import type { AIModel, CallSession, TranscriptEntry, SmConnectionState } from '@/types'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2) }
function fmt(s: number) {
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

interface QAPair { id: string; question: string; answer: string; ts: Date }

// Electron window heights
const TOOLBAR_H  = 48
const MODAL_H    = 320
// Popover sizing (Task 2)
const POPOVER_GAP = 6
const POPOVER_W     = 300        // fixed popover width
const POPOVER_MAX_H = 480        // internal scroll cap for the ":" menu body
const MAX_TOTAL_HEIGHT_RATIO = 0.9 // hard ceiling while the popover forces extra room

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
      onClick={() => onClick()}
      disabled={disabled}
      className={cn(
        'flex items-center justify-center gap-1.5 px-4 h-8 rounded-xl text-[13px] font-bold select-none transition-all',
        'disabled:opacity-30 disabled:cursor-not-allowed text-white',
        streaming ? 'cursor-wait' : 'hover:brightness-110 active:scale-[0.98]',
      )}
      style={{
        background: 'linear-gradient(135deg,#16a34a,#22c55e)',
        boxShadow: '0 2px 10px rgba(34,197,94,0.35), inset 0 0 0 1px rgba(255,255,255,0.15)',
        minWidth: 132,   // fixed footprint — never moves or resizes with state
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
  onClickWithRect, disabled = false,
}: {
  onClick?: () => void
  children: React.ReactNode
  title?: string
  className?: string
  disabled?: boolean
  onClickWithRect?: (rect: DOMRect) => void
}) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={(e) => {
        if (disabled) return
        if (onClickWithRect) {
          e.stopPropagation()   // prevent document 'click' listener from closing the menu
          onClickWithRect(e.currentTarget.getBoundingClientRect())
        } else {
          onClick?.()
        }
      }}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      className={cn(
        'flex items-center justify-center h-7 w-7 rounded-lg text-white/40 hover:text-white/85',
        'hover:bg-white/8 transition-all select-none',
        disabled && 'opacity-25 cursor-not-allowed pointer-events-none',
        className,
      )}
    >
      {children}
    </button>
  )
}

// ─── ":" menu contents — rendered inside the floating SettingsPopover ────────
const LANGUAGES: Array<[string, string]> = [
  ['en', 'English'], ['hi', 'Hindi'], ['te', 'Telugu'], ['ta', 'Tamil'],
  ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['zh', 'Chinese'],
  ['ja', 'Japanese'], ['ko', 'Korean'], ['ar', 'Arabic'], ['pt', 'Portuguese'],
]

function SettingsPanel({
  userEmail, zoom, opacity, autoGen, autoDetect, privateMode, language,
  extraContext, aiModel, snapPos,
  onZoom, onZoomReset, onOpacity, onOpacityReset,
  onAutoGen, onAutoDetect, onPrivate, onLanguage,
  onExtraContext, onModelChange, onMove, onExit, onEnd, onClose,
}: {
  userEmail?: string
  zoom: number; opacity: number; autoGen: boolean; autoDetect: boolean
  privateMode: boolean; language: string
  extraContext: string; aiModel: AIModel; snapPos: SnapPos
  onZoom: (d: number) => void; onZoomReset: () => void
  onOpacity: (d: number) => void; onOpacityReset: () => void
  onAutoGen: (v: boolean) => void; onAutoDetect: (v: boolean) => void
  onPrivate: (v: boolean) => void; onLanguage: (lang: string) => void
  onExtraContext: (v: string) => void
  onModelChange: (m: AIModel) => void; onMove: (p: SnapPos) => void
  onExit: () => void; onEnd: () => void; onClose: () => void
}) {
  const rowShadow = { boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)' }
  return (
    <div
      className="anim-in"
      style={{
        background: 'rgba(10,10,16,0.97)',
        backdropFilter: 'none',
      }}
    >
      {/* Header — account email (read-only) + close. Fixed, does not scroll. */}
      <div className="flex items-center justify-between px-3 py-2" style={rowShadow}>
        <span className="text-[10.5px] text-white/55 font-medium truncate max-w-[200px]" title={userEmail}>
          {userEmail ?? 'Signed in'}
        </span>
        <button
          onMouseDown={(e) => { e.preventDefault(); onClose() }}
          className="text-[10px] text-white/30 hover:text-white/70 transition-colors px-2 h-5 rounded-md hover:bg-white/8 flex items-center gap-1 flex-shrink-0"
          style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)' }}
        >
          ✕
        </button>
      </div>

      {/* Scrollable body — caps the popover's own height independently of the window fit */}
      <div style={{ maxHeight: POPOVER_MAX_H, overflowY: 'auto', scrollbarWidth: 'none' }}>
        {/* Dashboard */}
        <div className="px-3 py-1.5" style={rowShadow}>
          <button
            onClick={() => { window.electronAPI.shell.openExternal(`${FRONTEND_URL}/dashboard`); onClose() }}
            className="w-full text-left text-[11px] text-white/55 hover:text-indigo-300 transition-colors flex items-center gap-1.5 py-1"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            Dashboard
          </button>
        </div>

        {/* Toggles: Private / Auto-detect */}
        <div className="flex flex-col gap-2 px-3 py-2.5" style={rowShadow}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-white/35" title="Hide the overlay from screen shares and recordings">Private</span>
            <Toggle on={privateMode} onToggle={() => onPrivate(!privateMode)} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-white/35" title="Detect questions from the live transcript">Auto-detect</span>
            <Toggle on={autoDetect} onToggle={() => onAutoDetect(!autoDetect)} />
          </div>
        </div>

        {/* Zoom / Opacity steppers with reset */}
        <div className="flex flex-col gap-2 px-3 py-2.5" style={rowShadow}>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-white/35 w-14 flex-shrink-0">Zoom</span>
            <MiniBtn onClick={() => onZoom(-0.1)}>−</MiniBtn>
            <span className="text-[10px] text-white/50 w-9 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
            <MiniBtn onClick={() => onZoom(+0.1)}>+</MiniBtn>
            <button onClick={onZoomReset}
              className="text-[9px] text-white/25 hover:text-white/60 px-1.5 py-0.5 rounded-md hover:bg-white/8 transition-colors">
              Reset
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-white/35 w-14 flex-shrink-0">Opacity</span>
            <MiniBtn onClick={() => onOpacity(-0.1)}>−</MiniBtn>
            <span className="text-[10px] text-white/50 w-9 text-center tabular-nums">{Math.round(opacity * 100)}%</span>
            <MiniBtn onClick={() => onOpacity(+0.1)}>+</MiniBtn>
            <button onClick={onOpacityReset}
              className="text-[9px] text-white/25 hover:text-white/60 px-1.5 py-0.5 rounded-md hover:bg-white/8 transition-colors">
              Reset
            </button>
          </div>
        </div>

        {/* Language */}
        <div className="flex items-center gap-3 px-3 py-2" style={rowShadow}>
          <span className="text-[10px] text-white/35 flex-shrink-0 w-14">Language</span>
          <select
            value={language}
            onChange={(e) => onLanguage(e.target.value)}
            className="flex-1 px-2 py-1 rounded-lg text-[11px] outline-none cursor-pointer"
            style={{
              background: 'rgba(255,255,255,0.05)',
              boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.1)',
              color: '#ffffff',
              appearance: 'none',
            }}
          >
            {LANGUAGES.map(([value, label]) => (
              <option key={value} value={value} style={{ background: '#12121e' }}>{label}</option>
            ))}
          </select>
        </div>

        {/* Auto Generate */}
        <div className="flex items-center justify-between px-3 py-2.5" style={rowShadow}>
          <span className="text-[10px] text-white/35" title="Automatically send detected questions to the AI (requires Auto-detect)">Auto Generate</span>
          <Toggle on={autoGen} onToggle={() => onAutoGen(!autoGen)} />
        </div>

        {/* Model */}
        <div className="flex items-start gap-1.5 px-3 py-2 flex-wrap" style={rowShadow}>
          <span className="text-[10px] text-white/35 flex-shrink-0 w-14 pt-1">Model</span>
          <div className="flex flex-wrap gap-1 flex-1 min-w-0">
            {Object.entries(AI_MODEL_LABELS).map(([value, label]) => (
              <button key={value} onClick={() => { onModelChange(value as AIModel); onClose() }}
                className={cn('px-2 py-1 rounded-lg text-[10px] font-medium transition-all flex items-center gap-1',
                  aiModel === value
                    ? 'bg-indigo-500/25 text-indigo-300 ring-1 ring-indigo-400/30'
                    : 'text-white/40 hover:text-white/70 hover:bg-white/8')}>
                {aiModel === value && <span className="text-[8px]">✓</span>}
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Position — 2×3 grid reading like the screen */}
        <div className="flex items-center gap-3 px-3 py-2" style={rowShadow}>
          <span className="text-[10px] text-white/35 flex-shrink-0 w-14">Position</span>
          <div className="grid grid-cols-3 gap-1" style={{ width: 132 }}>
            {SNAP_POSITIONS.flat().map((pos) => (
              <button key={pos} onClick={() => { onMove(pos); onClose() }}
                title={pos.replace('-', ' ')}
                className={cn('flex items-center justify-center h-6 rounded-md text-[13px] transition-colors',
                  snapPos === pos
                    ? 'bg-indigo-500/25 text-indigo-300 ring-1 ring-indigo-400/30'
                    : 'text-white/45 hover:text-white hover:bg-white/10')}>
                {SNAP_ICONS[pos]}
              </button>
            ))}
          </div>
        </div>

        {/* Extra context */}
        <div className="flex flex-col gap-1 px-3 py-2.5" style={rowShadow}>
          <span className="text-[10px] text-white/30">Context</span>
          <input
            value={extraContext}
            onChange={(e) => onExtraContext(e.target.value)}
            placeholder="Extra context for AI (role, notes, company info…)"
            className="px-2.5 py-1.5 rounded-lg text-[11px] outline-none"
            style={{
              background: 'rgba(255,255,255,0.05)',
              boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.1)',
              color: '#ffffff',
              WebkitTextFillColor: '#ffffff',
            }}
            onFocus={(e) => (e.currentTarget.style.boxShadow = 'inset 0 0 0 1.5px rgba(99,102,241,0.5)')}
            onBlur={(e) => (e.currentTarget.style.boxShadow = 'inset 0 0 0 1px rgba(255,255,255,0.1)')}
          />
        </div>

        {/* Exit (hide, keep running) / End Session (full teardown) */}
        <div className="flex items-center justify-between px-3 py-2">
          <button
            onClick={() => { onClose(); onExit() }}
            title="Hide the overlay to the mini logo — session keeps running (and billing) in the background"
            className="text-[11px] text-white/55 hover:text-white transition-colors px-2 py-1 rounded-lg hover:bg-white/8 flex items-center gap-1.5"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            Exit
          </button>
          <button
            onClick={() => { onEnd(); onClose() }}
            title="Stop everything and end the session"
            className="text-[11px] text-red-400/70 hover:text-red-400 transition-colors px-2 py-1 rounded-lg hover:bg-red-500/10"
          >
            End Session
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── SettingsPopover — floating overlay layer, anchored to the trigger button ─
// Rendered as a sibling of the measured CONTAINER, so it never contributes to
// the auto-fit height calculation and can never get clipped by it. Direction
// (down vs. up) mirrors the window's snap position: top-anchored windows open
// downward (room grows below), bottom-anchored/flipped windows open upward
// (room grows above) — both directions are computed once at open time from a
// stable snapshot of window.innerWidth/innerHeight, so a later window resize
// (used to make room for this exact popover) never shifts the anchor.
function SettingsPopover({ rect, flipped, onClose, onMeasuredHeight, children }: {
  rect: DOMRect
  flipped: boolean
  onClose: () => void
  onMeasuredHeight: (h: number) => void
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('click', onClick)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('click', onClick); document.removeEventListener('keydown', onKey) }
  }, [onClose])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height ?? el.getBoundingClientRect().height
      onMeasuredHeight(Math.round(h))
    })
    ro.observe(el)
    return () => { ro.disconnect(); onMeasuredHeight(0) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Snapshot anchor math once per open (keyed by `rect` identity) — see note above.
  // Horizontal clamp: anchor to the button's right edge, but keep the whole
  // 300px popover inside the window with an 8px gutter on both sides.
  const anchor = useMemo(() => {
    let right = window.innerWidth - rect.right
    if (right < 8) right = 8                                    // never bleed off the right edge
    if (right + POPOVER_W > window.innerWidth - 8) {
      right = Math.max(8, window.innerWidth - 8 - POPOVER_W)    // never bleed off the left edge
    }
    return flipped
      ? { right, bottom: (window.innerHeight - rect.top) + POPOVER_GAP, top: undefined as number | undefined }
      : { right, top: rect.bottom + POPOVER_GAP, bottom: undefined as number | undefined }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rect])

  return (
    <div
      ref={ref}
      data-overlay
      className="anim-in"
      style={{
        position: 'fixed',
        top: anchor.top,
        bottom: anchor.bottom,
        right: anchor.right,
        zIndex: 99999,   // floats above answer panel, transcript strip, everything
        width: POPOVER_W,
        borderRadius: 12,
        overflow: 'hidden',
        boxShadow: '0 8px 30px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.1)',
      }}
    >
      {children}
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

// ─── Move dropdown — 2×3 grid of snap positions ───────────────────────────────
const SNAP_POSITIONS = [
  ['top-left', 'top-center', 'top-right'],
  ['bottom-left', 'bottom-center', 'bottom-right'],
] as const
type SnapPos = (typeof SNAP_POSITIONS)[number][number]

const SNAP_ICONS: Record<string, string> = {
  'top-left': '↖', 'top-center': '↑', 'top-right': '↗',
  'bottom-left': '↙', 'bottom-center': '↓', 'bottom-right': '↘',
}


// ─── Shared logo for overlay modal screens ────────────────────────────────────
function OverlayLogo() {
  return (
    <div className="flex items-center gap-1.5 flex-shrink-0">
      <div
        className="h-5 w-5 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', boxShadow: '0 2px 8px rgba(99,102,241,0.35)' }}
      >
        <span className="text-white font-black text-[8.5px] tracking-tight">IA</span>
      </div>
      <span className="text-white/70 text-[11px] font-semibold tracking-wide">
        Interview <span className="text-indigo-400">Agent</span>
      </span>
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
  const companyInitial = session.companyName?.[0]?.toUpperCase() ?? 'I'

  return (
    <div
      data-overlay
      className="overflow-hidden anim-in"
      style={{
        borderRadius: 14,
        background: 'linear-gradient(135deg,rgba(20,20,35,0.96),rgba(10,10,22,0.96))',
        backdropFilter: 'none',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
        maxWidth: 440,
        margin: '0 auto',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-4 h-10"
        style={{
          background: 'rgba(0,0,0,0.25)',
          boxShadow: 'inset 0 -1px 0 rgba(255,255,255,0.06)',
          WebkitAppRegion: 'drag',
        } as React.CSSProperties}
      >
        <OverlayLogo />
        {/* Mode badge */}
        <div
          className={cn('flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold ml-1',
            isFree ? 'text-indigo-300/65' : 'text-violet-300/80')}
          style={{ boxShadow: isFree ? 'inset 0 0 0 1px rgba(129,140,248,0.2)' : 'inset 0 0 0 1px rgba(167,139,250,0.3)' }}
        >
          <span className={cn('h-1.5 w-1.5 rounded-full', isFree ? 'bg-indigo-400/50' : 'bg-violet-400')} />
          {isFree ? 'Free · 10 min' : 'Paid · 30 min'}
        </div>
        <div className="flex-1" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />
        <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button onClick={onHide}
            className="text-[10px] text-white/35 hover:text-white/70 px-2 h-5 rounded-md transition-colors"
            style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)' }}>
            Hide
          </button>
          <button onClick={onBack}
            className="flex items-center justify-center h-6 w-6 rounded-md text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-all">
            <svg viewBox="0 0 10 10" className="h-2.5 w-2.5">
              <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
            </svg>
          </button>
        </div>
      </div>

      <div className="px-5 py-4 space-y-3.5">
        {/* Session company card */}
        <div
          className="flex items-center gap-3 px-3 py-3 rounded-xl"
          style={{ background: 'rgba(255,255,255,0.04)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.07)' }}
        >
          <div
            className="h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0 text-[14px] font-bold text-green-300"
            style={{ background: 'rgba(34,197,94,0.12)', boxShadow: 'inset 0 0 0 1px rgba(34,197,94,0.18)' }}
          >
            {companyInitial}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white/90 text-[13.5px] font-semibold truncate">{session.companyName ?? 'Interview'}</p>
            <p className="text-white/35 text-[10.5px] mt-0.5">
              {isFree ? '10-minute free trial' : 'Full paid session · 30 min window'}
            </p>
          </div>
          <div className={cn(
            'text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0',
            isFree ? 'text-indigo-300 bg-indigo-500/12' : 'text-violet-300 bg-violet-500/12',
          )}>
            {isFree ? 'FREE' : 'PAID'}
          </div>
        </div>

        {/* Info */}
        {isFree ? (
          <div
            className="px-3 py-2.5 rounded-xl"
            style={{ background: 'rgba(99,102,241,0.07)', boxShadow: 'inset 0 0 0 1px rgba(99,102,241,0.15)' }}
          >
            <p className="text-indigo-300/80 text-[11.5px] font-medium mb-0.5">10-minute free trial</p>
            <p className="text-white/35 text-[10.5px] leading-relaxed">
              Timer starts on activation. Buy credits before the timer runs out to continue.
            </p>
          </div>
        ) : (
          <div
            className="px-3 py-2.5 rounded-xl"
            style={{ background: 'rgba(34,197,94,0.06)', boxShadow: 'inset 0 0 0 1px rgba(34,197,94,0.12)' }}
          >
            <p className="text-green-300/80 text-[11.5px] font-medium mb-0.5">Full session · auto-extends</p>
            <p className="text-white/35 text-[10.5px] leading-relaxed">
              Session runs in 30-min windows and auto-extends (0.5 credits each) while you have credits.
            </p>
          </div>
        )}

        {error && (
          <div
            className="px-3 py-2 rounded-xl text-red-300 text-[11.5px]"
            style={{ background: 'rgba(239,68,68,0.1)', boxShadow: 'inset 0 0 0 1px rgba(239,68,68,0.2)' }}
          >
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2.5 pt-0.5">
          <button
            onClick={onBack}
            className="py-2.5 px-4 rounded-xl text-white/40 hover:text-white/75 text-[12px] font-medium transition-colors"
            style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.1)' }}
          >
            Cancel
          </button>
          <button
            onClick={onActivate}
            disabled={activating}
            className="flex-1 py-2.5 rounded-xl text-white text-[12.5px] font-semibold transition-all flex items-center justify-center gap-2 disabled:opacity-40"
            style={{
              background: activating
                ? 'rgba(34,197,94,0.3)'
                : 'linear-gradient(135deg,rgba(34,197,94,0.8),rgba(16,185,129,0.8))',
              boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.15)',
            }}
          >
            {activating ? (
              <>
                <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Starting session…
              </>
            ) : (
              <>
                <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                </svg>
                Activate {isFree ? '(Free Trial)' : 'Session'}
              </>
            )}
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
  userEmail?: string     // shown read-only in the ":" menu header
  /** true while "Exited" to the mini bar — component stays MOUNTED (session keeps
   *  running in the background); only window sizing/visual behavior is suspended */
  hidden?: boolean
  /** Lifts running state + timer deadline so App's mini bar can show them */
  onSessionMeta?: (meta: { running: boolean; endsAt: number | null }) => void
  onEnd: () => void
  onHide: (height?: number) => void
}

export function SessionOverlay({
  session, userCredits = 0, isAdmin = false, userEmail,
  hidden = false, onSessionMeta, onEnd, onHide,
}: Props) {
  const [isActivated,  setIsActivated]  = useState(false)
  const [activating,   setActivating]   = useState(false)
  const [activateErr,  setActivateErr]  = useState<string | null>(null)

  const [isRunning,    setIsRunning]    = useState(false)
  const [timerStartSeconds, setTimerStartSeconds] = useState<number | null>(null)
  const [timerKey,     setTimerKey]     = useState(0)

  // Report running state + countdown deadline up to App (mini-bar timer/billing dot).
  // Recomputed whenever the timer (re)starts (activate / auto-extend) or stops.
  useEffect(() => {
    onSessionMeta?.({
      running: isRunning,
      endsAt: isRunning && timerStartSeconds !== null ? Date.now() + timerStartSeconds * 1000 : null,
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning, timerStartSeconds, timerKey])
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
  // Auto-detect = detect questions from the transcript (silence-based detection).
  // Auto Generate (autoGen) = automatically SEND the detected question to the AI.
  // Auto Generate only has an effect while Auto-detect is on.
  const [autoDetect,   setAutoDetect]   = useState(true)
  // "Private" — hide the overlay window from screen shares/recordings
  // (setContentProtection). Mirrors main's boot value: ON in packaged builds,
  // OFF in dev (import.meta.env.PROD tracks the same dev/packaged split).
  const [privateMode,  setPrivateMode]  = useState(import.meta.env.PROD)
  const [language,     setLanguage]     = useState(session.language ?? 'en')
  const [screenshots,  setScreenshots]  = useState<string[]>([])
  const [manualQ,      setManualQ]      = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [settingsRect, setSettingsRect] = useState<DOMRect | null>(null)
  const [popoverH,     setPopoverH]     = useState(0)
  const [maxContentH,  setMaxContentH]  = useState(700)  // 70% of work-area height, fetched on mount
  const [extraContext, setExtraContext] = useState('')
  const [aiModel,      setAiModel]      = useState<AIModel>(session.aiModel)
  const [snapPos,      setSnapPos]      = useState<SnapPos>(() => {
    return (localStorage.getItem('overlay-snap-pos') as SnapPos | null) ?? 'top-center'
  })
  const flipped = snapPos.startsWith('bottom')

  // Restore the persisted snap position on launch AND when returning from
  // Exit/mini mode (the mini bar moves/resizes the window while we're hidden).
  useEffect(() => {
    if (hidden) return
    void window.electronAPI.window.moveTo(snapPos)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidden])

  // Keep a ref for callbacks that fire while hidden (e.g. timer expiry)
  const hiddenRef = useRef(hidden)
  useEffect(() => {
    hiddenRef.current = hidden
    if (hidden) { setShowSettings(false); setPopoverH(0) }  // popover can't outlive the visible overlay
  }, [hidden])

  const [audioLevel,   setAudioLevel]   = useState(0)  // 0–1 RMS from AudioWorklet
  const [copied,       setCopied]       = useState<string | null>(null)  // id of copied answer

  const isRunningRef   = useRef(false)
  const saveQueueRef   = useRef<string[]>([])
  const silenceRef     = useRef<ReturnType<typeof setTimeout> | null>(null)
  const questionBufRef = useRef<string[]>([])
  const partialRef     = useRef('')
  const pingRef        = useRef<ReturnType<typeof setInterval> | null>(null)
  const inputRef       = useRef<HTMLInputElement>(null)
  const pendingQRef    = useRef('')
  const prevHeightRef  = useRef(TOOLBAR_H)
  const answerScrollRef = useRef<HTMLDivElement>(null)
  const overlayRootRef = useRef<HTMLDivElement>(null)
  const contentHeightRef = useRef(TOOLBAR_H)

  useEffect(() => { partialRef.current = partial }, [partial])

  // BUG FIX: return 'none' when both toggles are off — previously always fell through to 'system'
  const audioSrc = useMemo(() => {
    if (micOn && sysOn) return 'both' as const
    if (micOn) return 'mic' as const
    if (sysOn) return 'system' as const
    return 'none' as const
  }, [micOn, sysOn])

  // ── Speechmatics ──────────────────────────────────────────────────────────
  const sm = useSpeechmatics({
    language,
    onPartial: setPartial,
    onFinal: useCallback((text: string) => {
      if (!isRunningRef.current) return
      setPartial(''); partialRef.current = ''
      setTranscript((p) => [...p, { id: uid(), text, isFinal: true, timestamp: Date.now() }])
      saveQueueRef.current.push(text)
      questionBufRef.current.push(text)
      // Auto-detect gates the silence-based question detection; Auto Generate
      // (autoGen) gates auto-sending the detected question. Both must be on
      // for hands-free answers. Send semantics (questionBufRef) are unchanged.
      if (autoDetect && autoGen) {
        if (silenceRef.current) clearTimeout(silenceRef.current)
        silenceRef.current = setTimeout(() => {
          const q = questionBufRef.current.join(' ').trim()
          questionBufRef.current = []
          if (q) triggerAnswer(q)
        }, SILENCE_TRIGGER_MS)
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoGen, autoDetect]),
    onStateChange: setSmState,
  })

  const audio = useSystemAudio({
    onPCMChunk: sm.sendAudio,
    onError: (m) => setError(m),
    onLevel: setAudioLevel,
  })

  const ai = useAIStream({
    callSessionId: session.id,
    extraContext,
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
    // Display-only: mark everything currently shown as consumed so the caption
    // strip can distinguish queued (will send next) from already-sent segments.
    setTranscript((p) => (p.some((t) => !t.sent) ? p.map((t) => (t.sent ? t : { ...t, sent: true })) : p))

    const snapshots = imgs ?? (screenshots.length ? [...screenshots] : undefined)
    if (snapshots?.length) setScreenshots([])

    pendingQRef.current = q || '[screenshot analysis]'
    setStreaming('')
    setCurrentQA(-1)
    setShowAnswer(true)   // Fix 3: show immediately, not just on done
    ai.ask(q || 'Analyze this screenshot and provide relevant interview assistance.', snapshots)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ai, screenshots])

  // Mid-session model switch. History lives server-side keyed by callSessionId,
  // so the conversation continues seamlessly — do NOT clear qaPairs/transcript.
  const onModelChange = useCallback((m: AIModel) => {
    const prev = aiModel
    setAiModel(m)  // optimistic — next Answer uses it once backend confirms
    updateSessionModel(session.id, m).catch(() => {
      setAiModel(prev)
      setError('Failed to switch model')
      setTimeout(() => setError(null), 3_000)
    })
  }, [aiModel, session.id])

  // "Private" — toggle screen-share invisibility live
  const onPrivateChange = useCallback((v: boolean) => {
    setPrivateMode(v)
    void window.electronAPI.window.setContentProtection(v)
  }, [])

  // Mid-session language change: Speechmatics reads the language at
  // StartRecognition, so switching requires a reconnect with a fresh JWT.
  // Transcript/QA state and the audio pipeline are untouched; audio chunks
  // sent during the brief reconnect window are dropped (readyState guard).
  const onLanguageChange = useCallback((lang: string) => {
    setLanguage(lang)
    if (isRunningRef.current) {
      getSpeechmaticsJwt(session.id)
        .then((jwt) => sm.connect(jwt))
        .catch(() => {
          setError('Failed to switch language — transcription may need a restart')
          setTimeout(() => setError(null), 4_000)
        })
    }
  }, [session.id, sm])

  // Single clear path — every Clear resets the same three stores together.
  const clearTranscript = useCallback(() => {
    if (silenceRef.current) { clearTimeout(silenceRef.current); silenceRef.current = null }
    setTranscript([])
    setPartial(''); partialRef.current = ''
    questionBufRef.current = []
  }, [])

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
      setTimerStartSeconds(windowSecs)
      setTimerKey((k) => k + 1)

      pingRef.current  = setInterval(() => pingSession(session.id), SESSION_PING_MS)
      setIsActivated(true)
      window.electronAPI.window.setHeight(TOOLBAR_H)
    } catch (err) {
      setActivateErr(`Activation failed: ${(err as Error).message}`)
    } finally { setActivating(false) }
  }, [session.id, audioSrc, sm, audio])

  // Restart audio when mic/sys toggles change while running
  const prevAudioSrc = useRef(audioSrc)
  useEffect(() => {
    if (!isRunning || audioSrc === prevAudioSrc.current) return
    prevAudioSrc.current = audioSrc
    if (audioSrc === 'none') {
      audio.stop()
      return
    }
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
    sm.disconnect(); audio.stop(); ai.abort()
    isRunningRef.current = false; setIsRunning(false)
    const remaining = saveQueueRef.current.splice(0)
    if (remaining.length > 0) {
      await saveTranscriptions(session.id, remaining.map((t) => ({ speaker: 'SYSTEM', text: t }))).catch(() => {})
    }
    await updateSessionStatus(session.id, 'ENDED').catch(() => {})
    onEnd()
  }, [session.id, sm, audio, ai, onEnd])

  // ── Timer expiry — called by SessionTimer component when countdown hits 0 ──
  const handleTimerExpire = useCallback(() => {
    if (!isRunningRef.current) return

    if (session.mode === 'FREE') {
      if (pingRef.current) clearInterval(pingRef.current)
      sm.disconnect(); audio.stop(); ai.abort()
      isRunningRef.current = false; setIsRunning(false)
      void updateSessionStatus(session.id, 'ENDED').catch(() => {})
      const pending = saveQueueRef.current.splice(0)
      if (pending.length) {
        void saveTranscriptions(session.id, pending.map((t) => ({ speaker: 'SYSTEM', text: t }))).catch(() => {})
      }
      setFreeExpired(true)
      if (!hiddenRef.current) window.electronAPI.window.setHeight(MODAL_H)
    } else {
      void extendSession(session.id)
        .then((data) => {
          setTimerStartSeconds(30 * 60)
          setTimerKey((k) => k + 1)
          setError(`Auto-extended ⚡ ${data.newBalance.toFixed(1)} credits left`)
          setTimeout(() => setError(null), 4_000)
        })
        .catch(() => {
          if (pingRef.current) clearInterval(pingRef.current)
          sm.disconnect(); audio.stop(); ai.abort()
          isRunningRef.current = false; setIsRunning(false)
          void updateSessionStatus(session.id, 'ENDED').catch(() => {})
          const pending = saveQueueRef.current.splice(0)
          if (pending.length) {
            void saveTranscriptions(session.id, pending.map((t) => ({ speaker: 'SYSTEM', text: t }))).catch(() => {})
          }
          setOutOfCredits(true)
          if (!hiddenRef.current) window.electronAPI.window.setHeight(MODAL_H)
        })
    }
  }, [session.id, session.mode, sm, audio, ai])

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
  const copyAnswer = useCallback((text: string, id?: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(id ?? 'current')
      setTimeout(() => setCopied(null), 2_000)
    }).catch(() => {})
  }, [])

  // ── Stable callbacks for memo'd child components ────────────────────────────
  const onToggleMic      = useCallback(() => setMicOn((v) => !v), [])
  const onToggleSys      = useCallback(() => setSysOn((v) => !v), [])
  const onToggleChat     = useCallback(() => setShowChat((v) => !v), [])
  const onSettingsClick   = useCallback((r: DOMRect) => {
    setSettingsRect(r)
    setShowSettings((v) => !v)
  }, [])
  const onCloseSettings   = useCallback(() => { setShowSettings(false); setPopoverH(0) }, [])
  const onHideMini       = useCallback(() => onHide(prevHeightRef.current), [onHide])
  const onSnapMove       = useCallback((pos: SnapPos) => {
    setSnapPos(pos)
    localStorage.setItem('overlay-snap-pos', pos)
    void window.electronAPI.window.moveTo(pos)
  }, [])
  const onNavigatePrev   = useCallback(() => setCurrentQA((i) => Math.max(0, i - 1)), [])
  const onNavigateNext   = useCallback((len: number) => setCurrentQA((i) => Math.min(len - 1, i + 1)), [])
  const onClearAnswers   = useCallback(() => { setQaPairs([]); setCurrentQA(-1); setStreaming(''); setShowAnswer(false); ai.abort() }, [ai])
  const onCloseAnswer    = useCallback(() => setShowAnswer(false), [])
  const onRegenerate     = useCallback((q: string) => { pendingQRef.current = q; ai.ask(q) }, [ai])
  const onDismissError   = useCallback(() => setError(null), [])

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    const u1 = window.electronAPI.on('shortcut:answer', () => triggerAnswer())
    const u2 = window.electronAPI.on('shortcut:screenshot', () => void captureScreenshot(true))
    const u3 = window.electronAPI.on('shortcut:toggle-chat', () => setShowChat((v) => !v))
    const u4 = window.electronAPI.on('shortcut:clear', clearTranscript)
    return () => { u1(); u2(); u3(); u4() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerAnswer, captureScreenshot, clearTranscript])

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

  // (caption + answer scroll are handled inside their respective memo'd components)

  // ── Cleanup ────────────────────────────────────────────────────────────────
  useEffect(() => () => {
    sm.disconnect(); audio.stop(); ai.abort()
    if (pingRef.current) clearInterval(pingRef.current)
  }, []) // eslint-disable-line

  // ── Auto-fit window height to real rendered content ──────────────────────────
  // Root container is measured directly (scrollHeight) instead of guessing a
  // pixel sum per panel — this is accurate under zoom, streaming growth, etc.
  const CAPTION_H  = 44   // single-row horizontal strip — a deliberate fixed size, not a guess

  useEffect(() => {
    let cancelled = false
    window.electronAPI.window.getWorkAreaSize?.().then((size) => {
      if (!cancelled && size?.height) setMaxContentH(Math.round(size.height * 0.7))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    // While hidden (Exit → mini bar) the mini bar owns the window size; don't
    // fight it. On unhide this effect re-runs and re-fits immediately.
    if (!isActivated || hidden) return
    const el = overlayRootRef.current
    if (!el) return

    const applyHeight = () => {
      const contentH = Math.min(el.scrollHeight, maxContentH)
      contentHeightRef.current = contentH
      prevHeightRef.current = contentH
      if (showSettings && popoverH > 0) {
        // maxContentH is already 70% of the work area — while the popover is open,
        // temporarily allow up to MAX_TOTAL_HEIGHT_RATIO (90%) of the full work area
        // so the popover is never clipped, then shrink back once it closes.
        const workAreaH = maxContentH / 0.7
        const total = Math.min(contentH + popoverH + POPOVER_GAP * 2, Math.round(workAreaH * MAX_TOTAL_HEIGHT_RATIO))
        window.electronAPI.window.setHeight(total, flipped)
      } else {
        window.electronAPI.window.setHeight(contentH, flipped)
      }
    }

    const ro = new ResizeObserver(applyHeight)
    ro.observe(el)
    applyHeight()
    return () => ro.disconnect()
  }, [isActivated, hidden, flipped, showSettings, popoverH, maxContentH])

  // ── Zoom / opacity ─────────────────────────────────────────────────────────
  useEffect(() => { document.documentElement.style.fontSize = `${zoom * 16}px` }, [zoom])
  useEffect(() => { window.electronAPI.window.setOpacity(opacity) }, [opacity])

  const currentPair = currentQA >= 0 ? qaPairs[currentQA] : null

  // ── Shared modal card style ───────────────────────────────────────────────
  const modalCardStyle: React.CSSProperties = {
    borderRadius: 14,
    background: 'linear-gradient(135deg,rgba(20,20,35,0.96),rgba(10,10,22,0.96))',
    backdropFilter: 'none',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
    maxWidth: 400,
    margin: '0 auto',
    overflow: 'hidden',
  }
  const modalHeaderStyle: React.CSSProperties = {
    background: 'rgba(0,0,0,0.25)',
    boxShadow: 'inset 0 -1px 0 rgba(255,255,255,0.06)',
    WebkitAppRegion: 'drag',
  }

  // ── FREE trial expired ────────────────────────────────────────────────────
  if (freeExpired) {
    const hasCredits = isAdmin || userCredits >= 0.5
    return (
      <div data-overlay className="anim-in" style={modalCardStyle}>
        <div className="flex items-center gap-2 px-4 h-10" style={modalHeaderStyle}>
          <OverlayLogo />
          <div className="flex-1" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />
        </div>
        <div className="px-5 py-5 text-center space-y-3">
          <div
            className="h-14 w-14 rounded-2xl mx-auto flex items-center justify-center"
            style={{ background: 'rgba(251,146,60,0.12)', boxShadow: 'inset 0 0 0 1px rgba(251,146,60,0.2)' }}
          >
            <svg className="h-7 w-7 text-orange-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <p className="text-white font-semibold text-[15px]">Free Trial Ended</p>
            <p className="text-white/40 text-[11.5px] mt-1.5 leading-relaxed">
              {hasCredits
                ? 'You have credits — start a paid session to continue without limits.'
                : 'Your 10-minute trial is up. Get credits to run full sessions.'}
            </p>
          </div>
          <div className="flex flex-col gap-2 pt-1">
            <button
              onClick={() => window.electronAPI.shell.openExternal(`${FRONTEND_URL}/dashboard/callSessions`)}
              className="w-full py-2.5 rounded-xl text-white text-[12.5px] font-semibold transition-all"
              style={{
                background: 'linear-gradient(135deg,rgba(99,102,241,0.85),rgba(139,92,246,0.85))',
                boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.14)',
              }}
              onMouseOver={(e) => { e.currentTarget.style.filter = 'brightness(1.1)' }}
              onMouseOut={(e) => { e.currentTarget.style.filter = '' }}
            >
              {hasCredits ? '⚡ Start Paid Session' : '💳 Buy Credits'}
            </button>
            <button
              onClick={onEnd}
              className="w-full py-2 rounded-xl text-white/35 hover:text-white/65 text-[12px] font-medium transition-colors"
              style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.09)' }}
            >
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
      <div data-overlay className="anim-in" style={modalCardStyle}>
        <div className="flex items-center gap-2 px-4 h-10" style={modalHeaderStyle}>
          <OverlayLogo />
          <div className="flex-1" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />
        </div>
        <div className="px-5 py-5 text-center space-y-3">
          <div
            className="h-14 w-14 rounded-2xl mx-auto flex items-center justify-center"
            style={{ background: 'rgba(239,68,68,0.1)', boxShadow: 'inset 0 0 0 1px rgba(239,68,68,0.18)' }}
          >
            <svg className="h-7 w-7 text-red-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div>
            <p className="text-white font-semibold text-[15px]">Out of Credits</p>
            <p className="text-white/40 text-[11.5px] mt-1.5 leading-relaxed">
              Your session ended — no credits left to extend. Buy more to continue.
            </p>
          </div>
          <div className="flex flex-col gap-2 pt-1">
            <button
              onClick={() => window.electronAPI.shell.openExternal(`${FRONTEND_URL}/dashboard/buyCredits`)}
              className="w-full py-2.5 rounded-xl text-white text-[12.5px] font-semibold transition-all"
              style={{
                background: 'linear-gradient(135deg,rgba(99,102,241,0.85),rgba(139,92,246,0.85))',
                boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.14)',
              }}
              onMouseOver={(e) => { e.currentTarget.style.filter = 'brightness(1.1)' }}
              onMouseOut={(e) => { e.currentTarget.style.filter = '' }}
            >
              💳 Buy Credits
            </button>
            <button
              onClick={onEnd}
              className="w-full py-2 rounded-xl text-white/35 hover:text-white/65 text-[12px] font-medium transition-colors"
              style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.09)' }}
            >
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
  const panelOpen   = showSettings || showChat || showAnswer

  const PANEL_BG: React.CSSProperties = {
    background: 'rgba(8,8,12,0.94)',
    backdropFilter: 'none',
  }
  const toolbarStyle: React.CSSProperties = {
    ...PANEL_BG,
    boxShadow: 'none',
  }

  // Unified rounded container — clips all panels so no individual border-radius needed.
  // maxHeight lets the AnswerPanel's flex child shrink-and-scroll instead of the
  // window growing past the 70% work-area cap (Task 1); Task 2's popover renders
  // OUTSIDE this container entirely so it never contributes to this layout.
  const CONTAINER: React.CSSProperties = {
    borderRadius: 14,
    overflow: 'hidden',
    background: 'rgba(8,8,12,0.94)',
    display: 'flex',
    flexDirection: flipped ? 'column-reverse' : 'column',
    maxHeight: maxContentH,
  }

  return (
    <div className="anim-in" style={{ background: 'transparent' }}>

      {/* Floating "…" popover — overlay layer, not part of the measured column flow */}
      {showSettings && settingsRect && (
        <SettingsPopover rect={settingsRect} flipped={flipped} onClose={onCloseSettings} onMeasuredHeight={setPopoverH}>
          <SettingsPanel
            userEmail={userEmail}
            zoom={zoom} opacity={opacity} autoGen={autoGen} autoDetect={autoDetect}
            privateMode={privateMode} language={language}
            extraContext={extraContext} aiModel={aiModel} snapPos={snapPos}
            onZoom={(d) => setZoom((z) => Math.max(0.7, Math.min(1.5, +((z + d).toFixed(1)))))}
            onZoomReset={() => setZoom(1)}
            onOpacity={(d) => setOpacity((o) => Math.max(0.3, Math.min(1, +((o + d).toFixed(1)))))}
            onOpacityReset={() => setOpacity(1)}
            onAutoGen={setAutoGen} onAutoDetect={setAutoDetect}
            onPrivate={onPrivateChange} onLanguage={onLanguageChange}
            onExtraContext={setExtraContext}
            onModelChange={onModelChange} onMove={onSnapMove}
            onExit={onHideMini} onEnd={endSession} onClose={onCloseSettings}
          />
        </SettingsPopover>
      )}

      <div data-overlay ref={overlayRootRef} style={CONTAINER}>

      {/* ══ TOOLBAR ══════════════════════════════════════════════════════════ */}
      <ToolbarBar
        companyName={session.companyName}
        sessionMode={session.mode}
        isRunning={isRunning}
        micOn={micOn}
        sysOn={sysOn}
        audioLevel={audioLevel}
        smState={smState}
        showChat={showChat}
        showAnswer={showAnswer}
        showSettings={showSettings}
        qaPairsCount={qaPairs.length}
        timerStartSeconds={timerStartSeconds}
        timerKey={timerKey}
        sessionTimerMode={session.mode}
        onTimerExpire={handleTimerExpire}
        isStreaming={ai.isStreaming}
        onToggleMic={onToggleMic}
        onToggleSys={onToggleSys}
        onAnswer={triggerAnswer}
        onScreenshot={captureScreenshot}
        onToggleChat={onToggleChat}
        onSettingsClick={onSettingsClick}
        onHide={onHideMini}
        aiModel={aiModel}
      />

      {/* ══ TRANSCRIPT STRIP — always visible: the queued "next question" tunnel ══ */}
      <CaptionPanel transcript={transcript} partial={partial} height={CAPTION_H} onClear={clearTranscript} />

      {/* ══ CHAT PANEL ══════════════════════════════════════════════════════ */}
      {showChat && (
        <div
          className="anim-in"
          style={{
            ...PANEL_BG,
            flexShrink: 0,
            boxShadow: 'none',
          }}
        >
          {/* Screenshot thumbnails */}
          {screenshots.length > 0 && (
            <div className="flex gap-1.5 px-2.5 pt-2.5 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
              {screenshots.map((src, i) => (
                <div key={i} className="relative flex-shrink-0">
                  <img src={src} alt="sc" className="h-14 w-20 object-cover rounded-lg hover:shadow-lg transition-shadow"
                       style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.1)' }} />
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

        </div>
      )}

      {/* ══ ANSWER PANEL ════════════════════════════════════════════════════ */}
      {showAnswer && (
        <AnswerPanel
          isStreaming={ai.isStreaming}
          streaming={streaming}
          qaPairs={qaPairs}
          currentQA={currentQA}
          pendingQuestion={pendingQRef.current}
          error={error}
          copied={copied}
          onNavigatePrev={onNavigatePrev}
          onNavigateNext={onNavigateNext}
          onClear={onClearAnswers}
          onClose={onCloseAnswer}
          onCopy={copyAnswer}
          onRegenerate={onRegenerate}
          onDismissError={onDismissError}
        />
      )}


      </div>{/* end unified container */}
    </div>
  )
}

// ─── SessionTimer — owns its own countdown so ticks don't re-render parent ───
interface SessionTimerProps {
  startSeconds: number | null
  onExpire: () => void
  mode: string
  timerKey: number  // change this to remount/reset the timer
}
const SessionTimer = React.memo(function SessionTimer({ startSeconds, onExpire, mode }: SessionTimerProps) {
  const [remaining, setRemaining] = useState<number | null>(startSeconds)
  const firedRef = useRef(false)

  useEffect(() => {
    if (startSeconds === null) return
    setRemaining(startSeconds)
    firedRef.current = false
    const id = setInterval(() => {
      setRemaining((s) => (s === null || s <= 0 ? 0 : s - 1))
    }, 1_000)
    return () => clearInterval(id)
  }, [startSeconds])

  useEffect(() => {
    if (remaining === 0 && !firedRef.current) {
      firedRef.current = true
      onExpire()
    }
  }, [remaining, onExpire])

  if (remaining === null) return null
  const mins = Math.floor(remaining / 60)
  const secs = remaining % 60
  const label = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  return (
    <span
      className={cn(
        'text-[12px] font-mono font-semibold tabular-nums flex-shrink-0 transition-colors',
        remaining <= 60 ? 'text-red-400 animate-pulse' : remaining <= 5 * 60 ? 'text-yellow-400' : 'text-white/55',
      )}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      title={mode === 'FREE' ? 'Free trial remaining' : 'Until auto-extend'}
    >
      {label}
    </span>
  )
})

// ─── CaptionPanel — the "NEXT ▸" strip: a single tunnel of QUEUED chips only ──
// Shows exactly what will be sent on the next Answer press. Sent chips are
// hidden entirely: triggerAnswer marks entries sent at the same instant it
// flushes questionBufRef, so the visible tunnel and the send buffer always
// clear together. The trailing partial (in-flight speech) confirms mic is live.
interface CaptionPanelProps {
  transcript: TranscriptEntry[]
  partial: string
  height: number
  onClear: () => void
}
const CaptionPanel = React.memo(function CaptionPanel({ transcript, partial, height, onClear }: CaptionPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = scrollRef.current.scrollWidth
  }, [transcript, partial])

  // Only queued (unsent) segments — the strip clears the moment Answer fires
  const queued = transcript.filter((t) => !t.sent)
  const hasContent = queued.length > 0 || !!partial

  return (
    <div className="anim-in" style={{ background: 'rgba(8,8,12,0.94)', height, flexShrink: 0, boxShadow: 'none' }}>
      <div className="flex items-center gap-2 px-3 h-full">
        <span className={cn(
          'text-[8.5px] font-bold tracking-widest uppercase flex-shrink-0 select-none',
          hasContent ? 'text-indigo-300' : 'text-white/20',
        )}>
          Next ▸
        </span>

        <div
          ref={scrollRef}
          className="flex items-center flex-1 overflow-x-auto overflow-y-hidden"
          style={{ scrollbarWidth: 'none' }}
        >
          {!hasContent ? (
            <p className="text-[11px] text-white/25 italic whitespace-nowrap">Waiting for speech…</p>
          ) : (
            /* The tunnel — one color-coded container wrapping the whole queued group */
            <div
              className="flex items-center gap-1.5 px-2 py-1 rounded-xl flex-shrink-0"
              style={{
                background: 'rgba(99,102,241,0.10)',
                boxShadow: 'inset 0 0 0 1px rgba(99,102,241,0.28)',
                borderLeft: '3px solid #6366f1',
              }}
            >
              {queued.map((t) => (
                <span
                  key={t.id}
                  className="flex-shrink-0 max-w-[340px] truncate px-2.5 py-0.5 rounded-full text-[12px] leading-snug text-white"
                  style={{ background: 'rgba(255,255,255,0.10)' }}
                  title={t.text}
                >
                  {t.text}
                </span>
              ))}
              {partial && (
                <span className="flex-shrink-0 max-w-[340px] truncate px-1.5 text-[12px] leading-snug text-white/45 italic">
                  {partial}
                </span>
              )}
            </div>
          )}
        </div>

        <button
          onClick={onClear}
          className="overlay-btn h-6 px-2 text-[10px] gap-1 flex-shrink-0"
          title="Clear the queued transcript"
        >
          Clear <Kbd s="⌘⇧⌫" />
        </button>
      </div>
    </div>
  )
})

// ─── AnswerPanel — memo'd so only streaming tokens cause re-renders here ───────
interface AnswerPanelProps {
  isStreaming: boolean
  streaming: string
  qaPairs: QAPair[]
  currentQA: number
  pendingQuestion: string
  error: string | null
  copied: string | null
  onNavigatePrev: () => void
  onNavigateNext: (len: number) => void
  onClear: () => void
  onClose: () => void
  onCopy: (text: string, id?: string) => void
  onRegenerate: (q: string) => void
  onDismissError: () => void
}
const AnswerPanel = React.memo(function AnswerPanel({
  isStreaming, streaming, qaPairs, currentQA, pendingQuestion,
  error, copied,
  onNavigatePrev, onNavigateNext, onClear, onClose, onCopy, onRegenerate, onDismissError,
}: AnswerPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (streaming && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [streaming])

  const currentPair = currentQA >= 0 ? qaPairs[currentQA] : null
  const PANEL_BG: React.CSSProperties = { background: 'rgba(8,8,12,0.94)', backdropFilter: 'none' }

  // flex: 1 1 auto + min-height: 0 makes this the one panel that shrinks and
  // scrolls internally when the root container hits its max-height clamp —
  // toolbar/caption/chat above it stay fixed size (see their flexShrink: 0).
  return (
    <div className="anim-in overflow-hidden flex flex-col" style={{ ...PANEL_BG, flex: '1 1 auto', minHeight: 0, boxShadow: 'none' }}>
      {/* Nav row */}
      <div className="flex items-center gap-1.5 px-2.5 h-9 flex-shrink-0"
           style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)' }}>
        <IBtn onClick={onNavigatePrev} disabled={currentQA <= 0}
              className="h-6 w-6 hover:bg-white/10 hover:text-white text-white/60">
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
          </svg>
        </IBtn>
        <IBtn onClick={() => onNavigateNext(qaPairs.length)} disabled={currentQA >= qaPairs.length - 1}
              className="h-6 w-6 hover:bg-white/10 hover:text-white text-white/60">
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
          </svg>
        </IBtn>
        {qaPairs.length > 0 && (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[9.5px] font-semibold tracking-wide"
                style={{ background: 'rgba(255,255,255,0.07)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.1)' }}>
            <span className="text-white/70">{currentQA + 1}</span>
            <span className="text-white/25">/</span>
            <span className="text-white/40">{qaPairs.length}</span>
            <span className="text-white/30 ml-0.5">Q&A</span>
          </span>
        )}
        {error && (
          <span className="text-red-400 text-[10.5px] truncate flex-1 mx-2">{error}
            <button onClick={onDismissError} className="ml-1 opacity-50 hover:opacity-100">✕</button>
          </span>
        )}
        <div className="flex-1" />
        {currentPair && !isStreaming && (
          <>
            <IBtn onClick={() => onCopy(currentPair.answer, 'nav')} title="Copy answer"
                  className={cn('h-6 w-6 transition-colors', copied === 'nav' ? 'text-green-400' : 'hover:text-green-300 hover:bg-green-500/10')}>
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </IBtn>
            <IBtn onClick={() => onRegenerate(currentPair.question)} title="Re-generate"
                  className="h-6 w-6 hover:text-indigo-300 hover:bg-indigo-500/10 transition-colors">
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </IBtn>
          </>
        )}
        <button onClick={onClear} className="overlay-btn h-6 px-2 text-[10px]">Clear</button>
        <IBtn onClick={onClose} className="h-6 w-6">
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </IBtn>
      </div>

      {/* Q&A content */}
      <div ref={scrollRef} className="px-3 pt-2.5 pb-4 overflow-y-auto space-y-3 flex-1"
           style={{ minHeight: 0, scrollbarWidth: 'none' }}>
        {(isStreaming || streaming) ? (
          <>
            {pendingQuestion && (
              <div className="rounded-xl px-3 py-2.5" style={{ background: 'rgba(99,102,241,0.08)', boxShadow: 'inset 0 0 0 1px rgba(99,102,241,0.18)' }}>
                <span className="text-[9.5px] font-bold tracking-widest uppercase text-indigo-400/60 block mb-1">Question</span>
                <p className="text-[12.5px] text-white/80 leading-relaxed font-medium">{pendingQuestion}</p>
              </div>
            )}
            <div className="flex gap-2">
              <span className="text-[14px] leading-none mt-0.5 flex-shrink-0">⭐</span>
              <p className="text-[13.5px] text-white/82 leading-relaxed whitespace-pre-wrap flex-1 min-w-0">
                {streaming}
                {isStreaming && !streaming && <span className="text-white/35 text-[11px]">Thinking…</span>}
                {isStreaming && <span className="inline-block h-3.5 w-0.5 bg-green-400 cursor-blink ml-0.5 align-middle rounded-full" />}
              </p>
            </div>
          </>
        ) : currentPair ? (
          <>
            <div className="rounded-xl px-3 py-2.5" style={{ background: 'rgba(99,102,241,0.08)', boxShadow: 'inset 0 0 0 1px rgba(99,102,241,0.18)' }}>
              <span className="text-[9.5px] font-bold tracking-widest uppercase text-indigo-400/60 block mb-1">Question</span>
              <p className="text-[12.5px] text-white/80 leading-relaxed font-medium">{currentPair.question}</p>
            </div>
            <div className="flex gap-2">
              <span className="text-[14px] leading-none mt-0.5 flex-shrink-0">⭐</span>
              <div className="flex-1 min-w-0"><AnswerText content={currentPair.answer} /></div>
            </div>
            <div className="flex items-center justify-between pt-1" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
              <span className="text-[9.5px] text-white/20 font-mono">
                {currentPair.ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              <button onClick={() => onCopy(currentPair.answer, 'footer')}
                      className={cn('text-[9.5px] transition-colors flex items-center gap-1', copied === 'footer' ? 'text-green-400' : 'text-white/25 hover:text-green-300')}>
                <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                {copied === 'footer' ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-20 text-white/20">
            <p className="text-[11px]">Press Answer or speak — AI response appears here</p>
          </div>
        )}
      </div>
    </div>
  )
})

// ─── ToolbarBar — memo'd so streaming/transcript/timer don't re-render it ──────
interface ToolbarBarProps {
  companyName: string; sessionMode: string
  isRunning: boolean; micOn: boolean; sysOn: boolean; audioLevel: number
  smState: SmConnectionState
  showChat: boolean; showAnswer: boolean; showSettings: boolean
  qaPairsCount: number
  timerStartSeconds: number | null; timerKey: number; sessionTimerMode: string
  onTimerExpire: () => void; isStreaming: boolean
  onToggleMic: () => void; onToggleSys: () => void
  onAnswer: () => void; onScreenshot: (sendNow?: boolean) => void
  onToggleChat: () => void; onSettingsClick: (r: DOMRect) => void
  onHide: () => void
  aiModel: AIModel
}
const ToolbarBar = React.memo(function ToolbarBar(p: ToolbarBarProps) {
  const isMicActive = p.isRunning && p.micOn
  const isSysActive = p.isRunning && p.sysOn
  const PANEL_BG: React.CSSProperties = { background: 'rgba(8,8,12,0.94)', backdropFilter: 'none' }

  return (
    <>
      <div
        className="flex items-center gap-1.5 px-2.5 select-none"
        style={{ ...PANEL_BG, borderRadius: 0, height: TOOLBAR_H, flexShrink: 0 }}
      >
        {/* Logo + company name + session badge + model */}
        <div className="flex items-center gap-1.5 flex-shrink-0 min-w-0">
          <div className="h-5 w-5 rounded-lg flex items-center justify-center flex-shrink-0"
               style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', boxShadow: '0 2px 6px rgba(99,102,241,0.35)' }}>
            <span className="text-white font-black text-[8.5px] tracking-tight">IA</span>
          </div>
          <span className="text-white/50 text-[10px] font-medium truncate max-w-[100px]" title={p.companyName}>{p.companyName}</span>
          <span className={cn('text-[8px] font-semibold px-1 py-0.5 rounded-full flex-shrink-0',
            p.sessionMode === 'FREE' ? 'text-indigo-300/60 bg-indigo-500/10' : 'text-violet-300/60 bg-violet-500/10')}>
            {p.sessionMode}
          </span>
          <span className="text-[8px] font-medium px-1 py-0.5 rounded-full flex-shrink-0 text-white/35 bg-white/6"
                title={`Active AI model: ${AI_MODEL_LABELS[p.aiModel] ?? p.aiModel}`}>
            {AI_MODEL_LABELS[p.aiModel] ?? p.aiModel}
          </span>
        </div>
        <Sep />
        {/* Audio indicators */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Audio-level indicator — display only, not a control */}
          <div title="Audio level" style={{ padding: '3px 4px' }}
               className="flex items-center justify-center rounded-lg">
            <WaveBars active={p.isRunning} level={p.audioLevel} />
          </div>
          <button onClick={p.onToggleSys}
                  title={p.sysOn ? 'System audio enabled — click to disable' : 'System audio disabled — click to enable'}
                  className={cn('relative flex items-center justify-center h-6 w-6 rounded-lg transition-all',
                    isSysActive ? 'text-red-400' : p.sysOn ? 'text-white/50 hover:text-white/80' : 'text-white/20 hover:text-white/50',
                    isSysActive && 'bg-red-500/10')}>
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            {p.sysOn && <Dot color={isSysActive ? 'red' : 'green'} />}
          </button>
          <span className="text-[9px] text-white/40 font-medium">System</span>
          <Sep />
          <button onClick={p.onToggleMic}
                  title={p.micOn ? 'Microphone enabled — click to disable' : 'Microphone disabled — click to enable'}
                  className={cn('relative flex items-center justify-center h-6 w-6 rounded-lg transition-all',
                    isMicActive ? 'text-red-400' : p.micOn ? 'text-white/50 hover:text-white/80' : 'text-white/20 hover:text-white/50',
                    isMicActive && 'bg-red-500/10')}>
            <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
            </svg>
            {p.micOn && <Dot color={isMicActive ? 'red' : 'green'} />}
          </button>
          <span className="text-[9px] text-white/40 font-medium">Mic</span>
        </div>
        <Sep />
        <AnswerBtn onClick={p.onAnswer} disabled={!p.isRunning} streaming={p.isStreaming} />
        <TBtn onClick={() => p.onScreenshot(true)}>
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Screenshot <Kbd s="⌘⇧↵" />
        </TBtn>
        <TBtn active={p.showChat} onClick={p.onToggleChat}>
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
          Chat <Kbd s="⌘⇧—" />
          {p.showAnswer && p.qaPairsCount > 0 && (
            <span className="ml-0.5 h-4 min-w-[16px] px-1 rounded-full bg-green-500/80 text-white text-[8px] font-bold flex items-center justify-center">
              {p.qaPairsCount}
            </span>
          )}
        </TBtn>
        <div className="flex-1" />
        <SessionTimer key={p.timerKey} startSeconds={p.timerStartSeconds} onExpire={p.onTimerExpire} mode={p.sessionTimerMode} timerKey={p.timerKey} />
        {/* Status pill */}
        {(() => {
          let label: string; let bg: string; let color: string; let ring: string; let dotColor: string
          if (p.isStreaming) {
            label = 'Answering'; bg = 'rgba(99,102,241,0.14)'; color = '#a5b4fc'; ring = 'rgba(99,102,241,0.28)'; dotColor = '#818cf8'
          } else if (p.isRunning && p.smState === 'connected') {
            label = 'Listening'; bg = 'rgba(34,197,94,0.12)'; color = '#86efac'; ring = 'rgba(34,197,94,0.25)'; dotColor = '#4ade80'
          } else if (p.isRunning && p.smState === 'connecting') {
            label = 'Connecting'; bg = 'rgba(251,146,60,0.12)'; color = '#fdba74'; ring = 'rgba(251,146,60,0.22)'; dotColor = '#fb923c'
          } else if (p.isRunning && p.smState === 'error') {
            label = 'Error'; bg = 'rgba(239,68,68,0.12)'; color = '#fca5a5'; ring = 'rgba(239,68,68,0.22)'; dotColor = '#f87171'
          } else {
            label = 'Ready'; bg = 'rgba(255,255,255,0.07)'; color = 'rgba(255,255,255,0.45)'; ring = 'rgba(255,255,255,0.12)'; dotColor = 'rgba(255,255,255,0.3)'
          }
          return (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-semibold flex-shrink-0"
                 style={{ background: bg, color, boxShadow: `inset 0 0 0 1px ${ring}`, minWidth: 76 }}>
              <span className="h-1.5 w-1.5 rounded-full flex-shrink-0"
                    style={{ background: dotColor, animation: (p.isRunning && p.smState === 'connected') || p.isStreaming ? 'pulse 1.5s ease-in-out infinite' : 'none' }} />
              {label}
            </div>
          )
        })()}
        <IBtn title={p.showSettings ? 'Close menu' : 'Menu'}
              onClickWithRect={p.onSettingsClick}
              className={p.showSettings ? 'bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-400/30' : ''}>
          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
            <path d="M10 4a2 2 0 100 4 2 2 0 000-4zM10 8a2 2 0 100 4 2 2 0 000-4zM10 12a2 2 0 100 4 2 2 0 000-4z" />
          </svg>
        </IBtn>
        <IBtn title="Hide to logo" onClick={p.onHide}>
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
          </svg>
        </IBtn>
      </div>
    </>
  )
})

// ─── Inline markdown: **bold**, *italic*, `code` ─────────────────────────────
function InlineText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g)
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**'))
          return <strong key={i} className="text-white font-semibold">{part.slice(2, -2)}</strong>
        if (part.startsWith('*') && part.endsWith('*'))
          return <em key={i} className="text-white/75 italic">{part.slice(1, -1)}</em>
        if (part.startsWith('`') && part.endsWith('`'))
          return (
            <code key={i} className="font-mono text-[11px] text-green-200/80 px-1 py-0.5 rounded-md"
                  style={{ background: 'rgba(34,197,94,0.1)' }}>
              {part.slice(1, -1)}
            </code>
          )
        return <React.Fragment key={i}>{part}</React.Fragment>
      })}
    </>
  )
}

// ─── Block-level markdown parser (headings, lists, MCQ options, paragraphs) ──
function TextBlocks({ text }: { text: string }) {
  const blocks: React.ReactNode[] = []
  const lines = text.split('\n')
  let listItems: string[] = []
  let listType: 'ul' | 'ol' | 'mcq' | null = null
  let key = 0

  const flushList = () => {
    if (!listItems.length) return
    if (listType === 'mcq') {
      blocks.push(
        <div key={key++} className="space-y-1.5 my-2">
          {listItems.map((item, j) => {
            const letter = String.fromCharCode(65 + j) // A, B, C…
            const isCorrect = /^\*\*/.test(item)
            const clean = item.replace(/^\*\*|\*\*$/g, '')
            return (
              <div key={j} className={cn(
                'flex gap-2.5 px-3 py-2 rounded-xl text-[13px] leading-snug transition-colors',
                isCorrect
                  ? 'bg-green-500/12 ring-1 ring-green-400/25 text-white'
                  : 'bg-white/4 text-white/70',
              )}>
                <span className={cn(
                  'flex-shrink-0 h-5 w-5 rounded-lg text-[11px] font-bold flex items-center justify-center',
                  isCorrect ? 'bg-green-500/30 text-green-300' : 'bg-white/8 text-white/40',
                )}>{letter}</span>
                <span><InlineText text={clean} /></span>
                {isCorrect && <span className="ml-auto text-green-400 text-[11px] flex-shrink-0">✓</span>}
              </div>
            )
          })}
        </div>
      )
    } else if (listType === 'ul') {
      blocks.push(
        <ul key={key++} className="space-y-1 my-1.5">
          {listItems.map((item, j) => (
            <li key={j} className="flex gap-2 text-[13px] text-white/82 leading-relaxed">
              <span className="text-indigo-400 flex-shrink-0 mt-0.5 text-[10px]">◆</span>
              <span><InlineText text={item} /></span>
            </li>
          ))}
        </ul>
      )
    } else {
      blocks.push(
        <ol key={key++} className="space-y-1 my-1.5">
          {listItems.map((item, j) => (
            <li key={j} className="flex gap-2 text-[13px] text-white/82 leading-relaxed">
              <span className="text-indigo-400/70 flex-shrink-0 font-mono text-[11px] mt-0.5 w-4 text-right">{j + 1}.</span>
              <span><InlineText text={item} /></span>
            </li>
          ))}
        </ol>
      )
    }
    listItems = []; listType = null
  }

  for (const line of lines) {
    const t = line.trim()
    if (!t) { flushList(); continue }

    const h3m = t.match(/^###\s+(.+)/); const h2m = t.match(/^##\s+(.+)/); const h1m = t.match(/^#\s+(.+)/)
    if (h3m || h2m || h1m) {
      flushList()
      const txt = (h3m || h2m || h1m)![1]
      const cls = h3m ? 'text-[12.5px] font-semibold text-white/80' : h2m ? 'text-[13px] font-bold text-white/85' : 'text-[14px] font-bold text-white/90'
      blocks.push(<p key={key++} className={`${cls} leading-snug mt-2 mb-0.5`}><InlineText text={txt} /></p>)
      continue
    }

    // Multiple-choice: A) … / B) … / a) … — or checkbox - [ ] / - [x]
    const mcq = t.match(/^([A-Da-d][).]\s+.+|- \[[ x]\]\s+.+)/)
    if (mcq) {
      if (listType !== 'mcq') flushList(); listType = 'mcq'
      const checkbox = t.match(/^- \[x\]\s+(.+)/i)
      const checkboxEmpty = t.match(/^- \[ \]\s+(.+)/)
      const letter = t.match(/^[A-Da-d][).]\s+(.+)/)
      if (checkbox) listItems.push(`**${checkbox[1]}**`)
      else if (checkboxEmpty) listItems.push(checkboxEmpty[1])
      else if (letter) listItems.push(letter[1])
      continue
    }

    const bullet = t.match(/^[-*]\s+(.+)/)
    if (bullet) {
      if (listType === 'ol' || listType === 'mcq') flushList(); listType = 'ul'; listItems.push(bullet[1]); continue
    }

    const num = t.match(/^\d+\.\s+(.+)/)
    if (num) {
      if (listType === 'ul' || listType === 'mcq') flushList(); listType = 'ol'; listItems.push(num[1]); continue
    }

    flushList()
    blocks.push(<p key={key++} className="text-[13px] text-white/82 leading-relaxed"><InlineText text={t} /></p>)
  }
  flushList()
  return <>{blocks}</>
}

// ─── AnswerText — markdown-aware renderer ────────────────────────────────────
function AnswerText({ content }: { content: string }) {
  const segments = content.split(/(```[\s\S]*?```)/g)
  return (
    <div className="space-y-1.5">
      {segments.map((seg, i) => {
        if (seg.startsWith('```')) {
          const inner = seg.slice(3, -3)
          const nlIdx = inner.indexOf('\n')
          const lang  = nlIdx > 0 ? inner.slice(0, nlIdx).trim() : ''
          const code  = nlIdx >= 0 ? inner.slice(nlIdx + 1) : inner
          return (
            <div key={i} className="rounded-xl overflow-hidden"
                 style={{ background: 'rgba(255,255,255,0.04)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.07)' }}>
              {lang && (
                <div className="px-3 py-1 text-[9px] text-white/30 font-mono uppercase tracking-wider"
                     style={{ boxShadow: 'inset 0 -1px 0 rgba(255,255,255,0.06)' }}>{lang}</div>
              )}
              <pre className="px-3 py-2.5 text-[11px] font-mono text-green-200/75 overflow-x-auto whitespace-pre leading-relaxed">{code}</pre>
            </div>
          )
        }
        return <TextBlocks key={i} text={seg} />
      })}
    </div>
  )
}
