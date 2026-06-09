/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  PARAKEET DESKTOP — COMPONENT USAGE GUIDE
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * A complete reference for the new macOS-first design system components.
 * All components are designed for:
 * - Semantic HTML output
 * - Smooth micro-interactions
 * - Consistent indigo/blue accent colors
 * - Glass-morphism vibrancy effects
 * - Accessibility-first approach
 */

/* ───────────────────────────────────────────────────────────────────────────
   1. BUTTON COMPONENT
   ─────────────────────────────────────────────────────────────────────────── */

/**
 * Usage:
 * ```tsx
 * import { Button } from '@/components'
 *
 * <Button variant="accent" size="md" onClick={handleClick}>
 *   Send Answer
 * </Button>
 *
 * <Button variant="secondary" icon={<IconComponent />}>
 *   Settings
 * </Button>
 *
 * <Button variant="ghost" disabled>
 *   Clear (Disabled)
 * </Button>
 * ```
 *
 * Props:
 * - variant: 'primary' | 'secondary' | 'accent' | 'ghost' (default: 'primary')
 * - size: 'sm' | 'md' | 'lg' (default: 'md')
 * - icon: React.ReactNode (optional)
 * - loading: boolean (shows spinner)
 * - disabled: boolean
 * - All standard HTMLButtonElement attributes
 */

/* ───────────────────────────────────────────────────────────────────────────
   2. STATUS PILL COMPONENT
   ─────────────────────────────────────────────────────────────────────────── */

/**
 * Usage:
 * ```tsx
 * import { StatusPill, type StatusType } from '@/components'
 * import { useState } from 'react'
 *
 * function Header() {
 *   const [status, setStatus] = useState<StatusType>('listening')
 *
 *   return (
 *     <div className="flex items-center justify-between">
 *       <StatusPill status={status} label="Listening…" isActive />
 *       <div>Other header items...</div>
 *     </div>
 *   )
 * }
 * ```
 *
 * Status Types: 'idle' | 'listening' | 'processing' | 'speaking' | 'error'
 * - idle: Gray dot, inactive
 * - listening: Pulsing indigo dot (animate-pulse-dot)
 * - processing: Spinning indigo dot
 * - speaking: Pulsing indigo dot
 * - error: Red dot (no animation)
 *
 * Props:
 * - status: StatusType (required)
 * - label: string (optional, uses default if not provided)
 * - isActive: boolean (controls hover state)
 * - onClick: () => void (optional, for opening menu)
 */

/* ───────────────────────────────────────────────────────────────────────────
   3. MIC SELECTOR COMPONENT
   ─────────────────────────────────────────────────────────────────────────── */

/**
 * Usage:
 * ```tsx
 * import { MicSelector, type AudioDevice } from '@/components'
 * import { useState } from 'react'
 *
 * function AudioSetup() {
 *   const [inputId, setInputId] = useState<string>('default')
 *   const [outputId, setOutputId] = useState<string>('default')
 *
 *   const inputDevices: AudioDevice[] = [
 *     { id: 'default', label: 'MacBook Pro Microphone', type: 'input' },
 *     { id: 'ext-mic', label: 'Shure SM7B', type: 'input' },
 *   ]
 *
 *   const outputDevices: AudioDevice[] = [
 *     { id: 'default', label: 'MacBook Pro Speakers', type: 'output' },
 *     { id: 'headphones', label: 'AirPods Pro', type: 'output' },
 *   ]
 *
 *   return (
 *     <MicSelector
 *       selectedInputId={inputId}
 *       selectedOutputId={outputId}
 *       inputDevices={inputDevices}
 *       outputDevices={outputDevices}
 *       onInputChange={setInputId}
 *       onOutputChange={setOutputId}
 *       compact={true}
 *     />
 *   )
 * }
 * ```
 *
 * Props:
 * - selectedInputId: string
 * - selectedOutputId: string
 * - inputDevices: AudioDevice[]
 * - outputDevices: AudioDevice[]
 * - onInputChange: (id: string) => void
 * - onOutputChange: (id: string) => void
 * - compact: boolean (show only icons, default: true)
 */

