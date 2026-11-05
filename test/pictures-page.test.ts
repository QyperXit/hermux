import { afterEach, describe, expect, test } from "bun:test";
import { createHttpClient } from "../web/api.js";
import { messageHtml } from "../web/history.js";
import { readerHtml } from "../web/reader.js";
import { createSampleClient } from "../web/sample-data.js";

const copyKey = (path: string) => `<button class="copy-key" type="button" data-copy="${path}" aria-label="Copy ${path}">copy</button>`;
const viewKey = (path: string) =>
  `<button class="view-key" type="button" data-view="${path}" aria-label="View ${path}"><svg class="icon" aria-hidden="true"><use href="#i-picture"/></svg>view</button>`;
const viewed = (html: string) => [...html.matchAll(/class="view-key"[^>]*data-view="([^"]*)"/g)].map(([, path]) => path);

describe("which paths get a view key", () => {
  test("a PNG, JPEG, WebP or GIF path in the Reader gets a view key after its copy key, in any case", () => {
    const paths = ["/tmp/a.png", "/tmp/b.jpg", "/tmp/c.jpeg", "/tmp/d.webp", "/tmp/e.gif", "/tmp/F.PNG", "~/s/g.JpEg", "/home/you/h.Gif"];
    const html = readerHtml(` See ${paths.join(" and ")} now`);
    expect(viewed(html)).toEqual(paths);
    expect(html).toContain(`/tmp/a.png${copyKey("/tmp/a.png")}${viewKey("/tmp/a.png")} and`);
  });

  test("other paths and web addresses get no view key", () => {
    const html = readerHtml(" See /tmp/a.svg /tmp/b.pdf /tmp/c.txt /tmp/d.png.bak /tmp/png /home/you/e.pngx https://example.com/f.png ~/g.jpg.old /tmp/.png.txt");
    expect(viewed(html)).toEqual([]);
    expect(html).toContain(copyKey("/tmp/a.svg"));
  });

  test("Earlier messages get the view key too: the user's words, the agent's prose and code spans, and tool rows", () => {
    const user = messageHtml({ seq: 1, role: "user", blocks: [{ kind: "text", text: "look at /tmp/shot.png" }] });
    const agent = messageHtml({ seq: 2, role: "assistant", blocks: [{ kind: "text", text: "Saved `~/sketch/left.webp` and **/home/you/b.gif**." }] });
    const tool = messageHtml({ seq: 3, role: "assistant", blocks: [{ kind: "tool", name: "read", summary: "/home/you/c.jpg" }] });
    expect(viewed(user)).toEqual(["/tmp/shot.png"]);
    expect(viewed(agent)).toEqual(["~/sketch/left.webp", "/home/you/b.gif"]);
    expect(viewed(tool)).toEqual(["/home/you/c.jpg"]);
  });

  test("in a box-drawn block a picture path is tapped to view it and long-pressed to copy it, so no key moves the columns", () => {
    const html = readerHtml(["╭──────────────────────╮", "│ /tmp/out/shot.png    │", "│ /tmp/out/notes.txt   │", "╰──────────────────────╯"].join("\n"));
    expect(html).toContain(
      `│ <span class="path" data-copy="/tmp/out/shot.png" data-view="/tmp/out/shot.png" role="button" tabindex="0" aria-label="View /tmp/out/shot.png">/tmp/out/shot.png</span>    │`,
    );
    expect(html).toContain(`│ <span class="path" data-copy="/tmp/out/notes.txt">/tmp/out/notes.txt</span>   │`);
    expect(html).not.toContain("view-key");
  });

  test("Atomic's chrome and a plain shell's output get no view key", () => {
    expect(readerHtml(" Done.\n" + "─".repeat(40) + "\n❯ open /tmp/a.png\n" + "─".repeat(40) + "\n(anthropic) model • ~/proj")).not.toContain("data-view");
  });

  test("a hostile picture path can't break out of its attributes or its text: & is escaped, and quotes and <> end a path", () => {
    const html = readerHtml(` /tmp/a&b=1#x?y%2F+z(1).png and /tmp/x<img src=x>.gif and /tmp/q"onclick=".png`);
    expect(viewed(html)).toEqual(["/tmp/a&amp;b=1#x?y%2F+z(1).png"]);
    expect(html).not.toContain("<img");
    expect(html).not.toContain(`"onclick`);
    const block = readerHtml(["┌────────────────┐", "│ ~/a&b.png      │", "└────────────────┘"].join("\n"));
    expect(block).toContain(`data-view="~/a&amp;b.png"`);
    expect(block).toContain(`aria-label="View ~/a&amp;b.png"`);
  });
});

