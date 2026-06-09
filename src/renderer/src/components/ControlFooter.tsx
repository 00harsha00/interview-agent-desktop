/**
 * ControlFooter — fixed bottom utility ribbon with accent buttons
 * Minimalist design with smooth hover animations
 */
import React from 'react'
import { cn } from '@/lib/utils'

export interface ControlAction {
  id: string
  label: string
  icon?: React.ReactNode
  onClick: () => void
  disabled?: boolean
  accent?: boolean
  shortcut?: string
  hidden?: boolean
}

interface ControlFooterProps {
  actions: ControlAction[]
  className?: string
  dividerAfter?: string[] // action IDs after which to add dividers
  sticky?: boolean
}

export function ControlFooter({
  actions,
  className,
  dividerAfter = [],
  sticky = true,
}: ControlFooterProps) {
  const visibleActions = actions.filter(a => !a.hidden)

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2 px-3 py-2.5',
        'bg-gradient-to-t from-black/10 to-transparent',
        'border-t border-white/6',
        sticky && 'sticky bottom-0',
        className
      )}
    >
      {/* Action buttons */}
      <div className="flex items-center gap-1.5">
        {visibleActions.map((action, idx) => (
          <React.Fragment key={action.id}>
            <button
              onClick={action.onClick}
              disabled={action.disabled}
              className={cn(
                'flex items-center gap-1.5 px-3 h-7 rounded-lg font-medium text-[12px]',
                'transition-all duration-150 ease-out',
                action.accent
                  ? cn(
                      'bg-indigo-500/15 text-indigo-300 border border-indigo-400/30',
                      'hover:bg-indigo-500/25 hover:border-indigo-400/50 hover:shadow-lg',
                      'hover:shadow-indigo-500/20 active:scale-95'
                    )
                  : cn(
                      'text-white/70 bg-white/5 border border-white/10',
                      'hover:bg-white/10 hover:text-white/85 hover:border-white/20',
                      'active:scale-95'
                    ),
                action.disabled && 'opacity-50 cursor-not-allowed hover:bg-inherit'
              )}
              title={action.shortcut ? `${action.label} (${action.shortcut})` : action.label}
            >
              {action.icon && (
                <span className="flex items-center justify-center w-4 h-4">
                  {action.icon}
                </span>
              )}
              <span>{action.label}</span>
              {action.shortcut && (
                <span className="text-[9px] text-white/30 ml-1 font-mono">
                  {action.shortcut}
                </span>
              )}
            </button>

            {/* Divider after specific actions */}
            {dividerAfter.includes(action.id) && (
              <div className="h-5 w-px bg-white/10 mx-0.5" />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Status/Info area on the right */}
      <div className="text-[10px] text-white/30 whitespace-nowrap">
        {/* Placeholder for status or additional info */}
      </div>
    </div>
  )
}

/**
 * Simple icon components for common actions
 */
export const ControlIcons = {
  Send: () => (
    <svg fill="currentColor" viewBox="0 0 20 20">
      <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5.951-2.976 5.951 2.976a1 1 0 001.169-1.409l-7-14z" />
    </svg>
  ),
  Copy: () => (
    <svg fill="none" strokeWidth="1.5" stroke="currentColor" viewBox="0 0 24 24">
      <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
    </svg>
  ),
  Trash: () => (
    <svg fill="none" strokeWidth="1.5" stroke="currentColor" viewBox="0 0 24 24">
      <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  ),
  Settings: () => (
    <svg fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
    </svg>
  ),
  Share: () => (
    <svg fill="none" strokeWidth="1.5" stroke="currentColor" viewBox="0 0 24 24">
      <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
  ),
  Close: () => (
    <svg fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
    </svg>
  ),
}
