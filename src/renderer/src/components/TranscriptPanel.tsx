/**
 * TranscriptPanel — live transcript stream with intelligent fade layering
 * Previous lines fade to 35% opacity while current text stays at 100%
 */
import React, { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

export interface TranscriptEntry {
  id: string
  text: string
  timestamp: Date
  isCurrent?: boolean
  speaker?: 'user' | 'assistant'
}

interface TranscriptPanelProps {
  entries: TranscriptEntry[]
  maxEntries?: number
  className?: string
  showTimestamps?: boolean
  speakerLabels?: boolean
}

export function TranscriptPanel({
  entries,
  maxEntries = 8,
  className,
  showTimestamps = false,
  speakerLabels = false,
}: TranscriptPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (scrollRef.current && containerRef.current) {
      const { scrollHeight, clientHeight } = scrollRef.current
      if (scrollHeight > clientHeight) {
        scrollRef.current.scrollTop = scrollHeight
      }
    }
  }, [entries])

  const displayEntries = entries.slice(-maxEntries)
  const currentEntryIndex = displayEntries.findIndex(e => e.isCurrent)

  return (
    <div
      ref={containerRef}
      className={cn(
        'flex flex-col gap-2 overflow-hidden',
        className
      )}
    >
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto space-y-2 pr-2"
      >
        {displayEntries.length === 0 ? (
          <div className="h-full flex items-center justify-center text-white/20 text-[12px]">
            Transcript will appear here…
          </div>
        ) : (
          displayEntries.map((entry, idx) => {
            const isCurrent = idx === currentEntryIndex
            const isFading = idx < currentEntryIndex

            return (
              <div
                key={entry.id}
                className={cn(
                  'text-[13px] leading-relaxed transition-all duration-300',
                  isCurrent
                    ? 'text-white opacity-100'
                    : isFading
                      ? 'text-white/35 opacity-100'
                      : 'text-white/50 opacity-90'
                )}
              >
                {/* Speaker label */}
                {speakerLabels && entry.speaker && (
                  <div className="text-[10px] text-white/35 font-semibold mb-0.5">
                    {entry.speaker === 'user' ? '🎤 You' : '🤖 AI'}
                  </div>
                )}

                {/* Main text content */}
                <div className="break-words whitespace-pre-wrap">
                  {entry.text}
                </div>

                {/* Timestamp if enabled */}
                {showTimestamps && (
                  <div className="text-[9px] text-white/20 mt-1">
                    {entry.timestamp.toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </div>
                )}

                {/* Cursor indicator for current entry */}
                {isCurrent && (
                  <span className="inline-block w-1.5 h-4 ml-1 bg-indigo-400 animate-cursor-blink" />
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
