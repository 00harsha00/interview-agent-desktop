/**
 * AudioWorklet processor — runs in a dedicated audio thread.
 * Resamples input to 16kHz PCM16 and posts chunks to the main thread.
 * Keeping this in a separate thread prevents audio glitches from UI work.
 */
class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    // sampleRate is a global in AudioWorkletGlobalScope
    this._ratio  = 16000 / sampleRate
    this._buf    = new Float32Array(0)
    this._size   = 4096  // ~256ms worth of 16kHz samples
    this._active = true

    this.port.onmessage = (e) => {
      if (e.data === 'stop') this._active = false
    }
  }

  process(inputs) {
    if (!this._active) return false

    const channel = inputs[0]?.[0]
    if (!channel || channel.length === 0) return true

    // Resample via linear interpolation
    const outLen = Math.ceil(channel.length * this._ratio)
    const resampled = new Float32Array(outLen)
    for (let i = 0; i < outLen; i++) {
      const src  = i / this._ratio
      const lo   = Math.floor(src)
      const hi   = Math.min(lo + 1, channel.length - 1)
      const frac = src - lo
      resampled[i] = channel[lo] * (1 - frac) + channel[hi] * frac
    }

    // Append to rolling buffer
    const combined = new Float32Array(this._buf.length + resampled.length)
    combined.set(this._buf)
    combined.set(resampled, this._buf.length)
    this._buf = combined

    // Flush complete chunks
    while (this._buf.length >= this._size) {
      const chunk  = this._buf.slice(0, this._size)
      this._buf    = this._buf.slice(this._size)

      // Convert Float32 → Int16 PCM (little-endian signed)
      const pcm16 = new Int16Array(chunk.length)
      for (let i = 0; i < chunk.length; i++) {
        const s   = Math.max(-1, Math.min(1, chunk[i]))
        pcm16[i]  = s < 0 ? s * 0x8000 : s * 0x7fff
      }

      // Transfer ownership — zero-copy to main thread
      this.port.postMessage({ type: 'pcm', buffer: pcm16.buffer }, [pcm16.buffer])
    }

    return true
  }
}

registerProcessor('audio-processor', AudioProcessor)
