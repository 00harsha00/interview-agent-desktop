/**
 * useAIStream — manages AI answer streaming via SSE.
 * Handles abort, error states, and provides a clean imperative API.
 */
import { useCallback, useRef, useState } from 'react'
import { streamAIAnswer } from '@/lib/api'

interface Options {
  callSessionId: string
  extraContext?: string
  onChunk:  (text: string) => void
  onDone:   (fullText: string) => void
  onError:  (msg: string) => void
}

export function useAIStream({ callSessionId, extraContext, onChunk, onDone, onError }: Options) {
  const [isStreaming, setIsStreaming]  = useState(false)
  const abortRef  = useRef<AbortController | null>(null)
  const bufRef    = useRef('')
  const optsRef   = useRef({ callSessionId, extraContext, onChunk, onDone, onError })
  optsRef.current = { callSessionId, extraContext, onChunk, onDone, onError }

  const abort = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setIsStreaming(false)
    bufRef.current = ''
  }, [])

  const ask = useCallback((question: string, images?: string[]) => {
    if (!question.trim()) return
    abort() // cancel any in-flight request

    const ctrl  = new AbortController()
    abortRef.current = ctrl
    bufRef.current   = ''
    setIsStreaming(true)

    streamAIAnswer(
      optsRef.current.callSessionId,
      question,
      ctrl.signal,
      (chunk) => {
        bufRef.current += chunk
        optsRef.current.onChunk(chunk)
      },
      () => {
        setIsStreaming(false)
        optsRef.current.onDone(bufRef.current)
        bufRef.current = ''
        abortRef.current = null
      },
      (err) => {
        setIsStreaming(false)
        bufRef.current = ''
        abortRef.current = null
        optsRef.current.onError(err)
      },
      images,
      optsRef.current.extraContext,
    )
  }, [abort])

  return { ask, abort, isStreaming }
}
