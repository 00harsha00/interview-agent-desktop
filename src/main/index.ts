import {
  app, BrowserWindow, ipcMain, globalShortcut,
  shell, session, desktopCapturer, nativeTheme, screen,
} from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import * as http from 'http'
import * as https from 'https'

// ─── Constants ────────────────────────────────────────────────────────────────
// Dev = electron-vite dev mode (NODE_ENV=development) OR any unpackaged run.
// Packaged .dmg/.exe builds are always treated as production.
const IS_DEV = process.env.NODE_ENV === 'development' || !app.isPackaged
const RENDERER_DEV_URL = process.env['ELECTRON_RENDERER_URL']
const PROTOCOL = 'iai-desktop'
// Stealth flags — automatically ON in packaged builds, OFF during development
// (so screenshots/dock access work while developing). No manual flipping needed.
const CONTENT_PROTECTION = !IS_DEV  // overlay invisible in screen shares/recordings
const HIDE_DOCK_ICON     = !IS_DEV  // app hidden from the macOS dock
// Backend/frontend base URLs — baked in at build time from .env.production /
// .env.development (VITE_ prefix is shared with the main process by electron-vite).
const BACKEND_URL: string =
  import.meta.env.VITE_API_BASE_URL ?? import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:3000'
const FRONTEND_URL: string =
  import.meta.env.VITE_FRONTEND_URL ?? 'http://localhost:4000'
// NextAuth uses secure cookies on HTTPS: the session cookie is named
// "__Secure-next-auth.session-token" in production (https backend) but plain
// "next-auth.session-token" in dev (http). Pick the right name accordingly.
const IS_HTTPS_BACKEND = BACKEND_URL.startsWith('https://')
const SESSION_COOKIE_NAME = IS_HTTPS_BACKEND
  ? '__Secure-next-auth.session-token'
  : 'next-auth.session-token'
const TOOLBAR_H  = 48   // toolbar-only height
const MODAL_H    = 340  // activation modal height
const WIN_W_INIT = 860  // initial width (may be updated after screen query)

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
  extraHeaders: Record<string, string> = {}
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

