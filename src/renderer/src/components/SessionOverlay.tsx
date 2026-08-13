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
import hljs from 'highlight.js'
import 'highlight.js/styles/atom-one-dark.css'
import logoSrc from '../assets/logo.png'
import { cn } from '@/lib/utils'
import { SESSION_PING_MS, TRANSCRIPT_SAVE_MS, SILENCE_TRIGGER_MS, AI_MODEL_LABELS, MODELS } from '@/config'
import {
  getSpeechmaticsJwt, updateSessionStatus, saveTranscriptions, pingSession, extendSession,
  updateSessionModel, heartbeatSession,
} from '@/lib/api'
import { FRONTEND_URL } from '@/config'
import { useSpeechmatics } from '@/hooks/useSpeechmatics'
import { useSystemAudio }  from '@/hooks/useSystemAudio'
import { MicSelector, type AudioDevice } from '@/components/MicSelector'
import { useAIStream }     from '@/hooks/useAIStream'
import { useNetworkStatus } from '@/hooks/useNetworkStatus'
import type { AIModel, CallSession, TranscriptEntry, SmConnectionState, AudioSource } from '@/types'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2) }

interface QAPair { id: string; question: string; answer: string; ts: Date }

// Electron window heights
const TOOLBAR_H  = 48
const MODAL_H    = 320
// Popover sizing/position all live in main now (popover:* IPC, its own
// BrowserWindow, positionPopoverWindow) — nothing left to track here.

// Answer/transcript/chat text size — user-adjustable via the popover's
// "Text Size" row, persisted independently of the Zoom control (which scales
// the whole overlay chrome, not just reading text).
const FONT_SIZE_MIN     = 11
const FONT_SIZE_MAX     = 20
const FONT_SIZE_DEFAULT = 14
// Matches the backend's hard cap (chat.ts: z.array(...).max(5)) — enforcing
// it client-side means the 6th screenshot gets a clear "max 5" toast
// instead of silently failing the entire send once it hits the backend.
const MAX_SCREENSHOTS = 5

/** Maps the active audio toggle state to the Speaker enum the backend
 *  already has (Transcription.speaker: MIC | SYSTEM) — mic is the
 *  candidate's own voice, system is whatever the OS is playing (typically
 *  the interviewer, arriving via the call app's audio). 'both' can't be
 *  disambiguated after useSystemAudio's mono mixdown (mic + system audio
 *  are merged into one channel before Speechmatics ever sees it), so it's
 *  tagged SYSTEM — the more useful side to have correctly labeled, and the
 *  existing default so single-source sessions (the common case: mic starts
 *  OFF) see no behavior change from this fix. */
function speakerForAudioSrc(src: AudioSource): 'MIC' | 'SYSTEM' {
  return src === 'mic' ? 'MIC' : 'SYSTEM'
}

// ─── Tiny shared components ───────────────────────────────────────────────────

function Kbd({ s }: { s: string }) {
  return <span className="text-white text-[10px] font-mono ml-0.5" style={{ opacity: 0.5 }}>{s}</span>
}

function Sep() {
  return <div className="flex-shrink-0" style={{ width: 1, height: 15, background: 'rgba(255,255,255,0.08)', margin: '0 2px' }} />
}

/** Bold collapse chevron — heavier and larger than a plain "∧" glyph */
function ChevronUp() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <polyline points="2,10 7,4 12,10" stroke="rgba(255,255,255,0.85)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * Toolbar logo — an animated equalizer/waveform in place of a static "IA"
 * mark. Bars bounce (CSS keyframes, staggered delay/duration per bar so they
 * don't move in lockstep) while `active` — i.e. mic or system audio is
 * actually on — and freeze at mid-height otherwise.
 */
// Each bar gets its own min/max height range, delay, and keyframe name —
// the asymmetric heights (10/14/16/10) plus staggered delays are what make
// four bars read as a natural equalizer instead of four bars in lockstep.
const EQ_BARS = [
  { min: 3, max: 14, delay: 0,     duration: 0.9 },
  { min: 3, max: 10, delay: 0.15,  duration: 0.7 },
  { min: 3, max: 16, delay: 0.075, duration: 1.0 },
  { min: 3, max: 10, delay: 0.225, duration: 0.8 },
]
const EQ_BAR_STATIC_H = 8

/**
 * Bare animated equalizer bars — ghost/frosted-glass style, no container.
 * Exported so the collapsed mini-bar pill (App.tsx) can reuse the exact same
 * icon+animation without the toolbar's gradient-square backing.
 */
export function WaveformBars({ active }: { active: boolean }) {
  return (
    <div className="flex items-end" style={{ gap: 2, height: 16 }}>
      <style>{`
        ${EQ_BARS.map((b, i) => `
          @keyframes eqBar${i} {
            0%, 100% { height: ${b.min}px; }
            50% { height: ${b.max}px; }
          }
        `).join('')}
      `}</style>
      {EQ_BARS.map((b, i) => (
        <div
          key={i}
          style={{
            width: 2,
            borderRadius: 2,
            height: active ? undefined : EQ_BAR_STATIC_H,
            background: active ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.35)',
            animation: active ? `eqBar${i} ${b.duration}s ease-in-out ${b.delay}s infinite` : 'none',
            transition: 'height 0.2s ease, background-color 0.2s ease',
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
      className="absolute -top-[1px] -right-[1px] rounded-full"
      style={{
        width: 5, height: 5,
        background: color === 'red' ? '#ef4444' : '#22c55e',
        boxShadow: '0 0 0 1.5px rgba(10,10,14,0.9)',
      }}
    />
  )
}

/** Tooltip — uses a separate BrowserWindow (tooltipWindow) positioned in real
 *  screen coordinates so it can never be clipped by the app window bounds.
 *  flipped=true (bottom snap positions) → tooltip opens ABOVE the element.
 *  flipped=false (top snap positions) → tooltip opens BELOW the element. */
function Tooltip({ text, children, flipped = false }: { text: string; children: React.ReactNode; flipped?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div
      ref={ref}
      onMouseEnter={() => {
        const rect = ref.current?.getBoundingClientRect()
        if (rect) {
          window.electronAPI.tooltip.show({
            text,
            x: rect.left + rect.width / 2,
            y: flipped ? rect.top : rect.bottom,
            below: !flipped,
          })
        }
      }}
      onMouseLeave={() => window.electronAPI.tooltip.hide()}
      style={{ display: 'inline-flex' }}
    >
      {children}
    </div>
  )
}

/** Primary answer button — Option D design spec */
function AnswerBtn({ disabled, onClick, streaming }: { disabled?: boolean; onClick: () => void; streaming?: boolean }) {
  return (
    <button
      onClick={() => onClick()}
      disabled={disabled}
      className={cn(
        'flex items-center justify-center gap-1.5 select-none transition-all',
        'disabled:opacity-30 disabled:cursor-not-allowed text-white',
        streaming ? 'cursor-wait' : 'active:scale-[0.98]',
      )}
      style={{
        background: '#16a34a',
        padding: '7px 18px',
        borderRadius: 7,
        fontWeight: 500,
        fontSize: 14,
        flexShrink: 0,
      }}
      onMouseOver={(e) => { if (!disabled && !streaming) e.currentTarget.style.background = '#15803d' }}
      onMouseOut={(e) => { e.currentTarget.style.background = '#16a34a' }}
    >
      {streaming ? (
        <svg style={{ width: 17, height: 17 }} className="animate-spin opacity-70" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3.5" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : (
        <svg style={{ width: 17, height: 17 }} fill="currentColor" viewBox="0 0 20 20">
          <path d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" />
        </svg>
      )}
      Answer
      <span style={{ fontFamily: 'monospace', fontSize: 10, opacity: 0.5 }}>⌘↵</span>
    </button>
  )
}

/** Toolbar button — spec hover: bg rgba(255,255,255,0.07), color 0.9, radius 6px */
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
        'flex items-center gap-1 select-none transition-all flex-shrink-0',
        'disabled:opacity-25 disabled:cursor-not-allowed',
      )}
      style={{
        padding: '4px 7px',
        borderRadius: 6,
        color: active ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.65)',
        background: active ? 'rgba(255,255,255,0.1)' : 'transparent',
      }}
      onMouseOver={(e) => { if (!active) { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; e.currentTarget.style.color = 'rgba(255,255,255,0.9)' } }}
      onMouseOut={(e) => { if (!active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.65)' } }}
    >
      {children}
    </button>
  )
}

/** Icon-only toolbar button */
function IBtn({
  onClick, children, className = '',
  onClickWithRect, disabled = false,
}: {
  onClick?: () => void
  children: React.ReactNode
  className?: string
  disabled?: boolean
  onClickWithRect?: (rect: DOMRect) => void
}) {
  return (
    <button
      disabled={disabled}
      onClick={(e) => {
        if (disabled) return
        if (onClickWithRect) {
          e.stopPropagation()
          onClickWithRect(e.currentTarget.getBoundingClientRect())
        } else {
          onClick?.()
        }
      }}
      className={cn(
        'flex items-center justify-center select-none transition-all',
        disabled && 'opacity-25 cursor-not-allowed pointer-events-none',
        className,
      )}
      style={{ padding: '4px 7px', borderRadius: 6, color: 'rgba(255,255,255,0.65)' }}
      onMouseOver={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; e.currentTarget.style.color = 'rgba(255,255,255,0.9)' }}
      onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.65)' }}
    >
      {children}
    </button>
  )
}

