class OatmealAudio extends AudioWorkletProcessor {
  constructor() {
    super()
    this.samples = new Float32Array(sampleRate * 6)
    this.filled = 0
    this.port.onmessage = (event) => {
      if (event.data === 'flush') {
        this.flush()
        this.port.postMessage({ flushed: true })
      }
    }
  }
  flush() {
    if (!this.filled) return
    const audio = this.samples.slice(0, this.filled)
    this.port.postMessage({ audio, sampleRate }, [audio.buffer])
    this.filled = 0
  }
  process(inputs) {
    const channels = inputs[0]
    if (!channels?.length) return true
    for (let i = 0; i < channels[0].length; i++) {
      let sample = 0
      for (const channel of channels) sample += channel[i] / channels.length
      this.samples[this.filled++] = sample
      if (this.filled === this.samples.length) this.flush()
    }
    return true
  }
}
registerProcessor('oatmeal-audio', OatmealAudio)
