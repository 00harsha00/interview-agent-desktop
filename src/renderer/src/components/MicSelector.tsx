import React, { useState, useRef, useCallback, useEffect } from 'react'

export interface AudioDevice {
  id: string
  label: string
  type: 'input' | 'output'
}

interface MicSelectorProps {
  selectedInputId?: string
  inputDevices?: AudioDevice[]
  onInputChange?: (deviceId: string) => void
  compact?: boolean
  flipped?: boolean
}

export function MicSelector({
  selectedInputId,
  inputDevices = [],
  onInputChange,
  compact = true,
  flipped = false,
}: MicSelectorProps) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)

  const toggle = useCallback(() => {
    if (!open) {
      const rect = btnRef.current?.getBoundingClientRect()
      if (rect) {
        window.electronAPI.mic.showSelector({
          x: rect.left,
          y: flipped ? rect.top : rect.bottom,
          width: rect.width,
          height: rect.height,
          flipped,
          devices: inputDevices.map(d => ({ id: d.id, label: d.label, type: d.type })),
          selectedId: selectedInputId,
        })
        setOpen(true)
      }
    } else {
      window.electronAPI.mic.hideSelector()
      setOpen(false)
    }
  }, [open, flipped, inputDevices, selectedInputId])

  useEffect(() => {
    const unsub1 = window.electronAPI.on('mic:device-selected', (deviceId: unknown) => {
      onInputChange?.(deviceId as string)
      setOpen(false)
    })
    const unsub2 = window.electronAPI.on('mic:selector-closed', () => {
      setOpen(false)
    })
    return () => { unsub1(); unsub2() }
  }, [onInputChange])

  if (!inputDevices.length) return null

  return (
    <button
      ref={btnRef}
      onClick={toggle}
      className="flex items-center justify-center transition-all"
      style={{
        padding: '4px 5px', borderRadius: 6,
        color: 'rgba(255,255,255,0.5)',
      }}
      onMouseOver={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; e.currentTarget.style.color = 'rgba(255,255,255,0.9)' }}
      onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.5)' }}
    >
      <svg style={{ width: 10, height: 10 }} fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
      </svg>
    </button>
  )
}