/* ───────────────────────────────────────────────────────────────────────────
   4. TRANSCRIPT PANEL COMPONENT
   ─────────────────────────────────────────────────────────────────────────── */

/**
 * Usage:
 * ```tsx
 * import { TranscriptPanel, type TranscriptEntry } from '@/components'
 * import { useEffect, useState } from 'react'
 *
 * function LiveTranscript() {
 *   const [entries, setEntries] = useState<TranscriptEntry[]>([])
 *
 *   useEffect(() => {
 *     // As new text arrives from WebSocket/API:
 *     const newEntry: TranscriptEntry = {
 *       id: `entry-${Date.now()}`,
 *       text: 'This is the user speaking...',
 *       timestamp: new Date(),
 *       isCurrent: true,
 *       speaker: 'user',
 *     }
 *     setEntries(prev => [...prev, newEntry])
 *   }, [])
 *
 *   return (
 *     <div className="h-64">
 *       <TranscriptPanel
 *         entries={entries}
 *         maxEntries={8}
 *         showTimestamps={false}
 *         speakerLabels={true}
 *       />
 *     </div>
 *   )
 * }
 * ```
 *
 * Fade Behavior:
 * - isCurrent=true lines: opacity 100%
 * - Previous lines: opacity 35% (fade effect)
 * - Auto-scrolls to newest entry
 * - Smooth opacity transitions
 *
 * Props:
 * - entries: TranscriptEntry[] (required)
 * - maxEntries: number (default: 8)
 * - showTimestamps: boolean (default: false)
 * - speakerLabels: boolean (default: false)
 * - className: string (optional)
 */

/* ───────────────────────────────────────────────────────────────────────────
   5. SOLUTION BOX COMPONENT
   ─────────────────────────────────────────────────────────────────────────── */

/**
 * Usage:
 * ```tsx
 * import { SolutionBox } from '@/components'
 *
 * function AnswerDisplay() {
 *   const markdown = `
 * The answer to your question:
 *
 * **Key Points:**
 * - First point
 * - Second point with \`code\` inline
 * - Third point
 *
 * For more info, check the \`documentation\`.
 *   `
 *
 *   return (
 *     <SolutionBox
 *       title="Solution"
 *       content={markdown}
 *       highlighted={true}
 *       onCopy={(text) => navigator.clipboard.writeText(text)}
 *       showCopyButtons={true}
 *     />
 *   )
 * }
 * ```
 *
 * Features:
 * - Markdown-like formatting: **bold**, *italic*, \`code\`
 * - Copy to clipboard button
 * - Elevated background with subtle gradient
 * - Syntax highlighting for code blocks
 * - Smooth scale-in animation
 * - Optional title header
 * - Border highlight when highlighted=true
 *
 * Props:
 * - content: string (required) - markdown-like content
 * - title: string (optional)
 * - onCopy: (text: string) => void (optional)
 * - showCopyButtons: boolean (default: true)
 * - highlighted: boolean (default: false) - adds indigo border
 * - className: string (optional)
 */

/* ───────────────────────────────────────────────────────────────────────────
   6. CONTROL FOOTER COMPONENT
   ─────────────────────────────────────────────────────────────────────────── */

