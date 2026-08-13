import { useEffect, useState } from 'react'

export function TooltipView() {
  const [text, setText] = useState('')

  useEffect(() => {
    return window.electronAPI.on('tooltip:update', (t: unknown) => setText(t as string))
  }, [])

  if (!text) return null

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      height: '100%',
    }}>
      <div style={{
        background: 'rgba(10,10,14,0.97)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 7,
        padding: '4px 10px',
        fontSize: 11,
        color: 'rgba(255,255,255,0.9)',
        whiteSpace: 'nowrap',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}>
        {text}
      </div>
    </div>
  )
}
