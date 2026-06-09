import React from 'react'

interface State { error: Error | null }

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info)
  }

  render() {
    const { error } = this.state
    if (error) {
      return (
        <div
          className="rounded-2xl overflow-hidden shadow-2xl border border-red-500/20"
          style={{ background: 'rgba(20,10,10,0.97)' }}
        >
          <div className="flex items-center gap-2 px-3 py-2 bg-red-900/30 border-b border-red-500/20"
               style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
            <div className="h-6 w-6 rounded-lg bg-green-500 flex items-center justify-center flex-shrink-0">
              <span className="text-white font-black text-[10px]">P</span>
            </div>
            <span className="text-white text-xs font-semibold">I<span className="text-green-400">AI</span></span>
            <div className="flex-1" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />
            <button
              onClick={() => this.setState({ error: null })}
              className="h-5 px-2 rounded text-[10px] text-white/60 hover:text-white border border-white/15 hover:bg-white/10"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              Retry
            </button>
          </div>
          <div className="px-4 py-4 space-y-2">
            <p className="text-red-400 text-sm font-semibold">Something went wrong</p>
            <p className="text-white/50 text-[11px] font-mono bg-white/5 rounded p-2 break-all">
              {error.message}
            </p>
            <button
              onClick={() => { this.setState({ error: null }); window.location.reload() }}
              className="w-full py-2 rounded-xl bg-white/8 hover:bg-white/15 text-white/70 text-[13px] transition-colors"
            >
              Reload App
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