async function verifyAuthToken(token: string): Promise<{ ok: boolean; email?: string; error?: string }> {
  try {
    const res = await httpFetch(
      `${BACKEND_URL}/api/auth/session`,
      'GET',
      undefined,
      { Cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}` }
    )
    if (!res.ok) {
      return { ok: false, error: `Auth check failed (${res.status})` }
    }
    const data = JSON.parse(res.body || '{}') as { user?: { email?: string } }
    if (!data.user?.email) {
      return { ok: false, error: 'Server did not recognize this desktop session.' }
    }
    return { ok: true, email: data.user.email }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

// ─── Window reference ─────────────────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null
let pendingProtocolUrl: string | null = null
let activeAuthToken: string | null = null  // token injected into outgoing requests

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

/** x/y for a snap position given window size, with 8px work-area margins */
function computeSnapXY(pos: string, w: number, h: number): [number, number] {
  const wa = screen.getPrimaryDisplay().workArea
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

function createWindow(): void {
  nativeTheme.themeSource = 'dark'

  const { width: sw } = screen.getPrimaryDisplay().workAreaSize
  const winW = Math.min(WIN_W_INIT, sw - 40)
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
    resizable: false,     // fixed 860px width; height is driven programmatically
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

  // ── System audio capture: intercept getDisplayMedia and inject loopback ──────
  session.defaultSession.setDisplayMediaRequestHandler((_req, callback) => {
    desktopCapturer
      .getSources({ types: ['screen'] })
      .then((sources) => {
        if (sources.length === 0) { callback({}); return }
        // 'loopback' = system audio on macOS; 'loopbackWithMute' on Windows
        callback({ video: sources[0], audio: 'loopback' as 'loopback' })
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
    for (const name of ['next-auth.session-token', '__Secure-next-auth.session-token']) {
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
    secure: IS_HTTPS_BACKEND,   // __Secure- prefixed cookies REQUIRE secure:true
    path: '/',
    sameSite: 'lax' as const,
    expirationDate: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
  }
  await Promise.all(
    [BACKEND_URL, FRONTEND_URL].map((url) =>
      session.defaultSession.cookies
        .set({ url, name: SESSION_COOKIE_NAME, ...cookieBase })
        .catch((e) => console.warn(`[main] Cookie set failed for ${url}:`, e))
    )
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
      const cookieName = SESSION_COOKIE_NAME
      // Replace or append the session cookie — strip any prior value under
      // either the plain or __Secure- name so we never send a stale/duplicate.
      const withoutOld = existing
        .split(';')
        .map((c) => c.trim())
        .filter((c) => c && !/^(?:__Secure-)?next-auth\.session-token=/.test(c))
        .join('; ')
      const updated = withoutOld
        ? `${withoutOld}; ${cookieName}=${activeAuthToken}`
        : `${cookieName}=${activeAuthToken}`
      headers['Cookie'] = updated
      callback({ requestHeaders: headers })
    }
  )

  console.log(`[main] Auth token set — cookie injector active for ${BACKEND_URL} / ${FRONTEND_URL}`)
}

// ─── Protocol handler ─────────────────────────────────────────────────────────
let protocolHandlerInFlight = false
let queuedProtocolUrl: string | null = null

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
    if (!rawPayload) return

    const json = Buffer.from(decodeURIComponent(rawPayload), 'base64').toString('utf8')
    const data = JSON.parse(json) as Record<string, unknown>

    if (parsed.hostname === 'auth') {
      // ── Set cookie in Electron's session BEFORE telling renderer ───────────
      const token = (data.authToken ?? data.token ?? data.sessionToken) as string | undefined
      if (token) {
        await setAuthCookies(token)
        const verified = await verifyAuthToken(token)
        if (verified.ok) saveToken(token)
        else {
          await clearAuthState()
          console.warn('[main] Auth deep link token did not verify:', verified.error)
        }
      } else {
        console.warn('[main] Auth deep link received but no token found in payload:', data)
      }
      if (mainWindow) {
        mainWindow.webContents.send('protocol:auth', data)
        mainWindow.show()
        mainWindow.focus()
      }
    } else if (parsed.hostname === 'session') {
      // Session deep link also carries authToken — set cookie automatically
      // so the app is authenticated even if launched fresh from the browser
      const token = (data.authToken ?? data.token) as string | undefined
      if (token && token !== activeAuthToken) {
        await setAuthCookies(token)
        const verified = await verifyAuthToken(token)
        if (verified.ok) saveToken(token)
        else {
          await clearAuthState()
          console.warn('[main] Session deep link token did not verify:', verified.error)
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
  // Window controls
  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:close',    () => mainWindow?.close())
  ipcMain.handle('window:hide',     () => mainWindow?.hide())
  ipcMain.handle('window:show',     () => { mainWindow?.show(); mainWindow?.focus() })
  ipcMain.handle('window:toggle',   () => {
    if (!mainWindow) return
    mainWindow.isVisible() ? mainWindow.hide() : (mainWindow.show(), mainWindow.focus())
  })
  ipcMain.handle('window:is-visible', () => mainWindow?.isVisible() ?? false)
  ipcMain.handle('window:set-opacity', (_e, v: number) =>
    mainWindow?.setOpacity(Math.max(0.2, Math.min(1, v))))

  // Custom window positioning (for floating MiniBar)
  ipcMain.handle('window:set-position', (_e, x: number, y: number) => {
    if (!mainWindow) return
    mainWindow.setPosition(Math.round(x), Math.round(y), true)
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
  ipcMain.handle('window:set-size', (_e, w: number, h: number) => {
    if (!mainWindow) return
    mainWindow.setSize(Math.round(w), Math.round(h), false)
  })
  // Renderer needs this to compute the 70% max-height clamp for auto-fit sizing.
  ipcMain.handle('window:get-work-area', () => {
    const wa = screen.getPrimaryDisplay().workArea
    return { width: wa.width, height: wa.height }
  })
  ipcMain.handle('window:set-ignore-mouse', (_e, ignore: boolean) => {
    mainWindow?.setIgnoreMouseEvents(ignore, { forward: true })
  })
  // "Private" toggle — hide the overlay from screen shares/recordings
  ipcMain.handle('window:set-content-protection', (_e, on: boolean) => {
    mainWindow?.setContentProtection(on)
  })

  // Position presets — 6 snap positions with 8px margins from the work area.
  // Width is fixed: re-apply it on every snap so the overlay stays anchored.
  // The chosen position is persisted main-side so the next launch is born there.
  ipcMain.handle('window:move-to', (_e, pos: string) => {
    if (!mainWindow) return
    const wa = screen.getPrimaryDisplay().workArea
    const w = Math.min(WIN_W_INIT, wa.width - 2 * SNAP_MARGIN)
    const [, h] = mainWindow.getSize()
    mainWindow.setSize(w, h, false)
    const [x, y] = computeSnapXY(pos, w, h)
    mainWindow.setPosition(x, y, true)
    saveSnapPos(pos)
  })

  // App info
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('app:platform', () => process.platform)

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
      if (!verified.ok) {
        await clearAuthState()
        return { success: false, error: verified.error ?? 'Desktop session was rejected by the server' }
      }
      saveToken(token.trim())
      console.log('[main] Auth token accepted for', verified.email)
      return { success: true }
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
        if (!verified.ok) {
          await clearAuthState()
          return {
            success: false,
            error: verified.error ?? 'Signed in, but the desktop session could not be verified.',
          }
        }
        saveToken(token)
        console.log('[main] In-app sign-in successful for', verified.email)
        return { success: true }
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
}

// ─── Global shortcuts ─────────────────────────────────────────────────────────
function registerShortcuts(): void {
  const shortcuts: Array<[string, string]> = [
    ['CommandOrControl+Return',           'shortcut:answer'],           // ⌘↵
    ['CommandOrControl+Shift+Return',     'shortcut:screenshot'],       // ⌘⇧↵
    ['CommandOrControl+Shift+-',           'shortcut:toggle-chat'],      // ⌘⇧-
    ['CommandOrControl+Shift+Backspace',  'shortcut:clear'],            // ⌘⇧⌫
    ['CommandOrControl+Shift+H',          'shortcut:toggle-visibility'],
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
}

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.setAsDefaultProtocolClient(PROTOCOL)

// Bring the (already-running) overlay to the front — used when a protocol URL
// arrives while the app is alive but backgrounded/minimized.
function bringToFront(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
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
    void dispatchProtocolUrl(url)
    bringToFront()
  } else {
    pendingProtocolUrl = url
  }
})

// Windows/Linux: deep link arrives as argv
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    const url = argv.find((a) => a.startsWith(`${PROTOCOL}://`))
    if (url) {
      if (mainWindow) dispatchProtocolUrl(url)
      else pendingProtocolUrl = url
    }
    bringToFront()
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

app.whenReady().then(async () => {
  if (HIDE_DOCK_ICON) void app.dock?.hide()
  registerIPC()

  // Create window immediately; restore token in parallel (doesn't need to block UI)
  const saved = loadToken()
  if (saved) {
    setAuthCookies(saved)
      .then(() => console.log('[main] Restored auth token from disk'))
      .catch((e) => console.warn('[main] Token restore failed:', e))
  }

  createWindow()
  registerShortcuts()

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
})
