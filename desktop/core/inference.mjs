import { Worker } from 'node:worker_threads'

export class Inference {
  constructor(cacheDir, onProgress = () => {}) {
    this.cacheDir = cacheDir
    this.onProgress = onProgress
    this.pending = new Map()
    this.nextId = 0
  }
  start() {
    if (this.worker) return
    this.worker = new Worker(
      new URL('../workers/inference.mjs', import.meta.url),
      { workerData: { cacheDir: this.cacheDir }, execArgv: [] },
    )
    const worker = this.worker
    this.worker.on('message', (message) => {
      if (message.event === 'progress') {
        this.onProgress(message)
        return
      }
      const task = this.pending.get(message.id)
      if (!task) return
      this.pending.delete(message.id)
      message.error
        ? task.reject(new Error(message.error))
        : task.resolve(message.result)
    })
    const fail = () => {
      if (this.worker !== worker) return
      for (const task of this.pending.values())
        task.reject(
          new Error('The local model worker stopped. Retry the operation.'),
        )
      this.pending.clear()
      this.worker = null
    }
    this.worker.on('error', fail)
    this.worker.on('exit', fail)
  }
  run(command, data = {}) {
    this.start()
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker.postMessage({ id, command, ...data })
    })
  }
  async close() {
    if (this.worker) await this.worker.terminate()
  }
}
