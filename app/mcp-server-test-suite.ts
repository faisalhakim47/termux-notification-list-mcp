export class MemoryTransport {
  onmessage: ((msg: unknown) => void) | undefined;
  onerror: ((err: unknown) => void) | undefined;
  onclose: (() => void) | undefined;
  _paired: MemoryTransport | null;
  constructor() {
    this.onmessage = undefined;
    this.onerror = undefined;
    this.onclose = undefined;
    this._paired = null;
  }
  async start() { /* no-op */ }
  async close() { this.onclose?.(); }
  async send(message: unknown) {
    if (!this._paired) throw new Error('No paired transport');
    setImmediate(() => {
      try {
        this._paired!.onmessage?.(message);
      }
      catch (err) {
        this._paired!.onerror?.(err);
      }
    });
  }
}
