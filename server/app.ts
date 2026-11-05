import { extname, resolve, sep } from "node:path";
import { HerdrError, checkTarget, type Herdr } from "./herdr";
import type { LiveEvent, LiveEvents } from "./events";
import { parseHistoryQuery, type createHistory } from "./history";
import { parseSubscription } from "./push-store";
import type { Pictures } from "./pictures";
import type { Push } from "./push";
import { createRoster } from "./roster";
import type { Uploads } from "./uploads";
import { stampedWorker } from "./app-shell";
import type { Viewer, WatchEvent, Watcher } from "./watch";
import { UPLOAD_HEADER } from "../web/upload-header.js";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

const STATUS: Record<string, number> = {
  bad_request: 400,
  invalid_target: 400,
  key_not_allowed: 400,
  cross_site_request: 403,
  path_not_allowed: 403,
  not_found: 404,
  picture_not_found: 404,
  subscription_not_found: 404,
  agent_not_found: 404,
  pane_not_found: 404,
  workspace_not_found: 404,
  method_not_allowed: 405,
  agent_blocked: 409,
  terminal_changed: 409,
  not_an_agent: 409,
  payload_too_large: 413,
  unsupported_media_type: 415,
  server_error: 500,
  herdr_unavailable: 503,
  push_failed: 502,
};

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

const errorResponse = (code: string, message: string) => json({ error: { code, message } }, STATUS[code] ?? 502);

// Bun.serve closes a connection that sends nothing for this long (its default idleTimeout).
const BUN_IDLE_TIMEOUT_S = 10;
const RETRY_MS = 2_000;
const HEARTBEAT_MS = (BUN_IDLE_TIMEOUT_S * 1000) / 2;

type StreamEvent = LiveEvent | WatchEvent | { type: "stream"; id: string };

const sseFrame = ({ type, ...data }: StreamEvent) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;

function eventStream(request: Request, events: LiveEvents, attach?: (send: (event: StreamEvent) => void) => () => void): Response {
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const send = (text: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          cleanup();
        }
      };
      send(`retry: ${RETRY_MS}\n\n`);
      const detach = attach?.((event) => send(sseFrame(event)));
      const unsubscribe = events.subscribe((event) => send(sseFrame(event)));
      const heartbeat = setInterval(() => send(": keep-alive\n\n"), HEARTBEAT_MS);
      cleanup = () => {
        if (!open) return;
        open = false;
        detach?.();
        unsubscribe();
        clearInterval(heartbeat);
      };
      request.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(body, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" } });
}

// Only this page's own fetch() sends application/json. A form or a text/plain
// POST from another site doesn't need a CORS preflight, so it must not count.
async function readBody(request: Request): Promise<Record<string, unknown>> {
  const mediaType = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    throw new HerdrError("unsupported_media_type", "Send the request body as application/json.");
  }
  try {
    const body = await request.json();
    if (body && typeof body === "object" && !Array.isArray(body)) return body;
  } catch {}
  throw new HerdrError("bad_request", "The request body must be a JSON object.");
}

function isCrossSite(request: Request) {
  const fetchSite = request.headers.get("sec-fetch-site");
  return fetchSite !== null && fetchSite !== "same-origin" && fetchSite !== "none";
}

function refuseCrossSiteRead(request: Request) {
  if (isCrossSite(request)) throw new HerdrError("cross_site_request", "Requests from other sites are refused.");
}

function terminalKind(body: Record<string, unknown>): string {
  if (typeof body.kind !== "string" || !body.kind) {
    throw new HerdrError("bad_request", '`kind` must be the kind of terminal you saw: its agent kind, or "shell".');
  }
  return body.kind;
}

function decodeTarget(encoded: string) {
  try {
    return decodeURIComponent(encoded);
  } catch {
    throw new HerdrError("invalid_target", "The address names no pane: it isn't valid URL encoding.");
  }
}

async function textBody(request: Request) {
  const body = await readBody(request);
  if (typeof body.text !== "string") throw new HerdrError("bad_request", "`text` must be a string.");
  return { body, text: body.text };
}

const isStringList = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");

async function keysBody(request: Request) {
  const body = await readBody(request);
  const { keys } = body;
  if (!isStringList(keys)) throw new HerdrError("bad_request", "`keys` must be an array of key names.");
  return { body, keys };
}

