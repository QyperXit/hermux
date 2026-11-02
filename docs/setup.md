# Setup

## In plain words

- **Tailnet** is Tailscale's name for the private network made of your own devices: here, the computer that runs Herdr (called "the laptop" below) and your phone. Nobody else is on it.
- **The server** runs on the laptop but on purpose answers only the laptop itself (`127.0.0.1:8787`). The phone can't reach it until step 3.
- **"Publish on the tailnet"** means one saved Tailscale setting on the laptop (`tailscale serve`). It passes visits to `https://<your-machine>.<your-tailnet>.ts.net` from your own devices to the server, adds the HTTPS padlock, and tells the server who you are. Nothing is uploaded, and nothing goes on the public internet.
- **`tailscale funnel`** is the opposite: it would make the app public. Never use it here.

```
Phone (Tailscale on) ──private Tailscale connection──► laptop's Tailscale ──tailscale serve──► server 127.0.0.1:8787 ──► herdr ──► agents
```

So you do four things: set your login (step 1), start the server on the laptop (step 2), run one Tailscale command on the laptop once (step 3), and open the address on the phone (step 4).

## Details

The server runs on the laptop, inside its own Herdr pane. It listens on `127.0.0.1:8787` only. The phone reaches it through `tailscale serve` (HTTPS, tailnet only). Every request must carry `Tailscale-User-Login: <you@example.com>`, the login you set in `AGENTS_ALLOWED_LOGIN`, which `tailscale serve` adds for your own devices; anything else gets `403`.

## 1. Set your login: `AGENTS_ALLOWED_LOGIN`

`AGENTS_ALLOWED_LOGIN` is the one Tailscale login the server answers, for example `<you@example.com>` (the login shown by `tailscale status` or in the Tailscale admin console). It is required: without it, or with it empty, the server refuses to start. There is no default and no "allow everyone".

Put it in `.env.local` at the repo root. `scripts/start.sh` loads that file if it is there (Bun also reads `.env.local` by itself when started from the repo root), and git ignores it:

```bash
echo 'AGENTS_ALLOWED_LOGIN=<you@example.com>' > .env.local
```

Setting it in the environment works too: `AGENTS_ALLOWED_LOGIN=<you@example.com> scripts/start.sh`.

## 2. Start the server in a Herdr pane

In Herdr, open a new tab (for example labelled `supervisor`), then run:

```bash
cd path/to/hermux
bun install
scripts/start.sh
```

It prints `Agents server listening on http://127.0.0.1:8787`. Leave the pane open. To stop the server, press Ctrl+C in that pane.

- The server refuses to start outside Herdr (`HERDR_ENV` must be `1`, which Herdr sets in its panes) and without `AGENTS_ALLOWED_LOGIN`.
- `PORT=8790 scripts/start.sh` uses another port. If you change it, use the same port in step 3.
- `HERDR_BIN=/path/to/herdr` picks a different herdr binary. The default is `herdr` on `PATH`.
- `bun install` fetches the server's one runtime dependency, `@xterm/headless` (pinned at 6.0.0, the terminal emulator for live output; see "Live output" below), and the two dev tools. There is no build step. After pulling a version that adds a dependency, run `bun install` again before restarting the server.

Quick check from the laptop (expect `403`, because curl sends no login header):

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/
```

## 3. Publish it on the tailnet with Tailscale Serve

Use Tailscale Serve with HTTPS on, and Funnel off. Serve's HTTPS needs MagicDNS and HTTPS certificates turned on for your tailnet (Tailscale admin console → DNS). Then run:

```bash
tailscale serve --bg --https=443 http://127.0.0.1:8787
```

If this fails with "Access denied" or a permissions error, allow your user to manage Tailscale once, then run the command above again:

```bash
sudo tailscale set --operator=$USER
```

Check it:

```bash
tailscale serve status
```

It should show `https://<your-machine>.<your-tailnet>.ts.net (tailnet only)` proxying to `http://127.0.0.1:8787`.

**Never run `tailscale funnel`** for this app. Funnel would put it on the public internet.

To turn it off again:

```bash
tailscale serve --https=443 off
```

(`tailscale serve reset` also works, but it clears every serve setting on the laptop.)

## 4. On the phone

1. With Tailscale on, open `https://<your-machine>.<your-tailnet>.ts.net` in Chrome. The agent list should load.
2. Chrome menu (⋮) → **Add to home screen** → **Install**. The app opens full screen as "Agents".

## Checks on the phone

- [ ] Over the tailnet, `https://<your-machine>.<your-tailnet>.ts.net` loads the list on the phone.
- [ ] It can be added to the home screen and opens as "Agents".
- [ ] With Tailscale off on the phone (mobile data), the address doesn't load.
- [ ] `tailscale serve status` says "tailnet only" and there is no funnel.
- [ ] Requests from the phone carry the login header: the list loads instead of showing a 403.

