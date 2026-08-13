import {
  app, BrowserWindow, ipcMain, globalShortcut,
  shell, session, desktopCapturer, nativeTheme, screen,
  systemPreferences,
} from 'electron'
import electronUpdater from 'electron-updater'
const { autoUpdater } = electronUpdater
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { randomUUID } from 'crypto'
import * as http from 'http'
import * as https from 'https'

// ─── Constants ────────────────────────────────────────────────────────────────
// Dev = electron-vite dev mode (NODE_ENV=development) OR any unpackaged run.
// Packaged .dmg/.exe builds are always treated as production.
const IS_DEV = process.env.NODE_ENV === 'development' || !app.isPackaged
const RENDERER_DEV_URL = process.env['ELECTRON_RENDERER_URL']
const SUPPORTED_PROTOCOLS = ['iai-desktop', 'iai-desktop-dev'] as const
const DEFAULT_PROTOCOL = IS_DEV ? 'iai-desktop-dev' : 'iai-desktop'
// Stealth flags — automatically ON in packaged builds, OFF during development
// (so screenshots/dock access work while developing). No manual flipping needed.
const CONTENT_PROTECTION = !IS_DEV  // overlay invisible in screen shares/recordings
const HIDE_DOCK_ICON     = !IS_DEV  // app hidden from the macOS dock
// Backend/frontend base URLs — baked in at build time from .env.production /
// .env.development (VITE_ prefix is shared with the main process by electron-vite).
const BACKEND_URL: string =
  import.meta.env.VITE_API_BASE_URL ?? import.meta.env.VITE_BACKEND_URL ?? 'https://interview-agent-backend-vnrl-a.fly.dev'
const FRONTEND_URL: string =
  import.meta.env.VITE_FRONTEND_URL ?? 'https://interview-agent-frontend-chi.vercel.app'
// NextAuth uses secure cookies on HTTPS: the session cookie is named
// "__Secure-next-auth.session-token" in production (https backend) but plain
// "next-auth.session-token" in dev (http). Pick the right name accordingly.
console.log('[main] BACKEND_URL:', BACKEND_URL)
console.log('[main] FRONTEND_URL:', FRONTEND_URL)
const IS_HTTPS_BACKEND = BACKEND_URL.startsWith('https://')
const SESSION_COOKIE_NAMES = ['__Secure-next-auth.session-token', 'next-auth.session-token'] as const
const TOOLBAR_H  = 48   // toolbar-only height
const MODAL_H    = 340  // activation modal height
const APP_WIDTH_MIN = 360  // never narrower, even on a tiny screen
const APP_WIDTH_MAX = 900  // never wider, even on a huge monitor
// App width = 4/9 of the primary display's work-area width (clamped), computed
// once when the app is ready (screen.getPrimaryDisplay() isn't available
// before then) and cached here. Deliberately not re-derived on every use — the
// window stays whatever width it was born at for the rest of the run;
// display-metrics-changed is not watched, so this never shifts mid-session.
let appWidth = 480  // placeholder until computeAppWidth() runs in app.whenReady()
function computeAppWidth(): number {
  const raw = Math.floor(screen.getPrimaryDisplay().workAreaSize.width * 4 / 9)
  return Math.min(APP_WIDTH_MAX, Math.max(APP_WIDTH_MIN, raw))
}

// ─── HTTP utility for in-app sign-in ─────────────────────────────────────────
interface NodeHttpResponse {
  status: number
  setCookies: string[]
  headers: Record<string, string>
  body: string
  ok: boolean
}

