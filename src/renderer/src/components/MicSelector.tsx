/**
 * MicSelector — custom styled dropdown for audio input device selection.
 * Uses ReactDOM.createPortal to render into document.body so the dropdown
 * is never clipped by parent overflow. Opens upward at bottom snap positions,
 * downward at top snap positions.
 */
import React, { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'

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
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, direction: 'down' as 'up' | 'down' })
  const btnRef = useRef<HTMLButtonElement>(null)

  const updatePosition = useCallback(() => {
    const rect = btnRef.current?.getBoundingClientRect()
    if (!rect) return
    const direction = flipped ? 'up' : 'down'
    setDropdownPos({
      top: direction === 'down' ? rect.bottom + 4 : rect.top - 4,
      left: rect.left + rect.width / 2,
      direction,
    })
  }, [flipped])

  const toggle = useCallback(() => {
    if (!open) updatePosition()
    setOpen(v => !v)
  }, [open, updatePosition])

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  if (!inputDevices.length) return null

  return (
    <>
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
      {open && createPortal(
        <div
          style={{
            position: 'fixed',
            top: dropdownPos.direction === 'down' ? dropdownPos.top : undefined,
            bottom: dropdownPos.direction === 'up' ? window.innerHeight - dropdownPos.top : undefined,
            left: dropdownPos.left,
            transform: 'translateX(-50%)',
            zIndex: 99999,
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div style={{
            background: 'rgba(10,10,14,0.97)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 10,
            boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)',
            padding: '6px 0',
            minWidth: 180,
            maxWidth: 280,
          }}>
            <div style={{
              padding: '4px 14px 6px',
              fontSize: 10,
              fontWeight: 600,
              color: 'rgba(255,255,255,0.35)',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}>
              Microphone
            </div>
            {inputDevices.map(device => {
              const isSelected = selectedInputId === device.id
              return (
                <button
                  key={device.id}
                  onClick={() => {
                    onInputChange?.(device.id)
                    setOpen(false)
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 14px',
                    fontSize: 12,
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'background 0.12s',
                    background: isSelected ? 'rgba(99,102,241,0.25)' : 'transparent',
                    color: isSelected ? '#fff' : 'rgba(255,255,255,0.8)',
                  }}
                  onMouseOver={(e) => { if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.07)' }}
                  onMouseOut={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent' }}
                >
                  {isSelected && (
                    <svg style={{ width: 14, height: 14, flexShrink: 0 }} fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                  {!isSelected && <span style={{ width: 14, flexShrink: 0 }} />}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {device.label}
                  </span>
                </button>
              )
            })}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
