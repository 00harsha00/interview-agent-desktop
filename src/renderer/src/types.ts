import type { ElectronAPI } from '../../preload/index'

// ─── Global window augmentation ───────────────────────────────────────────────
declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
export interface AuthUser {
  id: string
  email: string
  name?: string | null
  credits: number
  isAdmin?: boolean
}

// ─── Session ──────────────────────────────────────────────────────────────────
export type SessionMode   = 'FREE' | 'PAID'
export type SessionStatus = 'PENDING' | 'ACTIVE' | 'ENDED'
export type AIModel = 'GPT4O' | 'GPT4O_MINI' | 'GPT4_TURBO' | 'CLAUDE_3_5_SONNET' | 'CLAUDE_3_HAIKU' | 'GEMINI_1_5_PRO' | 'GEMINI_1_5_FLASH'

export interface CallSession {
  id: string
  companyName: string
  jobDescription?: string | null
  language: string
  aiModel: AIModel
  mode: SessionMode
  status: SessionStatus
  resumeId?: string | null
  autoGenerate: boolean
  createdAt: string
  activatedAt?: string | null  // ISO string — used to compute countdown on resume
}

// ─── Messages ─────────────────────────────────────────────────────────────────
export interface TranscriptEntry {
  id: string
  text: string
  isFinal: boolean
  timestamp: number
}

export interface AIMessage {
  id: string
  role: 'USER' | 'ASSISTANT'
  content: string
  isStreaming?: boolean
}

// ─── Speechmatics ─────────────────────────────────────────────────────────────
export type SmConnectionState = 'idle' | 'connecting' | 'connected' | 'error' | 'disconnected'

// ─── Audio ────────────────────────────────────────────────────────────────────
export type AudioSource = 'mic' | 'system' | 'both' | 'none'

// ─── Protocol payloads ────────────────────────────────────────────────────────
export interface SessionProtocolPayload {
  sessionId?: string       // legacy fallback
  callSessionId?: string   // what the frontend actually sends
  authToken?: string
}

export interface AuthProtocolPayload {
  authToken: string
}