function httpFetch(
  url: string,
  method: 'GET' | 'POST',
  body?: string,
  extraHeaders: Record<string, string> = {},
  timeoutMs?: number
): Promise<NodeHttpResponse> {
  return new Promise((resolve, reject) => {
    try {
      const parsed = new URL(url)
      const lib = parsed.protocol === 'https:' ? https : http
      const opts: http.RequestOptions = {
        hostname: parsed.hostname,
        port: parsed.port ? parseInt(parsed.port) : (parsed.protocol === 'https:' ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method,
        headers: {
          'User-Agent': 'ParakeetDesktop/1.0',
          ...extraHeaders,
          ...(body ? { 'Content-Length': Buffer.byteLength(body).toString() } : {}),
        },
      }
      const req = lib.request(opts, (res) => {
        let data = ''
        res.on('data', (chunk: Buffer) => { data += chunk.toString() })
        res.on('end', () => {
          const raw = res.headers['set-cookie']
          const simplified: Record<string, string> = {}
          for (const [k, v] of Object.entries(res.headers)) {
            if (typeof v === 'string') simplified[k] = v
            else if (Array.isArray(v) && v.length) simplified[k] = v[0]
          }
          resolve({
            status: res.statusCode ?? 0,
            setCookies: Array.isArray(raw) ? raw : raw ? [raw] : [],
            headers: simplified,
            body: data,
            ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300,
          })
        })
        res.on('error', reject)
      })
      req.on('error', reject)
      if (timeoutMs) {
        req.setTimeout(timeoutMs, () => {
          req.destroy(new Error(`Request timed out after ${timeoutMs}ms`))
        })
      }
      if (body) req.write(body)
      req.end()
    } catch (err) { reject(err) }
  })
}

function extractSessionToken(setCookies: string[]): string | null {
  for (const c of setCookies) {
    // Match both the plain (http/dev) and __Secure- (https/prod) cookie names
    const m = c.match(/(?:__Secure-)?next-auth\.session-token=([^;]+)/)
    if (m?.[1]) return decodeURIComponent(m[1])
  }
  return null
}

function buildCookieHeader(token: string): string {
  return SESSION_COOKIE_NAMES.map((name) => `${name}=${encodeURIComponent(token)}`).join('; ')
}

// Distinguishes "the backend explicitly rejected this token" (bad/expired/
// forced-logout — safe to log the user out) from "we couldn't get a real
// answer from the backend" (network/DNS/timeout/5xx — NEVER safe to treat as
// a logout, since it says nothing about whether the token is actually valid).
type VerifyResult =
  | { valid: true; email: string }
  | { valid: false; reason: 'rejected'; error: string }
  | { valid: false; reason: 'unreachable'; error: string }

const AUTH_CHECK_TIMEOUT_MS = 5000

async function verifyAuthToken(token: string): Promise<VerifyResult> {
  try {
    const res = await httpFetch(
      `${BACKEND_URL}/api/auth/session`,
      'GET',
      undefined,
      { Cookie: buildCookieHeader(token) },
      AUTH_CHECK_TIMEOUT_MS
    )
    // NextAuth's /api/auth/session route returns 200 with no `user` field for
    // an invalid/expired token — it does NOT 401. A non-2xx here means the
    // backend itself failed to answer (crash, proxy error, etc.), not that
    // the token is bad, so it must never be treated as a rejection.
    if (!res.ok) {
      return { valid: false, reason: 'unreachable', error: `Auth check failed (${res.status})` }
    }
    let data: { user?: { email?: string; forcedLogout?: boolean } }
    try {
      data = JSON.parse(res.body || '{}')
    } catch {
      return { valid: false, reason: 'unreachable', error: 'Malformed auth response from server' }
    }
    if (!data.user?.email) {
      return { valid: false, reason: 'rejected', error: 'Server did not recognize this desktop session.' }
    }
    if (data.user.forcedLogout) {
      return { valid: false, reason: 'rejected', error: 'Signed out on another device.' }
    }
    return { valid: true, email: data.user.email }
  } catch (err) {
    // Network error, DNS failure, or our own timeout — we genuinely don't
    // know whether the token is valid, so never clear auth state for this.
    return { valid: false, reason: 'unreachable', error: (err as Error).message }
  }
}

// ─── Window reference ─────────────────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null
let pendingProtocolUrl: string | null = null
let activeAuthToken: string | null = null  // token injected into outgoing requests
// The session THIS device currently owns the active-device lock for (see
// callSession.status.activate's deviceId enforcement) — set/cleared by the
// renderer via IPC. Deliberately not "any session the renderer thinks is
// running": if this device lost the lock to another device, it must NOT
// end that other device's session on quit.
let activeSessionId: string | null = null

// ─── Settings popover: its own window ──────────────────────────────────────────
// The popover used to render inside the main window (position:fixed portal),
// which is what caused every round of "window jumps/clips/flickers when the
// popover opens" — the main window's auto-fit-height effect had to grow it to
// make room, and every position calculation was relative to the main
// window's own (small, snap-anchored) bounds. A real second BrowserWindow
// sidesteps the whole problem: it's positioned in actual screen coordinates,
// never affects the main window's size, and can never be clipped by it.
// resizePaused/window:pause-resize from the previous round are gone — the
// main window no longer has any reason to grow for the popover at all.
let popoverWindow: BrowserWindow | null = null
// Anchor captured from the hamburger button's screen position when the
// popover opens — recomputing bounds when the real content height arrives
// (see popover:report-height) needs this without asking the renderer again.
let popoverAnchor: { screenX: number; screenY: number; buttonW: number; buttonH: number; flipped: boolean } | null = null
// Timestamp of the last .show() — guards against a spurious 'blur' firing
// within an instant of showing an alwaysOnTop window while another window
// (main) still has OS focus, a known Electron/macOS race that could hide
// the popover again almost immediately after it appears.
let popoverJustShownAt = 0
const POPOVER_BLUR_GRACE_MS = 200
const POPOVER_W = 300
const POPOVER_DEFAULT_H = 600   // generous placeholder so first paint already shows most/all content before report-height refines it
const POPOVER_MAX_H = 600
const POPOVER_EDGE_MARGIN = 8

function positionPopoverWindow(height: number): void {
  if (!popoverWindow || !popoverAnchor) return
  const { screenX, screenY, buttonW, buttonH, flipped } = popoverAnchor
  const display = screen.getDisplayMatching({ x: Math.round(screenX), y: Math.round(screenY), width: 1, height: 1 })
  const wa = display.workArea

  // Clamp to however much room ACTUALLY exists in the direction this
  // popover opens (not just a flat constant) — this is what guarantees it
  // never needs internal scrolling AND never goes off-screen, regardless of
  // monitor size or where the button sits on it. Flipped (bottom snap)
  // grows upward, so the limit is the room between the button and the
  // screen's top edge; otherwise it grows downward, limited by the room
  // between the button and the screen's bottom edge.
  const roomAvailable = flipped
    ? screenY - wa.y - POPOVER_EDGE_MARGIN * 2
    : wa.y + wa.height - (screenY + buttonH) - POPOVER_EDGE_MARGIN * 2
  const h = Math.round(Math.max(80, Math.min(height, POPOVER_MAX_H, roomAvailable)))

  // Horizontal: right-align to the button's right edge (mirrors the old
  // in-window anchor), clamped so it never crosses either screen edge.
  let x = screenX + buttonW - POPOVER_W
  x = Math.max(wa.x + POPOVER_EDGE_MARGIN, Math.min(x, wa.x + wa.width - POPOVER_W - POPOVER_EDGE_MARGIN))

  // Vertical: below the button normally; above it (growing upward) when
  // flipped (bottom snap positions) — recomputed from the FINAL clamped
  // height each time, so the popover's bottom edge always stays anchored
  // right against the button, however tall it ends up being (this is why
  // this reuses the same anchor-based math as the initial open rather than
  // just adjusting height in place: doing that would grow it downward from
  // its current top instead of upward from the button for flipped positions).
  let y: number
  if (flipped) {
    y = Math.max(wa.y + POPOVER_EDGE_MARGIN, screenY - h - POPOVER_EDGE_MARGIN)
  } else {
    y = screenY + buttonH + POPOVER_EDGE_MARGIN
    y = Math.min(y, wa.y + wa.height - h - POPOVER_EDGE_MARGIN)
    y = Math.max(wa.y + POPOVER_EDGE_MARGIN, y)
  }

  popoverWindow.setBounds({ x: Math.round(x), y: Math.round(y), width: POPOVER_W, height: h })
}

function hidePopoverWindow(): void {
  if (!popoverWindow) return
  popoverWindow.hide()
  // Tell the main window it's closed — it autonomously hides itself on blur/
  // Escape, so the main window's "is the menu open" state needs to hear
  // about that independently of whoever asked it to open in the first place.
  mainWindow?.webContents.send('popover:closed')
}

function createPopoverWindow(): void {
  popoverWindow = new BrowserWindow({
    width: POPOVER_W,
    height: POPOVER_DEFAULT_H,
    x: -10000, y: -10000,   // parked off-screen until positioned — avoids a flash at (0,0)
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    roundedCorners: false,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: !IS_DEV,
      backgroundThrottling: false,
    },
  })
  popoverWindow.setContentProtection(CONTENT_PROTECTION)
  popoverWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  popoverWindow.setAlwaysOnTop(true, 'screen-saver', 1)
  popoverWindow.setIgnoreMouseEvents(false)

  popoverWindow.webContents.on('did-fail-load', (_e, code, desc, validatedURL) => {
    console.error('[popover] did-fail-load:', code, desc, validatedURL)
  })

  const popoverUrl = IS_DEV && RENDERER_DEV_URL ? `${RENDERER_DEV_URL}?view=popover` : null
  if (popoverUrl) {
    popoverWindow.loadURL(popoverUrl)
  } else {
    popoverWindow.loadFile(join(__dirname, '../renderer/index.html'), { query: { view: 'popover' } })
  }

  // Closing (blur = click-outside, since this window is skipTaskbar/
  // alwaysOnTop with nothing else of ours to click) is the popover's own
  // decision — Escape inside the popover's renderer calls popover:hide too.
  // The grace-period guard skips a blur that fires immediately after
  // showing: a known Electron/macOS race for alwaysOnTop windows shown
  // while another window still holds OS focus can deliver a spurious blur
  // within milliseconds, which would otherwise hide the popover the instant
  // it appears — indistinguishable from "the popover never showed at all".
  popoverWindow.on('blur', () => {
    const sinceShown = Date.now() - popoverJustShownAt
    if (sinceShown < POPOVER_BLUR_GRACE_MS) return
    hidePopoverWindow()
  })
  popoverWindow.on('closed', () => { popoverWindow = null })
}

// ─── Window factory ───────────────────────────────────────────────────────────
// ─── Snap-position persistence (main-side, so the window is born in place) ────
const SNAP_MARGIN = 8
const SNAP_DEFAULT = 'top-center'

function snapPosPath(): string {
  const dir = join(app.getPath('userData'), 'parakeet')
  try { mkdirSync(dir, { recursive: true }) } catch { /* exists */ }
  return join(dir, 'snap-pos')
}
function loadSnapPos(): string {
  try { return readFileSync(snapPosPath(), 'utf8').trim() || SNAP_DEFAULT } catch { return SNAP_DEFAULT }
}
function saveSnapPos(pos: string): void {
  try { writeFileSync(snapPosPath(), pos, 'utf8') } catch { /* ignore */ }
}

/** x/y for a snap position given window size, with 8px work-area margins.
 *  Accepts an explicit work area (e.g. a non-primary display's) — defaults
 *  to the primary display's, which is what every existing call site wants. */
function computeSnapXY(
  pos: string, w: number, h: number,
  wa: Electron.Rectangle = screen.getPrimaryDisplay().workArea
): [number, number] {
  const lx = wa.x + SNAP_MARGIN
  const cx = wa.x + Math.round((wa.width - w) / 2)
  const rx = wa.x + wa.width - w - SNAP_MARGIN
  const ty = wa.y + SNAP_MARGIN
  const by = wa.y + wa.height - h - SNAP_MARGIN
  const positions: Record<string, [number, number]> = {
    'top-left':      [lx, ty],
    'top-center':    [cx, ty],
    'top-right':     [rx, ty],
    'bottom-left':   [lx, by],
    'bottom-center': [cx, by],
    'bottom-right':  [rx, by],
  }
  return positions[pos] ?? positions[SNAP_DEFAULT]
}

