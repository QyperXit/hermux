import { extname, resolve, sep } from "node:path";
import { HerdrError, type Herdr } from "./herdr";
import type { LiveEvent, LiveEvents } from "./events";
import { parseHistoryQuery, type createHistory } from "./history";
import { createRoster } from "./roster";

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

// HTTP status for each error code. herdr codes not listed here become 502.
const STATUS: Record<string, number> = {
  bad_request: 400,
  invalid_target: 400,
  key_not_allowed: 400,
  cross_site_request: 403,
  not_found: 404,
  agent_not_found: 404,
  pane_not_found: 404,
  workspace_not_found: 404,
  method_not_allowed: 405,
  agent_blocked: 409,
  terminal_changed: 409,
  not_an_agent: 409,
  unsupported_media_type: 415,
  server_error: 500,
  herdr_unavailable: 503,
};

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

const errorResponse = (code: string, message: string) => json({ error: { code, message } }, STATUS[code] ?? 502);

// The page's event stream (D20). The browser reconnects after RETRY_MS when it
// drops; a comment every HEARTBEAT_MS keeps an idle stream open (Bun closes a
// connection that sends nothing for 10 s).
const RETRY_MS = 2_000;
const HEARTBEAT_MS = 5_000;

const sseFrame = ({ type, ...data }: LiveEvent) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;

function eventStream(request: Request, events: LiveEvents): Response {
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
      const unsubscribe = events.subscribe((event) => send(sseFrame(event)));
      const heartbeat = setInterval(() => send(": keep-alive\n\n"), HEARTBEAT_MS);
      cleanup = () => {
        open = false;
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

// The kind the client saw (`kind` from the terminal list: an agent kind, or
// "shell"), checked just before each send.
function terminalKind(body: Record<string, unknown>): string {
  if (typeof body.kind !== "string" || !body.kind) {
    throw new HerdrError("bad_request", '`kind` must be the kind of terminal you saw: its agent kind, or "shell".');
  }
  return body.kind;
}

function decodeTarget(encoded: string) {
  // herdr.ts refuses anything that isn't a pane ID before running herdr.
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
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
}: {
  herdr: Herdr;
  webRoot: string;
  // The one Tailscale login the app answers (AGENTS_ALLOWED_LOGIN); every other request gets 403.
  allowedLogin: string;
  now?: () => number;
  // Earlier messages from Atomic's session store; without it there are none.
  history?: ReturnType<typeof createHistory>;
  // herdr's events for the page's stream (D20); without it there is no stream.
  events?: LiveEvents;
}) {
  const root = resolve(webRoot);
  const roster = createRoster(herdr, now);

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
    return new Response(file, { headers: { "content-type": type, "cache-control": "no-cache" } });
  }

  // `/api/<collection>` is the list, GET only; `lines` names the panes whose
  // latest line is wanted, comma-separated. `/api/<collection>/<pane>/<action>`
  // answers the methods `routes` gives for its action ("" is the pane itself):
  // another method on a known action is 405, an unknown action 404.
  type PaneRoutes = Record<string, Record<string, (paneId: string) => Promise<Response>>>;
  async function collectionApi(
    request: Request,
    url: URL,
    encodedPane: string | undefined,
    action: string | undefined,
    list: (named: string[]) => Promise<Response>,
    routes: PaneRoutes,
  ): Promise<Response> {
    const method = request.method;
    if (encodedPane === undefined) {
      if (method !== "GET") throw new HerdrError("method_not_allowed", "Use GET.");
      return list((url.searchParams.get("lines") ?? "").split(","));
    }
    const paneId = decodeTarget(encodedPane);
    const name = action ?? "";
    if (!Object.hasOwn(routes, name)) throw new HerdrError("not_found", "No such API route.");
    const methods = routes[name];
    if (!Object.hasOwn(methods, method)) throw new HerdrError("method_not_allowed", `${method} isn't allowed here.`);
    return methods[method](paneId);
  }

  // The agents list for home. Reads and sends go through the terminal routes,
  // so every `/api/agents/<pane>` route is unknown (404).
  function agentsApi(request: Request, url: URL, encodedPane: string | undefined, action: string | undefined): Promise<Response> {
    return collectionApi(request, url, encodedPane, action, async (named) => json({ agents: await roster.agents(named) }), {});
  }

  async function historyPage(paneId: string, url: URL) {
    const query = parseHistoryQuery(url.searchParams);
    if (!history) {
      await herdr.get(paneId);
      return { history: null, reason: "unavailable" };
    }
    return history.page(paneId, query);
  }

  // Any pane, agent or plain shell. Sends name the `kind` the client saw.
  function terminalsApi(request: Request, url: URL, encodedPane: string | undefined, action: string | undefined): Promise<Response> {
    return collectionApi(
      request,
      url,
      encodedPane,
      action,
      async (named) => json({ terminals: await roster.terminals(named) }),
      {
        // The pane itself answers no method here.
        "": {},
        // The page names no kind when it reads, so the pane is read as any pane.
        output: { GET: async (paneId) => json({ text: await herdr.readStyled(paneId) }) },
        history: {
          // Earlier messages exist only for agents.
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
      },
    );
  }

  async function api(request: Request, url: URL): Promise<Response> {
    const [, , resource, target, action, ...rest] = url.pathname.split("/");
    if (rest.length) throw new HerdrError("not_found", "No such API route.");
    if (resource === "agents") return agentsApi(request, url, target, action);
    if (resource === "terminals") return terminalsApi(request, url, target, action);
    // The page's event stream (D20): GET only, and only from this page. An
    // EventSource sends no body, so the global POST rules don't cover it.
    if (resource === "events" && target === undefined && events) {
      if (request.method !== "GET") throw new HerdrError("method_not_allowed", "Use GET.");
      const fetchSite = request.headers.get("sec-fetch-site");
      if (fetchSite !== null && fetchSite !== "same-origin" && fetchSite !== "none") throw new HerdrError("cross_site_request", "Requests from other sites are refused.");
      return eventStream(request, events);
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
    // (Origin isn't compared with Host: tailscale serve may rewrite Host.)
    const fetchSite = request.headers.get("sec-fetch-site");
    if (request.method !== "GET" && request.method !== "HEAD" && fetchSite !== null && fetchSite !== "same-origin" && fetchSite !== "none") {
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
