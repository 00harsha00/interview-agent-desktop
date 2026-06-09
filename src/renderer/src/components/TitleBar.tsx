/**
 * TitleBar — draggable, always rendered at the top.
 * On macOS, native traffic-light buttons are left-padded.
 * On Windows/Linux we render our own close/minimize buttons.
 */
import React, { useEffect, useState } from 'react'

interface Props {
  label?: string
  isActive?: boolean
}

export function TitleBar({ label = 'ParakeetAI', isActive = false }: Props) {
  const [platform, setPlatform] = useState<string>('darwin')

  useEffect(() => {
    window.electronAPI.app.platform().then(setPlatform).catch(() => {})
  }, [])

  return (
    <div
      className="flex items-center justify-between h-9 px-3 bg-gray-950 select-none flex-shrink-0 border-b border-white/5"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* macOS: leave space for native traffic-light buttons */}
      {platform === 'darwin' ? (
        <div className="w-16" />
      ) : (
        // Windows/Linux: render custom controls on the left
        <div
          className="flex items-center gap-1"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <WinBtn color="bg-red-500"    onClick={() => window.electronAPI.window.close()} title="Close" />
          <WinBtn color="bg-yellow-400" onClick={() => window.electronAPI.window.minimize()} title="Minimize" />
        </div>
      )}

      {/* Center label */}
      <div className="flex items-center gap-1.5 absolute left-1/2 -translate-x-1/2">
        <div className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-green-400 animate-pulse' : 'bg-gray-600'}`} />
        <span className="text-[11px] font-medium text-white/40 tracking-wide">{label}</span>
      </div>

      {/* Right: hide button */}
      <button
        onClick={() => window.electronAPI.window.hide()}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        className="h-5 w-5 rounded flex items-center justify-center text-white/25 hover:text-white/70 hover:bg-white/10 transition-colors"
        title="Hide (Cmd+Shift+H)"
      >
        <svg width="10" height="2" viewBox="0 0 10 2" fill="currentColor">
          <rect width="10" height="1.5" rx="0.75" />
        </svg>
      </button>
    </div>
  )
}

function WinBtn({ color, onClick, title }: { color: string; onClick: () => void; title: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`h-3 w-3 rounded-full ${color} hover:opacity-80 transition-opacity`}
    />
  )
}
