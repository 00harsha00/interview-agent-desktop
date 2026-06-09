// ─── URLs ─────────────────────────────────────────────────────────────────────
// In dev: backend runs on :3000, frontend (Next.js dashboard) on :4000.
export const BACKEND_URL  = import.meta.env.VITE_BACKEND_URL  ?? 'http://localhost:3000'
export const FRONTEND_URL = import.meta.env.VITE_FRONTEND_URL ?? 'http://localhost:4000'

// ─── Speechmatics ─────────────────────────────────────────────────────────────
export const SM_RT_URL = 'wss://eu2.rt.speechmatics.com/v2'
export const SM_SAMPLE_RATE = 16_000          // Hz — required by Speechmatics
export const SM_CHUNK_SIZE  = 4_096           // PCM16 samples per send (~256ms)

// ─── Session ──────────────────────────────────────────────────────────────────
export const SESSION_PING_MS      = 30_000    // Keep-alive ping interval
export const TRANSCRIPT_SAVE_MS   = 5_000     // Batch-save transcript every N ms
export const QUESTION_BUFFER_MS   = 3_000     // Collect speech for N ms before auto-answer
export const SILENCE_TRIGGER_MS   = 1_800     // Auto-answer after N ms silence

// ─── AI model labels ──────────────────────────────────────────────────────────
export const AI_MODEL_LABELS: Record<string, string> = {
  GPT4O:              'GPT-4o',
  GPT4O_MINI:         'GPT-4o Mini',
  GPT4_TURBO:         'GPT-4 Turbo',
  CLAUDE_3_5_SONNET:  'Claude Sonnet',
  CLAUDE_3_HAIKU:     'Claude Haiku',
  GEMINI_1_5_PRO:     'Gemini 1.5 Pro',
  GEMINI_1_5_FLASH:   'Gemini 1.5 Flash',
}
