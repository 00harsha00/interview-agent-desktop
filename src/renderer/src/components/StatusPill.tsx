/**
 * StatusPill — compact header status indicator with pulsing dot
 * Displays current session status with visual feedback
 */
import React from 'react'
import { cn } from '@/lib/utils'

export type StatusType = 'idle' | 'listening' | 'processing' | 'speaking' | 'error'

interface StatusPillProps {
  status: StatusType
  label?: string
  isActive?: boolean
  onClick?: () => void
}

const statusConfig: Record<StatusType, { color: string; label: string; dot: string }> = {
  idle: { color: 'text-white/40', label: 'Idle', dot: 'bg-white/30' },
  listening: { color: 'text-indigo-400', label: 'Listening…', dot: 'bg-indigo-400 animate-pulse-dot' },
  processing: { color: 'text-indigo-300', label: 'Processing…', dot: 'bg-indigo-300 animate-spin-slow' },
  speaking: { color: 'text-indigo-400', label: 'Speaking…', dot: 'bg-indigo-400 animate-pulse-dot' },
  error: { color: 'text-red-400', label: 'Error', dot: 'bg-red-400' },
}

export function StatusPill({ status, label, isActive = true, onClick }: StatusPillProps) {
  const config = statusConfig[status]
  const displayLabel = label || config.label

  return (
    <div
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 px-3 h-7 rounded-full transition-all',
        isActive ? 'cursor-pointer hover:bg-white/5' : 'cursor-default',
        config.color
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full flex-shrink-0', config.dot)} />
      <span className="text-[11px] font-medium tracking-wide">{displayLabel}</span>
    </div>
  )
}
