/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  INTEGRATION EXAMPLE — Using New Components in SessionOverlay
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * This example demonstrates how to integrate the new macOS-first components
 * into the existing SessionOverlay component.
 */

import React, { useState } from 'react'
import {
  Button,
  StatusPill,
  MicSelector,
  TranscriptPanel,
  SolutionBox,
  ControlFooter,
  ControlIcons,
} from '@/components'
import type { StatusType } from '@/components'
import type { TranscriptEntry } from '@/components'
import type { ControlAction } from '@/components'
import type { AudioDevice } from '@/components'

// ────────────────────────────────────────────────────────────────────────────
// Example: Enhanced Session Header
// ────────────────────────────────────────────────────────────────────────────

function EnhancedSessionHeader() {
  const [status, setStatus] = useState<StatusType>('idle')
  const [selectedMicId, setSelectedMicId] = useState('default')

  const micDevices: AudioDevice[] = [
    { id: 'default', label: 'MacBook Microphone', type: 'input' },
    { id: 'ext', label: 'External Mic', type: 'input' },
  ]

  return (
    <div className="overlay-card overflow-hidden">
      {/* Header with vibrancy */}
      <div className="overlay-header flex items-center justify-between">
        <div className="flex items-center gap-2">
          <StatusPill status={status} isActive />
        </div>

        {/* Center: Session title */}
        <div className="flex-1 text-center">
          <h2 className="text-[13px] font-semibold text-white/75">
            Interview Session #123
          </h2>
        </div>

        {/* Right: Device selector */}
        <div className="flex items-center gap-2">
          <MicSelector
            inputDevices={micDevices}
            selectedInputId={selectedMicId}
            onInputChange={setSelectedMicId}
            compact={true}
          />
        </div>
      </div>

      {/* Content area with transcript */}
      <div className="p-4 space-y-4">
        <TranscriptPanel
          entries={[
            // Mock entries
            {
              id: '1',
              text: 'Previous message with fade effect',
              timestamp: new Date(),
              speaker: 'user',
            },
            {
              id: '2',
              text: 'Current message being displayed',
              timestamp: new Date(),
              speaker: 'assistant',
              isCurrent: true,
            },
          ]}
          maxEntries={5}
          speakerLabels
          showTimestamps={false}
        />
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Example: Solution Display with Markdown
// ────────────────────────────────────────────────────────────────────────────

function SolutionDisplayExample() {
  const sampleMarkdown = `
**Answer to your question:**

Here are the **key points**:
- First important detail
- Second important detail with \`code\` example
- Third important detail

For implementation, use \`const result = compute()\`
  `

  return (
    <div className="space-y-3 p-4">
      <h3 className="text-[12px] font-semibold text-white/75">Response</h3>
      <SolutionBox
        title="Solution"
        content={sampleMarkdown}
        highlighted={true}
        showCopyButtons={true}
        onCopy={(text) => {
          navigator.clipboard.writeText(text)
          console.log('Copied:', text)
        }}
      />
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Example: Control Footer with Actions
// ────────────────────────────────────────────────────────────────────────────

function ControlFooterExample() {
  const [isLoading, setIsLoading] = useState(false)

  const actions: ControlAction[] = [
    {
      id: 'send-answer',
      label: 'Send Answer',
      icon: <ControlIcons.Send />,
      onClick: async () => {
        setIsLoading(true)
        // Simulate API call
        await new Promise(resolve => setTimeout(resolve, 2000))
        setIsLoading(false)
      },
      accent: true,
      shortcut: '⌘↵',
    },
    {
      id: 'take-screenshot',
      label: 'Screenshot',
      icon: <ControlIcons.Share />,
      onClick: () => console.log('Taking screenshot...'),
      shortcut: '⌘⇧↵',
    },
    {
      id: 'divider',
      label: '',
      hidden: true,
    },
    {
      id: 'clear-chat',
      label: 'Clear',
      icon: <ControlIcons.Trash />,
      onClick: () => console.log('Clearing...'),
      shortcut: '⌘⇧⌫',
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: <ControlIcons.Settings />,
      onClick: () => console.log('Opening settings...'),
      disabled: isLoading,
    },
  ]

  return (
    <ControlFooter
      actions={actions}
      dividerAfter={['take-screenshot']}
      sticky={true}
      className="mt-auto"
    />
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Example: Button Variants
// ────────────────────────────────────────────────────────────────────────────

function ButtonVariantsExample() {
  return (
    <div className="space-y-3 p-4">
      <div className="flex gap-2 flex-wrap">
        <Button variant="accent" size="md">
          Accent Button
        </Button>
        <Button variant="primary" size="md">
          Primary Button
        </Button>
        <Button variant="secondary" size="md">
          Secondary Button
        </Button>
        <Button variant="ghost" size="md">
          Ghost Button
        </Button>
      </div>

      <div className="flex gap-2 flex-wrap">
        <Button
          variant="accent"
          size="lg"
          icon={<ControlIcons.Send />}
        >
          Large with Icon
        </Button>
        <Button variant="primary" size="sm">
          Small Button
        </Button>
        <Button variant="accent" disabled>
          Disabled Button
        </Button>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Integration Notes
// ────────────────────────────────────────────────────────────────────────────

/**
 * How to integrate these components into SessionOverlay:
 *
 * 1. HEADER REPLACEMENT:
 *    Replace current header with EnhancedSessionHeader
 *    - StatusPill shows session state (listening, processing, etc)
 *    - MicSelector allows audio device switching
 *    - Matches macOS native design
 *
 * 2. TRANSCRIPT DISPLAY:
 *    Use TranscriptPanel for live streaming text
 *    - Automatically fades previous messages to 35% opacity
 *    - Current message stays at 100% visibility
 *    - Smooth opacity transitions as new text arrives
 *    - Optional speaker labels and timestamps
 *
 * 3. SOLUTION DISPLAY:
 *    Replace answer rendering with SolutionBox
 *    - Markdown-like formatting (bold, italic, code)
 *    - Built-in copy-to-clipboard
 *    - Elevated card design with subtle gradient
 *    - Smooth scale-in animation
 *
 * 4. FOOTER ACTIONS:
 *    Replace footer buttons with ControlFooter
 *    - Semantic action configuration
 *    - Accent highlighting for primary actions
 *    - Built-in loading states
 *    - Keyboard shortcut hints
 *
 * MIGRATION STEPS:
 * 1. Import new components in SessionOverlay
 * 2. Replace header section with EnhancedSessionHeader
 * 3. Replace transcript rendering with TranscriptPanel
 * 4. Replace answer card with SolutionBox
 * 5. Replace footer buttons with ControlFooter
 * 6. Test all interactions and animations
 * 7. Verify on macOS with native window
 */

export {
  EnhancedSessionHeader,
  SolutionDisplayExample,
  ControlFooterExample,
  ButtonVariantsExample,
}
