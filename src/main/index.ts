import {
  app, BrowserWindow, ipcMain, globalShortcut,
  shell, session, desktopCapturer, nativeTheme, screen,
} from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'

// ─── Constants ────────────────────────────────────────────────────────────────
const IS_DEV = process.env.NODE_ENV === 'development'
const RENDERER_DEV_URL = process.env['ELECTRON_RENDERER_URL']
const PROTOCOL = 'parakeetai'
const TOOLBAR_H  = 48   // toolbar-only height
const MODAL_H    = 340  // activation modal height
const WIN_W_INIT = 860  // initial width (may be updated after screen query)

// ─── Window reference ─────────────────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null
let pendingProtocolUrl: string | null = null
let activeAuthToken: string | null = null  // token injected into outgoing requests

// ─── Window factory ───────────────────────────────────────────────────────────
function createWindow(): void {
  nativeTheme.themeSource = 'dark'

  const { width: sw } = screen.getPrimaryDisplay().workAreaSize
  const winW = Math.min(WIN_W_INIT, sw - 40)
  const winX = Math.round((sw - winW) / 2)

  mainWindow = new BrowserWindow({
    width: winW,
    height: MODAL_H,      // starts with modal height
    x: winX,
    y: 0,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: true,
    roundedCorners: true,
    alwaysOnTop: true,
    resizable: false,
    movable: true,
    skipTaskbar: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: !IS_DEV,
    },
  })

  // ── Stealth: invisible on screen share / recordings ─────────────────────────
  mainWindow.setContentProtection(true)

  // ── Keep on top across all spaces + fullscreen apps ──────────────────────────
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  mainWindow.setAlwaysOnTop(true, 'screen-saver', 1)

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
async function setAuthCookies(token: string): Promise<void> {
  activeAuthToken = token

  // 1. Store token in Electron's cookie jar (belt-and-suspenders)
  const cookieBase = {
    value: token,
    httpOnly: true,
    secure: false,
    path: '/',
    sameSite: 'no_restriction' as const,
    expirationDate: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
  }
  await Promise.all(
    ['http://localhost:3000', 'http://localhost:4000'].map((url) =>
      session.defaultSession.cookies
        .set({ url, name: 'next-auth.session-token', ...cookieBase })
        .catch((e) => console.warn(`[main] Cookie set failed for ${url}:`, e))
    )
  )
  await session.defaultSession.cookies.flushStore().catch(() => {})

  // 2. Inject Cookie header on ALL requests to localhost:3000 and localhost:4000
  //    This bypasses the file:// null-origin restriction entirely.
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['http://localhost:3000/*', 'http://localhost:4000/*'] },
    (details, callback) => {
      if (!activeAuthToken) { callback({ requestHeaders: details.requestHeaders }); return }
      const headers = { ...details.requestHeaders }
      const existing = headers['Cookie'] ?? headers['cookie'] ?? ''
      const cookieName = 'next-auth.session-token'
      // Replace or append the session cookie
      const withoutOld = existing
        .split(';')
        .map((c) => c.trim())
        .filter((c) => !c.startsWith(`${cookieName}=`))
        .join('; ')
      const updated = withoutOld
        ? `${withoutOld}; ${cookieName}=${activeAuthToken}`
        : `${cookieName}=${activeAuthToken}`
      headers['Cookie'] = updated
      callback({ requestHeaders: headers })
    }
  )

  console.log('[main] Auth token set — cookie injector active for localhost:3000/4000')
}

// ─── Protocol handler ─────────────────────────────────────────────────────────
async function dispatchProtocolUrl(url: string): Promise<void> {
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
        saveToken(token)
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
        saveToken(token)
      }
      if (mainWindow) {
        mainWindow.webContents.send('protocol:session', data)
        mainWindow.show()
        mainWindow.focus()
      }
    }
  } catch (err) {
    console.error('[main] Protocol URL parse error:', err)
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

  // Dynamic window sizing — renderer calls these to expand/collapse panels
  ipcMain.handle('window:set-height', (_e, h: number) => {
    if (!mainWindow) return
    const [w] = mainWindow.getSize()
    mainWindow.setSize(w, Math.round(Math.max(TOOLBAR_H, h)), false)
  })
  ipcMain.handle('window:set-size', (_e, w: number, h: number) => {
    if (!mainWindow) return
    mainWindow.setSize(Math.round(w), Math.round(h), false)
  })
  ipcMain.handle('window:set-ignore-mouse', (_e, ignore: boolean) => {
    mainWindow?.setIgnoreMouseEvents(ignore, { forward: true })
  })

  // Position presets — move overlay to top/left/bottom
  ipcMain.handle('window:move-to', (_e, pos: 'top' | 'left' | 'bottom') => {
    if (!mainWindow) return
    const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize
    const [w, h] = mainWindow.getSize()
    if (pos === 'top')    mainWindow.setPosition(Math.round((sw - w) / 2), 0, true)
    else if (pos === 'left')   mainWindow.setPosition(0, Math.round((sh - h) / 2), true)
    else if (pos === 'bottom') mainWindow.setPosition(Math.round((sw - w) / 2), sh - h, true)
    else if (pos === 'right')  mainWindow.setPosition(sw - w - 8, Math.round((sh - h) / 2), true)
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

  // Clear auth token (sign out)
  ipcMain.handle('auth:clear', async () => {
    activeAuthToken = null
    session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['http://localhost:3000/*', 'http://localhost:4000/*'] }, (_d, cb) => cb({}))
    await session.defaultSession.cookies.remove('http://localhost:3000', 'next-auth.session-token').catch(() => {})
    await session.defaultSession.cookies.remove('http://localhost:4000', 'next-auth.session-token').catch(() => {})
    try { writeFileSync(tokenPath(), '', 'utf8') } catch { /* ignore */ }
    console.log('[main] Auth token cleared')
  })
}

// ─── Global shortcuts ─────────────────────────────────────────────────────────
function registerShortcuts(): void {
  const shortcuts: Array<[string, string]> = [
    ['CommandOrControl+Shift+A', 'shortcut:answer'],
    ['CommandOrControl+Shift+S', 'shortcut:screenshot'],
    ['CommandOrControl+Shift+K', 'shortcut:clear'],
    ['CommandOrControl+Shift+H', 'shortcut:toggle-visibility'],
  ]

  shortcuts.forEach(([accelerator, channel]) => {
    const ok = globalShortcut.register(accelerator, () => {
      if (channel === 'shortcut:toggle-visibility') {
        if (mainWindow?.isVisible()) mainWindow.hide()
        else { mainWindow?.show(); mainWindow?.focus() }
      } else {
        mainWindow?.webContents.send(channel)
      }
    })
    if (!ok) console.warn(`[main] Could not register shortcut: ${accelerator}`)
  })
}

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.setAsDefaultProtocolClient(PROTOCOL)

// macOS: deep link arrives while app is running
app.on('open-url', (event, url) => {
  event.preventDefault()
  if (mainWindow) void dispatchProtocolUrl(url)
  else pendingProtocolUrl = url
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
    mainWindow?.show()
    mainWindow?.focus()
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
  registerIPC()

  // Restore previously saved auth token so we stay logged in across restarts
  const saved = loadToken()
  if (saved) {
    await setAuthCookies(saved)
    console.log('[main] Restored auth token from disk')
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