/** Shared snap logic — used by both the window:move-to IPC handler (UI
 *  clicks) and the global snap-position keyboard shortcuts. */
function moveToSnap(pos: string, keepCurrentSize = false): void {
  if (!mainWindow) return
  hidePopoverWindow()
  const currentDisplay = screen.getDisplayMatching(mainWindow.getBounds())
  const wa = currentDisplay.workArea
  const [curW, curH] = mainWindow.getSize()
  let w: number, h: number
  if (keepCurrentSize) {
    w = curW
    h = curH
  } else {
    w = Math.min(appWidth, wa.width - 2 * SNAP_MARGIN)
    h = curH
    mainWindow.setSize(w, h, false)
  }
  const [x, y] = computeSnapXY(pos, w, h, wa)
  mainWindow.setPosition(x, y, true)
  saveSnapPos(pos)
}

// ─── Display change recovery ──────────────────────────────────────────────────
const PILL_CLAMP_MARGIN = 8

/** Clamps a position (for a rect of the given size) inside whichever
 *  display it's nearest to — `screen.getDisplayMatching` returns the
 *  closest display even for a point that's fully off-screen, so this both
 *  handles "dragged slightly past the edge" and "restored from a position
 *  on a display that no longer exists" the same way. */
function clampToDisplay(x: number, y: number, w: number, h: number): { x: number; y: number } {
  const display = screen.getDisplayMatching({ x, y, width: Math.max(1, w), height: Math.max(1, h) })
  const wa = display.workArea
  return {
    x: Math.max(wa.x + PILL_CLAMP_MARGIN, Math.min(x, wa.x + wa.width - w - PILL_CLAMP_MARGIN)),
    y: Math.max(wa.y + PILL_CLAMP_MARGIN, Math.min(y, wa.y + wa.height - h - PILL_CLAMP_MARGIN)),
  }
}

function isRectOnAnyDisplay(bounds: Electron.Rectangle): boolean {
  return screen.getAllDisplays().some((d) => {
    const wa = d.workArea
    return (
      bounds.x < wa.x + wa.width &&
      bounds.x + bounds.width > wa.x &&
      bounds.y < wa.y + wa.height &&
      bounds.y + bounds.height > wa.y
    )
  })
}

/** Re-snaps the main window onto the primary display if it's no longer on
 *  any currently-connected display (e.g. the external monitor it was on got
 *  unplugged). Preserves the window's CURRENT size — deliberately does not
 *  call moveToSnap() (which forces the full toolbar/modal width), since this
 *  must also recover the mini-pill correctly, and the pill's compact size
 *  would otherwise get blown back out to the full overlay width. */
function reclampMainWindowIfOffScreen(reason: string): void {
  if (!mainWindow) return
  const bounds = mainWindow.getBounds()
  if (isRectOnAnyDisplay(bounds)) return

  console.log(`[display] window off-screen (${reason}) — moving to primary display`)
  hidePopoverWindow()
  const wa = screen.getPrimaryDisplay().workArea
  const [x, y] = computeSnapXY(loadSnapPos(), bounds.width, bounds.height, wa)
  mainWindow.setBounds({ x, y, width: bounds.width, height: bounds.height })
  mainWindow.webContents.send('display:moved-to-primary', 'External display disconnected — moved to main screen')
}

function registerDisplayListeners(): void {
  screen.on('display-removed', (_event, removedDisplay) => {
    console.log('[display] removed:', removedDisplay.id)
    reclampMainWindowIfOffScreen('display removed')
  })

  // Not off-screen recovery — just lets the settings popover's display
  // picker (and any other display-aware UI) refresh instead of staying
  // stale until the popover happens to be closed and reopened.
  screen.on('display-added', (_event, newDisplay) => {
    console.log('[display] added:', newDisplay.id)
    mainWindow?.webContents.send('display:list-changed')
    popoverWindow?.webContents.send('display:list-changed')
  })

  // Resolution/scaling change on the window's current display (or any
  // display) — re-clamp so the window can't end up partially or fully
  // outside the new, possibly-smaller work area.
  screen.on('display-metrics-changed', (_event, display, changedMetrics) => {
    console.log('[display] metrics changed:', display.id, changedMetrics)
    if (!mainWindow) return
    const bounds = mainWindow.getBounds()
    const currentDisplay = screen.getDisplayMatching(bounds)
    const wa = currentDisplay.workArea
    const clampedX = Math.max(wa.x, Math.min(bounds.x, wa.x + wa.width - bounds.width))
    const clampedY = Math.max(wa.y, Math.min(bounds.y, wa.y + wa.height - bounds.height))
    if (clampedX !== bounds.x || clampedY !== bounds.y) {
      mainWindow.setBounds({ ...bounds, x: clampedX, y: clampedY })
    }
  })
}

/** Picks the desktopCapturer source matching whichever display the app
 *  window is currently on, instead of always taking sources[0] (which is
 *  OS-ordered, typically the primary display — wrong on multi-monitor setups
 *  where the app has been moved to an external display). */
function pickSourceForCurrentDisplay(
  sources: Electron.DesktopCapturerSource[]
): Electron.DesktopCapturerSource {
  const currentDisplay = mainWindow
    ? screen.getDisplayMatching(mainWindow.getBounds())
    : screen.getPrimaryDisplay()

  // Primary match: desktopCapturer sources carry display_id on macOS 10.15+
  // and Windows 8.1+ when available — the reliable, official way to match.
  const byId = sources.find((s) => s.display_id && s.display_id === String(currentDisplay.id))
  if (byId) return byId

  // Fallback for platforms/Electron builds where display_id isn't populated:
  // desktopCapturer's 'screen' sources are observed to come back in the same
  // order as screen.getAllDisplays() in practice (not a documented Electron
  // guarantee) — index-match against that as a best-effort second try.
  const displays = screen.getAllDisplays()
  const idx = displays.findIndex((d) => d.id === currentDisplay.id)
  if (idx >= 0 && sources[idx]) return sources[idx]

  return sources[0]
}

function createWindow(): void {
  nativeTheme.themeSource = 'dark'

  const { width: sw } = screen.getPrimaryDisplay().workAreaSize
  const winW = Math.min(appWidth, sw - 40)
  // Born in the persisted snap position (default top-center) — applied at
  // creation, before show, so the window never flashes in the wrong place.
  const [winX, winY] = computeSnapXY(loadSnapPos(), winW, MODAL_H)

  mainWindow = new BrowserWindow({
    width: winW,
    height: MODAL_H,      // starts with modal height
    x: winX,
    y: winY,
    show: false,          // reveal only after ready-to-show to avoid blank flash
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    roundedCorners: false,
    alwaysOnTop: true,
    resizable: false,     // fixed width (1/3 of the screen); height is driven programmatically
    movable: false,       // repositioning only via the 6-position picker
    minHeight: TOOLBAR_H,
    skipTaskbar: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: !IS_DEV,
      backgroundThrottling: false,
    },
  })

  // ── Stealth: invisible on screen share / recordings ──────────────────────────
  mainWindow.setContentProtection(CONTENT_PROTECTION)

  // ── Keep on top across all spaces + fullscreen apps ──────────────────────────
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  mainWindow.setAlwaysOnTop(true, 'screen-saver', 1)

  // ── Click-through by default; renderer opts in over solid UI ─────────────────
  // forward:true keeps mousemove flowing to the renderer so its hit-test works.
  mainWindow.setIgnoreMouseEvents(true, { forward: true })

  // ── Hard lock against manual edge-resize ──────────────────────────────────────
  // resizable:false is set above, but frameless/transparent windows on macOS are
  // known to still expose a live-resize region on the left/right edges even with
  // the style mask cleared (top/bottom are unaffected). will-resize only fires
  // for user-driven (manual) resize gestures — never for our own setSize/
  // setBounds calls — so vetoing it unconditionally blocks every edge without
  // touching the programmatic resizing the app relies on (activation, snap
  // moves, mini-bar, auto-fit height).
  mainWindow.on('will-resize', (event) => { event.preventDefault() })

  // ── System audio capture + screenshots: intercept getDisplayMedia ────────────
  // Shared by useSystemAudio's getDisplayMedia({audio:true,video:true}) (video
  // track is discarded, only 'loopback' audio matters — display choice here is
  // irrelevant to audio) AND SessionOverlay's screenshot capture, which DOES
  // care: it must be the display the user/overlay is actually on, not
  // whichever one desktopCapturer happens to list first.
  session.defaultSession.setDisplayMediaRequestHandler((_req, callback) => {
    desktopCapturer
      .getSources({ types: ['screen'] })
      .then((sources) => {
        if (sources.length === 0) { callback({}); return }
        // 'loopback' = system audio on macOS; 'loopbackWithMute' on Windows
        callback({ video: pickSourceForCurrentDisplay(sources), audio: 'loopback' as 'loopback' })
      })
      .catch(() => callback({}))
  })

  // ── Load renderer ────────────────────────────────────────────────────────────
  if (IS_DEV && RENDERER_DEV_URL) {
    mainWindow.loadURL(RENDERER_DEV_URL)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // ── Window ready ─────────────────────────────────────────────────────────────
  mainWindow.once('ready-to-show', () => {
    mainWindow!.setResizable(false)  // re-assert post-show — belt-and-suspenders for the same macOS quirk
    mainWindow!.show()
    // Dispatch any protocol URL that arrived before window was ready
    if (pendingProtocolUrl) {
      dispatchProtocolUrl(pendingProtocolUrl)
      pendingProtocolUrl = null
    }
  })

  mainWindow.on('closed', () => { mainWindow = null })
}

