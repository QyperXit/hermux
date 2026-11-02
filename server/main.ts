import { homedir } from "node:os";
import { resolve } from "node:path";
import { createApp } from "./app";
import { createLiveEvents, herdrSocketPath } from "./events";
import { createHerdr } from "./herdr";
import { createHistory, openSessionStore } from "./history";
import { createWatcher } from "./watch";

// The server drives the Herdr session it runs in, so it starts only inside a Herdr pane.
if (process.env.HERDR_ENV !== "1") {
  console.error("Refusing to start: HERDR_ENV is not 1. Run the server inside a Herdr pane (see docs/setup.md).");
  process.exit(1);
}

// The one Tailscale login allowed in. There is no default: without it the server doesn't start.
const allowedLogin = process.env.AGENTS_ALLOWED_LOGIN ?? "";
if (allowedLogin === "") {
  console.error("Refusing to start: AGENTS_ALLOWED_LOGIN is not set. Set it to your Tailscale login, for example in .env.local (see docs/setup.md).");
  process.exit(1);
}

// Loopback only. The phone reaches it through `tailscale serve`, never directly.
const HOSTNAME = "127.0.0.1";
const port = Number(process.env.PORT || 8787);
const herdrBin = process.env.HERDR_BIN || "herdr";
// Atomic's session store, opened read-only for earlier messages.
const sessionStore = process.env.ATOMIC_SESSION_STORE || resolve(homedir(), ".atomic/workflows/journal.sqlite");

const herdr = createHerdr(herdrBin);
// Live updates (D20): herdr's events, read-only, from the socket of the Herdr
// session the server runs in.
const socketPath = herdrSocketPath();
const events = createLiveEvents({ socketPath, panes: async () => (await herdr.panes()).map((pane) => pane.pane_id) });
events.start();
// Live output (D30): a read-only observe stream of each Terminal a page is
// viewing, only while one is.
const watcher = createWatcher({ herdr });

const server = Bun.serve({
  hostname: HOSTNAME,
  port,
  fetch: createApp({ herdr, allowedLogin, webRoot: resolve(import.meta.dir, "../web"), history: createHistory({ herdr, openStore: () => openSessionStore(sessionStore) }), events, watcher }),
});

console.log(`Agents server listening on http://${HOSTNAME}:${server.port} (herdr: ${herdrBin}, events: ${socketPath}, sessions: ${sessionStore}, read-only)`);