/**
 * Usage:
 * ```tsx
 * import { ControlFooter, ControlIcons, type ControlAction } from '@/components'
 * import { useState } from 'react'
 *
 * function SessionFooter() {
 *   const [isLoading, setIsLoading] = useState(false)
 *
 *   const actions: ControlAction[] = [
 *     {
 *       id: 'send',
 *       label: 'Send',
 *       icon: <ControlIcons.Send />,
 *       onClick: () => console.log('Sending...'),
 *       accent: true,
 *       shortcut: '↵',
 *     },
 *     {
 *       id: 'copy',
 *       label: 'Copy',
 *       icon: <ControlIcons.Copy />,
 *       onClick: () => console.log('Copied'),
 *       disabled: isLoading,
 *     },
 *     {
 *       id: 'divider',
 *       label: 'divider',
 *       hidden: true,
 *     },
 *     {
 *       id: 'clear',
 *       label: 'Clear',
 *       icon: <ControlIcons.Trash />,
 *       onClick: () => console.log('Clearing...'),
 *       shortcut: '⌘⇧⌫',
 *     },
 *   ]
 *
 *   return (
 *     <ControlFooter
 *       actions={actions}
 *       dividerAfter={['send']}
 *       sticky={true}
 *     />
 *   )
 * }
 * ```
 *
 * Available Icons:
 * - ControlIcons.Send
 * - ControlIcons.Copy
 * - ControlIcons.Trash
 * - ControlIcons.Settings
 * - ControlIcons.Share
 * - ControlIcons.Close
 *
 * Props:
 * - actions: ControlAction[] (required)
 * - dividerAfter: string[] (action IDs after which to add dividers)
 * - sticky: boolean (default: true)
 * - className: string (optional)
 *
 * ControlAction interface:
 * {
 *   id: string (unique identifier)
 *   label: string (button text)
 *   icon?: React.ReactNode
 *   onClick: () => void
 *   disabled?: boolean
 *   accent?: boolean (use indigo accent style)
 *   shortcut?: string (display shortcut hint)
 *   hidden?: boolean (hide from rendering)
 * }
 */

/* ───────────────────────────────────────────────────────────────────────────
   COLOR SYSTEM
   ─────────────────────────────────────────────────────────────────────────── */

/**
 * Available color tokens (via Tailwind + CSS custom properties):
 *
 * Backgrounds:
 * - bg-primary: #1e293b (surface)
 * - bg-secondary: #0f172a (panel/elevated)
 * - bg-tertiary: #0a0f1a (deep)
 *
 * Accents (Indigo):
 * - accent-primary: #6366f1 (main indigo-500)
 * - accent-secondary: #818cf8 (indigo-400)
 * - accent-light: #a5b4fc (indigo-300)
 * - accent-muted: rgba(99, 102, 241, 0.12)
 * - accent-border: rgba(99, 102, 241, 0.3)
 *
 * Text:
 * - text-primary: #f1f5f9 (100% opacity)
 * - text-secondary: rgba(255, 255, 255, 0.6) (60%)
 * - text-tertiary: rgba(255, 255, 255, 0.35) (35%)
 * - text-muted: rgba(255, 255, 255, 0.18) (18%)
 *
 * Usage in components:
 * className="text-accent-primary bg-bg-secondary"
 */

/* ───────────────────────────────────────────────────────────────────────────
   DESIGN PATTERNS
   ─────────────────────────────────────────────────────────────────────────── */

/**
 * Elevation Layering:
 * - Level 1: bg-secondary (elevated cards)
 * - Level 2: bg-tertiary (deeply nested)
 * - Level 3: rgba opacity modifiers
 *
 * Hover States:
 * - Buttons scale to 0.97 on active
 * - Backgrounds shift +10% lighter
 * - Borders brighten +20% opacity
 *
 * Animations:
 * - fade-in: 150ms opacity + translateY(-6px)
 * - slide-up: 200ms from bottom
 * - scale-pulse: 2s breathing effect
 * - spin-slow: 2s rotation for loaders
 *
 * Micro Interactions:
 * - Button presses: scale + color shift
 * - Hover glow: subtle shadow on accent buttons
 * - Copy feedback: icon swap with checkmark
 * - Loading states: spinner or pulse animation
 */

/* ───────────────────────────────────────────────────────────────────────────
   INTEGRATION CHECKLIST
   ─────────────────────────────────────────────────────────────────────────── */

/**
 * ✓ Phase 1: Color tokens updated in tailwind.config.js
 * ✓ Phase 2: macOS vibrancy layer (blur(20px)) in index.css
 * ✓ Phase 3: StatusPill + MicSelector components
 * ✓ Phase 4: TranscriptPanel with fade effect
 * ✓ Phase 5: SolutionBox markdown card
 * ✓ Phase 6: ControlFooter utility ribbon
 * ✓ Phase 7: Enhanced animations in index.css
 * □ Phase 8: Integrate into SessionOverlay
 * □ Phase 8: Test on macOS native window
 * □ Phase 8: Cross-platform compatibility check
 * □ Phase 8: Performance optimization (no jank)
 */
