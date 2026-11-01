// An EventSource a test drives (the page's side of D20's stream): it fires the
// server's events and the browser's errors, and records whether the page closed it.
export const CONNECTING = 0;
const OPEN = 1;
export const CLOSED = 2;

export class FakeSource {
  readyState = CONNECTING;
  closed = false;
  listeners = new Map<string, ((event: MessageEvent) => void)[]>();
  constructor(readonly path: string) {}
  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {
    this.closed = true;
    this.readyState = CLOSED;
  }
  fire(type: string, data?: unknown) {
    if (type !== "error") this.readyState = OPEN;
    for (const listener of this.listeners.get(type) ?? []) listener(new MessageEvent(type, { data: data === undefined ? undefined : JSON.stringify(data) }));
  }
  // The browser lost the stream: it reconnects by itself (CONNECTING), or gives up (CLOSED).
  fail(readyState: number) {
    this.readyState = readyState;
    this.fire("error");
  }
}
