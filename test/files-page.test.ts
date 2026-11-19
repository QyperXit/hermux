import { afterEach, describe, expect, test } from "bun:test";
import { createHttpClient } from "../web/api.js";
import { FILE_HEADER } from "../web/file-rules.js";
import { messageHtml } from "../web/history.js";
import { readerHtml } from "../web/reader.js";
import { createSampleClient } from "../web/sample-data.js";

const copyKey = (path: string) => `<button class="copy-key" type="button" data-copy="${path}" aria-label="Copy ${path}">copy</button>`;
const fileKey = (path: string) =>
  `<button class="file-key" type="button" data-file="${path}" aria-haspopup="dialog" aria-label="File ${path}"><svg class="icon" aria-hidden="true"><use href="#i-file"/></svg>file</button>`;
const filed = (html: string) => [...html.matchAll(/class="file-key"[^>]*data-file="([^"]*)"/g)].map(([, path]) => path);
const viewed = (html: string) => [...html.matchAll(/class="view-key"[^>]*data-view="([^"]*)"/g)].map(([, path]) => path);

describe("which paths get a file key", () => {
  test("a laptop file that isn't a picture gets a file key right after its copy key, in home or /tmp", () => {
    const paths = ["/tmp/hermux/invoice-november.pdf", "/tmp/hermux/photos-backup.zip", "~/notes/plan.md", "/home/you/report.tar.gz", "/tmp/a.svg", "/tmp/b.HEIC", "/tmp/d.png.bak"];
    const html = readerHtml(` Done: ${paths.join(" and ")} are ready`);
    expect(filed(html)).toEqual(paths);
    expect(viewed(html)).toEqual([]);
    expect(html).toContain(`/tmp/hermux/invoice-november.pdf${copyKey("/tmp/hermux/invoice-november.pdf")}${fileKey("/tmp/hermux/invoice-november.pdf")} and`);
  });

  test("pictures keep the view key and get no file key", () => {
    const html = readerHtml(" See /tmp/a.png, ~/b.JPG and /home/you/c.webp");
    expect(viewed(html)).toEqual(["/tmp/a.png", "~/b.JPG", "/home/you/c.webp"]);
    expect(filed(html)).toEqual([]);
  });

  test("no file key where the laptop would refuse or there is no file name: hidden parts, /home itself, folders, lines and web addresses", () => {
    const refused = [
      "/home/you/.ssh/id_ed25519.pub",
      "/home/x/hermux/.push/vapid.json",
      "~/.config/app.toml",
      "/tmp/.hidden/a.pdf",
      "/tmp/.env.local",
      "/tmp/./a.pdf",
      "/tmp/../etc/passwd.txt",
      "/home/notes.pdf",
      "/tmp/hermux/",
      "/home/you/projects/hermux",
      "/tmp/build/Makefile",
      "/home/you/app.ts:42",
    ];
    const html = readerHtml(` See ${refused.join(" and ")} now, and https://example.com/report.pdf`);
    expect(filed(html)).toEqual([]);
    for (const path of refused) expect(html).toContain(copyKey(path));
  });

  test("Earlier messages get the file key too: the user's words, the agent's prose and code spans, and tool rows", () => {
    const user = messageHtml({ seq: 1, role: "user", blocks: [{ kind: "text", text: "send me /tmp/report.pdf" }] });
    const agent = messageHtml({ seq: 2, role: "assistant", blocks: [{ kind: "text", text: "Zipped `~/photos-backup.zip` and **/home/you/notes.txt**, and kept `~/.cache/x.zip`." }] });
    const tool = messageHtml({ seq: 3, role: "assistant", blocks: [{ kind: "tool", name: "write", summary: "/home/you/invoice.pdf" }] });
    expect(filed(user)).toEqual(["/tmp/report.pdf"]);
    expect(filed(agent)).toEqual(["~/photos-backup.zip", "/home/you/notes.txt"]);
    expect(filed(tool)).toEqual(["/home/you/invoice.pdf"]);
  });

  test("in a box-drawn block a file path is tapped to open its sheet and long-pressed to copy, so no key moves the columns", () => {
    const html = readerHtml(["╭──────────────────────────╮", "│ /tmp/out/report.pdf      │", "│ /tmp/out/.secret.zip     │", "│ /tmp/out/shot.png        │", "╰──────────────────────────╯"].join("\n"));
    expect(html).toContain(
      `│ <span class="path" data-copy="/tmp/out/report.pdf" data-file="/tmp/out/report.pdf" role="button" tabindex="0" aria-haspopup="dialog" aria-label="File /tmp/out/report.pdf">/tmp/out/report.pdf</span>      │`,
    );
    expect(html).toContain(`│ <span class="path" data-copy="/tmp/out/.secret.zip">/tmp/out/.secret.zip</span>     │`);
    expect(html).toContain(`data-view="/tmp/out/shot.png"`);
    expect(html).not.toContain("file-key");
  });

  test("Atomic's chrome gets no file key", () => {
    expect(readerHtml(" Done.\n" + "─".repeat(40) + "\n❯ open /tmp/a.pdf\n" + "─".repeat(40) + "\n(anthropic) model • ~/proj")).not.toContain("data-file");
  });

  test("a hostile file path can't break out of its attributes or its text", () => {
    const html = readerHtml(` /tmp/a&b=1#x?y%2F+z(1).pdf and /tmp/x<img src=x>.zip and /tmp/q"onclick=".pdf`);
    expect(filed(html)).toEqual(["/tmp/a&amp;b=1#x?y%2F+z(1).pdf"]);
    expect(html).not.toContain("<img");
    expect(html).not.toContain(`"onclick`);
    const block = readerHtml(["┌────────────────┐", "│ ~/a&b.pdf      │", "└────────────────┘"].join("\n"));
    expect(block).toContain(`data-file="~/a&amp;b.pdf"`);
    expect(block).toContain(`aria-label="File ~/a&amp;b.pdf"`);
  });
});

