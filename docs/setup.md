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
- `bun install` fetches the server's two runtime dependencies and the two dev tools. The dependencies are `@xterm/headless`, pinned at 6.0.0, the terminal emulator behind live output (see "Live output" below), and `web-push`, pinned at 3.6.7, which sends push notifications (see "Push notifications" below). There's no build step. When you pull a version that adds a dependency, run `bun install` again before restarting the server.

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

`http://…/?demo` shows built-in sample data instead of real agents and sends nothing to herdr. A Terminal there shows the paperclip and three made-up image chips, and nothing is uploaded. Picture paths there get the view key too, which opens built-in sample pictures without asking the laptop for anything.

## Sending images to a Terminal

In a Terminal's message box the paperclip opens a small menu: take a photo or choose pictures. Each picked image shows as a chip in a row above the box and is uploaded to the laptop, up to 10 per message; when you press send, the message is your text followed by the saved files' absolute paths, separated by spaces (or just the paths when you typed nothing). The send is held back until every picture has uploaded; while any is uploading or failed, a notice says why. Atomic agents read the image from that path. A plain shell just receives the path as text. Nothing is sent until you press send, and the chips stay if the send fails.

- **Where uploads go.** In the `.uploads/` folder at the repo root (set `AGENTS_UPLOADS_DIR=/some/folder` to keep them somewhere else). The folder is readable by you only (the folder is mode 700 and each file 600), Git ignores it, and it is never part of the public copy. Files get names the server chooses (a timestamp and a random part, with the extension of the detected image type), never the name the phone gave. The server doesn't serve them back, and never logs what is in them.
- **Retention.** Files older than 7 days are deleted when the server starts and then once a day. Only files the server named itself are ever deleted. To clear everything now, stop the server, delete the `.uploads/` folder and start it again.
- **Limits.** At most 15 MB per image, and 10 pictures per message; each goes up in its own upload. The server checks the file's own first bytes, not what the phone says it is, and accepts PNG, JPEG, WebP, GIF and HEIC. Anything else is refused ("Not an image the laptop can take") and nothing is saved. HEIC is accepted when its file header says so, and goes up as it is: the phone's browser can't make a thumbnail of it, and the agent has to be able to read HEIC itself.
- **Large images.** The page makes an image smaller before it goes up only when its longest side is over 2560 px or the file is over 5 MB: then it is redrawn as a JPEG (longest side at most 2560 px, quality 90), unless that isn't smaller, or it is a GIF, which stays as it is. Smaller screenshots go up untouched and stay crisp.
- **Same guards as everything else.** `POST /api/uploads` needs the login (403 without it), refuses requests from other sites (403), and takes only a multipart form with an `image` file or the image's own type as the body (415 for anything else, 413 over the limit).

## Opening laptop pictures on the phone

Where the Reader or Earlier messages show a laptop path to a picture (a name ending in `.png`, `.jpg`, `.jpeg`, `.webp` or `.gif`), a "view" key opens it full screen. The page asks the server for it with `GET /api/pictures?path=<the path>`, a read-only route that never writes anything.

- **Where it may look.** Absolute paths only (a leading `~` is your home folder). After following links, the file has to be inside your home folder or `/tmp`. A path with a hidden part (any name starting with `.`), whether as written or after following links, is refused, so `.push/`, `.uploads/`, `.ssh/` and every other hidden folder are never shown. Only regular files are read; folders and pipes count as "not found".
- **What it sends.** Only PNG, JPEG, WebP and GIF, at most 25 MB, recognised by the file's own first bytes, never by its name. HEIC isn't shown. The answer is marked private and not to be stored, and the service worker never caches it.
- **Same guards as everything else.** It needs the login (403 without it) and refuses requests from other sites (403). Other answers: 400 for a missing or relative path, 403 outside the allowed places or through a hidden folder, 404 when there's no such file, 413 over 25 MB, 415 when the file isn't one of the four picture types.

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

## Push notifications

The app can send your phone a notification when an agent needs you, or finishes. It is off until you turn it on.

**Turn it on.** On the phone, open the app and tap the **bell** at the top right of the home screen, next to the theme key. (The All terminals screen has the same bell.) A small panel opens. Tap **Turn on** and allow notifications when the browser asks. The browser asks only after that tap. Then tap **Send test**: a "Test notification" should arrive within a few seconds. Do this once on each phone. **Turn off** in the same panel stops it again. The bell shows where things stand: a bell when notifications are on, a bell with a slash when they are off, and a grey bell with a slash when the browser blocks them or can't show them. `?demo` shows the bell and the panel but never turns anything on.

