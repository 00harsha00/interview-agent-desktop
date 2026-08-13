import { useEffect, useState } from 'react'

interface DeviceData {
  devices: { id: string; label: string; type: string }[]
  selectedId?: string
}

export function MicSelectorView() {
  const [data, setData] = useState<DeviceData | null>(null)

  useEffect(() => {
    return window.electronAPI.on('mic:devices', (d: unknown) => setData(d as DeviceData))
  }, [])

  if (!data || !data.devices.length) return null

  return (
    <div style={{
      display: 'flex',
      alignItems: 'stretch',
      justifyContent: 'center',
      width: '100%',
      height: '100%',
    }}>
      <div style={{
        background: 'rgba(10,10,14,0.97)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 10,
        boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)',
        padding: '6px 0',
        width: '100%',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
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
        {data.devices.map(device => {
          const isSelected = data.selectedId === device.id
          return (
            <button
              key={device.id}
              onClick={() => window.electronAPI.mic.selectDevice(device.id)}
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
              onMouseOut={(e) => { if (!isSelected) e.currentTarget.style.background = isSelected ? 'rgba(99,102,241,0.25)' : 'transparent' }}
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
    </div>
  )
}
