/**
 * useSystemAudio — captures system audio (loopback) and microphone.
 * Uses Electron's setDisplayMediaRequestHandler for no-picker system audio.
 * Audio is processed in an AudioWorklet (off-thread, zero GC pressure).
 * Exposes `onLevel` callback with 0–1 RMS amplitude for live VU metering.
 */
import { useCallback, useRef } from 'react'
import type { AudioSource } from '@/types'

interface Options {
  onPCMChunk: (buffer: ArrayBuffer) => void
  onError:    (msg: string) => void
  onLevel?:   (level: number) => void  // 0–1 RMS amplitude, ~15 fps
}

export function useSystemAudio({ onPCMChunk, onError, onLevel }: Options) {
  const contextRef  = useRef<AudioContext | null>(null)
  const workletRef  = useRef<AudioWorkletNode | null>(null)
  const streamsRef  = useRef<MediaStream[]>([])
  const onPCMRef    = useRef(onPCMChunk)
  const onErrRef    = useRef(onError)
  const onLevelRef  = useRef(onLevel)
  // Throttle level updates to ~15 fps (66ms) — no need for 50 fps UI updates
  const lastLevelTs = useRef(0)

  onPCMRef.current   = onPCMChunk
  onErrRef.current   = onError
  onLevelRef.current = onLevel

  const stop = useCallback(() => {
    workletRef.current?.port.postMessage('stop')
    workletRef.current?.disconnect()
    workletRef.current = null

    streamsRef.current.forEach((s) => s.getTracks().forEach((t) => t.stop()))
    streamsRef.current = []

    contextRef.current?.close().catch(() => {})
    contextRef.current = null

    // Reset level to 0 so bars go flat
    onLevelRef.current?.(0)
  }, [])

  const start = useCallback(async (source: AudioSource): Promise<void> => {
    stop()

    try {
      const ctx = new AudioContext({ sampleRate: 48_000 })
      contextRef.current = ctx

      await ctx.audioWorklet.addModule('./audio-processor.js')
      const worklet = new AudioWorkletNode(ctx, 'audio-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 1,
        channelCountMode: 'explicit',
        channelInterpretation: 'discrete',
      })
      workletRef.current = worklet

      worklet.port.onmessage = (e: MessageEvent<{ type: string; buffer: ArrayBuffer }>) => {
        if (e.data.type !== 'pcm') return

        // Forward to Speechmatics
        onPCMRef.current(e.data.buffer)

        // Compute RMS for VU meter — throttled to ~15 fps
        if (onLevelRef.current) {
          const now = Date.now()
          if (now - lastLevelTs.current > 66) {
            lastLevelTs.current = now
            const samples = new Int16Array(e.data.buffer)
            let sumSq = 0
            for (let i = 0; i < samples.length; i++) {
              const s = samples[i]! / 32768
              sumSq += s * s
            }
            const rms = Math.sqrt(sumSq / (samples.length || 1))
            // Boost by 6× — speech typically sits at 0.05–0.15 RMS; scale to visible range
            onLevelRef.current(Math.min(1, rms * 6))
          }
        }
      }

      worklet.port.onmessageerror = () => onErrRef.current('AudioWorklet message error')

      const merger = ctx.createChannelMerger(1)
      merger.connect(worklet)

      // ── System audio ──────────────────────────────────────────────────────────
      let sysAudioOk = false
      if (source === 'system' || source === 'both') {
        try {
          const sysStream = await navigator.mediaDevices.getDisplayMedia({
            audio: true,
            video: true,
          })
          streamsRef.current.push(sysStream)
          sysStream.getVideoTracks().forEach((t) => t.stop())

          const audioTracks = sysStream.getAudioTracks()
          if (audioTracks.length > 0) {
            const sysSource = ctx.createMediaStreamSource(new MediaStream(audioTracks))
            sysSource.connect(merger, 0, 0)
            sysAudioOk = true
          }
        } catch (err) {
          const msg = (err as Error).message ?? ''
          console.warn('[useSystemAudio] System audio failed:', msg)
          if (source === 'system') {
            onErrRef.current(
              'Screen Recording permission needed. ' +
              'Go to System Settings → Privacy & Security → Screen Recording → enable Interview Agent. ' +
              'Falling back to microphone.'
            )
          }
        }
      }

      // ── Microphone ────────────────────────────────────────────────────────────
      if (source === 'mic' || source === 'both' || (source === 'system' && !sysAudioOk)) {
        try {
          const micStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: false,
              noiseSuppression: true,
              autoGainControl: true,
              sampleRate: 48_000,
              channelCount: 1,
            },
            video: false,
          })
          streamsRef.current.push(micStream)
          const micSource = ctx.createMediaStreamSource(micStream)
          micSource.connect(merger, 0, 0)
        } catch (err) {
          console.warn('[useSystemAudio] Mic not available:', err)
          if (source === 'mic' || (source === 'system' && !sysAudioOk)) {
            onErrRef.current(
              'Microphone unavailable. Check microphone permission in System Settings → Privacy & Security → Microphone.'
            )
            stop()
            return
          }
        }
      }

      if (ctx.state === 'suspended') await ctx.resume()

    } catch (err) {
      stop()
      onErrRef.current(`Audio setup failed: ${(err as Error).message}`)
    }
  }, [stop])

  return { start, stop }
}