describe("asking the laptop for a picture", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  const answering = (answer: () => Response | Promise<Response>) => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return answer();
    }) as unknown as typeof fetch;
    return calls;
  };
  const failure = async (path: string) => {
    try {
      await createHttpClient().readPicture(path);
    } catch (error) {
      return error as Error & { code: string };
    }
    throw new Error("It didn't fail.");
  };

  test("asks GET api/pictures with the whole path encoded, uncached, and gives back the picture's bytes", async () => {
    const calls = answering(() => new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { headers: { "content-type": "image/png" } }));
    const signal = new AbortController().signal;
    const blob = await createHttpClient().readPicture("/tmp/a b&c=1#x?y%2F+z.png", { signal });
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`api/pictures?path=${encodeURIComponent("/tmp/a b&c=1#x?y%2F+z.png")}`);
    expect(new URL(calls[0].url, "https://agents.example.com/").searchParams.get("path")).toBe("/tmp/a b&c=1#x?y%2F+z.png");
    expect([calls[0].init?.cache, calls[0].init?.method ?? "GET"]).toEqual(["no-store", "GET"]);
  });

  test("each refusal reads as a plain reason", async () => {
    const refusals: [number, string, string][] = [
      [400, "bad_request", "That path can't be opened as a picture."],
      [403, "path_not_allowed", "Not allowed. The laptop shows pictures in your home folder or /tmp only, never in a hidden folder."],
      [404, "picture_not_found", "Not found on the laptop."],
      [413, "payload_too_large", "Too big to show. The limit is 25 MB."],
      [415, "unsupported_media_type", "Not a picture. The laptop shows PNG, JPEG, WebP and GIF files."],
      [502, "herdr_unavailable", "The laptop answered 502."],
    ];
    for (const [status, code, message] of refusals) {
      answering(() => Response.json({ error: { code, message: "server words" } }, { status }));
      const error = await failure("/tmp/a.png");
      expect([error.code, error.message]).toEqual([code, message]);
    }
    answering(() => new Response("Forbidden\n", { status: 403 }));
    expect((await failure("/tmp/a.png")).message).toBe("Not allowed. The laptop shows pictures in your home folder or /tmp only, never in a hidden folder.");
  });

  test("a laptop that doesn't answer reads as unreachable", async () => {
    answering(() => Promise.reject(new TypeError("Failed to fetch")));
    const error = await failure("/tmp/a.png");
    expect([error.code, error.message]).toEqual(["unreachable", "Can't reach the laptop."]);
  });

  test("a laptop that doesn't start answering in time reads as unreachable", async () => {
    globalThis.fetch = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))) as unknown as typeof fetch;
    const started = performance.now();
    const error = await createHttpClient({ readTimeoutMs: 100 })
      .readPicture("/tmp/a.png")
      .then(() => null, (thrown: Error & { code?: string }) => thrown);
    expect([error?.code, error?.message]).toEqual(["unreachable", "Can't reach the laptop."]);
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  test("once the laptop answers, the time limit no longer cuts the picture off, and closing the viewer still stops it", async () => {
    const calls = answering(() => new Response(new Uint8Array([1]), { headers: { "content-type": "image/png" } }));
    await createHttpClient({ readTimeoutMs: 50 }).readPicture("/tmp/a.png");
    await Bun.sleep(120);
    expect(calls[0].init?.signal?.aborted).toBe(false);

    const closing = new AbortController();
    const more = answering(() => new Response(new Uint8Array([1])));
    await createHttpClient({ readTimeoutMs: 50 }).readPicture("/tmp/a.png", { signal: closing.signal });
    closing.abort();
    expect(more[0].init?.signal?.aborted).toBe(true);
  });

  test("the demo shows view keys on its hermux agent's three sketches, draws them itself, and asks nothing of the laptop", async () => {
    const calls = answering(() => new Response("no"));
    const client = createSampleClient();
    const sketches = ["left", "middle", "right"].map((name) => `/home/you/projects/hermux/sketches/${name}.png`);
    expect(viewed(readerHtml(await client.readOutput("wF:p1")))).toEqual(sketches);
    for (const path of sketches) {
      const blob = await client.readPicture(path);
      expect(blob.type).toBe("image/svg+xml");
      expect(await blob.text()).toContain("<svg");
    }
    const missing = await client.readPicture("/tmp/gone.png").catch((error: Error) => error.message);
    expect(missing).toBe("Not found on the laptop.");
    expect(calls).toEqual([]);
  });
});