// ─── Auth cookie helper ───────────────────────────────────────────────────────
// Problem: the renderer loads from file:// which has a null origin.
// Browsers won't attach cookies to cross-origin requests from null origins even
// with credentials:'include'. Fix: intercept all outgoing requests in the main
// process and inject the Cookie header directly at the network level.
async function clearAuthState(): Promise<void> {
  activeAuthToken = null
  for (const url of [BACKEND_URL, FRONTEND_URL]) {
    for (const name of [...SESSION_COOKIE_NAMES]) {
      await session.defaultSession.cookies.remove(url, name).catch(() => {})
    }
  }
  try { writeFileSync(tokenPath(), '', 'utf8') } catch { /* ignore */ }
}

async function setAuthCookies(token: string): Promise<void> {
  activeAuthToken = token

  // 1. Store token in Electron's cookie jar (belt-and-suspenders)
  const cookieBase = {
    value: token,
    httpOnly: true,
    path: '/',
    sameSite: 'lax' as const,
    expirationDate: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
  }
  await Promise.all(
    [BACKEND_URL, FRONTEND_URL].flatMap((url) => {
      const isHttps = url.startsWith('https://')
      const names = isHttps
        ? SESSION_COOKIE_NAMES
        : SESSION_COOKIE_NAMES.filter((n) => !n.startsWith('__Secure-'))
      return names.map((name) =>
        session.defaultSession.cookies
          .set({
            url,
            name,
            ...cookieBase,
            secure: isHttps,
          })
          .catch((e) => console.warn(`[main] Cookie set failed for ${url} (${name}):`, e))
      )
    })
  )
  await session.defaultSession.cookies.flushStore().catch(() => {})

  // 2. Inject Cookie header on ALL requests to the backend and frontend origins.
  //    This bypasses the file:// null-origin restriction entirely.
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: [`${BACKEND_URL}/*`, `${FRONTEND_URL}/*`] },
    (details, callback) => {
      if (!activeAuthToken) { callback({ requestHeaders: details.requestHeaders }); return }
      const headers = { ...details.requestHeaders }
      const existing = headers['Cookie'] ?? headers['cookie'] ?? ''
      // Replace or append the session cookie — strip any prior value under
      // either the plain or __Secure- name so we never send a stale/duplicate.
      const withoutOld = existing
        .split(';')
        .map((c) => c.trim())
        .filter((c) => c && !/^(?:__Secure-)?next-auth\.session-token=/.test(c))
        .join('; ')
      const injectedCookies = SESSION_COOKIE_NAMES.map((name) => `${name}=${activeAuthToken}`).join('; ')
      const updated = withoutOld
        ? `${withoutOld}; ${injectedCookies}`
        : injectedCookies
      headers['Cookie'] = updated
      callback({ requestHeaders: headers })
    }
  )

  console.log(`[main] Auth token set — cookie injector active for ${BACKEND_URL} / ${FRONTEND_URL}`)
}

// ─── Protocol handler ─────────────────────────────────────────────────────────
let protocolHandlerInFlight = false
let queuedProtocolUrl: string | null = null

function normalizeBase64Payload(value: string): string {
  return value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
}

function parseDeepLinkPayload(rawPayload: string | null): { data: Record<string, unknown>; rawPayload: string; decodedPayload: string } {
  if (!rawPayload) {
    throw new Error('Missing deep-link payload')
  }

  const raw = rawPayload.trim()
  console.log('[main] deep-link raw payload:', raw)

  let decoded = raw
  try {
    decoded = decodeURIComponent(raw)
  } catch (err) {
    console.warn('[main] deep-link decodeURIComponent failed, using raw payload:', err)
  }
  console.log('[main] deep-link decoded payload:', decoded)

  const candidates = [decoded, normalizeBase64Payload(decoded)]
  let parsed: Record<string, unknown> | null = null

  for (const candidate of candidates) {
    try {
      const base64Decoded = Buffer.from(candidate, 'base64').toString('utf8')
      if (base64Decoded.trim()) {
        try {
          parsed = JSON.parse(base64Decoded) as Record<string, unknown>
          console.log('[main] deep-link parsed JSON:', parsed)
          break
        } catch (parseErr) {
          console.warn('[main] deep-link base64 decode did not yield valid JSON:', parseErr)
        }
      }
    } catch (err) {
      console.warn('[main] deep-link base64 decode failed:', err)
    }
  }

  if (!parsed) {
    try {
      parsed = JSON.parse(decoded) as Record<string, unknown>
      console.log('[main] deep-link parsed JSON:', parsed)
    } catch (err) {
      throw new Error(`Unable to parse deep-link payload: ${String(err)}`)
    }
  }

  const authToken =
    typeof parsed.authToken === 'string'
      ? parsed.authToken
      : typeof parsed.token === 'string'
        ? parsed.token
        : typeof parsed.sessionToken === 'string'
          ? parsed.sessionToken
          : ''

  const normalizedData: Record<string, unknown> = {
    ...parsed,
    authToken,
  }

  if (typeof parsed.callSessionId === 'string') {
    normalizedData.callSessionId = parsed.callSessionId
  }
  if (typeof parsed.sessionId === 'string') {
    normalizedData.sessionId = parsed.sessionId
  }

  return { data: normalizedData, rawPayload: raw, decodedPayload: decoded }
}

