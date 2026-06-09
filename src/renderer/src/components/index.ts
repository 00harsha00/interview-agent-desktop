/**
 * Components index — centralized exports for all UI components
 * Re-export all semantic components for convenient importing
 */

export { Button } from './Button'
export type { } from './Button'

export { StatusPill } from './StatusPill'
export type { StatusType } from './StatusPill'

export { MicSelector } from './MicSelector'
export type { AudioDevice } from './MicSelector'

export { TranscriptPanel } from './TranscriptPanel'
export type { TranscriptEntry } from './TranscriptPanel'

export { SolutionBox } from './SolutionBox'

export { ControlFooter, ControlIcons } from './ControlFooter'
export type { ControlAction } from './ControlFooter'

// Re-export existing components
export { TitleBar } from './TitleBar'
export { SessionOverlay } from './SessionOverlay'
export { IdleScreen } from './IdleScreen'
export { AuthGate } from './AuthGate'
export { ErrorBoundary } from './ErrorBoundary'
export { Icons } from './Icons'
