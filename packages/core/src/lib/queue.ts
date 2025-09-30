/**
 * Generic processing queue that handles asynchronous job processing
 */
export class ProcessQueue<T> {
  private queue: T[] = []
  private processing: boolean = false
  private autoProcess: boolean = true

  constructor(
    private processor: (item: T) => Promise<void> | void,
    autoProcess: boolean = true,
  ) {
    this.autoProcess = autoProcess
  }

  enqueue(item: T): void {
    this.queue.push(item)

    if (!this.processing && this.autoProcess) {
      this.processQueue()
    }
  }

  private processQueue(): void {
    if (this.queue.length === 0) {
      return
    }

    this.processing = true

    queueMicrotask(async () => {
      if (this.queue.length === 0) {
        this.processing = false
        return
      }

      // Get the next item to process (FIFO)
      const item = this.queue.shift()!

      try {
        await this.processor(item)
      } catch (error) {
        console.error("Error processing queue item:", error)
      }

      if (this.queue.length > 0) {
        this.processQueue()
      } else {
        this.processing = false
      }
    })
  }

  clear(): void {
    this.queue = []
  }

  isProcessing(): boolean {
    return this.processing
  }

  size(): number {
    return this.queue.length
  }
}
