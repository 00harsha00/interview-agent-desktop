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
}

const MAX_RECONNECT_ATTEMPTS = 3
const RECONNECT_DELAY_MS     = 2_000

export function useSpeechmatics({ language, onPartial, onFinal, onStateChange }: Options) {
  const wsRef              = useRef<WebSocket | null>(null)
  const seqNoRef           = useRef(0)
  const jwtRef             = useRef<string>('')          // stored so we can reconnect
  const intentionalClose   = useRef(false)               // true = we called disconnect()
  const reconnectAttempts  = useRef(0)
  const reconnectTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const optsRef            = useRef({ language, onPartial, onFinal, onStateChange })
  optsRef.current          = { language, onPartial, onFinal, onStateChange }

  function clearReconnectTimer() {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
  }

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

    jwtRef.current           = jwt
    reconnectAttempts.current = 0
    seqNoRef.current          = 0

    console.log('[useSpeechmatics] Connecting with language:', language)
    optsRef.current.onStateChange('connecting')

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
          reconnectAttempts.current = 0   // reset on successful connect
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
      // If we closed it intentionally (user ended session) — don't reconnect
      if (intentionalClose.current) {
        optsRef.current.onStateChange('disconnected')
        return
      }

      // Unexpected drop — attempt reconnect with back-off
      if (reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS && jwtRef.current) {
        reconnectAttempts.current++
        const delay = RECONNECT_DELAY_MS * reconnectAttempts.current
        console.info(`[Speechmatics] Unexpected close — reconnecting in ${delay}ms (attempt ${reconnectAttempts.current}/${MAX_RECONNECT_ATTEMPTS})`)
        optsRef.current.onStateChange('connecting')
        reconnectTimerRef.current = setTimeout(() => {
          connect(jwtRef.current)
        }, delay)
      } else {
        optsRef.current.onStateChange('disconnected')
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const sendAudio = useCallback((buffer: ArrayBuffer) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(buffer)
      seqNoRef.current++
    }
  }, [])

  // Graceful disconnect: flush remaining audio, prevent reconnect
  const disconnect = useCallback(() => {
    clearReconnectTimer()
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
