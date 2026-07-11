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
  /** true once this segment was consumed by an Answer (mirrors questionBufRef flush — display only) */
  sent?: boolean
}

export interface AIMessage {
  id: string
  role: 'USER' | 'ASSISTANT'
  content: string
  isStreaming?: boolean
}

// ─── Speechmatics ─────────────────────────────────────────────────────────────
// 'reconnecting' = an unexpected drop is being retried (bounded, with backoff).
// 'failed' = retries exhausted — transcription is down until the user acts
// (distinct from 'error', which is a single Speechmatics-reported error that
// may or may not lead to a reconnect attempt).
export type SmConnectionState = 'idle' | 'connecting' | 'connected' | 'error' | 'disconnected' | 'reconnecting' | 'failed'

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