**If the browser refuses.** The panel says so, in words, and names the fix.

- **Brave:** "In Brave, turn on Settings → Privacy and security → Use Google services for push messaging, then try again." Brave ships with that setting off, and without it Brave can't register for push at all. Turn it on in Brave's settings, reopen the app, tap the bell and Turn on again.
- **Other browsers:** "Your browser didn't allow push notifications. Allow notifications for this site in the browser's settings, then try again." In Chrome, that's the lock icon beside the address, then Permissions.
- **Blocked:** if you refused the browser's prompt, the panel says the browser didn't allow push notifications and the Turn on key is off. Allow notifications for this site in the browser's settings (in Chrome, the lock icon, then Permissions), then reopen the app.
- **Unsupported:** if the panel says this browser can't show push notifications, that browser has no Web Push; use Chrome on Android or Brave with the setting above.

**What you get.**

- An agent that becomes blocked: "‹folder› · ‹name› needs you", with the agent's question or latest line as the text. The name is the same one the app shows everywhere (the session title, else the tab's label, else "tab N").
- An agent that goes from working to done: "‹folder› · ‹name› finished", with its latest line.
- Tapping a notification opens that Terminal in the app.
- Each change notifies once. The server waits 3 s before it sends, so an agent that flaps, or that you answer at once, sends nothing or one notification. A newer notification for the same agent replaces the older one.
- No notification for a Terminal a page of the app is showing right now. Shells never notify. The text is plain text, cut at about 120 characters.
- The server only reads from herdr to do this. It never sends anything to any pane.

**What Google's push service sees.** Chrome on Android delivers push through Google's push service (Firebase Cloud Messaging). When you turn notifications on, the phone gets an address at that service, and the server keeps it. To notify you, the laptop sends each notification to that address over the internet (outbound HTTPS from the laptop; the tailnet isn't used), and Google's service passes it to the phone. The notification is encrypted with keys only your phone and the laptop have, so Google's service sees that your laptop sent your phone a message, when, and about how big it was. It can't read the title, the text, the folder or the agent's name. Browsers that aren't Chrome use their own push service, and see the same. Nothing is sent when notifications are off or no agent changes.

**Where the keys live.** The first time the server starts, it makes a pair of VAPID keys (the laptop's identity to the push service) and saves them, with each phone's address and keys, in two files in the `.push/` folder at the repo root: `vapid.json` and `subscriptions.json`. The folder is readable by you only (the files are mode 600), Git ignores it, and it is never part of the public copy. The private key and the phones' addresses are never logged. `AGENTS_PUSH_DIR=/some/folder` keeps them somewhere else. `AGENTS_PUSH_SUBJECT` is the `mailto:` or `https:` address the server names itself with to the push service; it defaults to the placeholder `mailto:hermux@localhost`, so set it only if a push service refuses that.

**Reset.** To forget one phone, turn Notifications off in the app on that phone. To start everything afresh (new keys, no phones), stop the server, delete the `.push/` folder, and start the server again. Then on each phone turn Notifications off and on again: a phone's old subscription belongs to the old key and stops working. A phone that the push service says is gone (it answers 404 or 410) is forgotten automatically.

The page uses four routes, all with the usual login check (403), refusing other sites (403) and, for bodies, accepting only JSON (415): `GET /api/push/key` (the server's public key), `POST` and `DELETE /api/push/subscription` (`{"subscription": …}` and `{"endpoint": …}`) and `POST /api/push/test` (`{"endpoint": …}`, which sends the test to that one phone).

A failed send is tried once more after 2 s. After that the server logs "Push: the push service didn't accept a notification (‹status›)." and carries on.

Real delivery to a phone is the one thing the tests can't show. After turning it on, leave the app (or lock the phone), let an agent block, and check the notification arrives and opens the right Terminal.

## Type checking

Run `bun install` once to fetch the two dev tools, `typescript` and `@types/bun`, and the runtime dependencies `@xterm/headless` and `web-push`. Then:

```bash
bun run typecheck
```

It checks the server, the page's JavaScript modules and the tests in strict mode, and reports each type error with its file and line. With no errors it exits quietly. It never builds or changes a file, and the page is still served as plain JavaScript.
