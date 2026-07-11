/**
 * useSystemAudio — captures system audio (loopback) and microphone.
 * Uses Electron's setDisplayMediaRequestHandler for no-picker system audio.
 * Audio is processed in an AudioWorklet (off-thread, zero GC pressure).
 * Exposes `onLevel` callback with 0–1 RMS amplitude for live VU metering.
 * Detects device changes (e.g. headphones unplugged) mid-capture and
 * automatically restarts the stream against whatever the OS default is now.
 */
import { useCallback, useRef } from 'react'
import type { AudioSource } from '@/types'

interface Options {
  onPCMChunk: (buffer: ArrayBuffer) => void
  onError:    (msg: string) => void
  onLevel?:   (level: number) => void  // 0–1 RMS amplitude, ~15 fps
  /** Fired when a device change/track loss is detected and a restart is
   *  starting — distinct from onError so callers can show a transient
   *  amber "recovering" state instead of a hard error. */
  onRecovering?: () => void
  /** Fired once the restart succeeds. */
  onRestored?: () => void
}

export function useSystemAudio({ onPCMChunk, onError, onLevel, onRecovering, onRestored }: Options) {
  const contextRef  = useRef<AudioContext | null>(null)
  const workletRef  = useRef<AudioWorkletNode | null>(null)
  const streamsRef  = useRef<MediaStream[]>([])
  const onPCMRef    = useRef(onPCMChunk)
  const onErrRef    = useRef(onError)
  const onLevelRef  = useRef(onLevel)
  const onRecoveringRef = useRef(onRecovering)
  const onRestoredRef   = useRef(onRestored)
  // Throttle level updates to ~15 fps (66ms) — no need for 50 fps UI updates
  const lastLevelTs = useRef(0)

  // Tracks what `start()` was last asked to capture, so a device-change
  // restart knows what to re-request without the caller telling it again.
  const currentSourceRef = useRef<AudioSource>('none')
  // True once stop() has run (or before the first start()) — restart
  // handlers no-op while this is set, so a device event after the user
  // ended the session (or toggled audio off) can't resurrect a capture.
  const stoppedRef = useRef(true)
  // Guards against overlapping restart attempts — unplugging headphones
  // typically fires 'ended' on multiple tracks AND a 'devicechange' event
  // within milliseconds of each other.
  const restartingRef = useRef(false)
  // User's preferred mic device (from MicSelector) — a ref so a
  // device-change restart (which calls doStart again internally) picks up
  // whatever the latest preference is without needing it threaded through
  // start()'s signature.
  const micDeviceIdRef = useRef<string | undefined>(undefined)

  onPCMRef.current   = onPCMChunk
  onErrRef.current   = onError
  onLevelRef.current = onLevel
  onRecoveringRef.current = onRecovering
  onRestoredRef.current   = onRestored

  // Stable function identity for add/removeEventListener — delegates to
  // whatever the latest handleDeviceChange closure is via a ref, so doStart
  // doesn't need handleDeviceChange in its own dependency array (that would
  // create a circular useCallback dependency between the two).
  const handleDeviceChangeRef = useRef<() => void>(() => {})
  const stableDeviceChangeHandler = useRef(() => { handleDeviceChangeRef.current() }).current

  const stop = useCallback(() => {
    stoppedRef.current = true
    navigator.mediaDevices.removeEventListener('devicechange', stableDeviceChangeHandler)

    workletRef.current?.port.postMessage('stop')
    workletRef.current?.disconnect()
    workletRef.current = null

    streamsRef.current.forEach((s) => s.getTracks().forEach((t) => t.stop()))
    streamsRef.current = []

    contextRef.current?.close().catch(() => {})
    contextRef.current = null

    // Reset level to 0 so bars go flat
    onLevelRef.current?.(0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const doStart = useCallback(async (source: AudioSource): Promise<void> => {
    stop()
    if (source === 'none') return   // both toggles off — stay silent
    stoppedRef.current = false

    try {
      console.log('[useSystemAudio] Starting audio capture:', source)
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
            audioTracks.forEach((t) => t.addEventListener('ended', stableDeviceChangeHandler))
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
          const baseAudioConstraints = {
            echoCancellation: false,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: 48_000,
            channelCount: 1,
          }
          let micStream: MediaStream
          try {
            micStream = await navigator.mediaDevices.getUserMedia({
              audio: micDeviceIdRef.current
                ? { ...baseAudioConstraints, deviceId: { exact: micDeviceIdRef.current } }
                : baseAudioConstraints,
              video: false,
            })
          } catch (err) {
            // Preferred device no longer exists (unplugged since last
            // session, etc.) — fall back to the OS default rather than
            // failing the whole capture over a stale saved preference.
            if (micDeviceIdRef.current) {
              console.warn('[useSystemAudio] Preferred mic unavailable, falling back to default:', err)
              micStream = await navigator.mediaDevices.getUserMedia({ audio: baseAudioConstraints, video: false })
            } else {
              throw err
            }
          }
          streamsRef.current.push(micStream)
          micStream.getAudioTracks().forEach((t) => t.addEventListener('ended', stableDeviceChangeHandler))
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

      // Only watch for device changes once capture is actually up — avoids
      // reacting to devicechange events that fire while we're still setting
      // up (e.g. the permission prompt itself can trigger one).
      navigator.mediaDevices.addEventListener('devicechange', stableDeviceChangeHandler)

    } catch (err) {
      stop()
      onErrRef.current(`Audio setup failed: ${(err as Error).message}`)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stop])

  const handleDeviceChange = useCallback(() => {
    if (stoppedRef.current || restartingRef.current) return
    if (currentSourceRef.current === 'none') return

    // A 'devicechange' event fires for ANY device plug/unplug system-wide —
    // most are irrelevant. Only restart if OUR active stream actually lost
    // a live track.
    const tracks = streamsRef.current.flatMap((s) => s.getTracks())
    const hasActiveTracks = tracks.length > 0 && tracks.every((t) => t.readyState === 'live')
    if (hasActiveTracks) return

    console.log('[useSystemAudio] Device change detected, stream lost — restarting')
    restartingRef.current = true
    onRecoveringRef.current?.()
    onErrRef.current('Audio device changed — restarting…')

    void (async () => {
      await new Promise((r) => setTimeout(r, 500))  // let the OS settle
      try {
        await doStart(currentSourceRef.current)
        onRestoredRef.current?.()
      } catch (err) {
        onErrRef.current(`Could not restart audio — please check your microphone/headphones. (${(err as Error).message})`)
      } finally {
        restartingRef.current = false
      }
    })()
  }, [doStart])

  handleDeviceChangeRef.current = handleDeviceChange

  const start = useCallback(async (source: AudioSource): Promise<void> => {
    currentSourceRef.current = source
    await doStart(source)
  }, [doStart])

  // Takes effect on the next start()/restart — doesn't tear down and
  // restart an already-running capture by itself (caller decides whether
  // to restart immediately, same as toggling mic/system source does).
  const setMicDeviceId = useCallback((deviceId: string | undefined) => {
    micDeviceIdRef.current = deviceId
  }, [])

  return { start, stop, setMicDeviceId }
}
