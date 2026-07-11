/**
 * MicSelector — audio input/output device selector dropdown
 * Clean, minimal design for selecting mic & speaker
 *
 * TODO: built but not yet wired into the live app — only referenced from
 * INTEGRATION_EXAMPLES.tsx. useSystemAudio always captures the OS-default
 * input device with no way to pick a non-default mic. Wire this into
 * IdleScreen or the toolbar/settings popover when mic selection ships.
 */
import React, { useState, useRef, useEffect } from 'react'
import { cn } from '@/lib/utils'

export interface AudioDevice {
  id: string
  label: string
  type: 'input' | 'output'
}

interface MicSelectorProps {
  selectedInputId?: string
  selectedOutputId?: string
  inputDevices?: AudioDevice[]
  outputDevices?: AudioDevice[]
  onInputChange?: (deviceId: string) => void
  onOutputChange?: (deviceId: string) => void
  compact?: boolean
}

export function MicSelector({
  selectedInputId,
  selectedOutputId,
  inputDevices = [],
  outputDevices = [],
  onInputChange,
  onOutputChange,
  compact = true,
}: MicSelectorProps) {
  const [openMenu, setOpenMenu] = useState<'input' | 'output' | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenu(null)
      }
    }
    if (openMenu) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [openMenu])

  const selectedInput = inputDevices.find(d => d.id === selectedInputId)
  const selectedOutput = outputDevices.find(d => d.id === selectedOutputId)

  if (!inputDevices.length && !outputDevices.length) {
    return <div className="text-[10px] text-white/30">No devices</div>
  }

  return (
    <div ref={menuRef} className="relative">
      <div className="flex items-center gap-1.5">
        {/* Input device selector */}
        {inputDevices.length > 0 && (
          <button
            onClick={() => setOpenMenu(openMenu === 'input' ? null : 'input')}
            className="flex items-center gap-1.5 px-2.5 h-6 rounded-md hover:bg-white/5 transition-colors"
            title="Select input device"
          >
            <svg className="h-3.5 w-3.5 text-white/50" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
            </svg>
            {!compact && selectedInput && (
              <span className="text-[10px] text-white/60 max-w-[80px] truncate">{selectedInput.label}</span>
            )}
          </button>
        )}

        {/* Output device selector */}
        {outputDevices.length > 0 && (
          <button
            onClick={() => setOpenMenu(openMenu === 'output' ? null : 'output')}
            className="flex items-center gap-1.5 px-2.5 h-6 rounded-md hover:bg-white/5 transition-colors"
            title="Select output device"
          >
            <svg className="h-3.5 w-3.5 text-white/50" fill="currentColor" viewBox="0 0 24 24">
              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
            </svg>
            {!compact && selectedOutput && (
              <span className="text-[10px] text-white/60 max-w-[80px] truncate">{selectedOutput.label}</span>
            )}
          </button>
        )}
      </div>

      {/* Dropdown menu */}
      {openMenu && (
        <div className="absolute top-8 left-0 z-50 min-w-max animate-fade-in">
          <div className="overlay-card p-1 shadow-lg">
            {openMenu === 'input' && inputDevices.length > 0 && (
              <div className="space-y-0.5">
                <div className="px-2 py-1 text-[10px] text-white/40 font-semibold">Microphone</div>
                {inputDevices.map(device => (
                  <button
                    key={device.id}
                    onClick={() => {
                      onInputChange?.(device.id)
                      setOpenMenu(null)
                    }}
                    className={cn(
                      'w-full text-left px-3 py-1.5 text-[11px] rounded-md transition-all',
                      selectedInputId === device.id
                        ? 'bg-indigo-500/20 text-indigo-300'
                        : 'text-white/60 hover:bg-white/5 hover:text-white/80'
                    )}
                  >
                    {device.label}
                  </button>
                ))}
              </div>
            )}

            {openMenu === 'output' && outputDevices.length > 0 && (
              <div className="space-y-0.5">
                <div className="px-2 py-1 text-[10px] text-white/40 font-semibold">Speaker</div>
                {outputDevices.map(device => (
                  <button
                    key={device.id}
                    onClick={() => {
                      onOutputChange?.(device.id)
                      setOpenMenu(null)
                    }}
                    className={cn(
                      'w-full text-left px-3 py-1.5 text-[11px] rounded-md transition-all',
                      selectedOutputId === device.id
                        ? 'bg-indigo-500/20 text-indigo-300'
                        : 'text-white/60 hover:bg-white/5 hover:text-white/80'
                    )}
                  >
                    {device.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
