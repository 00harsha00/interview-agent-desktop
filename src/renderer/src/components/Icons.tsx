/**
 * Minimal inline SVG icon set — zero dependency, tree-shakeable.
 * All icons accept standard SVGProps.
 */
import React from 'react'

type P = React.SVGProps<SVGSVGElement>
const i = (d: string) =>
  ({ className, ...rest }: P) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" className={className ?? 'h-4 w-4'} {...rest}>
      <path d={d} />
    </svg>
  )

export const Bird        = i('M16 7h.01M3.4 18H12a8 8 0 0 0 8-8V7a4 4 0 0 0-7.28-2.3L2 20m10.6-9.7L9.5 13')
export const Mic         = i('M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8')
export const MicOff      = i('M1 1l22 22M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23M12 19v4M8 23h8')
export const Monitor     = i('M20 3H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zM8 21h8M12 17v4')
export const MonitorOff  = i('M17 17H4a2 2 0 0 1-2-2V5c0-.53.19-1 .5-1.4M19.9 14.25A2 2 0 0 0 22 12V5a2 2 0 0 0-2-2H9M8 21h8M12 17v4M1 1l22 22')
export const Send        = i('M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z')
export const Camera      = i('M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z')
export const Trash2      = i('M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2')
export const Copy        = i('M20 9H11a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1')
export const Check       = i('M20 6L9 17l-5-5')
export const X           = i('M18 6L6 18M6 6l12 12')
export const Zap         = i('M13 2L3 14h9l-1 8 10-12h-9l1-8z')
export const Square      = i('M21 3H3v18h18V3z')
export const Loader2     = ({ className, ...r }: P) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
    strokeLinecap="round" className={className ?? 'h-4 w-4'} {...r}>
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
)
export const ExternalLink = i('M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3')
export const Link2        = i('M15 7h3a5 5 0 0 1 5 5 5 5 0 0 1-5 5h-3m-6 0H6a5 5 0 0 1-5-5 5 5 0 0 1 5-5h3m-1 5h8')
export const WifiOff      = i('M1 1l22 22M16.72 11.06A10.94 10.94 0 0 1 19 12.55M5 12.55a10.94 10.94 0 0 1 5.17-2.39M10.71 5.05A16 16 0 0 1 22.54 9M1.42 9a15.91 15.91 0 0 1 4.7-2.88M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01')
export const AlertCircle  = i('M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM12 8v4M12 16h.01')
export const Sparkles     = i('M12 3l1.09 3.35L16.5 7.5l-3.41 1.15L12 12l-1.09-3.35L7.5 7.5l3.41-1.15L12 3zM5 17l.55 1.68L7.23 19.5l-1.68.82L5 22l-.55-1.68L2.77 19.5l1.68-.82L5 17zM20 17l.55 1.68 1.68.82-1.68.82L20 22l-.55-1.68-1.68-.82 1.68-.82L20 17z')
export const ChevronRight = i('M9 18l6-6-6-6')