async function dispatchProtocolUrl(url: string): Promise<void> {
  // Prevent concurrent handler calls; queue if already processing
  if (protocolHandlerInFlight) {
    queuedProtocolUrl = url
    return
  }

  protocolHandlerInFlight = true
  try {
    const parsed = new URL(url)
    const rawPayload = parsed.searchParams.get('payload')

    if (!rawPayload) {
      console.warn('[main] deep-link missing payload in URL:', url)
      return
    }

    const { data } = parseDeepLinkPayload(rawPayload)

    if (parsed.hostname === 'auth') {
      // ── Set cookie in Electron's session BEFORE telling renderer ───────────
      const token = typeof data.authToken === 'string' ? data.authToken : ''
      if (token) {
        await setAuthCookies(token)
        const verified = await verifyAuthToken(token)
        if (verified.valid) {
          saveToken(token)
        } else if (verified.reason === 'rejected') {
          await clearAuthState()
          console.warn('[main] Auth deep link token was rejected:', verified.error)
        } else {
          // Couldn't reach the backend to verify — keep the token we just
          // set rather than logging the user out over a transient blip.
          saveToken(token)
          console.warn('[main] Could not verify auth deep link token (offline?) — keeping session:', verified.error)
          mainWindow?.webContents.send('auth:verify-warning', verified.error)
        }
      } else {
        console.warn('[main] Auth deep link received but no valid token was found in payload:', data)
      }
      if (mainWindow) {
        mainWindow.webContents.send('protocol:auth', data)
        mainWindow.show()
        mainWindow.focus()
      }
    } else if (parsed.hostname === 'session') {
      // Session deep link also carries authToken — set cookie automatically
      // so the app is authenticated even if launched fresh from the browser
      const token = typeof data.authToken === 'string' ? data.authToken : ''
      if (token && token !== activeAuthToken) {
        await setAuthCookies(token)
        const verified = await verifyAuthToken(token)
        if (verified.valid) {
          saveToken(token)
        } else if (verified.reason === 'rejected') {
          await clearAuthState()
          console.warn('[main] Session deep link token was rejected:', verified.error)
        } else {
          saveToken(token)
          console.warn('[main] Could not verify session deep link token (offline?) — keeping session:', verified.error)
          mainWindow?.webContents.send('auth:verify-warning', verified.error)
        }
      }
      if (mainWindow) {
        mainWindow.webContents.send('protocol:session', data)
        mainWindow.show()
        mainWindow.focus()
      }
    }
  } catch (err) {
    console.error('[main] Protocol URL parse error:', err)
  } finally {
    protocolHandlerInFlight = false
    // Process queued URL if any
    if (queuedProtocolUrl) {
      const next = queuedProtocolUrl
      queuedProtocolUrl = null
      // Small delay to let the UI settle
      setTimeout(() => void dispatchProtocolUrl(next), 100)
    }
  }
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────
function registerIPC(): void {
  // ── CORS override for renderer → backend calls ──────────────────────────────
  // The renderer loads from file:// (null origin). Chromium blocks credentialed
  // cross-origin reads and rejects "Access-Control-Allow-Origin: null" outright.
  // Since the main process injects the session cookie on every backend request
  // (onBeforeSendHeaders) and the renderer fetches non-credentialed, we can
  // safely relax the *response* CORS headers to "*" so Chromium reads them.
  session.defaultSession.webRequest.onHeadersReceived(
    { urls: [`${BACKEND_URL}/*`, `${FRONTEND_URL}/*`] },
    (details, callback) => {
      const responseHeaders = { ...details.responseHeaders }
      // Drop any existing (case-insensitive) CORS headers to avoid duplicates
      for (const k of Object.keys(responseHeaders)) {
        if (/^access-control-/i.test(k)) delete responseHeaders[k]
      }
      responseHeaders['Access-Control-Allow-Origin'] = ['*']
      responseHeaders['Access-Control-Allow-Methods'] = ['GET,POST,PUT,DELETE,OPTIONS']
      responseHeaders['Access-Control-Allow-Headers'] = ['*']
      callback({ responseHeaders })
    }
  )

  // Window controls
  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:close',    () => mainWindow?.close())
  ipcMain.handle('window:hide',     () => mainWindow?.hide())
  ipcMain.handle('window:show',     () => { mainWindow?.show(); mainWindow?.focus() })
  // Escape hatch for the renderer to request the full bringToFront()
  // sequence directly (e.g. during session initialization), rather than
  // just the plain show+focus above.
  ipcMain.handle('window:force-show', () => { bringToFront() })
  ipcMain.handle('window:toggle',   () => {
    if (!mainWindow) return
    mainWindow.isVisible() ? mainWindow.hide() : (mainWindow.show(), mainWindow.focus())
  })
  ipcMain.handle('window:is-visible', () => mainWindow?.isVisible() ?? false)
  ipcMain.handle('window:set-opacity', (_e, v: number) =>
    mainWindow?.setOpacity(Math.max(0.2, Math.min(1, v))))

  // Custom window positioning (for floating MiniBar) — clamped to whichever
  // display the position is nearest, so the mini pill can never be dragged
  // (or restored from a stale saved position, e.g. after a display was
  // removed) fully or partially off-screen. Uses the window's OWN current
  // size for the clamp, so this works whether it's currently the small pill
  // or the full toolbar/overlay. Returns the clamped position so the
  // renderer can keep whatever it persists (localStorage, for the pill) in
  // sync instead of re-saving a stale off-screen value next launch.
  ipcMain.handle('window:set-position', (_e, x: number, y: number) => {
    if (!mainWindow) return { x: Math.round(x), y: Math.round(y) }
    const { width, height } = mainWindow.getBounds()
    const clamped = clampToDisplay(Math.round(x), Math.round(y), width, height)
    mainWindow.setPosition(clamped.x, clamped.y, true)
    return clamped
  })

  // Dynamic window sizing — renderer measures real content and calls this to fit it.
  // anchorBottom=true pins the window's bottom edge to the work-area bottom (8px
  // margin) while growing/shrinking upward — used for bottom snap positions so
  // content never runs off the bottom of the screen. Pinning absolutely (rather
  // than keeping the current bottom edge) prevents drift accumulating across
  // mini-bar drags, restores, and popover open/close cycles.
  ipcMain.handle('window:set-height', (_e, h: number, anchorBottom?: boolean) => {
    if (!mainWindow) return
    const [w] = mainWindow.getSize()
    const newH = Math.round(Math.max(TOOLBAR_H, h))
    if (anchorBottom) {
      const wa = screen.getPrimaryDisplay().workArea
      const [x] = mainWindow.getPosition()
      mainWindow.setBounds({ x, y: wa.y + wa.height - newH - 8, width: w, height: newH })
    } else {
      mainWindow.setSize(w, newH, false)
    }
  })
  // ── Settings popover IPC ────────────────────────────────────────────────────
  ipcMain.handle('popover:show', (_e, coords: { x: number; y: number; width: number; height: number; flipped: boolean }) => {
    if (!mainWindow) { console.warn('[popover:show] no mainWindow — aborting'); return }
    if (!popoverWindow || popoverWindow.isDestroyed()) {
      createPopoverWindow()
    }
    const mainBounds = mainWindow.getBounds()
    popoverAnchor = {
      screenX: mainBounds.x + coords.x,
      screenY: mainBounds.y + coords.y,
      buttonW: coords.width,
      buttonH: coords.height,
      flipped: coords.flipped,
    }
    // Show immediately with a reasonable default size rather than waiting
    // for popover:report-height — if that message is ever late, dropped, or
    // never arrives at all (e.g. the popover's renderer failed to mount),
    // the old flow left the window hidden forever, which is indistinguishable
    // from "the popover doesn't work". report-height still arrives a moment
    // later and refines the bounds to the real content height; it's no
    // longer a precondition for visibility at all.
    positionPopoverWindow(POPOVER_DEFAULT_H)
    popoverJustShownAt = Date.now()
    popoverWindow!.setAlwaysOnTop(true, 'screen-saver', 1)
    popoverWindow!.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    popoverWindow!.show()
  })
  ipcMain.on('popover:hide', () => hidePopoverWindow())
  ipcMain.on('popover:update-settings', (_e, settings) => {
    popoverWindow?.webContents.send('popover:settings', settings)
  })
  ipcMain.on('popover:action', (_e, action) => {
    mainWindow?.webContents.send('popover:action', action)
  })
  ipcMain.on('popover:report-height', (_e, height: number) => {
    positionPopoverWindow(height)
  })
  ipcMain.handle('window:set-size', (_e, w: number, h: number) => {
    if (!mainWindow) return
    mainWindow.setSize(Math.round(w), Math.round(h), false)
  })
  // Renderer needs this to compute the 70% max-height clamp for auto-fit sizing,
  // and appWidth so it can restore to the real window width (not a hardcoded
  // guess) after exiting the mini-bar.
  ipcMain.handle('window:get-work-area', () => {
    const wa = screen.getPrimaryDisplay().workArea
    return { width: wa.width, height: wa.height, appWidth }
  })
  ipcMain.handle('window:set-ignore-mouse', (_e, ignore: boolean) => {
    mainWindow?.setIgnoreMouseEvents(ignore, { forward: true })
  })
  // "Private" toggle — hide the overlay from screen shares/recordings.
  // Applies to the popover window too — otherwise a screen share started
  // with Private on would still leak the settings menu while it's open.
  ipcMain.handle('window:set-content-protection', (_e, on: boolean) => {
    mainWindow?.setContentProtection(on)
    popoverWindow?.setContentProtection(on)
  })

  // Position presets — 6 snap positions with 8px margins from the work area.
  // Width is fixed: re-apply it on every snap so the overlay stays anchored.
  // The chosen position is persisted main-side so the next launch is born there.
  ipcMain.handle('window:move-to', (_e, pos: string, keepCurrentSize?: boolean) => {
    moveToSnap(pos, keepCurrentSize)
  })

  // ── Multi-monitor: list displays + move the window to one ────────────────────
  ipcMain.handle('window:get-displays', () => {
    const displays = screen.getAllDisplays()
    const primaryId = screen.getPrimaryDisplay().id
    const externalCount = displays.filter((d) => !d.internal).length
    let externalSeen = 0
    const list = displays.map((d, i) => {
      let label: string
      if (d.internal) label = 'Built-in Display'
      else if (displays.some((o) => o.internal)) {
        externalSeen += 1
        label = externalCount > 1 ? `External Display ${externalSeen}` : 'External Display'
      } else {
        label = `Display ${i + 1}`
      }
      return { id: d.id, label, bounds: d.bounds, isPrimary: d.id === primaryId }
    })
    const currentId = mainWindow
      ? screen.getDisplayMatching(mainWindow.getBounds()).id
      : primaryId
    return { displays: list, currentId }
  })
  ipcMain.handle('window:move-to-display', (_e, displayId: number) => {
    if (!mainWindow) return
    const target = screen.getAllDisplays().find((d) => d.id === displayId)
    if (!target) return
    // Popover's anchor is a screen-coordinate snapshot from open time — moving
    // to another display invalidates it, so close it rather than leave it
    // stranded on the old display.
    hidePopoverWindow()
    // Keep the current snap position (top-left, bottom-center, etc.) but
    // recompute it against the TARGET display's work area, so the window
    // lands in the equivalent spot on the new screen rather than just its center.
    const [w, h] = mainWindow.getSize()
    const pos = loadSnapPos()
    const [x, y] = computeSnapXY(pos, w, h, target.workArea)
    mainWindow.setBounds({ x, y, width: w, height: h })
  })

  // App info
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('app:platform', () => process.platform)
  ipcMain.handle('app:device-id', () => getDeviceId())

  // Renderer's "Restart Now" button on the update-ready banner.
  ipcMain.on('update:install', () => {
    autoUpdater.quitAndInstall()
  })

  // Desktop capturer sources (for system audio)
  ipcMain.handle('capture:get-sources', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 0, height: 0 },
    })
    return sources.map((s) => ({ id: s.id, name: s.name }))
  })

  // Open external URLs in default browser
  ipcMain.handle('shell:open-external', (_e, url: string) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
  })

  // Set an auth token supplied by the browser bridge or another trusted renderer.
  ipcMain.handle('auth:set-token', async (
    _evt: Electron.IpcMainInvokeEvent,
    token: string
  ): Promise<{ success: boolean; error?: string }> => {
    if (!token?.trim()) return { success: false, error: 'Missing desktop auth token' }
    try {
      await setAuthCookies(token.trim())
      const verified = await verifyAuthToken(token.trim())
      if (verified.valid) {
        saveToken(token.trim())
        console.log('[main] Auth token accepted for', verified.email)
        return { success: true }
      }
      if (verified.reason === 'rejected') {
        await clearAuthState()
        return { success: false, error: verified.error }
      }
      // Unreachable — don't wipe any existing session; just report failure.
      return {
        success: false,
        error: `Could not verify with the server right now (${verified.error}). Check your connection and try again.`,
      }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  // In-app email/password sign-in (no browser required)
  ipcMain.handle('auth:signin', async (
    _evt: Electron.IpcMainInvokeEvent,
    email: string,
    password: string
  ): Promise<{ success: boolean; error?: string }> => {
    const BACKEND = BACKEND_URL
    try {
      // 1. Get CSRF token (NextAuth requires this for credentials sign-in)
      const csrfRes = await httpFetch(`${BACKEND}/api/auth/csrf`, 'GET')
      if (!csrfRes.ok) {
        return { success: false, error: 'Cannot reach server. Is the backend running?' }
      }
      const csrfJson = JSON.parse(csrfRes.body) as { csrfToken?: string }
      if (!csrfJson.csrfToken) {
        return { success: false, error: 'Server error: no CSRF token' }
      }
      const csrfCookie = csrfRes.setCookies.map(c => c.split(';')[0]).join('; ')

      // 2. POST credentials to NextAuth callback
      const formBody = new URLSearchParams({
        csrfToken: csrfJson.csrfToken,
        email: email.trim(),
        password,
        redirect: 'false',
        callbackUrl: BACKEND,
        json: 'true',
      }).toString()

      const signInRes = await httpFetch(
        `${BACKEND}/api/auth/callback/credentials`,
        'POST',
        formBody,
        { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': csrfCookie }
      )

      // 3. Extract session token from cookies
      let token = extractSessionToken(signInRes.setCookies)

      // NextAuth sometimes returns 302 even with redirect=false in body
      if (!token && (signInRes.status === 301 || signInRes.status === 302)) {
        const location = signInRes.headers['location'] ?? ''
        if (location.includes('error=')) {
          return { success: false, error: 'Invalid email or password' }
        }
        if (location) {
          const absUrl = location.startsWith('http') ? location : `${BACKEND}${location}`
          const redirRes = await httpFetch(absUrl, 'GET', undefined, { 'Cookie': csrfCookie })
          token = extractSessionToken(redirRes.setCookies)
        }
      }

      if (token) {
        await setAuthCookies(token)
        const verified = await verifyAuthToken(token)
        if (verified.valid) {
          saveToken(token)
          console.log('[main] In-app sign-in successful for', verified.email)
          return { success: true }
        }
        if (verified.reason === 'rejected') {
          await clearAuthState()
          return { success: false, error: verified.error }
        }
        return {
          success: false,
          error: 'Signed in, but could not verify with the server right now. Check your connection and try again.',
        }
      }

      // Parse error from response body
      try {
        const parsed = JSON.parse(signInRes.body) as { ok?: boolean; error?: string; url?: string }
        if (parsed.ok === false || parsed.error) {
          return {
            success: false,
            error: parsed.error === 'CredentialsSignin'
              ? 'Invalid email or password'
              : (parsed.error ?? 'Sign in failed'),
          }
        }
      } catch { /* body may not be JSON */ }

      return { success: false, error: 'Invalid email or password' }
    } catch (err) {
      const msg = (err as Error).message
      console.error('[main] auth:signin error:', msg)
      return {
        success: false,
        error: msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND')
          ? 'Cannot connect to server. Make sure the backend is running.'
          : `Sign in failed: ${msg}`,
      }
    }
  })

  // Clear auth token (sign out)
  ipcMain.handle('auth:clear', async () => {
    await clearAuthState()
    console.log('[main] Auth token cleared')
  })

  // ── Active-session tracking (for clean end-on-quit) ─────────────────────────
  // The renderer is the source of truth for session lifecycle (it's the one
  // making the tRPC activate/end calls) — these just mirror that state into
  // main so before-quit can end the session synchronously instead of relying
  // on the 90s server-side watchdog.
  ipcMain.on('session:activated', (_e, sessionId: string) => {
    activeSessionId = sessionId
  })
  ipcMain.on('session:ended', (_e, sessionId: string) => {
    if (activeSessionId === sessionId) activeSessionId = null
  })
}

// ─── Global shortcuts ─────────────────────────────────────────────────────────
function registerShortcuts(): void {
  const shortcuts: Array<[string, string]> = [
    ['CommandOrControl+Return',           'shortcut:answer'],           // ⌘↵
    ['CommandOrControl+Shift+Return',     'shortcut:screenshot'],       // ⌘⇧↵
    ['CommandOrControl+Shift+-',           'shortcut:toggle-chat'],      // ⌘⇧-
    ['CommandOrControl+Shift+Backspace',  'shortcut:clear'],            // ⌘⇧⌫
    ['CommandOrControl+Shift+H',          'shortcut:toggle-visibility'],
    // NOT CommandOrControl+H on macOS — that's the system-wide "Hide app"
    // shortcut; registering it globally silently breaks Cmd+H in every
    // other app for as long as this app is running. NOT
    // CommandOrControl+Shift+H either — that's already bound to
    // toggle-visibility above. Control+Command+H avoids both, but
    // "Command" isn't a real modifier on Windows, so Windows keeps the
    // original Ctrl+H (no system-wide "hide" shortcut exists there to
    // conflict with).
    [process.platform === 'darwin' ? 'Control+Command+H' : 'CommandOrControl+H', 'shortcut:toggle-collapse'],  // ⌃⌘H (Mac) / Ctrl+H (Win) — same as the ∧/∨ button
  ]

  shortcuts.forEach(([accelerator, channel]) => {
    try {
      const ok = globalShortcut.register(accelerator, () => {
        if (channel === 'shortcut:toggle-visibility') {
          if (mainWindow?.isVisible()) mainWindow.hide()
          else { mainWindow?.show(); mainWindow?.focus() }
        } else {
          mainWindow?.webContents.send(channel)
        }
      })
      if (!ok) console.warn(`[main] Could not register shortcut: ${accelerator}`)
    } catch (err) {
      console.warn(`[main] Shortcut registration failed for ${accelerator}:`, err)
    }
  })

  // Snap-position shortcuts — smart neighbor-based movement.
  // Each arrow key moves to the neighbor in that direction from the current
  // snap position. If no neighbor exists in that direction, do nothing.
  const SNAP_NEIGHBORS: Record<string, string[]> = {
    'top-left':      ['top-center', 'bottom-left'],
    'top-center':    ['top-left', 'top-right', 'bottom-center'],
    'top-right':     ['top-center', 'bottom-right'],
    'bottom-left':   ['top-left', 'bottom-center'],
    'bottom-center': ['bottom-left', 'bottom-right', 'top-center'],
    'bottom-right':  ['top-right', 'bottom-center'],
  }
  // Direction → target lookup from current position
  const SNAP_DIRECTION: Record<string, Record<string, string | undefined>> = {
    left: {
      'top-center': 'top-left', 'top-right': 'top-center',
      'bottom-center': 'bottom-left', 'bottom-right': 'bottom-center',
    },
    right: {
      'top-left': 'top-center', 'top-center': 'top-right',
      'bottom-left': 'bottom-center', 'bottom-center': 'bottom-right',
    },
    up: {
      'bottom-left': 'top-left', 'bottom-center': 'top-center', 'bottom-right': 'top-right',
    },
    down: {
      'top-left': 'bottom-left', 'top-center': 'bottom-center', 'top-right': 'bottom-right',
    },
  }
  const snapShortcuts: Array<[string, string]> = [
    ['CommandOrControl+Shift+Up',    'up'],
    ['CommandOrControl+Shift+Down',  'down'],
    ['CommandOrControl+Shift+Left',  'left'],
    ['CommandOrControl+Shift+Right', 'right'],
  ]
  snapShortcuts.forEach(([accelerator, direction]) => {
    try {
      const ok = globalShortcut.register(accelerator, () => {
        const current = loadSnapPos()
        const target = SNAP_DIRECTION[direction]?.[current]
        if (!target) return
        moveToSnap(target)
        mainWindow?.webContents.send('window:snap-feedback', target)
      })
      if (!ok) console.warn(`[main] Could not register shortcut: ${accelerator}`)
    } catch (err) {
      console.warn(`[main] Shortcut registration failed for ${accelerator}:`, err)
    }
  })

  // macOS: globalShortcut itself doesn't require Accessibility permission for
  // ordinary accelerators, but a shortcut can still silently fail to FIRE
  // (as opposed to failing to REGISTER) on machines where the OS is
  // withholding input-monitoring-adjacent permissions. Logged for
  // diagnosis — isTrustedAccessibilityClient(true) also prompts the user to
  // grant it if missing, in case that's a factor on this machine.
  if (process.platform === 'darwin') {
    const hasAccess = systemPreferences.isTrustedAccessibilityClient(false)
    console.log('[accessibility] trusted:', hasAccess)
    if (!hasAccess) {
      systemPreferences.isTrustedAccessibilityClient(true)
    }
  }

  // Global "bring app to front" shortcut — works even when the app is
  // hidden/backgrounded or collapsed to the mini pill. Tries Ctrl+Cmd+I
  // first; if that specific combo is already claimed by something else on
  // this machine (register() returns false rather than throwing), falls
  // through alternates in order until one actually registers.
  // activeFocusAccelerator records whichever one is live so the renderer's
  // toast can display the accelerator that's really wired up, not a
  // hardcoded assumption.
  const focusApp = (): void => {
    console.log('[shortcut] focus-app shortcut fired, accelerator:', activeFocusAccelerator)
    mainWindow?.webContents.send('shortcut:restore-from-mini')
    bringToFront()
    mainWindow?.webContents.send('shortcut:app-focused', activeFocusAccelerator)
  }

  let activeFocusAccelerator: string | null = null
  const focusAcceleratorCandidates = [
    'Control+Command+I',
    'CommandOrControl+Shift+Space',
    'Alt+Command+I',
    'Control+Shift+Space',
  ]
  for (const accelerator of focusAcceleratorCandidates) {
    try {
      const ok = globalShortcut.register(accelerator, focusApp)
      console.log(`[shortcut] ${accelerator} registered:`, ok)
      if (ok) { activeFocusAccelerator = accelerator; break }
    } catch (err) {
      console.warn(`[main] Shortcut registration failed for ${accelerator}:`, err)
    }
  }
  if (!activeFocusAccelerator) {
    console.warn('[shortcut] No focus-app accelerator could be registered on this machine')
  }

  // Windows-only: also register Ctrl+Shift+I, in ADDITION to whichever
  // accelerator above ended up active. Ctrl+Shift+I is the DevTools toggle
  // on Mac (hence excluded there) but a natural, expected "bring to front"
  // binding on Windows.
  if (process.platform === 'win32') {
    try {
      const ok = globalShortcut.register('Control+Shift+I', focusApp)
      console.log('[shortcut] Control+Shift+I (Windows) registered:', ok)
    } catch (err) {
      console.warn('[main] Shortcut registration failed for Control+Shift+I:', err)
    }
  }
}

// ─── App lifecycle ────────────────────────────────────────────────────────────
// setAsDefaultProtocolClient registers the scheme differently per platform:
// macOS reads CFBundleURLTypes from the packaged app's Info.plist (already
// generated correctly by electron-builder from the "protocols" field in
// package.json); Windows instead writes a
// HKEY_CURRENT_USER\Software\Classes\<scheme>\shell\open\command registry
// key pointing at the installed .exe — handled entirely by Electron/NSIS,
// nothing extra needed here, but worth knowing when debugging "deep link
// doesn't launch the app" on Windows: check that registry key exists and
// points at the CURRENT install path (a stale key from a previous install
// location is the usual cause).
for (const protocol of SUPPORTED_PROTOCOLS) {
  try {
    app.setAsDefaultProtocolClient(protocol)
  } catch (err) {
    console.warn(`[main] Could not register protocol ${protocol}:`, err)
  }
}

// Bring the (already-running) overlay to the front — used when a protocol URL
// arrives while the app is alive but backgrounded/minimized. This is also
// what a *second* deep-link launch relies on (the first launch is a fresh
// process that naturally comes up front; only the second+ needs this).
function bringToFront(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  if (!mainWindow.isVisible()) mainWindow.show()
  mainWindow.show()
  // Re-assert always-on-top/all-workspaces — on macOS these can silently
  // fall away after certain focus-stealing/Space-switching interactions,
  // which is a plausible reason a *second* activation stops floating above
  // whatever the user is currently in even though the first one worked.
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  mainWindow.setAlwaysOnTop(true, 'screen-saver', 1)
  mainWindow.moveTop()
  mainWindow.focus()
  if (process.platform === 'darwin') {
    if (!HIDE_DOCK_ICON) void app.dock?.show()
    app.focus({ steal: true })
  }
}

// macOS: deep link arrives while app is running
app.on('open-url', (event, url) => {
  event.preventDefault()
  console.log('[main] open-url received:', url)
  if (mainWindow) {
    // Bring the window forward BEFORE dispatching the payload, so it's
    // already visible/focused by the time session data lands and the
    // renderer starts reacting to it.
    bringToFront()
    void dispatchProtocolUrl(url)
  } else {
    // mainWindow is null. Two different reasons that needs two different
    // responses:
    //  - Still launching (app.isReady() is false): open-url on macOS can
    //    fire BEFORE the ready event when the app is launched via a URL
    //    scheme — createWindow() calls screen.* internally, which throws
    //    if the app isn't ready yet. Just queue the URL; the normal
    //    app.whenReady().then() startup path below already calls
    //    createWindow() and dispatches pendingProtocolUrl once ready.
    //  - Already running but the window was CLOSED (e.g. the "X" in
    //    IdleScreen calls window:close, which destroys it, not hides it):
    //    nothing will ever call createWindow() again on its own, so the
    //    queued URL would rot forever (macOS keeps the app running with
    //    zero windows). A deep link is effectively an activation request,
    //    so treat it as one and recreate the window ourselves.
    pendingProtocolUrl = url
    if (app.isReady()) createWindow()
  }
})

// Windows/Linux: deep link arrives as argv
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    const url = argv.find((a) => SUPPORTED_PROTOCOLS.some((protocol) => a.startsWith(`${protocol}://`)))
    if (mainWindow) {
      // Bring forward first, then dispatch — same ordering as open-url above.
      bringToFront()
      if (url) dispatchProtocolUrl(url)
    } else if (url) {
      // Same reasoning as open-url above: only recreate the window
      // ourselves if the app is already past startup (screen.* isn't safe
      // to touch, via createWindow(), before app.isReady()).
      pendingProtocolUrl = url
      if (app.isReady()) createWindow()
    }
  })
}

