import {
  app, BrowserWindow, ipcMain, globalShortcut,
  shell, session, desktopCapturer, nativeTheme, screen,
} from 'electron'
import { join } from 'path'

// ─── Constants ────────────────────────────────────────────────────────────────
const IS_DEV = process.env.NODE_ENV === 'development'
const RENDERER_DEV_URL = process.env['ELECTRON_RENDERER_URL']
const PROTOCOL = 'parakeetai'
const WIN_WIDTH  = 380
const WIN_HEIGHT = 700
const WIN_MIN_W  = 320
const WIN_MIN_H  = 480

// ─── Window reference ─────────────────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null
let pendingProtocolUrl: string | null = null

// ─── Window factory ───────────────────────────────────────────────────────────
function createWindow(): void {
  nativeTheme.themeSource = 'dark'

  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize

  mainWindow = new BrowserWindow({
    width: WIN_WIDTH,
    height: WIN_HEIGHT,
    minWidth: WIN_MIN_W,
    minHeight: WIN_MIN_H,
    x: sw - WIN_WIDTH - 24,
    y: Math.round((sh - WIN_HEIGHT) / 2),
    frame: false,
    transparent: false,
    backgroundColor: '#0f172a',
    hasShadow: true,
    roundedCorners: true,
    alwaysOnTop: true,
    resizable: true,
    movable: true,
    skipTaskbar: false,
    titleBarStyle: 'hidden',
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
async function setAuthCookies(token: string): Promise<void> {
  const cookieBase = {
    value: token,
    httpOnly: true,
    secure: false,
    path: '/',
    sameSite: 'no_restriction' as const,
    expirationDate: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30, // 30 days
  }
  // Set for both ports — backend (3000) validates, frontend (4000) also needs it
  const targets = [
    { url: 'http://localhost:3000', name: 'next-auth.session-token' },
    { url: 'http://localhost:4000', name: 'next-auth.session-token' },
  ]
  await Promise.all(
    targets.map(({ url, name }) =>
      session.defaultSession.cookies.set({ url, name, ...cookieBase }).catch((e) =>
        console.warn(`[main] Cookie set failed for ${url}:`, e)
      )
    )
  )
  // Flush cookie store to disk immediately
  await session.defaultSession.cookies.flushStore().catch(() => {})
  console.log('[main] Auth cookies set for localhost:3000 and localhost:4000')
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
      } else {
        console.warn('[main] Auth deep link received but no token found in payload:', data)
      }
      if (mainWindow) {
        mainWindow.webContents.send('protocol:auth', data)
        mainWindow.show()
        mainWindow.focus()
      }
    } else if (parsed.hostname === 'session') {
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

app.whenReady().then(() => {
  registerIPC()
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
