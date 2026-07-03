/** A pushable AsyncIterable — used as the streaming `prompt` input for query(). */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private buffer: T[] = []
  private waiter: ((value: IteratorResult<T>) => void) | null = null
  private ended = false

  push(item: T): void {
    if (this.ended) return
    if (this.waiter) {
      const resolve = this.waiter
      this.waiter = null
      resolve({ value: item, done: false })
    } else {
      this.buffer.push(item)
    }
  }

  end(): void {
    this.ended = true
    if (this.waiter) {
      const resolve = this.waiter
      this.waiter = null
      resolve({ value: undefined, done: true })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.buffer.length > 0) {
          return Promise.resolve({ value: this.buffer.shift()!, done: false })
        }
        if (this.ended) {
          return Promise.resolve({ value: undefined, done: true })
        }
        return new Promise((resolve) => {
          this.waiter = resolve
        })
      }
    }
  }
}
