export class Recorder {
  constructor(api, report) {
    this.api = api
    this.report = report
    this.streams = []
    this.lanes = []
    this.sends = new Set()
    this.failures = []
  }
  prepare(systemAudio) {
    // Start the system picker during the click's transient user activation.
    // Awaiting model downloads first would make Chromium reject the picker.
    const retain = (stream) => {
      if (this.cancelled) stream.getTracks().forEach((t) => t.stop())
      else this.streams.push(stream)
      return stream
    }
    const mic = navigator.mediaDevices
      .getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      .then(retain)
    const display = systemAudio
      ? navigator.mediaDevices
          .getDisplayMedia({
            video: true,
            audio: { echoCancellation: false },
            systemAudio: 'include',
          })
          .then(retain)
      : Promise.resolve(null)
    this.prepared = Promise.allSettled([mic, display])
  }
  async start(id, systemAudio, initialOffset = 0) {
    this.id = id
    this.initialOffset = initialOffset
    try {
      if (!this.prepared) this.prepare(systemAudio)
      const [micResult, displayResult] = await this.prepared
      if (micResult.status !== 'fulfilled') throw micResult.reason
      const mic = micResult.value
      this.context = new AudioContext({ sampleRate: 16000 })
      await this.context.resume()
      await this.context.audioWorklet.addModule('./audio-worklet.js')
      this.startedAt = performance.now()
      await this.attach(mic, 'you')
      mic.getAudioTracks()[0].onended = () =>
        this.report(
          'Microphone disconnected. Stop recording, reconnect it, and start again.',
        )
      let room = false
      if (systemAudio) {
        try {
          const display =
            displayResult.status === 'fulfilled' ? displayResult.value : null
          // Keep video alive: stopping it can also end system audio on macOS.
          // No video frames are read, persisted, or sent anywhere.
          if (display?.getAudioTracks().length) {
            await this.attach(new MediaStream(display.getAudioTracks()), 'room')
            room = true
            display.getAudioTracks()[0].onended = () =>
              this.report(
                'System audio stopped. Only your microphone is still recording.',
              )
          }
        } catch {
          /* Explicitly reported to the user below. */
        }
      }
      return room
    } catch (error) {
      await this.cleanup()
      throw error
    }
  }
  async attach(stream, speaker) {
    const source = this.context.createMediaStreamSource(stream)
    const worklet = new AudioWorkletNode(this.context, 'oatmeal-audio')
    const silent = this.context.createGain()
    silent.gain.value = 0
    source.connect(worklet)
    worklet.connect(silent)
    silent.connect(this.context.destination)
    const lane = {
      source,
      worklet,
      silent,
      speaker,
      seconds: (performance.now() - this.startedAt) / 1000,
    }
    worklet.port.onmessage = (event) => {
      if (event.data.flushed) {
        lane.flushed?.()
        return
      }
      const { audio, sampleRate } = event.data
      let samples = audio
      if (sampleRate !== 16000) {
        samples = new Float32Array(
          Math.round((audio.length * 16000) / sampleRate),
        )
        const ratio = sampleRate / 16000
        for (let i = 0; i < samples.length; i++) {
          const start = Math.floor(i * ratio),
            end = Math.min(audio.length, Math.floor((i + 1) * ratio))
          let value = 0
          for (let j = start; j < end; j++) value += audio[j]
          samples[i] = value / Math.max(1, end - start)
        }
      }
      const data = {
        id: this.id,
        speaker,
        offset: this.initialOffset + lane.seconds,
        audio: samples,
      }
      lane.seconds += audio.length / sampleRate
      const send = this.api
        .sendChunk(data)
        .catch(() => {
          this.failures.push(data)
          this.report(
            'Audio could not be saved. Stop recording and retry saving before closing Oatmeal.',
          )
        })
        .finally(() => this.sends.delete(send))
      this.sends.add(send)
    }
    this.lanes.push(lane)
  }
  async stop() {
    await Promise.all(
      this.lanes.map(
        (lane) =>
          new Promise((resolve) => {
            lane.source.disconnect()
            lane.flushed = resolve
            lane.worklet.port.postMessage('flush')
          }),
      ),
    )
    await this.cleanup()
    await Promise.all(this.sends)
    await this.retryFailed()
  }
  async retryFailed() {
    const packets = this.failures.splice(0)
    for (let i = 0; i < packets.length; i++) {
      try {
        await this.api.sendChunk(packets[i])
      } catch (error) {
        this.failures.push(...packets.slice(i))
        throw error
      }
    }
  }
  async cleanup() {
    this.cancelled = true
    for (const stream of this.streams)
      for (const track of stream.getTracks()) {
        track.onended = null
        track.stop()
      }
    for (const lane of this.lanes) {
      lane.source.disconnect()
      lane.worklet.disconnect()
      lane.silent.disconnect()
    }
    this.streams = []
    this.lanes = []
    await this.context?.close()
    this.context = null
  }
}
