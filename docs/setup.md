# Setup

## How it fits together

- **Tailnet** is Tailscale's name for the private network of your own devices. Here that's the computer running Herdr, called "the laptop" below, and your phone. Nobody else is on it.
- **The server** runs on the laptop and answers only the laptop itself, at `127.0.0.1:8787`. The phone can't reach it until step 3.
- **Publishing on the tailnet** is one saved Tailscale setting on the laptop, `tailscale serve`. It passes visits to `https://<your-machine>.<your-tailnet>.ts.net` from your own devices to the server, adds HTTPS, and tells the server who you are. Nothing is uploaded or made public.
- **`tailscale funnel`** does the opposite and makes the app public. Never use it here.

```
Phone (Tailscale on) ──private Tailscale connection──► laptop's Tailscale ──tailscale serve──► server 127.0.0.1:8787 ──► herdr ──► agents
```

You do four things. Set your login (step 1), start the server on the laptop (step 2), run one Tailscale command on the laptop once (step 3), and open the address on the phone (step 4).

## Details

The server runs on the laptop, inside its own Herdr pane, and listens only on `127.0.0.1:8787`. The phone reaches it through `tailscale serve`, with HTTPS, on the tailnet only. Every request must carry `Tailscale-User-Login: <you@example.com>`, matching the login you set in `AGENTS_ALLOWED_LOGIN`. `tailscale serve` adds that header for your own devices. The server answers anything else with `403`.

## 1. Set your login with `AGENTS_ALLOWED_LOGIN`

`AGENTS_ALLOWED_LOGIN` is the one Tailscale login the server answers, for example `<you@example.com>`. `tailscale status` and the Tailscale admin console show your login. The setting is required. If it's missing or empty, the server refuses to start. There's no default and no "allow everyone".

Put it in `.env.local` at the repo root. Git ignores that file, and `scripts/start.sh` loads it if it exists. Bun also reads `.env.local` itself when started from the repo root.

```bash
echo 'AGENTS_ALLOWED_LOGIN=<you@example.com>' > .env.local
```

You can also set it in the environment: `AGENTS_ALLOWED_LOGIN=<you@example.com> scripts/start.sh`.

## 2. Start the server in a Herdr pane

In Herdr, open a new tab, for example one labelled `supervisor`, and run:

```bash
cd path/to/hermux
bun install
scripts/start.sh
```

It prints `Agents server listening on http://127.0.0.1:8787`. Leave the pane open. To stop the server, press Ctrl+C in that pane.

- The server refuses to start outside Herdr, where `HERDR_ENV` isn't `1`, and without `AGENTS_ALLOWED_LOGIN`. Herdr sets `HERDR_ENV` in its panes.
- `PORT=8790 scripts/start.sh` uses another port. If you change it, use the same port in step 3.
- `HERDR_BIN=/path/to/herdr` picks a different herdr binary. The default is `herdr` on `PATH`.
- `bun install` fetches the server's one runtime dependency and the two dev tools. The dependency is `@xterm/headless`, pinned at 6.0.0, the terminal emulator behind live output (see "Live output" below). There's no build step. When you pull a version that adds a dependency, run `bun install` again before restarting the server.

Check it from the laptop. Expect `403`, because curl sends no login header:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/
```

## 3. Publish it on the tailnet with Tailscale Serve

Use Tailscale Serve with HTTPS on and Funnel off. Serve's HTTPS needs MagicDNS and HTTPS certificates turned on for your tailnet, under DNS in the Tailscale admin console. Then run:

```bash
tailscale serve --bg --https=443 http://127.0.0.1:8787
```

If this fails with "Access denied" or a permissions error, let your user manage Tailscale once, then run the command above again:

```bash
sudo tailscale set --operator=$USER
```

Check it:

```bash
tailscale serve status
```

It should show `https://<your-machine>.<your-tailnet>.ts.net (tailnet only)` proxying to `http://127.0.0.1:8787`.

**Never run `tailscale funnel`** for this app. Funnel puts it on the public internet.

To turn it off again:

```bash
tailscale serve --https=443 off
```

`tailscale serve reset` also works, but it clears every serve setting on the laptop.

## 4. On the phone

1. With Tailscale on, open `https://<your-machine>.<your-tailnet>.ts.net` in Chrome. The agent list should load.
2. In Chrome's menu (⋮), choose **Add to home screen**, then **Install**. The app opens full screen as "Agents".

## Checks on the phone

- [ ] Over the tailnet, `https://<your-machine>.<your-tailnet>.ts.net` loads the list on the phone.
- [ ] You can add it to the home screen, and it opens as "Agents".
- [ ] With Tailscale off on the phone and only mobile data, the address doesn't load.
- [ ] `tailscale serve status` says "tailnet only", and there's no funnel.
- [ ] Requests from the phone carry the login header, so the list loads instead of a 403.

