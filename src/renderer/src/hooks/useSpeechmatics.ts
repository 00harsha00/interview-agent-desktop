/**
 * useSpeechmatics — real-time transcription via Speechmatics WebSocket.
 * Manages connection lifecycle, auto-reconnect on unexpected drops,
 * and typed message dispatch.
 */
import { useCallback, useEffect, useRef } from 'react'
import { SM_RT_URL } from '@/config'
import type { SmConnectionState } from '@/types'

interface SmResult {
  alternatives?: Array<{ content: string; confidence: number }>
}

interface SmMessage {
  message: string
  results?: SmResult[]
  reason?: string
  seq_no?: number
}

interface Options {
  language: string
  onPartial:      (text: string) => void
  onFinal:        (text: string) => void
  onStateChange:  (state: SmConnectionState) => void
  /** Called before every reconnect attempt — must return a FRESH JWT, never
   *  a cached one. Speechmatics JWTs have only a 60s TTL, so reusing the
   *  JWT from the original connect() on a reconnect that happens more than
   *  ~60s later is a near-guaranteed failure. */
  getFreshJwt:    () => Promise<string>
  /** Fired once, after all reconnect attempts are exhausted. */
  onReconnectFailed?: (message: string) => void
}

// Exponential backoff: 1s, 2s, 4s, 8s, 16s — 5 attempts total.
const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000]
const MAX_RECONNECT_ATTEMPTS = RECONNECT_DELAYS_MS.length

export function useSpeechmatics({ language, onPartial, onFinal, onStateChange, getFreshJwt, onReconnectFailed }: Options) {
  const wsRef              = useRef<WebSocket | null>(null)
  const seqNoRef           = useRef(0)
  const jwtRef             = useRef<string>('')          // last-used JWT, for debugging only — reconnects always fetch fresh
  const intentionalClose   = useRef(false)               // true = we called disconnect()
  const reconnectAttempts  = useRef(0)
  const reconnectTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const optsRef            = useRef({ language, onPartial, onFinal, onStateChange, getFreshJwt, onReconnectFailed })
  optsRef.current          = { language, onPartial, onFinal, onStateChange, getFreshJwt, onReconnectFailed }

  function clearReconnectTimer() {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
  }

  // Core "open a WebSocket with this JWT" logic — deliberately does NOT
  // touch reconnectAttempts, so scheduleReconnect() can track attempts
  // across multiple establishConnection() calls until one succeeds.
  const establishConnection = useCallback((jwt: string) => {
    jwtRef.current  = jwt
    seqNoRef.current = 0

    console.log('[useSpeechmatics] Connecting with language:', optsRef.current.language)

    const ws = new WebSocket(`${SM_RT_URL}?jwt=${encodeURIComponent(jwt)}`)
    ws.binaryType = 'arraybuffer'
    wsRef.current = ws

    ws.onopen = () => {
      console.log('[useSpeechmatics] WebSocket connected')
      const config = {
        message: 'StartRecognition',
        audio_format: {
          type: 'raw',
          encoding: 'pcm_s16le',
          sample_rate: 16_000,
        },
        transcription_config: {
          language: optsRef.current.language,
          enable_partials: true,
          max_delay: 2,
          max_delay_mode: 'flexible',
          operating_point: 'enhanced',
        },
      }
      ws.send(JSON.stringify(config))
    }

    ws.onmessage = (evt) => {
      if (typeof evt.data !== 'string') return
      let msg: SmMessage
      try { msg = JSON.parse(evt.data) as SmMessage } catch { return }

      switch (msg.message) {
        case 'RecognitionStarted':
          reconnectAttempts.current = 0   // reset on confirmed successful (re)connect
          optsRef.current.onStateChange('connected')
          break

        case 'AddPartialTranscript': {
          const text = extractText(msg.results)
          if (text) optsRef.current.onPartial(text)
          break
        }

        case 'AddTranscript': {
          const text = extractText(msg.results)
          if (text) optsRef.current.onFinal(text)
          break
        }

        case 'EndOfTranscript':
          optsRef.current.onStateChange('disconnected')
          break

        case 'Error':
          console.error('[Speechmatics] Error:', msg.reason)
          optsRef.current.onStateChange('error')
          break
      }
    }

    ws.onerror = () => {
      optsRef.current.onStateChange('error')
    }

    ws.onclose = () => {
      // If we closed it intentionally (user ended session, or a fresh
      // connect() tore down the old socket) — don't reconnect.
      if (intentionalClose.current) {
        optsRef.current.onStateChange('disconnected')
        return
      }
      scheduleReconnect()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Bounded exponential-backoff reconnect. ALWAYS fetches a fresh JWT before
  // reconnecting — Speechmatics JWTs expire after 60s, so reusing the
  // original one past that window would fail every single time.
  function scheduleReconnect() {
    if (reconnectAttempts.current >= MAX_RECONNECT_ATTEMPTS) {
      console.error('[Speechmatics] Reconnect attempts exhausted — giving up')
      optsRef.current.onStateChange('failed')
      optsRef.current.onReconnectFailed?.('Transcription lost — please restart the session.')
      return
    }

    const delay = RECONNECT_DELAYS_MS[reconnectAttempts.current]
    reconnectAttempts.current++
    console.info(`[Speechmatics] Unexpected close — reconnecting in ${delay}ms (attempt ${reconnectAttempts.current}/${MAX_RECONNECT_ATTEMPTS})`)
    optsRef.current.onStateChange('reconnecting')

    reconnectTimerRef.current = setTimeout(async () => {
      try {
        const freshJwt = await optsRef.current.getFreshJwt()
        establishConnection(freshJwt)
      } catch (err) {
        // Couldn't even mint a fresh JWT (network/backend down) — count this
        // as a failed attempt too and keep trying on the same backoff.
        console.error('[Speechmatics] Failed to fetch fresh JWT for reconnect:', err)
        scheduleReconnect()
      }
    }, delay)
  }

  // Public API — a fresh, explicit connect (session start, language change).
  // Always resets attempt count/state, unlike the internal auto-reconnect path.
  const connect = useCallback((jwt: string) => {
    // Tear down existing connection
    intentionalClose.current = true
    if (wsRef.current) {
      wsRef.current.onclose = null
      wsRef.current.close()
      wsRef.current = null
    }
    intentionalClose.current = false
    clearReconnectTimer()
    reconnectAttempts.current = 0

    optsRef.current.onStateChange('connecting')
    establishConnection(jwt)
  }, [establishConnection])

  const sendAudio = useCallback((buffer: ArrayBuffer) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(buffer)
      seqNoRef.current++
    }
  }, [])

  // Graceful disconnect: flush remaining audio, prevent reconnect
  const disconnect = useCallback(() => {
    clearReconnectTimer()
    reconnectAttempts.current = 0
    intentionalClose.current = true
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({ message: 'EndOfStream', last_seq_no: seqNoRef.current }),
      )
    } else {
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [])

  useEffect(() => () => {
    clearReconnectTimer()
    disconnect()
  }, [disconnect])

  return { connect, sendAudio, disconnect }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function extractText(results?: SmResult[]): string {
  if (!results?.length) return ''
  return results
    .map((r) => r.alternatives?.[0]?.content ?? '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}
