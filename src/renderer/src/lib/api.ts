/**
 * Type-safe API client for the ParakeetAI backend.
 * All calls go to BACKEND_URL (the Next.js backend — localhost in dev, Railway in prod).
 */
import { BACKEND_URL } from '@/config'
import type { AIModel, AuthUser, CallSession } from '@/types'

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
    credentials: 'omit',    // cookie injected by main process; avoids null-origin CORS block
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

// ─── Device identity (single-device session lock) ──────────────────────────
let cachedDeviceId: string | null = null
async function getDeviceId(): Promise<string> {
  if (!cachedDeviceId) cachedDeviceId = await window.electronAPI.app.deviceId()
  return cachedDeviceId
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
  opts?: { forceTakeOver?: boolean },
): Promise<void> {
  // callSession.status is a nested router: .activate or .end
  if (status === 'ACTIVE') {
    const deviceId = await getDeviceId()
    await trpcMutation('callSession.status.activate', { id, deviceId, forceTakeOver: opts?.forceTakeOver })
  } else {
    await trpcMutation('callSession.status.end', { id })
  }
}

/** Refreshes this device's claim on the session's active-device lock. Called
 *  periodically while a session is running — if another device has since
 *  taken over, `ok` comes back false so the caller can stop itself. */
export async function heartbeatSession(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const deviceId = await getDeviceId()
    return await trpcMutation<{ ok: boolean; error?: string }>('callSession.heartbeat', { id, deviceId })
  } catch {
    // Network hiccup — never treat this as losing the lock.
    return { ok: true }
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

export async function updateSessionModel(id: string, aiModel: AIModel): Promise<void> {
  // Existing callSession.update mutation accepts aiModel; history is keyed by
  // callSessionId so switching mid-session keeps the full conversation.
  await trpcMutation('callSession.update', { id, aiModel })
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

// ─── Session creation ─────────────────────────────────────────────────────────
export interface CreateSessionInput {
  companyName: string
  jobDescription: string        // required on backend (min 1 char)
  resumeId?: string
  documentIds?: string[]
  language?: string
  mode: 'FREE' | 'DESKTOP'     // backend SessionMode: FREE | DESKTOP | WEB
  autoGenerate?: boolean
  aiModel?: AIModel            // backend defaults to GPT4O when omitted
}

export async function createSession(data: CreateSessionInput): Promise<CallSession> {
  return trpcMutation<CallSession>('callSession.create', data)
}

// ─── Resumes ─────────────────────────────────────────────────────────────────
export interface UserResume {
  id: string
  fileName: string
  mimeType: string
  fileSize: number
  createdAt: string
}

export async function getUserResumes(): Promise<UserResume[]> {
  try {
    return await trpcQuery<UserResume[]>('resume.getMany')
  } catch {
    return []
  }
}

export async function getResumeContent(id: string): Promise<string | null> {
  try {
    const data = await trpcQuery<{ parsedContent?: string }>('resume.getOne', { id })
    return data.parsedContent ?? null
  } catch {
    return null
  }
}

// ─── Documents ────────────────────────────────────────────────────────────────
export interface UserDocument {
  id: string
  name: string
  fileName: string
  fileSize: number
  mimeType: string
  createdAt: string
}

export async function getUserDocuments(): Promise<UserDocument[]> {
  try {
    return await trpcQuery<UserDocument[]>('callDocument.getMany')
  } catch {
    return []
  }
}

// ─── AI chat (SSE streaming) ──────────────────────────────────────────────────
export function streamAIAnswer(
  callSessionId: string,
  question: string,
  signal: AbortSignal,
  onChunk: (text: string) => void,
  onDone: () => void,
  onError: (err: string) => void,
  images?: string[],
  extraContext?: string,
  isRegenerate?: boolean,
): void {
  void getDeviceId().then((deviceId) => {
    const url = `${BACKEND_URL}/api/chat`
    console.log('[api] getDeviceId resolved:', deviceId?.slice(0, 8), '| url:', url)
    const payload = {
      callSessionId,
      question,
      ...(images?.length ? { images } : {}),
      ...(extraContext?.trim() ? { extraContext: extraContext.trim() } : {}),
      ...(isRegenerate ? { isRegenerate: true } : {}),
      deviceId,
    }
    console.error('[DEBUG-RENDERER] about to fetch:', url)
    console.error('[DEBUG-RENDERER] fetch headers:', JSON.stringify({
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
      'Cache-Control': 'no-cache',
    }))
    console.log('[api] streamAIAnswer URL:', url)
    console.log('[api] streamAIAnswer callSessionId:', callSessionId)
    console.log('[api] streamAIAnswer payload:', JSON.stringify(payload).slice(0, 500))

    return fetch(url, {
      method: 'POST',
      credentials: 'omit',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
      body: JSON.stringify(payload),
      signal,
    })
    .then(async (res) => {
      console.error('[DEBUG-RENDERER] response status:', res.status)
      console.error('[DEBUG-RENDERER] response headers:', JSON.stringify(Object.fromEntries(res.headers.entries())))
      console.log('[api] streamAIAnswer response:', res.status, res.statusText)
      console.log('[api] response content-type:', res.headers.get('content-type'))
      if (!res.ok) {
        const body = await res.text().catch(() => res.statusText)
        let msg = body
        try { msg = (JSON.parse(body) as { error?: string }).error ?? body } catch {}
        console.error('[api] streamAIAnswer error:', res.status, body)
        onError(msg)
        return
      }

      if (!res.body) { console.error('[api] res.body is null'); onError('No response body'); return }

      // TextDecoderStream for Electron compatibility — avoids issues with
      // manual TextDecoder + Uint8Array buffering in Electron's Chromium.
      const reader = res.body
        .pipeThrough(new TextDecoderStream())
        .getReader()

      console.log('[api] SSE stream reader obtained via TextDecoderStream')
      let buf = ''
      let chunkCount = 0

      const pump = async (): Promise<void> => {
        try {
          const { done, value } = await reader.read()
          if (done) { console.log('[api] SSE stream done, total chunks:', chunkCount); onDone(); return }

          buf += value
          const lines = buf.split('\n')
          buf = lines.pop() ?? ''

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed.startsWith('data:')) continue
            const data = trimmed.slice(5).trim()
            if (data === '[DONE]') { console.log('[api] SSE [DONE], total chunks:', chunkCount); onDone(); return }
            if (!data) continue
            try {
              const chunk = JSON.parse(data) as unknown
              if (chunkCount === 0) console.log('[api] first SSE chunk:', JSON.stringify(chunk).slice(0, 200))
              chunkCount++
              if (typeof chunk === 'string') {
                onChunk(chunk)
              } else if (chunk && typeof chunk === 'object') {
                const obj = chunk as Record<string, unknown>
                if (obj.error) { onError(String(obj.error)); return }
                if (typeof obj.text === 'string') { onChunk(obj.text); continue }
                if (typeof obj.content === 'string') { onChunk(obj.content); continue }
                const choices = obj.choices as Array<{ delta?: { content?: string } }> | undefined
                if (choices?.[0]?.delta?.content) { onChunk(choices[0].delta.content); continue }
                console.warn('[api] unhandled SSE chunk shape:', JSON.stringify(chunk).slice(0, 300))
              }
            } catch {
              console.warn('[api] SSE JSON parse failed:', data.slice(0, 200))
            }
          }

          return pump()
        } catch (err) {
          if ((err as Error).name !== 'AbortError') {
            console.error('[api] SSE pump error:', (err as Error).message)
            onError((err as Error).message)
          }
        }
      }

      return pump()
    })
    .catch((err: Error) => {
      console.error('[api] streamAIAnswer fetch error:', err.message)
      if (err.name !== 'AbortError') onError(err.message)
    })
  }).catch((err: Error) => {
    console.error('[api] getDeviceId or pre-fetch error:', err.message)
    onError(err.message)
  })
}
