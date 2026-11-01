// A stand-in for herdr's socket (D20): a Unix socket that answers
// `events.subscribe` as herdr 0.9.5 does (shapes probed read-only on a
// real herdr), records every request line it gets, and pushes the events a
// test gives it. It can drop its connections, refuse requests, or stop
// listening and start again.
import type { Socket } from "bun";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Answer = "start" | { code: string; message: string };

export function makeFakeEvents({ listen = true }: { listen?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "fake-herdr-events-"));
  const path = join(dir, "herdr.sock");
  const requests: Record<string, unknown>[] = [];
  const buffers = new Map<Socket<undefined>, string>();
  const started = new Set<Socket<undefined>>();
  let answer: Answer = "start";
  let server: ReturnType<typeof Bun.listen<undefined>> | null = null;

  const write = (socket: Socket<undefined>, message: unknown) => socket.write(`${JSON.stringify(message)}\n`);

  function onLine(socket: Socket<undefined>, line: string) {
    const request = JSON.parse(line);
    requests.push(request);
    // herdr takes one subscribe per connection: a second request closes it.
    if (started.has(socket)) {
      socket.end();
      return;
    }
    if (answer === "start") {
      write(socket, { id: request.id, result: { type: "subscription_started" } });
      started.add(socket);
    } else {
      write(socket, { id: request.id, error: answer });
      socket.end();
    }
  }

  function start() {
    if (existsSync(path)) rmSync(path);
    server = Bun.listen<undefined>({
      unix: path,
      socket: {
        open: (socket) => {
          buffers.set(socket, "");
        },
        data: (socket, chunk) => {
          let buffer = (buffers.get(socket) ?? "") + chunk.toString();
          for (let index = buffer.indexOf("\n"); index !== -1; index = buffer.indexOf("\n")) {
            onLine(socket, buffer.slice(0, index));
            buffer = buffer.slice(index + 1);
          }
          buffers.set(socket, buffer);
        },
        close: (socket) => {
          buffers.delete(socket);
          started.delete(socket);
        },
      },
    });
  }
  if (listen) start();

  return {
    path,
    // Every request line, parsed, in the order they came.
    requests,
    // Live subscriptions (connections herdr has answered subscription_started).
    subscribers: () => started.size,
    // Pushes one event line to every live subscription, as herdr does.
    push(event: string, data: Record<string, unknown>) {
      for (const socket of started) write(socket, { event, data });
    },
    // How the next requests are answered: started, or herdr's error.
    answerWith(next: Answer) {
      answer = next;
    },
    // Closes every connection, as herdr does on events_lost or when it stops.
    drop() {
      for (const socket of [...buffers.keys()]) socket.end();
    },
    start,
    stop() {
      for (const socket of [...buffers.keys()]) socket.end();
      server?.stop(true);
      server = null;
      if (existsSync(path)) rmSync(path);
    },
    dispose() {
      this.stop();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export type FakeEvents = ReturnType<typeof makeFakeEvents>;

// Waits until `ok` holds, polling every 5 ms; fails after `ms`.
export async function until(ok: () => boolean, ms = 2_000, what = "the condition") {
  const started = Date.now();
  while (!ok()) {
    if (Date.now() - started > ms) throw new Error(`Timed out after ${ms} ms waiting for ${what}`);
    await Bun.sleep(5);
  }
}