describe("asking the laptop for a file", () => {
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
  const failure = async (read: () => Promise<unknown>) => {
    try {
      await read();
    } catch (error) {
      return error as Error & { code: string };
    }
    throw new Error("It didn't fail.");
  };
  const PATH = "/tmp/a b&c=1#x?y%2F+z.pdf";
  const INFO = { name: "a b&c=1#x?y%2F+z.pdf", size: 212_000, modified: 1_700_000_000_000, kind: "application/pdf" };

  test("the info is GET api/files/info with the whole path encoded, uncached, with the app's own header", async () => {
    const calls = answering(() => Response.json(INFO));
    expect(await createHttpClient().readFileInfo(PATH)).toEqual(INFO);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`api/files/info?path=${encodeURIComponent(PATH)}`);
    expect(new URL(calls[0].url, "https://agents.example.com/").searchParams.get("path")).toBe(PATH);
    expect([calls[0].init?.cache, calls[0].init?.method ?? "GET", new Headers(calls[0].init?.headers).get(FILE_HEADER)]).toEqual(["no-store", "GET", "1"]);
  });

  test("the file is GET api/files with the path encoded, uncached, with the app's own header, and comes back as a typed blob", async () => {
    const calls = answering(() => new Response("%PDF-1.7", { headers: { "content-type": "application/pdf" } }));
    const signal = new AbortController().signal;
    const blob = await createHttpClient().readFile(PATH, { signal });
    expect([blob.type, await blob.text()]).toEqual(["application/pdf", "%PDF-1.7"]);
    expect(calls[0].url).toBe(`api/files?path=${encodeURIComponent(PATH)}`);
    expect([calls[0].init?.cache, new Headers(calls[0].init?.headers).get(FILE_HEADER)]).toEqual(["no-store", "1"]);
  });

  test("each refusal reads as a plain reason, for the info and the file", async () => {
    const refusals: [number, string, string][] = [
      [400, "bad_request", "That path can't be opened as a file."],
      [403, "path_not_allowed", "Not allowed. The laptop sends files from your home folder or /tmp only, never from a hidden folder."],
      [404, "file_not_found", "Not found on the laptop."],
      [413, "payload_too_large", "Too big to get. The limit is 100 MB."],
      [502, "herdr_unavailable", "The laptop answered 502."],
    ];
    for (const [status, code, message] of refusals) {
      answering(() => Response.json({ error: { code, message: "server words" } }, { status }));
      for (const read of [() => createHttpClient().readFileInfo("/tmp/a.pdf"), () => createHttpClient().readFile("/tmp/a.pdf")]) {
        const error = await failure(read);
        expect([error.code, error.message]).toEqual([code, message]);
      }
    }
    answering(() => new Response("Forbidden\n", { status: 403 }));
    expect((await failure(() => createHttpClient().readFileInfo("/tmp/a.pdf"))).message).toBe("Not allowed. The laptop sends files from your home folder or /tmp only, never from a hidden folder.");
  });

  test("a laptop that doesn't answer, or doesn't start answering in time, reads as unreachable", async () => {
    answering(() => Promise.reject(new TypeError("Failed to fetch")));
    for (const read of [() => createHttpClient().readFileInfo("/tmp/a.pdf"), () => createHttpClient().readFile("/tmp/a.pdf")]) {
      const error = await failure(read);
      expect([error.code, error.message]).toEqual(["unreachable", "Can't reach the laptop."]);
    }
    globalThis.fetch = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))) as unknown as typeof fetch;
    const started = performance.now();
    for (const read of [() => createHttpClient({ readTimeoutMs: 100 }).readFileInfo("/tmp/a.pdf"), () => createHttpClient({ readTimeoutMs: 100 }).readFile("/tmp/a.pdf")]) {
      const error = await failure(read);
      expect([error.code, error.message]).toEqual(["unreachable", "Can't reach the laptop."]);
    }
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  test("once the laptop answers, the time limit no longer cuts a big file off", async () => {
    const calls = answering(() => new Response(new Uint8Array([1])));
    await createHttpClient({ readTimeoutMs: 50 }).readFile("/tmp/a.zip");
    await Bun.sleep(120);
    expect(calls[0].init?.signal?.aborted).toBe(false);
  });

  test("a connection that drops halfway through reads as unreachable; the sheet's own abort stops it with the browser's abort", async () => {
    answering(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([0x50, 0x4b]));
              controller.error(new TypeError("network error"));
            },
          }),
        ),
    );
    const error = await failure(() => createHttpClient().readFile("/tmp/a.zip"));
    expect([error.code, error.message]).toEqual(["unreachable", "Can't reach the laptop."]);

    const closing = new AbortController();
    globalThis.fetch = (async (_url: string, init?: RequestInit) =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([0x50, 0x4b]));
            init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason));
          },
        }),
      )) as unknown as typeof fetch;
    const reading = createHttpClient().readFile("/tmp/a.zip", { signal: closing.signal });
    await Bun.sleep(10);
    closing.abort();
    expect(await reading.then(() => null, (thrown: unknown) => thrown)).toBe(closing.signal.reason);
  });

  test("the demo asks the laptop for no file", async () => {
    const calls = answering(() => new Response("no"));
    const client = createSampleClient();
    expect((await failure(() => client.readFileInfo("/tmp/a.pdf"))).message).toBe("Not found on the laptop.");
    expect((await failure(() => client.readFile("/tmp/a.pdf"))).message).toBe("Not found on the laptop.");
    expect(calls).toHaveLength(0);
  });
});
