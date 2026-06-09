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
    setHeight:      (h: number) => ipcRenderer.invoke('window:set-height', h),
    setSize:        (w: number, h: number) => ipcRenderer.invoke('window:set-size', w, h),
    setIgnoreMouse: (v: boolean) => ipcRenderer.invoke('window:set-ignore-mouse', v),
    moveTo:         (pos: 'top' | 'left' | 'bottom' | 'right') => ipcRenderer.invoke('window:move-to', pos),
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

  // Listen for events from main process
  on: (channel: string, fn: (...args: unknown[]) => void) => {
    const ALLOWED = new Set([
      'protocol:session',
      'protocol:auth',
      'shortcut:answer',
      'shortcut:screenshot',
      'shortcut:clear',
      'shortcut:toggle-visibility',
    ])
    if (!ALLOWED.has(channel)) return () => {}
    const listener = (_: Electron.IpcRendererEvent, ...args: unknown[]) => fn(...args)
    ipcRenderer.on(channel, listener)
    // Return unsubscribe function
    return () => ipcRenderer.removeListener(channel, listener)
  },
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

// TypeScript declaration for the renderer
export type ElectronAPI = typeof electronAPI