export function createApp({
  herdr,
  webRoot,
  allowedLogin,
  now = Date.now,
  history,
  events,
  watcher,
  push,
  uploads,
  pictures,
}: {
  herdr: Herdr;
  webRoot: string;
  allowedLogin: string;
  now?: () => number;
  // Earlier messages from Atomic's session store; without it there are none.
  history?: ReturnType<typeof createHistory>;
  // herdr's events for the page's stream; without it there is no stream.
  events?: LiveEvents;
  // Live output; without it the page polls the open Terminal's output.
  watcher?: Watcher;
  // Push notifications; without it the push routes are unknown (404).
  push?: Push;
  // Images attached to messages; without it the upload route is unknown (404).
  uploads?: Uploads;
  pictures?: Pictures;
}) {
  const root = resolve(webRoot);
  const roster = createRoster(herdr, now);
  const streams = new Map<string, Viewer>();
  const watchGeneration = new Map<Viewer, number>();
  const isStreamOpen = (viewer: Viewer) => watchGeneration.has(viewer);
  const isLatestWatch = (viewer: Viewer, ticket: number) => watchGeneration.get(viewer) === ticket;

  const nameStream = (send: (event: StreamEvent) => void) => {
    if (!watcher) return () => {};
    const id = crypto.randomUUID();
    const viewer: Viewer = (event) => send(event);
    streams.set(id, viewer);
    watchGeneration.set(viewer, 0);
    send({ type: "stream", id });
    return () => {
      streams.delete(id);
      watchGeneration.delete(viewer);
      watcher.unwatch(viewer);
    };
  };

  async function streamOf(request: Request): Promise<{ watcher: Watcher; viewer: Viewer }> {
    const body = await readBody(request);
    const viewer = typeof body.stream === "string" ? streams.get(body.stream) : undefined;
    if (!watcher || !viewer) throw new HerdrError("not_found", "No such event stream: open /api/events first.");
    return { watcher, viewer };
  }

  async function serveStatic(request: Request, pathname: string): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed\n", { status: 405 });
    let relative: string;
    try {
      relative = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
    } catch {
      return new Response("Not found\n", { status: 404 });
    }
    const path = resolve(root, relative);
    const type = CONTENT_TYPES[extname(path)];
    const file = Bun.file(path);
    if (!path.startsWith(root + sep) || !type || !(await file.exists())) {
      return new Response("Not found\n", { status: 404 });
    }
    if (path === resolve(root, "sw.js")) {
      return new Response(await stampedWorker(root, await file.text()), { headers: { "content-type": type, "cache-control": "no-cache" } });
    }
    return new Response(file, { headers: { "content-type": type, "cache-control": "no-cache" } });
  }

  const PANE_ITSELF = "";
  type PaneRoutes = Record<string, Record<string, (paneId: string) => Promise<Response>>>;
  async function collectionApi(
    request: Request,
    url: URL,
    encodedPane: string | undefined,
    action: string | undefined,
    list: (shownIdlePanes: string[]) => Promise<Response>,
    routes: PaneRoutes,
  ): Promise<Response> {
    const method = request.method;
    if (encodedPane === undefined) {
      if (method !== "GET") throw new HerdrError("method_not_allowed", "Use GET.");
      return list((url.searchParams.get("lines") ?? "").split(","));
    }
    const paneId = decodeTarget(encodedPane);
    const name = action ?? PANE_ITSELF;
    if (!Object.hasOwn(routes, name)) throw new HerdrError("not_found", "No such API route.");
    const methods = routes[name];
    if (!Object.hasOwn(methods, method)) throw new HerdrError("method_not_allowed", `${method} isn't allowed here.`);
    return methods[method](paneId);
  }

  function agentsApi(request: Request, url: URL, encodedPane: string | undefined): Promise<Response> {
    if (encodedPane !== undefined) throw new HerdrError("not_found", "No such API route.");
    return collectionApi(request, url, undefined, undefined, async (shownIdlePanes) => json({ agents: await roster.agents(shownIdlePanes) }), {});
  }

  async function historyPage(paneId: string, url: URL) {
    const query = parseHistoryQuery(url.searchParams);
    if (!history) {
      await herdr.get(paneId);
      return { history: null, reason: "unavailable" };
    }
    return history.page(paneId, query);
  }

  function terminalsApi(request: Request, url: URL, encodedPane: string | undefined, action: string | undefined): Promise<Response> {
    return collectionApi(
      request,
      url,
      encodedPane,
      action,
      async (shownIdlePanes) => json({ terminals: await roster.terminals(shownIdlePanes) }),
      {
        [PANE_ITSELF]: {},
        output: { GET: async (paneId) => json({ text: await herdr.readStyled(paneId) }) },
        history: {
          GET: async (paneId) => {
            try {
              return json(await historyPage(paneId, url));
            } catch (error) {
              if (!(error instanceof HerdrError && error.code === "agent_not_found")) throw error;
              await herdr.pane(paneId);
              throw new HerdrError("not_an_agent", `Pane ${paneId} is a plain shell; earlier messages exist only for agents.`);
            }
          },
        },
        prompt: {
          POST: async (paneId) => {
            const { body, text } = await textBody(request);
            await herdr.sendText(paneId, text, terminalKind(body));
            return json({ ok: true });
          },
        },
        keys: {
          POST: async (paneId) => {
            const { body, keys } = await keysBody(request);
            await herdr.sendKeys(paneId, keys, terminalKind(body));
            return json({ ok: true });
          },
        },
        watch: {
          POST: async (paneId) => {
            const { watcher, viewer } = await streamOf(request);
            const ticket = (watchGeneration.get(viewer) ?? 0) + 1;
            watchGeneration.set(viewer, ticket);
            await herdr.pane(paneId);
            if (!isStreamOpen(viewer)) throw new HerdrError("not_found", "No such event stream: open /api/events first.");
            if (isLatestWatch(viewer, ticket)) watcher.watch(viewer, paneId);
            return json({ ok: true });
          },
          DELETE: async (paneId) => {
            const { watcher, viewer } = await streamOf(request);
            checkTarget(paneId);
            watchGeneration.set(viewer, (watchGeneration.get(viewer) ?? 0) + 1);
            watcher.unwatch(viewer, paneId);
            return json({ ok: true });
          },
        },
      },
    );
  }

  async function pushApi(request: Request, name: string | undefined): Promise<Response> {
    if (!push) throw new HerdrError("not_found", "No such API route.");
    refuseCrossSiteRead(request);
    const method = request.method;
    const endpointOf = (body: Record<string, unknown>) => {
      if (typeof body.endpoint !== "string" || !body.endpoint) throw new HerdrError("bad_request", "`endpoint` must be the subscription's endpoint.");
      return body.endpoint;
    };
    if (name === "key") {
      if (method !== "GET") throw new HerdrError("method_not_allowed", "Use GET.");
      return json({ key: push.publicKey() });
    }
    if (name === "subscription") {
      if (method === "POST") {
        const subscription = parseSubscription((await readBody(request)).subscription);
        if (!subscription) throw new HerdrError("bad_request", "`subscription` must be a push subscription with an https endpoint and its keys.");
        push.subscribe(subscription);
        return json({ ok: true });
      }
      if (method === "DELETE") {
        push.unsubscribe(endpointOf(await readBody(request)));
        return json({ ok: true });
      }
      throw new HerdrError("method_not_allowed", "Use POST or DELETE.");
    }
    if (name === "test") {
      if (method !== "POST") throw new HerdrError("method_not_allowed", "Use POST.");
      const delivery = await push.sendTo(endpointOf(await readBody(request)), { title: "Test notification", body: "Notifications are working.", pane_id: null, tag: "test" });
      if (delivery === null || delivery === "gone") throw new HerdrError("subscription_not_found", "The server doesn't have this phone's subscription.");
      if (delivery === "failed") throw new HerdrError("push_failed", "The push service didn't accept the test.");
      return json({ ok: true });
    }
    throw new HerdrError("not_found", "No such API route.");
  }

  async function api(request: Request, url: URL): Promise<Response> {
    const [, , resource, target, action, ...rest] = url.pathname.split("/");
    if (rest.length) throw new HerdrError("not_found", "No such API route.");
    if (resource === "agents") return agentsApi(request, url, target);
    if (resource === "terminals") return terminalsApi(request, url, target, action);
    if (resource === "events" && target === undefined && events) {
      if (request.method !== "GET") throw new HerdrError("method_not_allowed", "Use GET.");
      refuseCrossSiteRead(request);
      return eventStream(request, events, nameStream);
    }
    if (resource === "push" && action === undefined) return pushApi(request, target);
    if (resource === "uploads" && target === undefined && uploads) {
      if (request.method !== "POST") throw new HerdrError("method_not_allowed", "Use POST.");
      // A form upload needs no CORS preflight, so another site's page could send one; it can't add a custom header without one.
      if (request.headers.get(UPLOAD_HEADER) !== "1") throw new HerdrError("cross_site_request", "Uploads come only from this app's own page.");
      return json(await uploads.accept(request));
    }
    if (resource === "pictures" && target === undefined && pictures) {
      if (request.method !== "GET") throw new HerdrError("method_not_allowed", "Use GET.");
      refuseCrossSiteRead(request);
      const { bytes, type } = await pictures.read(url.searchParams.get("path"));
      return new Response(bytes, { headers: { "content-type": type, "content-length": String(bytes.length), "x-content-type-options": "nosniff", "cache-control": "private, no-store" } });
    }
    if (resource === "workspaces" && target !== undefined && action === "terminals") {
      if (request.method !== "GET") throw new HerdrError("method_not_allowed", "Use GET.");
      return json(await roster.workspace(decodeTarget(target)));
    }
    throw new HerdrError("not_found", "No such API route.");
  }

  return async function fetch(request: Request): Promise<Response> {
    if (request.headers.get("tailscale-user-login") !== allowedLogin) {
      return new Response("Forbidden\n", { status: 403 });
    }
    // tailscale serve adds the login header to any request from the phone, even
    // one fired by another site's page, so changes must come from this page.
    if (request.method !== "GET" && request.method !== "HEAD" && isCrossSite(request)) {
      return errorResponse("cross_site_request", "Requests from other sites are refused.");
    }
    const url = new URL(request.url);
    if (url.pathname !== "/api" && !url.pathname.startsWith("/api/")) return serveStatic(request, url.pathname);
    try {
      return await api(request, url);
    } catch (error) {
      if (error instanceof HerdrError) return errorResponse(error.code, error.message);
      console.error(error);
      return errorResponse("server_error", "The server hit an unexpected error.");
    }
  };
}
