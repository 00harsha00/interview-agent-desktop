import { ExternalLink, Bird, Loader2, Link2 } from './Icons'

interface Props {
  state: 'loading' | 'unauthenticated'
}

export function AuthGate({ state }: Props) {
  const openSignIn = () =>
    window.electronAPI.shell.openExternal('http://localhost:4000/auth/signin')

  const openBridge = () =>
    window.electronAPI.shell.openExternal('http://localhost:4000/auth/desktop-bridge')

  if (state === 'loading') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-white/30">
        <Loader2 className="h-6 w-6 animate-spin" />
        <span className="text-xs">Connecting…</span>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 text-center gap-5">
      <div className="h-14 w-14 rounded-2xl bg-gray-800 flex items-center justify-center">
        <Bird className="h-7 w-7 text-gray-500" />
      </div>

      <div>
        <p className="text-white font-semibold mb-1">Sign in to get started</p>
        <p className="text-gray-400 text-xs leading-relaxed">
          Already signed in at{' '}
          <span className="text-white font-medium">localhost:4000</span>?
          <br />
          Click <span className="text-green-400 font-medium">Connect App</span> to link your session.
        </p>
      </div>

      {/* Primary: connect browser session → Electron */}
      <button
        onClick={openBridge}
        className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-green-600 hover:bg-green-500 rounded-xl text-sm font-semibold text-white transition-colors shadow-lg shadow-green-600/20"
      >
        <Link2 className="h-4 w-4" />
        Connect App
      </button>

      {/* Secondary: go sign in first */}
      <button
        onClick={openSignIn}
        className="flex items-center justify-center gap-2 w-full px-4 py-2 bg-white/8 hover:bg-white/15 border border-white/10 rounded-xl text-sm font-medium text-white/70 transition-colors"
      >
        <ExternalLink className="h-4 w-4" />
        Sign In First
      </button>

      <p className="text-gray-600 text-[11px] leading-relaxed">
        "Connect App" opens a browser page that links<br />
        your existing session to this overlay.
      </p>
    </div>
  )
}
