/** FIFO queue for asynchronous operations that must never overlap. */
export class SerialAsyncQueue {
  private tail: Promise<void> = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    // A failed operation rejects only its caller. The settled tail keeps the
    // queue usable so a later retry can still run in submission order.
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