## Demo mode

`http://…/?demo` shows built-in sample data instead of real agents and sends nothing to herdr.

## Sending to Atomic agents (herdr 0.9.5)

herdr 0.9.5 accepts `agent prompt` and `agent send-keys` only for its built-in agent kinds, such as `pi`, `claude` and `codex`. Atomic agents report themselves as `atomic`. For them, the server sends with `pane send-text` and `pane send-keys` instead and makes herdr's checks itself:

- Just before each send, it runs `agent get` on the pane. If the pane no longer hosts an agent, or now hosts a different kind than the app showed, it sends nothing and the app says so.
- It won't send a message to an agent waiting on a question. The app says "It's waiting on a question. Answer it with the keys." The keys still work, so you can answer from the phone.
- A message goes as one bracketed paste followed by one Enter. Newlines inside it don't send it early, and it's never sent twice.
- Keys follow the same rules as for other agents. Ctrl+C still needs a long press, or a second press from a keyboard.

Agents of a built-in kind still go through `agent prompt` and `agent send-keys`.

## Live updates

The server keeps one subscription to herdr's events open, so a change on the laptop shows on the phone at once rather than on the next 3 s refresh. The subscription only reads. The server sends herdr's socket one request, `events.subscribe`, because the herdr 0.9.5 CLI has no streaming subscribe. It covers status changes of every pane, and panes, tabs and workspaces being created, closed, renamed or moved. The server sends nothing else on the socket.

- It uses the same socket as the herdr CLI in the server's pane. That's `HERDR_SOCKET_PATH` (Herdr sets it in its panes), else the socket of the `HERDR_SESSION` session, else `~/.config/herdr/herdr.sock`. The start line names it, as in `… (herdr: herdr, events: /home/you/.config/herdr/herdr.sock, …)`.
- If the subscription can't start or drops, the server retries after 0.5 s, then 1, 2, 4 and 8 s, then every 10 s, and logs "Live updates: couldn't subscribe to herdr's events …". Meanwhile the page polls every 3 s, and its freshness line shows the time, as in "Live · 14:05", instead of "Live".
- The page's stream is `GET /api/events`, using server-sent events. It has the same login check, answering 403 without `Tailscale-User-Login: <you@example.com>`. It answers only GET, with 405 otherwise, and refuses requests from other sites with 403. A hidden page closes it.

To see the stream from the laptop:

```bash
curl -N -H 'Tailscale-User-Login: <you@example.com>' http://127.0.0.1:8787/api/events
```

It prints `event: live` with `{"live":true}`, then a `change` event, and sometimes an `output` event, for each change, plus a `: keep-alive` line every 5 s.

The live check creates one disposable `--no-focus` tab and starts its own server on port 8791, never 8787. It times status changes through the stream and through the old 3 s poll, then closes the tab:

```bash
bun test/live/stream-check.ts
```

## Live output

While the phone shows a Terminal, the server pushes that Terminal's output as it changes, instead of the page reading it every 2 s. A line printed in the pane reaches the page about 60 ms later on the laptop's loopback, plus the phone's network time. With the poll it took 0-2 s.

- It only reads. For each Terminal a page is viewing, and only while one is, the server runs `herdr terminal session observe <pane>`. That stream shows the pane's screen. It never sends input and never resizes the pane. The server keeps a copy of the screen in `@xterm/headless`, a terminal emulator, and checks it every 40 ms. When the screen changes, it reads the pane's output exactly as the poll does and pushes that text on the page's stream, so the screen, Earlier messages and the Join look the same as before.
- The page starts it with `POST /api/terminals/<pane>/watch` and stops it with `DELETE` on the same path. Both take a JSON body `{"stream": "<id>"}`, where the id is the one the stream sends first as `event: stream`. Both have the usual login check (403), refuse other sites (403) and accept only JSON (415). Output arrives as `event: output` with `{"pane_id", "text"}` and `event: watch` with `{"pane_id", "streaming"}`, and only the page that asked receives them.
- The observe stream stops 5 s after the last page leaves that Terminal, closes or is hidden.
- If the observe stream fails or ends, the server tells the page to poll that Terminal every 2 s again, and the page reads it at once. The server reopens the stream after 0.5 s, then 1, 2, 4 and 8 s, then every 10 s, and logs "Live output: the stream of <pane> stopped (…). Retrying." Once the stream works again, the polling stops by itself.
- There's nothing to set up beyond `bun install`. With an older herdr that lacks `terminal session observe`, the page keeps polling.

## Type checking

Run `bun install` once to fetch the two dev tools, `typescript` and `@types/bun`, and the runtime dependency `@xterm/headless`. Then:

```bash
bun run typecheck
```

It checks the server, the page's JavaScript modules and the tests in strict mode, and reports each type error with its file and line. With no errors it exits quietly. It never builds or changes a file, and the page is still served as plain JavaScript.