## Demo mode

`http://…/?demo` shows the built-in sample data instead of real agents. It sends nothing to herdr.

## Sending to Atomic agents (herdr 0.9.5)

herdr 0.9.5 accepts `agent prompt` and `agent send-keys` only for its built-in agent kinds (`pi`, `claude`, `codex`, …). Atomic agents report themselves as `atomic`, so the server sends to them with `pane send-text` and `pane send-keys` instead, and does herdr's checks itself:

- Just before each send, it runs `agent get` on the pane. If the pane no longer hosts an agent, or now hosts a different kind than the one the app showed, nothing is sent and the app says so.
- A message to an agent that is waiting on a question isn't sent ("It's waiting on a question. Answer it with the keys."). The keys still work, so the question can be answered from the phone.
- A message goes as one bracketed paste followed by one Enter, so newlines inside it don't send it early, and it is never sent twice.
- The keys are the same 12 as for other agents, and Ctrl+C still needs a long press (or a second press from a keyboard).

Agents of a built-in kind still go through `agent prompt` and `agent send-keys`.

## Live updates

The server keeps one subscription to herdr's events open, so a change on the laptop shows on the phone at once instead of on the next 3 s refresh. It is read-only: the server sends herdr's socket one request, `events.subscribe` (the CLI has no streaming subscribe in herdr 0.9.5), for status changes of every pane and for panes, tabs and workspaces being created, closed, renamed or moved. It never sends anything else on the socket.

- The socket is the one the herdr CLI in the server's pane uses: `HERDR_SOCKET_PATH` (Herdr sets it in its panes), else the `HERDR_SESSION` session's socket, else `~/.config/herdr/herdr.sock`. The start line names it: `… (herdr: herdr, events: /home/you/.config/herdr/herdr.sock, …)`.
- If the subscription can't start or drops, the server tries again after 0.5 s, then 1, 2, 4 and 8 s, then every 10 s, and logs "Live updates: couldn't subscribe to herdr's events …". Meanwhile the page polls every 3 s as before, and its freshness line shows the time ("Live · 14:05") instead of "Live".
- The page's stream is `GET /api/events` (server-sent events). It has the same login check (403 without `Tailscale-User-Login: <you@example.com>`), answers GET only (405 otherwise), and refuses requests from other sites (403). A hidden page closes it.

To see the stream from the laptop:

```bash
curl -N -H 'Tailscale-User-Login: <you@example.com>' http://127.0.0.1:8787/api/events
```

It prints `event: live` with `{"live":true}`, then a `change` (and an `output`) event for each change, and a `: keep-alive` line every 5 s.

The live check for it creates one disposable `--no-focus` tab, starts its own server on port 8791 (never 8787), times status changes through the stream and through the old 3 s poll, then closes the tab:

```bash
bun test/live/stream-check.ts
```

## Live output

While the phone shows a Terminal, the server pushes that Terminal's output to it as it changes, instead of the page reading it every 2 s. A line printed in the pane shows on the phone about 60 ms later on the laptop's loopback (plus the phone's network time), against 0-2 s with the poll.

- It is read-only. For each Terminal a page is viewing, and only while one is, the server runs `herdr terminal session observe <pane>` (a stream of the pane's screen; it never sends input and doesn't resize the pane) and keeps a copy of the screen in a terminal emulator, `@xterm/headless`. When the screen really changes (looked at once per 40 ms), it reads the pane's output exactly as the 2 s poll does and pushes that text on the page's stream, so the screen, Earlier messages and the Join look the same as before.
- The page asks for it with `POST /api/terminals/<pane>/watch` and stops with `DELETE` on the same path (JSON body `{"stream": "<id>"}`, the id the stream sends first as `event: stream`). Both have the usual login check (403), refuse other sites (403) and take only JSON (415). The output comes as `event: output` (`{"pane_id", "text"}`) and `event: watch` (`{"pane_id", "streaming"}`), only to the page that asked.
- The observe stream stops 5 s after the last page leaves that Terminal, closes or is hidden.
- If the observe stream fails or ends, the server tells the page to poll that Terminal every 2 s again (it reads at once), and opens the stream again after 0.5 s, then 1, 2, 4 and 8 s, then every 10 s, and logs "Live output: the stream of <pane> stopped (…). Retrying." Once it works again the polling stops by itself.
- Nothing to set up beyond `bun install`. An older herdr without `terminal session observe` just means the page keeps polling.

## Type checking

`bun install` once (it fetches the two dev tools, `typescript` and `@types/bun`, and the runtime dependency `@xterm/headless`), then:

```bash
bun run typecheck
```

It checks the server, the page's JavaScript modules and the tests in strict mode, and reports any type error with its file and line; no errors means it exits quietly. It never builds or changes a file; the page is still served as plain JavaScript.
