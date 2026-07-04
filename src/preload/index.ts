import { contextBridge, ipcRenderer } from 'electron'

// ─── Type-safe API surface exposed to renderer ────────────────────────────────
const electronAPI = {
  // Window controls
  window: {
    minimize:       () => ipcRenderer.invoke('window:minimize'),
    close:          () => ipcRenderer.invoke('window:close'),
    hide:           () => ipcRenderer.invoke('window:hide'),
    show:           () => ipcRenderer.invoke('window:show'),
    toggle:         () => ipcRenderer.invoke('window:toggle'),
    isVisible:      () => ipcRenderer.invoke('window:is-visible') as Promise<boolean>,
    setOpacity:     (v: number) => ipcRenderer.invoke('window:set-opacity', v),
    setHeight:      (h: number, anchorBottom?: boolean) => ipcRenderer.invoke('window:set-height', h, anchorBottom),
    setSize:        (w: number, h: number) => ipcRenderer.invoke('window:set-size', w, h),
    getWorkAreaSize: () => ipcRenderer.invoke('window:get-work-area') as Promise<{ width: number; height: number }>,
    setIgnoreMouse: (v: boolean) => ipcRenderer.invoke('window:set-ignore-mouse', v),
    setContentProtection: (v: boolean) => ipcRenderer.invoke('window:set-content-protection', v),
    setPosition:    (x: number, y: number) => ipcRenderer.invoke('window:set-position', x, y),
    moveTo:         (pos: string) => ipcRenderer.invoke('window:move-to', pos),
  },

  // App info
  app: {
    version:  () => ipcRenderer.invoke('app:version') as Promise<string>,
    platform: () => ipcRenderer.invoke('app:platform') as Promise<NodeJS.Platform>,
  },

  // Desktop capture sources (for system audio)
  capture: {
    getSources: () =>
      ipcRenderer.invoke('capture:get-sources') as Promise<{ id: string; name: string }[]>,
  },

  // External links
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),
  },

  // Auth
  auth: {
    clear: () => ipcRenderer.invoke('auth:clear'),
    setToken: (token: string) =>
      ipcRenderer.invoke('auth:set-token', token) as Promise<{ success: boolean; error?: string }>,
    signin: (email: string, password: string) =>
      ipcRenderer.invoke('auth:signin', email, password) as Promise<{ success: boolean; error?: string }>,
  },

  // Listen for events from main process
  on: (channel: string, fn: (...args: unknown[]) => void) => {
    const ALLOWED = new Set([
      'protocol:session',
      'protocol:auth',
      'shortcut:answer',
      'shortcut:screenshot',
      'shortcut:clear',
      'shortcut:toggle-chat',
      'shortcut:toggle-visibility',
    ])
    if (!ALLOWED.has(channel)) return () => {}
    const listener = (_: Electron.IpcRendererEvent, ...args: unknown[]) => fn(...args)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

export type ElectronAPI = typeof electronAPI