// ─── Token persistence ────────────────────────────────────────────────────────
function tokenPath(): string {
  const dir = join(app.getPath('userData'), 'parakeet')
  try { mkdirSync(dir, { recursive: true }) } catch { /* exists */ }
  return join(dir, 'session.token')
}
function saveToken(token: string): void {
  try { writeFileSync(tokenPath(), token, 'utf8') } catch { /* ignore */ }
}
function loadToken(): string | null {
  try { return readFileSync(tokenPath(), 'utf8').trim() || null } catch { return null }
}

// ─── Device identity (single-device session lock) ────────────────────────────
// A stable, persisted-per-install id — NOT tied to hardware — so the backend
// can tell "this is the same desktop install re-activating" apart from "a
// second, different install (or a stale/stolen lock) is trying to take over".
function deviceIdPath(): string {
  const dir = join(app.getPath('userData'), 'parakeet')
  try { mkdirSync(dir, { recursive: true }) } catch { /* exists */ }
  return join(dir, 'device-id')
}
let cachedDeviceId: string | null = null
function getDeviceId(): string {
  if (cachedDeviceId) return cachedDeviceId
  try {
    const existing = readFileSync(deviceIdPath(), 'utf8').trim()
    if (existing) { cachedDeviceId = existing; return existing }
  } catch { /* not created yet */ }
  const id = randomUUID()
  try { writeFileSync(deviceIdPath(), id, 'utf8') } catch { /* ignore */ }
  cachedDeviceId = id
  return id
}

