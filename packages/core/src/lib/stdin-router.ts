export class StdinRouter {
  private readonly oscSubscribers = new Set<(sequence: string) => void>()

  public subscribeOsc(handler: (sequence: string) => void): () => void {
    this.oscSubscribers.add(handler)
    return () => {
      this.oscSubscribers.delete(handler)
    }
  }

  public notifyOsc(sequence: string): void {
    for (const subscriber of this.oscSubscribers) {
      subscriber(sequence)
    }
  }

  public destroy(): void {
    this.oscSubscribers.clear()
  }
}
