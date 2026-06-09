/**
 * Type-safe API client for the ParakeetAI backend.
 * All calls go to localhost:3000 (the Next.js backend).
 */
import { BACKEND_URL } from '@/config'
import type { AuthUser, CallSession } from '@/types'

class APIError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'APIError'
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${BACKEND_URL}${path}`
  const res = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  if (!res.ok) {
    let message = res.statusText
    try {
      const body = await res.json() as { error?: { json?: { message?: string } }; message?: string }
      // tRPC v11 error envelope: {error: {json: {message: "..."}}}
      message = body.error?.json?.message ?? body.message ?? message
    } catch {}
    throw new APIError(res.status, message)
  }

  const text = await res.text()
  return text ? (JSON.parse(text) as T) : ({} as T)
}

// tRPC v11 wraps both input and output in a {json: ...} envelope.
// Query:    GET  ?input={"json":{...}}   → {"result":{"data":{"json":{...}}}}
// Mutation: POST body={"json":{...}}     → {"result":{"data":{"json":{...}}}}
function trpcQuery<T>(procedure: string, input?: unknown): Promise<T> {
  const wrapped = input !== undefined ? { json: input } : undefined
  const inputStr = wrapped ? `?input=${encodeURIComponent(JSON.stringify(wrapped))}` : ''
  return request<{ result: { data: { json: T } } }>(`/api/trpc/${procedure}${inputStr}`)
    .then((r) => r.result.data.json)
}

function trpcMutation<T>(procedure: string, input: unknown): Promise<T> {
  return request<{ result: { data: { json: T } } }>(`/api/trpc/${procedure}`, {
    method: 'POST',
    body: JSON.stringify({ json: input }),
  }).then((r) => r.result.data.json)
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
export async function getAuthSession(): Promise<AuthUser | null> {
  try {
    const data = await request<{ user?: AuthUser }>('/api/auth/session')
    return data.user ?? null
  } catch {
    return null
  }
}

export async function getUser(): Promise<AuthUser | null> {
  try {
    return await trpcQuery<AuthUser>('user.get')
  } catch {
    return null
  }
}

// ─── Sessions ─────────────────────────────────────────────────────────────────
export async function getSession(id: string): Promise<CallSession | null> {
  try {
    return await trpcQuery<CallSession>('callSession.get', { id })
  } catch {
    return null
  }
}

export async function updateSessionStatus(
  id: string,
  status: 'ACTIVE' | 'ENDED',
): Promise<void> {
  // callSession.status is a nested router: .activate or .end
  if (status === 'ACTIVE') {
    await trpcMutation('callSession.status.activate', { id })
  } else {
    await trpcMutation('callSession.status.end', { id })
  }
}

export async function getSpeechmaticsJwt(sessionId: string): Promise<string> {
  // Backend expects { id } and returns { jwt: "..." }
  const data = await trpcMutation<{ jwt: string }>(
    'callSession.generateSpeechmaticsApiKey',
    { id: sessionId },
  )
  return data.jwt
}

export async function saveTranscriptions(
  callSessionId: string,
  transcriptions: Array<{ speaker: string; text: string }>,
): Promise<void> {
  // Backend speaker enum: "MIC" | "SYSTEM" — map generic strings to enum values
  const mapped = transcriptions.map((t) => ({
    ...t,
    speaker: (t.speaker?.toUpperCase() === 'MIC' ? 'MIC' : 'SYSTEM') as 'MIC' | 'SYSTEM',
  }))
  await trpcMutation('callSession.transcription.createMany', {
    callSessionId,
    transcriptions: mapped,
  })
}

export async function pingSession(id: string): Promise<void> {
  await trpcMutation('callSession.ping', { id }).catch(() => {})
}

export async function extendSession(id: string): Promise<{ newBalance: number }> {
  return trpcMutation<{ success: boolean; newBalance: number }>(
    'callSession.status.extendLimitedSession',
    { id },
  ).then((r) => ({ newBalance: r.newBalance }))
}

// ─── AI chat (SSE streaming) ──────────────────────────────────────────────────
export function streamAIAnswer(
  callSessionId: string,
  question: string,
  signal: AbortSignal,
  onChunk: (text: string) => void,
  onDone: () => void,
  onError: (err: string) => void,
  images?: string[],   // optional base64 data-URLs for vision
): void {
  fetch(`${BACKEND_URL}/api/chat`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callSessionId, question, ...(images?.length ? { images } : {}) }),
    signal,
  })
    .then(async (res) => {
      if (!res.ok) {
        const body = await res.text().catch(() => res.statusText)
        let msg = body
        try { msg = (JSON.parse(body) as { error?: string }).error ?? body } catch {}
        onError(msg)
        return
      }

      const reader = res.body?.getReader()
      if (!reader) { onError('No response body'); return }

      const decoder = new TextDecoder()
      let buf = ''

      const pump = async (): Promise<void> => {
        try {
          const { done, value } = await reader.read()
          if (done) { onDone(); return }

          buf += decoder.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop() ?? ''

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed.startsWith('data:')) continue
            const data = trimmed.slice(5).trim()
            if (data === '[DONE]') { onDone(); return }
            if (!data) continue
            try {
              const chunk = JSON.parse(data) as string | { error?: string }
              if (typeof chunk === 'string') onChunk(chunk)
              else if (chunk.error) onError(chunk.error)
            } catch {}
          }

          return pump()
        } catch (err) {
          if ((err as Error).name !== 'AbortError') onError((err as Error).message)
        }
      }

      return pump()
    })
    .catch((err: Error) => {
      if (err.name !== 'AbortError') onError(err.message)
    })
}
