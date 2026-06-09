/**
 * useSpeechmatics — real-time transcription via Speechmatics WebSocket.
 * Manages connection lifecycle, reconnect, and typed message dispatch.
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

export function useSpeechmatics({ language, onPartial, onFinal, onStateChange }: Options) {
  const wsRef      = useRef<WebSocket | null>(null)
  const seqNoRef   = useRef(0)
  const optsRef    = useRef({ language, onPartial, onFinal, onStateChange })
  optsRef.current  = { language, onPartial, onFinal, onStateChange }

  const connect = useCallback((jwt: string) => {
    // Tear down existing connection cleanly
    if (wsRef.current) {
      wsRef.current.onclose = null
      wsRef.current.close()
      wsRef.current = null
    }

    optsRef.current.onStateChange('connecting')
    seqNoRef.current = 0

    const ws = new WebSocket(`${SM_RT_URL}?jwt=${encodeURIComponent(jwt)}`)
    ws.binaryType = 'arraybuffer'
    wsRef.current = ws

    ws.onopen = () => {
      const config: object = {
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

    ws.onerror = (e) => {
      console.error('[Speechmatics] WebSocket error', e)
      optsRef.current.onStateChange('error')
    }

    ws.onclose = () => {
      optsRef.current.onStateChange('disconnected')
    }
  }, [])

  // Send binary PCM16 chunk — called from AudioWorklet message handler
  const sendAudio = useCallback((buffer: ArrayBuffer) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(buffer)
      seqNoRef.current++
    }
  }, [])

  // Graceful disconnect: send EndOfStream so server flushes final transcript
  const disconnect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({ message: 'EndOfStream', last_seq_no: seqNoRef.current }),
      )
    } else {
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [])

  useEffect(() => () => { disconnect() }, [disconnect])

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
