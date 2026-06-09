import { ExternalLink, Monitor, Sparkles } from './Icons'
import type { AuthUser } from '@/types'

interface Props {
  user: AuthUser
}

export function IdleScreen({ user }: Props) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 text-center gap-5">
      <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center shadow-lg shadow-green-500/20">
        <Monitor className="h-7 w-7 text-white" />
      </div>

      <div>
        <p className="text-white font-semibold mb-1">Ready</p>
        <p className="text-gray-400 text-xs leading-relaxed">
          Signed in as{' '}
          <span className="text-white font-medium">{user.email}</span>
        </p>
        <p className="text-gray-500 text-xs mt-1">
          {user.credits.toFixed(1)} credits remaining
        </p>
      </div>

      <div className="w-full space-y-2">
        <p className="text-gray-500 text-[11px]">
          Start a session from your browser — this overlay will activate automatically.
        </p>
        <button
          onClick={() => window.electronAPI.shell.openExternal('http://localhost:4000/dashboard')}
          className="flex items-center justify-center gap-2 w-full py-2 px-4 bg-white/8 hover:bg-white/15 border border-white/10 rounded-xl text-sm font-medium text-white transition-colors"
        >
          <ExternalLink className="h-4 w-4" />
          Open Dashboard
        </button>
      </div>

      <div className="flex items-center gap-1.5 text-gray-700 text-[10px]">
        <Sparkles className="h-3 w-3" />
        Shortcuts: ⌘⇧A Answer · ⌘⇧S Screen · ⌘⇧H Hide
      </div>
    </div>
  )
}
