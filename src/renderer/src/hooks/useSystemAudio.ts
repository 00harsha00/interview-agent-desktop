/**
 * useSystemAudio — captures system audio (loopback) and microphone.
 * Uses Electron's setDisplayMediaRequestHandler for no-picker system audio.
 * Audio is processed in an AudioWorklet (off-thread, zero GC pressure).
 */
import { useCallback, useRef } from 'react'
import type { AudioSource } from '@/types'

interface Options {
  onPCMChunk: (buffer: ArrayBuffer) => void
  onError:    (msg: string) => void
}

export function useSystemAudio({ onPCMChunk, onError }: Options) {
  const contextRef  = useRef<AudioContext | null>(null)
  const workletRef  = useRef<AudioWorkletNode | null>(null)
  const streamsRef  = useRef<MediaStream[]>([])
  const onPCMRef    = useRef(onPCMChunk)
  const onErrRef    = useRef(onError)
  onPCMRef.current  = onPCMChunk
  onErrRef.current  = onError

  const stop = useCallback(() => {
    // Stop worklet
    workletRef.current?.port.postMessage('stop')
    workletRef.current?.disconnect()
    workletRef.current = null

    // Stop all tracks
    streamsRef.current.forEach((s) => s.getTracks().forEach((t) => t.stop()))
    streamsRef.current = []

    // Close audio context
    contextRef.current?.close().catch(() => {})
    contextRef.current = null
  }, [])

  const start = useCallback(async (source: AudioSource): Promise<void> => {
    stop() // clean previous session

    try {
      const ctx = new AudioContext({ sampleRate: 48_000 }) // native rate; worklet resamples to 16k
      contextRef.current = ctx

      // Load AudioWorklet module
      await ctx.audioWorklet.addModule('/audio-processor.js')
      const worklet = new AudioWorkletNode(ctx, 'audio-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 1,
        channelCountMode: 'explicit',
        channelInterpretation: 'discrete',
      })
      workletRef.current = worklet

      worklet.port.onmessage = (e: MessageEvent<{ type: string; buffer: ArrayBuffer }>) => {
        if (e.data.type === 'pcm') onPCMRef.current(e.data.buffer)
      }

      worklet.port.onmessageerror = () => onErrRef.current('AudioWorklet message error')

      const merger = ctx.createChannelMerger(1)
      merger.connect(worklet)

      // ── System audio ─────────────────────────────────────────────────────────
      if (source === 'system' || source === 'both') {
        try {
          // Electron intercepts getDisplayMedia and provides loopback audio
          const sysStream = await navigator.mediaDevices.getDisplayMedia({
            audio: true,
            video: true, // required — video tracks are stopped immediately
          })
          streamsRef.current.push(sysStream)

          // Stop video immediately (we only want audio)
          sysStream.getVideoTracks().forEach((t) => t.stop())

          const audioTracks = sysStream.getAudioTracks()
          if (audioTracks.length > 0) {
            const sysSource = ctx.createMediaStreamSource(new MediaStream(audioTracks))
            sysSource.connect(merger, 0, 0)
          }
        } catch (err) {
          console.warn('[useSystemAudio] System audio not available:', err)
          if (source === 'system') {
            onErrRef.current('System audio unavailable. Check screen recording permission.')
            stop()
            return
          }
          // For 'both', fall through to mic only
        }
      }

      // ── Microphone ───────────────────────────────────────────────────────────
      if (source === 'mic' || source === 'both') {
        try {
          const micStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: false,
              noiseSuppression: true,
              autoGainControl:  true,
              sampleRate:       48_000,
              channelCount:     1,
            },
            video: false,
          })
          streamsRef.current.push(micStream)
          const micSource = ctx.createMediaStreamSource(micStream)
          micSource.connect(merger, 0, 0)
        } catch (err) {
          console.warn('[useSystemAudio] Mic not available:', err)
          if (source === 'mic') {
            onErrRef.current('Microphone unavailable. Check microphone permission.')
            stop()
            return
          }
        }
      }

      // Resume context if it was suspended (browser autoplay policy)
      if (ctx.state === 'suspended') await ctx.resume()

    } catch (err) {
      stop()
      onErrRef.current(`Audio setup failed: ${(err as Error).message}`)
    }
  }, [stop])

  return { start, stop }
}