// ─── ":" menu contents — rendered inside the settings popover window ────────
const LANGUAGES: Array<[string, string]> = [
  ['en', 'English'], ['hi', 'Hindi'], ['te', 'Telugu'], ['ta', 'Tamil'],
  ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['zh', 'Chinese'],
  ['ja', 'Japanese'], ['ko', 'Korean'], ['ar', 'Arabic'], ['pt', 'Portuguese'],
]

function SettingsPanel({
  userEmail, zoom, opacity, autoGen, autoDetect, privateMode, language,
  extraContext, aiModel, snapPos, fontSize,
  onZoom, onZoomReset, onOpacity, onOpacityReset,
  onAutoGen, onAutoDetect, onPrivate, onLanguage,
  onExtraContext, onModelChange, onMove, onExit, onEnd, onClose, onFontSize,
}: {
  userEmail?: string
  zoom: number; opacity: number; autoGen: boolean; autoDetect: boolean
  privateMode: boolean; language: string
  extraContext: string; aiModel: AIModel; snapPos: SnapPos; fontSize: number
  onZoom: (d: number) => void; onZoomReset: () => void
  onOpacity: (d: number) => void; onOpacityReset: () => void
  onAutoGen: (v: boolean) => void; onAutoDetect: (v: boolean) => void
  onPrivate: (v: boolean) => void; onLanguage: (lang: string) => void
  onExtraContext: (v: string) => void
  onModelChange: (m: AIModel) => void; onMove: (p: SnapPos) => void
  onExit: () => void; onEnd: () => void; onClose: () => void
  onFontSize: (size: number) => void
}) {
  // 1px hairline divider with a tight 4px margin (space above the line only —
  // each row supplies its own 6px py-1.5 below it) instead of a padded shadow
  // strip — matches the "macOS menu bar" density the compact redesign wants.
  const rowDivider = { borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: 4 }

  const [displays, setDisplays] = useState<Array<{ id: number; label: string; isPrimary: boolean }>>([])
  const [currentDisplayId, setCurrentDisplayId] = useState<number | null>(null)
  useEffect(() => {
    let cancelled = false
    const refresh = () => {
      window.electronAPI.window.getDisplays().then(({ displays, currentId }) => {
        if (cancelled) return
        setDisplays(displays)
        setCurrentDisplayId(currentId)
      }).catch(() => {})
    }
    refresh()
    // A monitor plugged/unplugged while this popover happens to be open
    // would otherwise leave the list stale until it's closed and reopened.
    const unsub = window.electronAPI.on('display:list-changed', refresh)
    return () => { cancelled = true; unsub() }
  }, [])

  return (
    <div
      className="anim-in"
      style={{
        background: 'rgba(10,10,16,0.97)',
        backdropFilter: 'none',
      }}
    >
      {/* Header — account email (read-only) + close. Fixed, does not scroll. */}
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-[12px] text-white/55 font-medium truncate max-w-[200px]" title={userEmail}>
          {userEmail ?? 'Signed in'}
        </span>
        <button
          onMouseDown={(e) => { e.preventDefault(); onClose() }}
          className="text-[12px] text-white/30 hover:text-white/70 transition-colors px-2 h-5 rounded-md hover:bg-white/8 flex items-center gap-1 flex-shrink-0"
          style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)' }}
        >
          ✕
        </button>
      </div>

      {/* Body — no maxHeight/scroll of its own: the popover window (see main
          process positionPopoverWindow) sizes itself to fit this content's
          real natural height exactly, so nothing here should ever need to
          scroll internally. The outer SettingsPopoverWindow wrapper still
          carries a scroll fallback for the rare case a screen is too short
          to fit the whole menu even at the edges. */}
      <div className="px-3 pb-1.5">
        {/* Dashboard */}
        <div style={rowDivider}>
          <button
            onClick={() => { window.electronAPI.shell.openExternal(`${FRONTEND_URL}/dashboard`); onClose() }}
            className="w-full text-left text-[12px] text-white/55 hover:text-indigo-300 transition-colors flex items-center gap-1.5 py-1.5"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            Dashboard
          </button>
        </div>

        {/* ROW 1: Private | Auto-detect — side by side, 50/50 */}
        <div className="grid grid-cols-2" style={rowDivider}>
          <div className="flex items-center justify-between py-1.5 pr-2"
               style={{ borderRight: '1px solid rgba(255,255,255,0.08)' }}>
            <span className="text-[12px] text-white/35" title="Hide the overlay from screen shares and recordings">Private</span>
            <Toggle checked={privateMode} onChange={() => onPrivate(!privateMode)} />
          </div>
          <div className="flex items-center justify-between py-1.5 pl-2">
            <span className="text-[12px] text-white/35" title="Detect questions from the live transcript">Auto-detect</span>
            <Toggle checked={autoDetect} onChange={() => onAutoDetect(!autoDetect)} />
          </div>
        </div>

        {/* ROW 2: Zoom | Opacity — side by side, 50/50. Reset collapses to a
            ↺ icon button (matching the −/+ steppers) so it fits the half-width
            column instead of the old full-width text button. */}
        <div className="grid grid-cols-2" style={rowDivider}>
          <div className="flex items-center gap-1 py-1.5 pr-2"
               style={{ borderRight: '1px solid rgba(255,255,255,0.08)' }}>
            <span className="text-[11px] text-white/35 flex-shrink-0">Zoom</span>
            <MiniBtn onClick={() => onZoom(-0.1)}>−</MiniBtn>
            <span className="text-[11px] text-white/50 flex-1 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
            <MiniBtn onClick={() => onZoom(+0.1)}>+</MiniBtn>
            <MiniBtn onClick={onZoomReset}>↺</MiniBtn>
          </div>
          <div className="flex items-center gap-1 py-1.5 pl-2">
            <span className="text-[11px] text-white/35 flex-shrink-0">Opacity</span>
            <MiniBtn onClick={() => onOpacity(-0.1)}>−</MiniBtn>
            <span className="text-[11px] text-white/50 flex-1 text-center tabular-nums">{Math.round(opacity * 100)}%</span>
            <MiniBtn onClick={() => onOpacity(+0.1)}>+</MiniBtn>
            <MiniBtn onClick={onOpacityReset}>↺</MiniBtn>
          </div>
        </div>

        {/* Language */}
        <div className="flex items-center gap-3 py-1.5" style={rowDivider}>
          <span className="text-[12px] text-white/35 flex-shrink-0 w-14">Language</span>
          <select
            value={language}
            onChange={(e) => onLanguage(e.target.value)}
            className="flex-1 px-2 py-1 rounded-lg text-[12px] outline-none cursor-pointer"
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
        <div className="flex items-center justify-between py-1.5" style={rowDivider}>
          <span className="text-[12px] text-white/35" title="Automatically send detected questions to the AI (requires Auto-detect)">Auto Generate</span>
          <Toggle checked={autoGen} onChange={() => onAutoGen(!autoGen)} />
        </div>

        {/* Model — compact dropdown */}
        <div className="flex items-center justify-between py-1.5" style={rowDivider}>
          <span className="text-[12px] text-white/35 flex-shrink-0 w-14">Model</span>
          <select
            value={aiModel}
            onChange={(e) => onModelChange(e.target.value as AIModel)}
            style={{
              flex: 1, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 6, color: '#fff', fontSize: 12, padding: '4px 6px', cursor: 'pointer',
            }}
          >
            <optgroup label="Paid Models" style={{ background: '#12121e' }}>
              {MODELS.filter((m) => !m.free).map((m) => (
                <option key={m.id} value={m.id} style={{ background: '#12121e' }}>{m.name}</option>
              ))}
            </optgroup>
            <optgroup label="Free Models (NVIDIA)" style={{ background: '#12121e' }}>
              {MODELS.filter((m) => m.free).map((m) => (
                <option key={m.id} value={m.id} style={{ background: '#12121e' }}>{m.name} — FREE</option>
              ))}
            </optgroup>
          </select>
        </div>

        {/* Text Size — controls the answer/transcript/chat reading text size,
            independent of Zoom (which scales the whole overlay chrome). */}
        <div className="flex items-center gap-3 py-1.5" style={rowDivider}>
          <span className="text-[12px] text-white/35 flex-shrink-0 w-14">Text Size</span>
          <div className="flex items-center gap-1 flex-1">
            <MiniBtn onClick={() => onFontSize(Math.max(FONT_SIZE_MIN, fontSize - 1))}>A−</MiniBtn>
            <span className="text-[11px] text-white/50 flex-1 text-center tabular-nums">{fontSize}px</span>
            <MiniBtn onClick={() => onFontSize(Math.min(FONT_SIZE_MAX, fontSize + 1))}>A+</MiniBtn>
          </div>
        </div>

        {/* Position — 24×24 cells, 3px gap, reading like the screen */}
        <div className="flex items-center gap-3 py-1.5" style={rowDivider}>
          <span className="text-[12px] text-white/35 flex-shrink-0 w-14">Position</span>
          <PositionGrid snapPos={snapPos} onMove={onMove} onAfterMove={onClose} />
        </div>

        {/* Screen — move the app to a different monitor (multi-monitor only) */}
        <div className="flex items-center gap-3 py-1.5" style={rowDivider}>
          <span className="text-[12px] text-white/35 flex-shrink-0 w-14">Screen</span>
          {displays.length <= 1 ? (
            <span className="text-[11px] text-white/25">Single Display</span>
          ) : (
            <div className="flex flex-wrap gap-1 flex-1 min-w-0">
              {displays.map((d) => (
                <button key={d.id}
                  onClick={() => { void window.electronAPI.window.moveToDisplay(d.id); setCurrentDisplayId(d.id); window.electronAPI.popover.hide() }}
                  title={d.label}
                  className={cn('px-2 py-1 rounded-lg text-[10px] font-medium transition-all truncate max-w-[110px]',
                    d.id === currentDisplayId
                      ? 'bg-indigo-500/25 text-indigo-300 ring-1 ring-indigo-400/30'
                      : 'text-white/40 hover:text-white/70 hover:bg-white/8')}>
                  {d.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Extra context */}
        <div className="flex flex-col gap-1 py-1.5" style={rowDivider}>
          <span className="text-[12px] text-white/30">Context</span>
          <input
            value={extraContext}
            onChange={(e) => onExtraContext(e.target.value)}
            placeholder="Extra context for AI (role, notes, company info…)"
            className="px-2.5 py-1.5 rounded-lg text-[12px] outline-none"
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
        <div className="flex items-center justify-between py-1.5" style={rowDivider}>
          <button
            onClick={() => { onClose(); onExit() }}
            title="Hide the overlay to the mini logo — session keeps running (and billing) in the background"
            className="text-[12px] text-white/55 hover:text-white transition-colors px-2 py-1 rounded-lg hover:bg-white/8 flex items-center gap-1.5"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            Exit
          </button>
          <button
            onClick={() => { onEnd(); onClose() }}
            title="Stop everything and end the session"
            className="text-[12px] text-red-400/70 hover:text-red-400 transition-colors px-2 py-1 rounded-lg hover:bg-red-500/10"
          >
            End Session
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── SettingsPopoverWindow — rendered instead of <App/> when this same
// renderer bundle is loaded with ?view=popover (see main.tsx and main
// process createPopoverWindow). This is a SEPARATE BrowserWindow, positioned
// by main in real screen coordinates, so it can never be clipped by or
// resize the main window — the entire reason this exists (see the many
// rounds of position:fixed-portal fighting this used to replace).
//
// State here is a local, optimistic mirror of the main window's settings
// (applied immediately for a responsive feel), refreshed from a fresh
// snapshot every time the popover opens. Every change is ALSO dispatched
// back to the main window via popover:action — several of these settings
// have real side effects (ending the session, an API call to change the AI
// model, reconnecting Speechmatics on language change) that only exist in
// the main window's own hooks and cannot run in this separate renderer at all.
interface PopoverSettings {
  userEmail?: string
  zoom: number; opacity: number; autoGen: boolean; autoDetect: boolean
  privateMode: boolean; language: string
  extraContext: string; aiModel: AIModel; snapPos: SnapPos; fontSize: number
  _mode?: 'settings' | 'model-picker'
}
const DEFAULT_POPOVER_SETTINGS: PopoverSettings = {
  zoom: 1, opacity: 0.65, autoGen: true, autoDetect: true, privateMode: false,
  language: 'en', extraContext: '', aiModel: 'GPT4O', snapPos: 'top-center', fontSize: FONT_SIZE_DEFAULT,
}
export function SettingsPopoverWindow() {
  const [settings, setSettings] = useState<PopoverSettings>(DEFAULT_POPOVER_SETTINGS)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    return window.electronAPI.on('popover:settings', (s: unknown) => setSettings(s as PopoverSettings))
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') window.electronAPI.popover.hide() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // Reports real rendered height to main, which resizes the window to fit
  // it exactly (see main's positionPopoverWindow, called from both
  // popover:show and popover:report-height) — scrollHeight (not
  // contentRect.height/clientHeight) is what correctly reflects the TRUE
  // natural content height even if this element's own box were ever
  // constrained, which clientHeight/contentRect would silently truncate.
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const h = rootRef.current?.scrollHeight ?? 0
      if (h > 0) window.electronAPI.popover.reportHeight(h)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const patch = (p: Partial<PopoverSettings>) => setSettings((s) => ({ ...s, ...p }))
  const send = (type: string, payload?: unknown) => window.electronAPI.popover.sendAction({ type, payload })
  const close = () => window.electronAPI.popover.hide()

  const handleModelChange = (m: AIModel) => { patch({ aiModel: m }); send('model', m); close() }

  return (
    <div
      ref={rootRef}
      style={{
        background: 'transparent',
        borderRadius: 12,
        overflowY: 'auto',
        overflowX: 'hidden',
        scrollbarWidth: 'none',
        boxShadow: '0 8px 30px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.1)',
      }}
    >
      {settings._mode === 'model-picker' ? (
        <ModelPickerContent aiModel={settings.aiModel} onModelChange={handleModelChange} onClose={close} />
      ) : (
        <SettingsPanel
          userEmail={settings.userEmail}
          zoom={settings.zoom} opacity={settings.opacity} autoGen={settings.autoGen} autoDetect={settings.autoDetect}
          privateMode={settings.privateMode} language={settings.language}
          extraContext={settings.extraContext} aiModel={settings.aiModel} snapPos={settings.snapPos}
          fontSize={settings.fontSize}
          onZoom={(d) => {
            patch({ zoom: Math.max(0.7, Math.min(1.5, +((settings.zoom + d).toFixed(1)))) })
            send('zoom', d)
          }}
          onZoomReset={() => { patch({ zoom: 1 }); send('zoomReset') }}
          onOpacity={(d) => {
            patch({ opacity: Math.max(0.3, Math.min(1, +((settings.opacity + d).toFixed(1)))) })
            send('opacity', d)
          }}
          onOpacityReset={() => { patch({ opacity: 1 }); send('opacityReset') }}
          onAutoGen={(v) => { patch({ autoGen: v }); send('autoGen', v) }}
          onAutoDetect={(v) => { patch({ autoDetect: v }); send('autoDetect', v) }}
          onPrivate={(v) => { patch({ privateMode: v }); send('private', v) }}
          onLanguage={(v) => { patch({ language: v }); send('language', v) }}
          onExtraContext={(v) => { patch({ extraContext: v }); send('extraContext', v) }}
          onModelChange={handleModelChange}
          onFontSize={(size) => { patch({ fontSize: size }); send('SET_FONT_SIZE', size) }}
          onMove={(p) => { patch({ snapPos: p }); send('move', p); close() }}
          onExit={() => { send('exit'); close() }}
          onEnd={() => { send('end'); close() }}
          onClose={close}
        />
      )}
    </div>
  )
}

function ModelPickerContent({ aiModel, onModelChange, onClose }: { aiModel: AIModel; onModelChange: (m: AIModel) => void; onClose: () => void }) {
  const paidModels = MODELS.filter((m) => !m.free)
  const freeModels = MODELS.filter((m) => m.free)
  const rowStyle = (selected: boolean): React.CSSProperties => ({
    width: '100%', display: 'flex', alignItems: 'center', gap: 8,
    padding: '6px 10px', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
    background: selected ? 'rgba(99,102,241,0.15)' : 'transparent',
    boxShadow: selected ? 'inset 0 0 0 1px rgba(99,102,241,0.3)' : 'none',
    border: 'none', color: 'inherit',
  })

  const renderGroup = (models: typeof MODELS) =>
    models.map((m) => (
      <button key={m.id} onClick={() => onModelChange(m.id as AIModel)} style={rowStyle(aiModel === m.id)}
        onMouseOver={(e) => { if (aiModel !== m.id) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.05)' }}
        onMouseOut={(e) => { if (aiModel !== m.id) (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
      >
        <span style={{ width: 12, flexShrink: 0, color: 'rgba(99,102,241,0.9)', fontSize: 11 }}>{aiModel === m.id ? '✓' : ''}</span>
        <span style={{ fontSize: 13, color: '#fff', flex: 1 }}>{m.name}</span>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', fontStyle: 'italic', flexShrink: 0 }}>{m.bestFor}</span>
        {m.free && (
          <span style={{ fontSize: 10, fontWeight: 500, padding: '1px 6px', borderRadius: 4, background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)', color: '#22c55e', flexShrink: 0 }}>FREE</span>
        )}
      </button>
    ))

  return (
    <div style={{ background: 'rgba(14,14,20,0.96)', borderRadius: 12, padding: '10px 6px', minWidth: 260 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 6px 6px', borderBottom: '1px solid rgba(255,255,255,0.07)', marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontWeight: 500, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Select Model</span>
        <button onClick={onClose} style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px' }}>✕</button>
      </div>
      {renderGroup(paidModels)}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0 4px' }}>
        <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.07)' }} />
        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Free Models</span>
        <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.07)' }} />
      </div>
      {renderGroup(freeModels)}
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
// Track/knob geometry driven entirely by inline pixel math (not Tailwind
// translate utilities) so the knob's position is a direct, unambiguous
// function of `checked` — nothing to purge, merge, or misconfigure.
const TOGGLE_W = 36, TOGGLE_H = 20, TOGGLE_KNOB = 14, TOGGLE_INSET = 4
function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  const knobLeft = checked ? TOGGLE_W - TOGGLE_KNOB - TOGGLE_INSET : TOGGLE_INSET
  return (
    <button
      type="button"
      onClick={onChange}
      aria-pressed={checked}
      style={{
        position: 'relative',
        width: TOGGLE_W,
        height: TOGGLE_H,
        borderRadius: TOGGLE_H,
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        flexShrink: 0,
        background: checked ? '#22c55e' : '#444444',
        transition: 'background-color 0.2s ease',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: (TOGGLE_H - TOGGLE_KNOB) / 2,
          left: knobLeft,
          width: TOGGLE_KNOB,
          height: TOGGLE_KNOB,
          borderRadius: '50%',
          background: '#ffffff',
          boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
          transition: 'left 0.2s ease',
        }}
      />
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

const SNAP_NEIGHBORS: Record<SnapPos, SnapPos[]> = {
  'top-left':      ['top-center', 'bottom-left'],
  'top-center':    ['top-left', 'top-right', 'bottom-center'],
  'top-right':     ['top-center', 'bottom-right'],
  'bottom-left':   ['top-left', 'bottom-center'],
  'bottom-center': ['bottom-left', 'bottom-right', 'top-center'],
  'bottom-right':  ['top-right', 'bottom-center'],
}

function PositionGrid({ snapPos, onMove, size = 12, gap = 2, onAfterMove, flashPos }: {
  snapPos: SnapPos; onMove: (p: SnapPos) => void
  size?: number; gap?: number; onAfterMove?: () => void
  flashPos?: SnapPos | null
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', width: size * 3 + gap * 2, gap, padding: '4px 5px' }}>
      {SNAP_POSITIONS.flat().map((pos) => {
        const isActive = snapPos === pos
        const isFlashing = flashPos === pos
        return (
          <button
            key={pos}
            onClick={() => { onMove(pos); onAfterMove?.() }}
            title={pos.replace('-', ' ')}
            className="flex items-center justify-center transition-all"
            style={{
              width: size, height: size,
              borderRadius: 2,
              fontSize: Math.max(7, Math.round(size * 0.5)),
              border: 'none', cursor: 'pointer',
              background: isFlashing
                ? 'rgba(99,102,241,0.6)'
                : isActive
                  ? 'rgba(99,102,241,0.65)'
                  : 'rgba(255,255,255,0.1)',
              color: isFlashing || isActive ? '#fff' : 'rgba(255,255,255,0.3)',
            }}
          >
            {SNAP_ICONS[pos]}
          </button>
        )
      })}
    </div>
  )
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
  session, onActivate, onBack, error, activating, onHide, locked, onTakeOver,
}: {
  session: CallSession; onActivate: () => void; onBack: () => void
  error: string | null; activating: boolean; onHide: () => void
  locked?: boolean; onTakeOver?: () => void
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
            title="Collapse"
            className="flex items-center justify-center h-6 w-6 rounded-md hover:bg-white/8 transition-all opacity-85 hover:opacity-100"
            style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)' }}>
            <ChevronUp />
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
            onClick={locked ? onTakeOver : onActivate}
            disabled={activating}
            className="flex-1 py-2.5 rounded-xl text-white text-[12.5px] font-semibold transition-all flex items-center justify-center gap-2 disabled:opacity-40"
            style={{
              background: activating
                ? 'rgba(34,197,94,0.3)'
                : locked
                  ? 'linear-gradient(135deg,rgba(245,158,11,0.85),rgba(217,119,6,0.85))'
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
            ) : locked ? (
              <>
                <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                </svg>
                Take Over Session
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
  const [sessionLocked, setSessionLocked] = useState(false)

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
  const [opacity,      setOpacity]      = useState(0.65)
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
  const { isOnline, justCameBackOnline } = useNetworkStatus()
  const [manualQ,      setManualQ]      = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [maxContentH,  setMaxContentH]  = useState(700)  // 70% of work-area height, fetched on mount
  const [extraContext, setExtraContext] = useState('')
  const [aiModel,      setAiModel]      = useState<AIModel>(session.aiModel)
  const [snapPos,      setSnapPos]      = useState<SnapPos>(() => {
    return (localStorage.getItem('overlay-snap-pos') as SnapPos | null) ?? 'top-center'
  })
  const [flashPos,     setFlashPos]     = useState<SnapPos | null>(null)
  const [fontSize,     setFontSize]     = useState<number>(() => {
    const saved = Number(localStorage.getItem('answerFontSize'))
    return saved >= FONT_SIZE_MIN && saved <= FONT_SIZE_MAX ? saved : FONT_SIZE_DEFAULT
  })
  useEffect(() => { localStorage.setItem('answerFontSize', fontSize.toString()) }, [fontSize])
  const flipped = snapPos.startsWith('bottom')

  // Global snap-position shortcuts (main process) move the window directly —
  // this just flashes the matching button in the toolbar's mini grid so the
  // shortcut has the same visible acknowledgment a click would.
  useEffect(() => {
    return window.electronAPI.on('window:snap-feedback', (pos: unknown) => {
      setSnapPos(pos as SnapPos)
      localStorage.setItem('overlay-snap-pos', pos as SnapPos)
      setFlashPos(pos as SnapPos)
      setTimeout(() => setFlashPos(null), 200)
    })
  }, [])

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
    // The popover window can't outlive the visible overlay — if the user
    // exits to the mini-bar pill while it's open, close it too.
    if (hidden) {
      showSettingsRef.current = false
      setShowSettings(false)
      window.electronAPI.popover.hide()
    }
  }, [hidden])

  const [copied,       setCopied]       = useState<string | null>(null)  // id of copied answer

  const isRunningRef   = useRef(false)
  const saveQueueRef   = useRef<{ text: string; speaker: 'MIC' | 'SYSTEM' }[]>([])
  const silenceRef     = useRef<ReturnType<typeof setTimeout> | null>(null)
  const questionBufRef = useRef<string[]>([])
  const partialRef     = useRef('')
  const pingRef        = useRef<ReturnType<typeof setInterval> | null>(null)
  const deviceHeartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const inputRef       = useRef<HTMLInputElement>(null)
  const pendingQRef    = useRef('')
  const prevHeightRef  = useRef(TOOLBAR_H)
  const overlayRootRef = useRef<HTMLDivElement>(null)
  const contentHeightRef = useRef(TOOLBAR_H)
  // Mirrors `showSettings` in a ref so the memoized onSettingsClick callback
  // (stable across renders, so it doesn't break ToolbarBar's React.memo) can
  // read the current open/closed state synchronously without needing
  // `showSettings` in its own dependency array.
  const showSettingsRef = useRef(false)
  const popoverClosedAtRef = useRef(0)
  // Settings snapshot kept in a ref for the same reason — onSettingsClick
  // reads this to send the popover window its current values on open,
  // without needing every settings field in its dependency array either.
  const settingsSnapshotRef = useRef({
    userEmail, zoom, opacity, autoGen, autoDetect, privateMode, language, extraContext, aiModel, snapPos, fontSize,
  })
  useEffect(() => {
    settingsSnapshotRef.current = {
      userEmail, zoom, opacity, autoGen, autoDetect, privateMode, language, extraContext, aiModel, snapPos, fontSize,
    }
  }, [userEmail, zoom, opacity, autoGen, autoDetect, privateMode, language, extraContext, aiModel, snapPos, fontSize])

  useEffect(() => { partialRef.current = partial }, [partial])

  // BUG FIX: return 'none' when both toggles are off — previously always fell through to 'system'
  const audioSrc = useMemo(() => {
    if (micOn && sysOn) return 'both' as const
    if (micOn) return 'mic' as const
    if (sysOn) return 'system' as const
    return 'none' as const
  }, [micOn, sysOn])
  // Read inside the onFinal callback below without adding audioSrc to its
  // dependency array (that callback is passed into useSpeechmatics, and
  // this file's existing convention is "stable callback + ref for the
  // latest value" rather than reconstructing callbacks on every toggle).
  const audioSrcRef = useRef(audioSrc)
  useEffect(() => { audioSrcRef.current = audioSrc }, [audioSrc])

  // ── Speechmatics ──────────────────────────────────────────────────────────
  const sm = useSpeechmatics({
    language,
    onPartial: setPartial,
    onFinal: useCallback((text: string) => {
      if (!isRunningRef.current) return
      setPartial(''); partialRef.current = ''
      const speaker = speakerForAudioSrc(audioSrcRef.current)
      setTranscript((p) => [...p, { id: uid(), text, isFinal: true, timestamp: Date.now(), speaker }])
      saveQueueRef.current.push({ text, speaker })
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
    getFreshJwt: useCallback(() => getSpeechmaticsJwt(session.id), [session.id]),
    onReconnectFailed: useCallback((msg: string) => setError(msg), []),
  })

  const audio = useSystemAudio({
    onPCMChunk: sm.sendAudio,
    onError: (m) => setError(m),
    onRestored: useCallback(() => {
      setError('Audio restored ✓')
      setTimeout(() => setError(null), 2_500)
    }, []),
  })

  // ── Mic device selection ──────────────────────────────────────────────────
  const [micDevices,   setMicDevices]   = useState<AudioDevice[]>([])
  const [selectedMicId, setSelectedMicId] = useState<string | undefined>(undefined)

  // Device labels are only populated once mic permission has been granted
  // at least once (browser privacy rule) — re-enumerate on every
  // 'devicechange' too, so a newly-plugged-in mic shows up without needing
  // a session restart.
  useEffect(() => {
    let cancelled = false
    const refresh = () => {
      navigator.mediaDevices.enumerateDevices().then((devices) => {
        if (cancelled) return
        const inputs = devices
          .filter((d) => d.kind === 'audioinput')
          .map((d, i): AudioDevice => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}`, type: 'input' }))
        setMicDevices(inputs)
        // Saved preference may point at a device that's no longer
        // connected — fall back to the OS default rather than silently
        // failing capture on a stale id.
        setSelectedMicId((current) => {
          const saved = current ?? localStorage.getItem('preferredMicDeviceId') ?? undefined
          return saved && inputs.some((d) => d.id === saved) ? saved : undefined
        })
      }).catch(() => {})
    }
    refresh()
    navigator.mediaDevices.addEventListener('devicechange', refresh)
    return () => { cancelled = true; navigator.mediaDevices.removeEventListener('devicechange', refresh) }
  }, [])

  useEffect(() => {
    audio.setMicDeviceId(selectedMicId)
  }, [selectedMicId, audio])

  const onMicDeviceChange = useCallback((deviceId: string) => {
    setSelectedMicId(deviceId)
    localStorage.setItem('preferredMicDeviceId', deviceId)
    // Take effect immediately if mic is already live, not just next start().
    if (isRunningRef.current && (audioSrc === 'mic' || audioSrc === 'both')) {
      audio.start(audioSrc).catch((err: Error) => setError(`Audio: ${err.message}`))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio, audioSrc])

  console.log('[session] active session:', { id: session.id, status: session.status, mode: session.mode, aiModel: session.aiModel })

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

  // ── Device-lock heartbeat ────────────────────────────────────────────────
  // Refreshes this device's claim on the session every 15s while it's
  // running. If another device takes over (heartbeat comes back LOCK_LOST),
  // this device stops itself rather than keep sending audio/chat against a
  // session it no longer owns.
  const DEVICE_HEARTBEAT_MS = 15_000
  const startDeviceHeartbeat = useCallback(() => {
    if (deviceHeartbeatRef.current) clearInterval(deviceHeartbeatRef.current)
    deviceHeartbeatRef.current = setInterval(async () => {
      const res = await heartbeatSession(session.id)
      if (!res.ok && res.error === 'LOCK_LOST') {
        if (deviceHeartbeatRef.current) { clearInterval(deviceHeartbeatRef.current); deviceHeartbeatRef.current = null }
        if (pingRef.current) { clearInterval(pingRef.current); pingRef.current = null }
        sm.disconnect(); audio.stop(); ai.abort()
        isRunningRef.current = false; setIsRunning(false)
        setError('This session was taken over by another device.')
        if (!hiddenRef.current) window.electronAPI.window.setHeight(MODAL_H)
        // This device no longer owns the session — main must NOT try to end
        // it (on quit) on this device's behalf; the other device owns it now.
        window.electronAPI.session.notifyEnded(session.id)
      }
    }, DEVICE_HEARTBEAT_MS)
  }, [session.id, sm, audio, ai])

  // ── Activate ──────────────────────────────────────────────────────────────
  const handleActivate = useCallback(async (forceTakeOver = false) => {
    setActivating(true); setActivateErr(null); setSessionLocked(false)
    try {
      await updateSessionStatus(session.id, 'ACTIVE', { forceTakeOver })
      window.electronAPI.session.notifyActivated(session.id)
      const jwt = await getSpeechmaticsJwt(session.id)
      sm.connect(jwt)
      await audio.start(audioSrc)
      setIsRunning(true); isRunningRef.current = true

      // Countdown: FREE = 10 min, PAID = 30 min; admin = no expiry (set large value)
      const windowSecs = isAdmin ? 99 * 60 : session.mode === 'FREE' ? 10 * 60 : 30 * 60
      setTimerStartSeconds(windowSecs)
      setTimerKey((k) => k + 1)

      pingRef.current  = setInterval(() => pingSession(session.id), SESSION_PING_MS)
      startDeviceHeartbeat()
      setIsActivated(true)
      window.electronAPI.window.setHeight(TOOLBAR_H)
    } catch (err) {
      const msg = (err as Error).message
      if (msg.includes('SESSION_LOCKED')) {
        setSessionLocked(true)
        setActivateErr('This session is already active on another device.')
      } else {
        setActivateErr(`Activation failed: ${msg}`)
      }
    } finally { setActivating(false) }
  }, [session.id, session.mode, isAdmin, audioSrc, sm, audio, startDeviceHeartbeat])

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
    if (deviceHeartbeatRef.current) clearInterval(deviceHeartbeatRef.current)
    sm.disconnect(); audio.stop(); ai.abort()
    isRunningRef.current = false; setIsRunning(false)
    const remaining = saveQueueRef.current.splice(0)
    if (remaining.length > 0) {
      await saveTranscriptions(session.id, remaining.map((t) => ({ speaker: t.speaker, text: t.text }))).catch(() => {})
    }
    await updateSessionStatus(session.id, 'ENDED').catch(() => {})
    window.electronAPI.session.notifyEnded(session.id)
    onEnd()
  }, [session.id, sm, audio, ai, onEnd])

  // ── Timer expiry — called by SessionTimer component when countdown hits 0 ──
  const handleTimerExpire = useCallback(() => {
    if (!isRunningRef.current) return

    if (session.mode === 'FREE') {
      if (pingRef.current) clearInterval(pingRef.current)
      if (deviceHeartbeatRef.current) clearInterval(deviceHeartbeatRef.current)
      sm.disconnect(); audio.stop(); ai.abort()
      isRunningRef.current = false; setIsRunning(false)
      void updateSessionStatus(session.id, 'ENDED').catch(() => {})
      window.electronAPI.session.notifyEnded(session.id)
      const pending = saveQueueRef.current.splice(0)
      if (pending.length) {
        void saveTranscriptions(session.id, pending.map((t) => ({ speaker: t.speaker, text: t.text }))).catch(() => {})
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
          if (deviceHeartbeatRef.current) clearInterval(deviceHeartbeatRef.current)
          sm.disconnect(); audio.stop(); ai.abort()
          isRunningRef.current = false; setIsRunning(false)
          void updateSessionStatus(session.id, 'ENDED').catch(() => {})
          window.electronAPI.session.notifyEnded(session.id)
          const pending = saveQueueRef.current.splice(0)
          if (pending.length) {
            void saveTranscriptions(session.id, pending.map((t) => ({ speaker: t.speaker, text: t.text }))).catch(() => {})
          }
          setOutOfCredits(true)
          if (!hiddenRef.current) window.electronAPI.window.setHeight(MODAL_H)
        })
    }
  }, [session.id, session.mode, sm, audio, ai])

  // "Back online" toast — reuses the same transient-message banner as the
  // other brief status notices in this file (auto-extend, audio restored).
  useEffect(() => {
    if (!justCameBackOnline) return
    setError('Back online ✓')
    const t = setTimeout(() => setError(null), 2_000)
    return () => clearTimeout(t)
  }, [justCameBackOnline])

  // ── Screenshot ─────────────────────────────────────────────────────────────
  const captureScreenshot = useCallback(async (sendNow = false) => {
    // Cap only applies to the QUEUE path (sendNow=false, the small camera
    // button in the chat panel) — the toolbar/shortcut path always sends a
    // single screenshot immediately and never touches this array.
    if (!sendNow && screenshots.length >= MAX_SCREENSHOTS) {
      setError(`Maximum ${MAX_SCREENSHOTS} screenshots per send — send or clear first`)
      setTimeout(() => setError(null), 2_500)
      return
    }
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
  }, [ai, screenshots.length])

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
  // Settings now live in a separate BrowserWindow (see SettingsPopoverWindow
  // + main process popover:* IPC) — this just opens/closes that window
  // instead of toggling in-window portal state. Positioned in real screen
  // coordinates by main, so it can never resize or get clipped by this window.
  const onSettingsClick   = useCallback((r: DOMRect) => {
    // Guard: if the popover was just closed by blur (click-outside / trackpad),
    // the same click event that caused the blur will also fire here — skip it
    // so the popover doesn't immediately re-open.
    if (Date.now() - popoverClosedAtRef.current < 300) return
    const opening = !showSettingsRef.current
    showSettingsRef.current = opening
    setShowSettings(opening)
    if (opening) {
      window.electronAPI.popover.updateSettings({ ...settingsSnapshotRef.current, _mode: 'settings' })
      window.electronAPI.popover.show({
        x: r.left, y: r.top, width: r.width, height: r.height, flipped,
      }).catch((err) => {
        console.error('[hamburger] popover show failed:', err)
      })
    } else {
      window.electronAPI.popover.hide()
    }
  }, [flipped])
  const onModelPickerClick = useCallback((r: DOMRect) => {
    if (Date.now() - popoverClosedAtRef.current < 300) return
    const opening = !showSettingsRef.current
    showSettingsRef.current = opening
    setShowSettings(opening)
    if (opening) {
      window.electronAPI.popover.updateSettings({ ...settingsSnapshotRef.current, _mode: 'model-picker' })
      window.electronAPI.popover.show({
        x: r.left, y: r.top, width: r.width, height: r.height, flipped,
      }).catch((err) => {
        console.error('[model-picker] popover show failed:', err)
      })
    } else {
      window.electronAPI.popover.hide()
    }
  }, [flipped])
  const onHideMini       = useCallback(() => onHide(prevHeightRef.current), [onHide])
  const onSnapMove       = useCallback((pos: SnapPos) => {
    setSnapPos(pos)
    localStorage.setItem('overlay-snap-pos', pos)
    void window.electronAPI.window.moveTo(pos)
    window.electronAPI.popover.hide()
  }, [])
  const onNavigatePrev   = useCallback(() => setCurrentQA((i) => Math.max(0, i - 1)), [])
  const onNavigateNext   = useCallback((len: number) => setCurrentQA((i) => Math.min(len - 1, i + 1)), [])
  const onClearAnswers   = useCallback(() => { setQaPairs([]); setCurrentQA(-1); setStreaming(''); setShowAnswer(false); ai.abort() }, [ai])
  const onCloseAnswer    = useCallback(() => setShowAnswer(false), [])
  const onRegenerate     = useCallback((q: string) => { pendingQRef.current = q; ai.ask(q, undefined, true) }, [ai])
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

  // ── Settings popover window: closed itself (blur/Escape) or dispatched an
  // action (toggle/slider/dropdown/position/exit/end changed in that window) ──
  useEffect(() => {
    const uClosed = window.electronAPI.on('popover:closed', () => {
      showSettingsRef.current = false
      popoverClosedAtRef.current = Date.now()
      setShowSettings(false)
    })
    const uAction = window.electronAPI.on('popover:action', (action: unknown) => {
      const { type, payload } = action as { type: string; payload?: unknown }
      switch (type) {
        case 'zoom': setZoom((z) => Math.max(0.7, Math.min(1.5, +((z + (payload as number)).toFixed(1))))); break
        case 'zoomReset': setZoom(1); break
        case 'opacity': setOpacity((o) => Math.max(0.3, Math.min(1, +((o + (payload as number)).toFixed(1))))); break
        case 'opacityReset': setOpacity(1); break
        case 'autoGen': setAutoGen(payload as boolean); break
        case 'autoDetect': setAutoDetect(payload as boolean); break
        case 'private': onPrivateChange(payload as boolean); break
        case 'language': onLanguageChange(payload as string); break
        case 'extraContext': setExtraContext(payload as string); break
        case 'model': onModelChange(payload as AIModel); break
        case 'SET_FONT_SIZE': setFontSize(payload as number); break
        case 'move': onSnapMove(payload as SnapPos); break
        case 'exit': onHideMini(); break
        case 'end': void endSession(); break
      }
    })
    return () => { uClosed(); uAction() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onPrivateChange, onLanguageChange, onModelChange, onSnapMove, onHideMini, endSession])

  // ── Batch save transcript ──────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(async () => {
      const pending = saveQueueRef.current.splice(0)
      if (!pending.length || !isRunningRef.current) return
      await saveTranscriptions(session.id, pending.map((t) => ({ speaker: t.speaker, text: t.text }))).catch(
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
    if (deviceHeartbeatRef.current) clearInterval(deviceHeartbeatRef.current)
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

    // The settings popover now lives in its own BrowserWindow (see
    // SettingsPopoverWindow / main process popover:* IPC), so this no longer
    // needs to know or care whether it's open — the main window always just
    // fits its own content, exactly like before the popover ever existed.
    const applyHeight = () => {
      const contentH = Math.min(el.scrollHeight, maxContentH)
      contentHeightRef.current = contentH
      prevHeightRef.current = contentH
      window.electronAPI.window.setHeight(contentH, flipped)
    }

    const ro = new ResizeObserver(applyHeight)
    ro.observe(el)
    applyHeight()
    return () => ro.disconnect()
  }, [isActivated, hidden, flipped, maxContentH])

  // ── Zoom / opacity ─────────────────────────────────────────────────────────
  useEffect(() => { document.documentElement.style.fontSize = `${zoom * 16}px` }, [zoom])
  useEffect(() => { window.electronAPI.window.setOpacity(opacity) }, [opacity])

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
          <button onClick={() => onHide(MODAL_H)}
            title="Collapse"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            className="flex items-center justify-center h-6 w-6 rounded-md hover:bg-white/8 transition-all flex-shrink-0 opacity-85 hover:opacity-100">
            <ChevronUp />
          </button>
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
          <button onClick={() => onHide(MODAL_H)}
            title="Collapse"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            className="flex items-center justify-center h-6 w-6 rounded-md hover:bg-white/8 transition-all flex-shrink-0 opacity-85 hover:opacity-100">
            <ChevronUp />
          </button>
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
        session={session} onActivate={() => handleActivate(false)} onBack={onEnd}
        error={activateErr} activating={activating} onHide={() => onHide(MODAL_H)}
        locked={sessionLocked} onTakeOver={() => handleActivate(true)}
      />
    )
  }

  // ── Active overlay ────────────────────────────────────────────────────────
  const PANEL_BG: React.CSSProperties = {
    background: 'rgba(8,8,12,0.94)',
    backdropFilter: 'none',
  }

  // Unified rounded container — clips all panels so no individual border-radius needed.
  // maxHeight lets the AnswerPanel's flex child shrink-and-scroll instead of the
  // window growing past the 70% work-area cap. The settings popover lives in
  // its own BrowserWindow entirely (see SettingsPopoverWindow / main process
  // popover:* IPC) and never touches this container's layout at all.
  //
  // Bottom positions: toolbar visually at the BOTTOM (column-reverse), pinned
  // to the window's bottom edge via position:fixed so it never shifts on
  // screen whenever the window grows for any OTHER reason (chat panel
  // opening, an answer appearing, transcript growing) — the window's bottom
  // edge itself is held constant by anchorBottom in main, so pinning here
  // means the toolbar truly cannot move.
  //
  // A first attempt at this pinning broke the whole app: this element used to
  // be nested inside a wrapper carrying the `.anim-in` fade/slide class, which
  // animates `transform` — and any ANCESTOR with a non-`none` transform
  // becomes the containing block for `position: fixed` descendants (CSS
  // spec). So "fixed" was resolving against that animated wrapper's
  // (near-zero-size) box instead of the real window. Fix: `.anim-in` now
  // lives directly on THIS element instead of an ancestor — a transform on
  // the fixed element itself doesn't affect what it's positioned relative to
  // (transforms apply after position is resolved), so it's safe here.
  const CONTAINER: React.CSSProperties = {
    borderRadius: 14,
    overflow: 'hidden',
    background: 'rgba(8,8,12,0.94)',
    display: 'flex',
    flexDirection: flipped ? 'column-reverse' : 'column',
    maxHeight: maxContentH,
    ...(flipped ? { position: 'fixed', bottom: 0, left: 0, right: 0 } as React.CSSProperties : {}),
  }

  return (
    <div style={{ background: 'transparent' }}>

      <div data-overlay ref={overlayRootRef} className="anim-in" style={CONTAINER}>

      {/* ══ TOOLBAR ══════════════════════════════════════════════════════════ */}
      <ToolbarBar
        companyName={session.companyName}
        isRunning={isRunning}
        micOn={micOn}
        sysOn={sysOn}
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
        onModelPickerClick={onModelPickerClick}
        onHide={onHideMini}
        aiModel={aiModel}
        snapPos={snapPos}
        onSnapMove={onSnapMove}
        flashPos={flashPos}
        isOnline={isOnline}
        screenshotCount={screenshots.length}
        micDevices={micDevices}
        selectedMicId={selectedMicId}
        onMicDeviceChange={onMicDeviceChange}
      />

      {/* ══ TRANSCRIPT STRIP — always visible: the queued "next question" tunnel ══ */}
      <CaptionPanel transcript={transcript} partial={partial} height={CAPTION_H} onClear={clearTranscript} fontSize={fontSize} />

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
            <div className="flex items-center gap-1.5 px-2.5 pt-2.5">
              <div className="flex gap-1.5 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
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
              <span className="text-[10px] font-medium text-white/35 flex-shrink-0 whitespace-nowrap">
                📷 {screenshots.length}/{MAX_SCREENSHOTS}
              </span>
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
              className="flex-1 rounded-xl px-3 py-1.5 outline-none transition-all disabled:opacity-40"
              style={{
                background: 'rgba(255,255,255,0.06)',
                boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.1)',
                color: '#ffffff',
                WebkitTextFillColor: '#ffffff',
                caretColor: '#4ade80',
                fontSize,
              }}
              onFocus={(e) => (e.currentTarget.style.boxShadow = 'inset 0 0 0 1px rgba(34,197,94,0.4)')}
              onBlur={(e) => (e.currentTarget.style.boxShadow = 'inset 0 0 0 1px rgba(255,255,255,0.1)')}
            />

            <button onClick={() => void captureScreenshot(false)}
              disabled={screenshots.length >= MAX_SCREENSHOTS}
              className="overlay-btn h-8 px-2 text-[10px] gap-1 flex-shrink-0 disabled:opacity-30 disabled:cursor-not-allowed"
              title={screenshots.length >= MAX_SCREENSHOTS ? `Max ${MAX_SCREENSHOTS} screenshots — send or clear first` : 'Add screenshot'}>
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <Kbd s="⌘⌥↵" />
            </button>

            <button
              onClick={() => { triggerAnswer(manualQ.trim() || undefined, screenshots.length ? screenshots : undefined); setManualQ('') }}
              disabled={!isRunning || (!manualQ.trim() && !screenshots.length) || ai.isStreaming || !isOnline}
              title={!isOnline ? 'No internet connection' : undefined}
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
          fontSize={fontSize}
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
  fontSize: number
}
const CaptionPanel = React.memo(function CaptionPanel({ transcript, partial, height, onClear, fontSize }: CaptionPanelProps) {
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
            <div
              className="flex items-center gap-1.5 px-2 py-1 rounded-xl flex-shrink-0"
              style={{
                background: 'rgba(99,102,241,0.10)',
                boxShadow: 'inset 0 0 0 1px rgba(99,102,241,0.28)',
                borderLeft: '3px solid #6366f1',
              }}
            >
              {queued.map((t, i) => {
                const isMic = t.speaker === 'MIC'
                const prevSpeaker = i > 0 ? queued[i - 1].speaker : null
                const showLabel = t.speaker !== prevSpeaker
                const chipBg = isMic ? 'rgba(34,197,94,0.1)' : 'rgba(99,102,241,0.15)'
                const chipBorder = isMic ? 'rgba(34,197,94,0.25)' : 'rgba(99,102,241,0.3)'
                const chipColor = isMic ? 'rgba(150,230,170,0.9)' : 'rgba(180,190,255,0.9)'
                return (
                  <span
                    key={t.id}
                    className="flex-shrink-0 max-w-[340px] truncate px-2.5 py-0.5 rounded-full leading-snug"
                    style={{ background: chipBg, boxShadow: `inset 0 0 0 1px ${chipBorder}`, color: chipColor, fontSize }}
                    title={`${isMic ? 'You' : 'Interviewer'}: ${t.text}`}
                  >
                    {showLabel && (
                      <span className="font-semibold mr-1" style={{ opacity: 0.7 }}>
                        {isMic ? 'You:' : 'Interviewer:'}
                      </span>
                    )}
                    {t.text}
                  </span>
                )
              })}
              {partial && (
                <span className="flex-shrink-0 max-w-[340px] truncate px-1.5 leading-snug text-white/45 italic" style={{ fontSize }}>
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
          style={{ background: 'rgba(0,0,0,0.6)', color: '#ffffff', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.12)' }}
        >
          Clear <Kbd s="⌘⇧⌫" />
        </button>
      </div>
    </div>
  )
})

// Renders streaming text so only the newest chunk (since the last render)
// gets a fresh DOM node — CSS handles the fade-in purely from that node
// mounting fresh, with no change to how/when tokens actually arrive.
function StreamingText({ text }: { text: string }) {
  const prevRef = useRef('')
  const prevText = prevRef.current
  const isGrowth = text.startsWith(prevText)
  const stable = isGrowth ? prevText : ''
  const fresh = isGrowth ? text.slice(prevText.length) : text
  useEffect(() => { prevRef.current = text }, [text])
  return (
    <>
      {stable}
      {fresh && <span key={text.length} className="answer-fade-in">{fresh}</span>}
    </>
  )
}

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
  fontSize: number
}
const AnswerPanel = React.memo(function AnswerPanel({
  isStreaming, streaming, qaPairs, currentQA, pendingQuestion,
  error, copied,
  onNavigatePrev, onNavigateNext, onClear, onClose, onCopy, onRegenerate, onDismissError, fontSize,
}: AnswerPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  // Smart auto-scroll: only follow new streaming tokens while the user is at
  // (or very near) the bottom. Any manual scroll-up latches "not at bottom"
  // until the user scrolls back down themselves — never yank them back.
  const atBottomRef = useRef(true)
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 50
  }, [])
  useEffect(() => {
    const el = scrollRef.current
    if (streaming && el && atBottomRef.current) el.scrollTop = el.scrollHeight
  }, [streaming])
  // No scroll effect on `currentQA` — that fired on every generation-complete
  // (onDone advances currentQA to the new pair) as well as manual prev/next
  // navigation, snapping the view to the bottom right after the user had
  // control during streaming. Scroll position is left entirely to the user
  // once generation is done; the only automatic scrolling left is the
  // smart-scroll-while-streaming above.

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
      <div ref={scrollRef} onScroll={handleScroll} className="px-3 pt-2.5 pb-4 overflow-y-auto space-y-3 flex-1"
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
              <p
                className="text-white/82 whitespace-pre-wrap flex-1 min-w-0 answer-text"
                style={{ fontSize, lineHeight: 1.65, letterSpacing: '0.01em', WebkitFontSmoothing: 'antialiased', MozOsxFontSmoothing: 'grayscale' } as React.CSSProperties}
              >
                <StreamingText text={streaming} />
                {isStreaming && !streaming && <span className="text-white/35 text-[11px]">Thinking…</span>}
                {isStreaming && <span className="answer-cursor" />}
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
              <div className="flex-1 min-w-0"><AnswerText content={currentPair.answer} fontSize={fontSize} isStreaming={isStreaming} /></div>
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
  companyName: string
  isRunning: boolean; micOn: boolean; sysOn: boolean
  smState: SmConnectionState
  showChat: boolean; showAnswer: boolean; showSettings: boolean
  qaPairsCount: number
  timerStartSeconds: number | null; timerKey: number; sessionTimerMode: string
  onTimerExpire: () => void; isStreaming: boolean
  onToggleMic: () => void; onToggleSys: () => void
  onAnswer: () => void; onScreenshot: (sendNow?: boolean) => void
  onToggleChat: () => void; onSettingsClick: (r: DOMRect) => void; onModelPickerClick: (r: DOMRect) => void
  onHide: () => void
  aiModel: AIModel
  snapPos: SnapPos; onSnapMove: (p: SnapPos) => void; flashPos?: SnapPos | null
  isOnline: boolean; screenshotCount: number
  micDevices: AudioDevice[]; selectedMicId?: string; onMicDeviceChange: (deviceId: string) => void
}
const ToolbarBar = React.memo(function ToolbarBar(p: ToolbarBarProps) {
  const isMicActive = p.isRunning && p.micOn
  const isSysActive = p.isRunning && p.sysOn
  const audioActive = p.isRunning && (p.sysOn || p.micOn)
  const flipped = p.snapPos.startsWith('bottom')

  // Status dot color
  let statusLabel: string; let statusDotColor: string
  if (p.isStreaming) {
    statusLabel = 'Answering'; statusDotColor = '#818cf8'
  } else if (p.isRunning && p.smState === 'connected') {
    statusLabel = 'Listening'; statusDotColor = '#22c55e'
  } else if (p.isRunning && (p.smState === 'connecting' || p.smState === 'reconnecting')) {
    statusLabel = 'Reconnecting'; statusDotColor = '#f59e0b'
  } else if (p.isRunning && (p.smState === 'failed' || p.smState === 'error')) {
    statusLabel = 'Error'; statusDotColor = '#ef4444'
  } else {
    statusLabel = 'Ready'; statusDotColor = 'rgba(255,255,255,0.3)'
  }

  return (
    <>
      <div
        className="flex flex-nowrap items-center select-none"
        style={{
          background: 'rgba(10,10,14,0.55)',
          borderRadius: 11,
          border: '1px solid rgba(255,255,255,0.09)',
          padding: '5px 8px',
          gap: 3,
          minHeight: TOOLBAR_H,
          flexShrink: 0,
        }}
      >
        {/* ── LEFT GROUP: controls ── */}
        {/* 1. LOGO */}
        <div style={{ padding: '2px 4px', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <img src={logoSrc} style={{ width: 24, height: 24, borderRadius: 6, objectFit: 'contain' }} />
        </div>
        <Sep />
        {/* 2. MIC TOGGLE */}
        <Tooltip text={p.micOn ? 'Microphone · on' : 'Microphone · off'} flipped={flipped}>
          <button onClick={p.onToggleMic}
            className="relative flex items-center justify-center transition-all"
            style={{
              padding: '4px 7px', borderRadius: 6,
              color: p.micOn ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.65)',
            }}
            onMouseOver={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; e.currentTarget.style.color = 'rgba(255,255,255,0.9)' }}
            onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = p.micOn ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.65)' }}
          >
            <svg style={{ width: 15, height: 15 }} fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
            </svg>
            {p.micOn && <Dot color={isMicActive ? 'red' : 'green'} />}
          </button>
        </Tooltip>
        {/* 3. MIC SELECTOR */}
        {p.micOn && p.micDevices.length > 1 && (
          <MicSelector
            inputDevices={p.micDevices}
            selectedInputId={p.selectedMicId}
            onInputChange={p.onMicDeviceChange}
            compact
            flipped={flipped}
          />
        )}
        {/* 4. SYSTEM AUDIO */}
        <Tooltip text={isSysActive ? 'System audio · recording' : 'System audio · off'} flipped={flipped}>
          <button onClick={p.onToggleSys}
            className="relative flex items-center justify-center transition-all"
            style={{
              padding: '4px 7px', borderRadius: 6,
              color: p.sysOn ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.65)',
            }}
            onMouseOver={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; e.currentTarget.style.color = 'rgba(255,255,255,0.9)' }}
            onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = p.sysOn ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.65)' }}
          >
            <svg style={{ width: 15, height: 15 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            {p.sysOn && <Dot color={isSysActive ? 'red' : 'green'} />}
          </button>
        </Tooltip>
        <Sep />
        {/* 5. ANSWER */}
        <Tooltip text="Generate answer ⌘↵" flipped={flipped}>
          <AnswerBtn
            onClick={p.onAnswer}
            disabled={!p.isRunning || !p.isOnline}
            streaming={p.isStreaming}
          />
        </Tooltip>
        {/* 6. SCREENSHOT — pill-style */}
        <Tooltip text="Screenshot" flipped={flipped}>
          <button
            onClick={() => p.onScreenshot(true)}
            className="flex items-center select-none transition-all flex-shrink-0"
            style={{
              gap: 6,
              padding: '6px 12px',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 8,
              color: 'rgba(255,255,255,0.65)',
              cursor: 'pointer',
            }}
            onMouseOver={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = 'rgba(255,255,255,0.9)' }}
            onMouseOut={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = 'rgba(255,255,255,0.65)' }}
          >
            <svg style={{ width: 17, height: 17 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span style={{ fontSize: 13 }}>Screenshot</span>
            <span style={{
              fontFamily: 'monospace', fontSize: 10, opacity: 0.45,
              background: 'rgba(255,255,255,0.08)', borderRadius: 4,
              padding: '2px 6px',
            }}>⌘⇧↵</span>
          </button>
        </Tooltip>
        {/* 7. CHAT — pill-style */}
        <Tooltip text="Chat" flipped={flipped}>
          <button
            onClick={p.onToggleChat}
            className="flex items-center select-none transition-all flex-shrink-0"
            style={{
              gap: 6,
              padding: '6px 12px',
              background: p.showChat ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 8,
              color: p.showChat ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.65)',
              cursor: 'pointer',
            }}
            onMouseOver={(e) => { if (!p.showChat) { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = 'rgba(255,255,255,0.9)' } }}
            onMouseOut={(e) => { if (!p.showChat) { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = 'rgba(255,255,255,0.65)' } }}
          >
            <svg style={{ width: 17, height: 17 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
            <span style={{ fontSize: 13 }}>Chat</span>
            <span style={{
              fontFamily: 'monospace', fontSize: 10, opacity: 0.45,
              background: 'rgba(255,255,255,0.08)', borderRadius: 4,
              padding: '2px 6px',
            }}>⌘⇧-</span>
            {p.showAnswer && p.qaPairsCount > 0 && (
              <span className="ml-0.5 rounded-full text-white flex items-center justify-center"
                    style={{ height: 14, minWidth: 14, padding: '0 3px', fontSize: 8, fontWeight: 700, background: 'rgba(34,197,94,0.8)' }}>
                {p.qaPairsCount}
              </span>
            )}
          </button>
        </Tooltip>

        {/* ── SPACER ── */}
        <div style={{ flex: 1 }} />

        {/* ── RIGHT GROUP: navigation/meta ── */}
        {/* 8. TIMER */}
        <SessionTimer key={p.timerKey} startSeconds={p.timerStartSeconds} onExpire={p.onTimerExpire} mode={p.sessionTimerMode} timerKey={p.timerKey} />
        {/* 9. STATUS DOT */}
        <Tooltip text={statusLabel} flipped={flipped}>
          <div style={{ padding: '0 3px', display: 'flex', alignItems: 'center' }}>
            <span style={{
              width: 5, height: 5, borderRadius: '50%',
              background: statusDotColor,
              animation: (p.isRunning && (p.smState === 'connected' || p.smState === 'reconnecting')) || p.isStreaming ? 'pulse 1.5s ease-in-out infinite' : 'none',
            }} />
          </div>
        </Tooltip>
        {!p.isOnline && (
          <Tooltip text="No internet — Answer disabled" flipped={flipped}>
            <span style={{ fontSize: 11, color: '#fde68a', fontWeight: 600 }}>⚠</span>
          </Tooltip>
        )}
        {/* MODEL LABEL — click opens focused model picker */}
        {(() => {
          const modelInfo = MODELS.find((m) => m.id === p.aiModel)
          const isFree = modelInfo?.free ?? false
          const label = AI_MODEL_LABELS[p.aiModel] ?? p.aiModel
          return (
            <Tooltip text="Switch model" flipped={flipped}>
              <button
                onClick={(e) => p.onModelPickerClick(e.currentTarget.getBoundingClientRect())}
                style={{
                  padding: '2px 6px', borderRadius: 5,
                  fontSize: 10, fontWeight: 500, flexShrink: 0,
                  color: isFree ? '#22c55e' : 'rgba(255,255,255,0.4)',
                  background: isFree ? 'rgba(34,197,94,0.08)' : 'transparent',
                  border: isFree ? '1px solid rgba(34,197,94,0.2)' : '1px solid transparent',
                }}
              >
                {label}{isFree && <span style={{ marginLeft: 3, fontSize: 9 }}>FREE</span>}
              </button>
            </Tooltip>
          )
        })()}
        <Sep />
        {/* 10. POSITION GRID */}
        <Tooltip text="Move window ⌘⇧↑↓←→" flipped={flipped}>
          <PositionGrid snapPos={p.snapPos} onMove={p.onSnapMove} size={12} gap={2} flashPos={p.flashPos} />
        </Tooltip>
        {/* 11. HAMBURGER */}
        <Tooltip text="Settings" flipped={flipped}>
          <IBtn onClickWithRect={p.onSettingsClick}
                className={p.showSettings ? 'bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-400/30' : ''}>
            <svg style={{ width: 15, height: 15 }} fill="currentColor" viewBox="0 0 20 20">
              <path d="M10 4a2 2 0 100 4 2 2 0 000-4zM10 8a2 2 0 100 4 2 2 0 000-4zM10 12a2 2 0 100 4 2 2 0 000-4z" />
            </svg>
          </IBtn>
        </Tooltip>
        {/* 12. COLLAPSE */}
        <Tooltip text="Hide ⌃⌘H" flipped={flipped}>
          <IBtn onClick={p.onHide}>
            <ChevronUp />
            <span style={{ fontFamily: 'monospace', fontSize: 9, opacity: 0.38, marginLeft: 2 }}>⌃⌘H</span>
          </IBtn>
        </Tooltip>
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
function TextBlocks({ text, fontSize }: { text: string; fontSize: number }) {
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
                'flex gap-2.5 px-3 py-2 rounded-xl leading-snug transition-colors',
                isCorrect
                  ? 'bg-green-500/12 ring-1 ring-green-400/25 text-white'
                  : 'bg-white/4 text-white/70',
              )} style={{ fontSize, lineHeight: 1.65, letterSpacing: '0.01em' }}>
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
            <li key={j} className="flex gap-2 text-white/82" style={{ fontSize, lineHeight: 1.65, letterSpacing: '0.01em' }}>
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
            <li key={j} className="flex gap-2 text-white/82" style={{ fontSize, lineHeight: 1.65, letterSpacing: '0.01em' }}>
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
      const cls = h3m ? 'font-semibold text-white/80' : h2m ? 'font-bold text-white/85' : 'font-bold text-white/90'
      const headingSize = h3m ? fontSize - 0.5 : h2m ? fontSize : fontSize + 1
      blocks.push(<p key={key++} className={`${cls} leading-snug mt-2 mb-0.5`} style={{ fontSize: headingSize }}><InlineText text={txt} /></p>)
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
    blocks.push(<p key={key++} className="text-white/82" style={{ fontSize, lineHeight: 1.65, letterSpacing: '0.01em' }}><InlineText text={t} /></p>)
  }
  flushList()
  return <>{blocks}</>
}

// Markdown fence tag → highlight.js language name. Most tags (python, sql,
// javascript…) already ARE valid hljs names/aliases and need no mapping;
// this only covers the couple of common tags whose casing/spelling hljs
// doesn't register as an alias by default.
const FALLBACK_NBSP = ' ' // keeps empty lines from collapsing to zero height
const FENCE_LANG_ALIASES: Record<string, string> = {
  js: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  py: 'python',
  sh: 'bash', shell: 'bash', zsh: 'bash',
  yml: 'yaml',
}

// ─── CodeBlock — syntax-highlighted (highlight.js, atom-one-dark) with a
// language badge and copy button. While the answer is still streaming,
// partial/incomplete code breaks hljs's parser (unclosed strings, brackets,
// etc. mid-token), so it renders plain monospace until streaming finishes.
function CodeBlock({ code, language, isStreaming }: { code: string; language?: string; isStreaming: boolean }) {
  const ref = useRef<HTMLElement>(null)
  const [copied, setCopied] = useState(false)
  const [detectedLang, setDetectedLang] = useState<string | undefined>(language)

  const resolvedLang = language ? (FENCE_LANG_ALIASES[language] ?? language) : undefined

  useEffect(() => {
    if (isStreaming) return
    const el = ref.current
    if (!el) return
    el.removeAttribute('data-highlighted')
    if (resolvedLang && hljs.getLanguage(resolvedLang)) {
      el.innerHTML = hljs.highlight(code, { language: resolvedLang }).value
      setDetectedLang(resolvedLang)
    } else {
      const result = hljs.highlightAuto(code)
      el.innerHTML = result.value
      setDetectedLang(result.language)
    }
  }, [code, resolvedLang, isStreaming])

  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const badgeBtnStyle: React.CSSProperties = {
    fontSize: 10, fontFamily: 'monospace', textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.9)', letterSpacing: '0.03em',
  }

  return (
    <div className="answer-code-block" style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', background: '#282c34', margin: '8px 0' }}>
      <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 10, alignItems: 'center', zIndex: 1 }}>
        {!isStreaming && detectedLang && (
          <span style={{ ...badgeBtnStyle, opacity: 0.5, userSelect: 'none' }}>{detectedLang}</span>
        )}
        <button
          onClick={handleCopy}
          style={{ ...badgeBtnStyle, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, opacity: copied ? 1 : 0.5, transition: 'opacity 0.15s ease' }}
          onMouseOver={(e) => { e.currentTarget.style.opacity = '1' }}
          onMouseOut={(e) => { e.currentTarget.style.opacity = copied ? '1' : '0.5' }}
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre className="text-[11px] font-mono overflow-x-auto whitespace-pre" style={{ borderRadius: 8, padding: '12px 16px', margin: 0, fontSize: 'inherit', lineHeight: 1.6, background: '#282c34' }}>
        {isStreaming ? (
          code.split('\n').map((line, li) => (
            <div key={li} className="code-line text-green-200/75" style={{ margin: '0 -16px', padding: '0 16px' }}>{line || FALLBACK_NBSP}</div>
          ))
        ) : (
          <code ref={ref} className={resolvedLang ? `language-${resolvedLang}` : ''} />
        )}
      </pre>
    </div>
  )
}

// ─── AnswerText — markdown-aware renderer ────────────────────────────────────
function AnswerText({ content, fontSize, isStreaming }: { content: string; fontSize: number; isStreaming: boolean }) {
  const segments = content.split(/(```[\s\S]*?```)/g)
  return (
    <div className="space-y-1.5" style={{ WebkitFontSmoothing: 'antialiased', MozOsxFontSmoothing: 'grayscale' } as React.CSSProperties}>
      {segments.map((seg, i) => {
        if (seg.startsWith('```')) {
          const inner = seg.slice(3, -3)
          const nlIdx = inner.indexOf('\n')
          const lang  = nlIdx > 0 ? inner.slice(0, nlIdx).trim().toLowerCase() : ''
          const code  = nlIdx >= 0 ? inner.slice(nlIdx + 1) : inner
          return <CodeBlock key={i} code={code} language={lang || undefined} isStreaming={isStreaming} />
        }
        return <TextBlocks key={i} text={seg} fontSize={fontSize} />
      })}
    </div>
  )
}
