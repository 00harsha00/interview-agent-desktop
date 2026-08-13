// ─── URLs ─────────────────────────────────────────────────────────────────────
// Baked at build time from .env.development (local) or .env.production (Fly.io).
// Production: https://interview-agent-backend-vnrl-a.fly.dev
// Local dev:  http://localhost:3000  (set in .env.development)
export const BACKEND_URL =
  import.meta.env.VITE_API_BASE_URL ??
  import.meta.env.VITE_BACKEND_URL ??
  'https://interview-agent-backend-vnrl-a.fly.dev'
export const FRONTEND_URL =
  import.meta.env.VITE_FRONTEND_URL ??
  'https://interview-agent-frontend-chi.vercel.app'

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
  LLAMA_3_3_70B:      'Llama 3.3 70B',
  QWEN_2_5_CODER:     'Qwen 2.5 Coder',
  NEMOTRON_49B:       'Nemotron 49B',
  LLAMA_3_1_8B:       'Llama 3.1 8B',
}

export interface ModelInfo {
  id: string
  name: string
  bestFor: string
  free: boolean
  provider: string
}

export const MODELS: ModelInfo[] = [
  { id: 'CLAUDE_3_5_SONNET', name: 'Claude Sonnet',    bestFor: 'Live interviews',      free: false, provider: 'Anthropic' },
  { id: 'CLAUDE_3_HAIKU',    name: 'Claude Haiku',     bestFor: 'Fast responses',        free: false, provider: 'Anthropic' },
  { id: 'GPT4O',             name: 'GPT-4o',           bestFor: 'Detailed answers',      free: false, provider: 'OpenAI'    },
  { id: 'GPT4O_MINI',        name: 'GPT-4o Mini',      bestFor: 'Quick answers',         free: false, provider: 'OpenAI'    },
  { id: 'GPT4_TURBO',        name: 'GPT-4 Turbo',      bestFor: 'Complex reasoning',     free: false, provider: 'OpenAI'    },
  { id: 'GEMINI_1_5_PRO',    name: 'Gemini 1.5 Pro',   bestFor: 'Long context',          free: false, provider: 'Google'    },
  { id: 'GEMINI_1_5_FLASH',  name: 'Gemini Flash',     bestFor: 'Speed + efficiency',    free: false, provider: 'Google'    },
  { id: 'LLAMA_3_3_70B',     name: 'Llama 3.3 70B',   bestFor: 'General Q&A',           free: true,  provider: 'NVIDIA'    },
  { id: 'QWEN_2_5_CODER',    name: 'Qwen 2.5 Coder',  bestFor: 'Coding & DSA',          free: true,  provider: 'NVIDIA'    },
  { id: 'NEMOTRON_49B',      name: 'Nemotron 49B',     bestFor: 'Math & ML theory',      free: true,  provider: 'NVIDIA'    },
  { id: 'LLAMA_3_1_8B',      name: 'Llama 3.1 8B',    bestFor: 'Fastest responses',     free: true,  provider: 'NVIDIA'    },
]