// ─── Forced-logout polling ────────────────────────────────────────────────────
// Catches "signed out on another device" (or any other server-side session
// revocation) while the app is idle/backgrounded, not just on the next API
// call that happens to fail. Reuses verifyAuthToken's unreachable/rejected
// distinction — a network blip here must never log the user out.
let forcedLogoutInterval: ReturnType<typeof setInterval> | null = null
const FORCED_LOGOUT_POLL_MS = 60_000

function startForcedLogoutPolling(): void {
  if (forcedLogoutInterval) return
  forcedLogoutInterval = setInterval(async () => {
    if (!activeAuthToken) return
    try {
      const verified = await verifyAuthToken(activeAuthToken)
      if (!verified.valid && verified.reason === 'rejected') {
        console.warn('[main] Session invalidated remotely:', verified.error)
        await clearAuthState()
        mainWindow?.webContents.send('auth:force-logout', verified.error)
      }
      // 'unreachable' → ignore; never log out over a network blip.
    } catch { /* ignore */ }
  }, FORCED_LOGOUT_POLL_MS)
}

app.whenReady().then(async () => {
  if (HIDE_DOCK_ICON) void app.dock?.hide()
  appWidth = computeAppWidth()
  registerIPC()

  // Create window immediately; restore token in parallel (doesn't need to block UI)
  const saved = loadToken()
  if (saved) {
    setAuthCookies(saved)
      .then(() => console.log('[main] Restored auth token from disk'))
      .catch((e) => console.warn('[main] Token restore failed:', e))
  }

  createWindow()
  createPopoverWindow()   // pre-created hidden so it shows instantly on first hamburger click
  registerShortcuts()
  registerDisplayListeners()
  startForcedLogoutPolling()

  // ── Auto-update (packaged builds only) ──────────────────────────────────────
  if (app.isPackaged) {
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    // Logged once at startup so a real packaged build can be checked against
    // the actual feed URL it resolved (electron-builder's publish config +
    // the "private" flag together determine whether this needs a GH_TOKEN —
    // see package.json's build.publish.private).
    console.log('[updater] feed URL:', autoUpdater.getFeedURL())
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch((e) => console.error('[updater] check failed:', e?.message))
    }, 10_000)
    autoUpdater.on('update-available', (info) => {
      console.log('[updater] Update available:', info.version)
      mainWindow?.webContents.send('update:available', { version: info.version, releaseDate: info.releaseDate })
    })
    autoUpdater.on('update-downloaded', (info) => {
      console.log('[updater] Downloaded — ready to install:', info.version)
      mainWindow?.webContents.send('update:ready', { version: info.version })
    })
    autoUpdater.on('error', (err) => {
      // Silent to the user by design — a failed update check shouldn't
      // interrupt an interview; it just tries again on next launch.
      console.error('[updater] Error:', err?.message)
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else { mainWindow?.show(); mainWindow?.focus() }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  if (forcedLogoutInterval) clearInterval(forcedLogoutInterval)
})

// ── Clean session end on quit ──────────────────────────────────────────────
// Ends the tRPC call directly (tRPC v11 wraps mutation input in {json:...})
// with a short timeout — this must never hang app quit for long even if the
// backend is unreachable.
async function endSessionOnQuit(sessionId: string): Promise<void> {
  if (!activeAuthToken) return
  const body = JSON.stringify({ json: { id: sessionId } })
  await httpFetch(
    `${BACKEND_URL}/api/trpc/callSession.status.end`,
    'POST',
    body,
    { 'Content-Type': 'application/json', Cookie: buildCookieHeader(activeAuthToken) },
    3_000 // 3s max — don't block quit for long
  )
}

// Ends the active session synchronously before the app actually exits,
// instead of leaving it ACTIVE (and potentially still billing) for up to
// the 90s server-side watchdog timeout. event.preventDefault() + app.exit()
// (not app.quit()) — exit() terminates immediately without re-dispatching
// lifecycle events, so there's no risk of this handler re-entering itself.
app.on('before-quit', (event) => {
  if (!activeSessionId) return
  const sessionId = activeSessionId
  activeSessionId = null
  event.preventDefault()
  endSessionOnQuit(sessionId)
    .catch((err) => console.error('[quit] failed to end session:', err))
    .finally(() => app.exit(0))
})
