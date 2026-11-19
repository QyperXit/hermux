import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app";
import { attachmentHeader, createFiles, type Files } from "../server/files";
import { createHerdr } from "../server/herdr";
import { FILE_HEADER, MAX_FILE_BYTES } from "../web/file-rules.js";
import { WEB } from "./support/agents";
import { ALLOWED_LOGIN } from "./support/http";
import { image, type Bytes } from "./support/uploads";

const folders: string[] = [];
afterAll(() => folders.splice(0).forEach((folder) => rmSync(folder, { recursive: true, force: true })));

type Options = { login?: string | null; site?: string; method?: string; header?: string | null; info?: boolean };
const errorCode = async (response: Response) => ((await response.json()) as { error: { code: string } }).error.code;
const PDF = new TextEncoder().encode("%PDF-1.7\n%\u00e2\u00e3\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");
const ZIP = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0, 8, 0, ...Array.from({ length: 54 }, (_, index) => index)]);

function serve(files: Files) {
  const app = createApp({ herdr: createHerdr("/nonexistent/herdr"), allowedLogin: ALLOWED_LOGIN, webRoot: WEB, files });
  const request = (query: string, { login = ALLOWED_LOGIN, site, method = "GET", header = "1", info = false }: Options = {}) => {
    const headers = new Headers();
    if (login !== null) headers.set("Tailscale-User-Login", login);
    if (site !== undefined) headers.set("sec-fetch-site", site);
    if (header !== null) headers.set(FILE_HEADER, header);
    return app(new Request(`http://127.0.0.1:8787/api/files${info ? "/info" : ""}${query}`, { method, headers }));
  };
  return {
    app,
    request,
    get: (path: string, options?: Options) => request(`?path=${encodeURIComponent(path)}`, options),
    info: (path: string, options?: Options) => request(`?path=${encodeURIComponent(path)}`, { ...options, info: true }),
  };
}

function makeFiles() {
  const scratch = mkdtempSync(join(tmpdir(), "files-test-"));
  folders.push(scratch);
  const home = join(scratch, "home");
  const tmp = join(scratch, "tmp");
  const outside = join(scratch, "outside");
  for (const dir of [home, tmp, outside]) mkdirSync(dir);
  const served = serve(createFiles({ home, tmp }));
  const put = (path: string, bytes: Bytes | string = PDF) => {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, bytes);
    return path;
  };
  const listing = () => readdirSync(scratch, { recursive: true }).map(String).sort();
  return { scratch, home, tmp, outside, put, listing, ...served };
}

const expectRefused = async (response: Response, status: number, code: string, label: unknown = "") => {
  expect([label, response.status, await errorCode(response)]).toEqual([label, status, code]);
};

const DOWNLOAD_HEADERS = ["content-type", "content-length", "content-disposition", "x-content-type-options", "cache-control"];
const headersOf = (response: Response) => Object.fromEntries(DOWNLOAD_HEADERS.map((header) => [header, response.headers.get(header)]));

describe("who may get a file", () => {
  test("403 without the login or with another one, for the file and its info", async () => {
    const { get, info, put, home } = makeFiles();
    const path = put(join(home, "invoice.pdf"));
    for (const login of [null, "other@example.com", ""]) {
      expect([login, (await get(path, { login })).status, (await info(path, { login })).status]).toEqual([login, 403, 403]);
    }
  });

  test("403 cross_site_request from another site, even for a real file", async () => {
    const { get, info, put, home } = makeFiles();
    const path = put(join(home, "invoice.pdf"));
    for (const site of ["cross-site", "same-site"]) {
      await expectRefused(await get(path, { site }), 403, "cross_site_request", site);
      await expectRefused(await info(path, { site }), 403, "cross_site_request", site);
    }
  });

  test("403 cross_site_request without the app's own header, or with another value", async () => {
    const { get, info, put, home } = makeFiles();
    const path = put(join(home, "invoice.pdf"));
    for (const header of [null, "", "0", "yes"]) {
      await expectRefused(await get(path, { header }), 403, "cross_site_request", header);
      await expectRefused(await info(path, { header }), 403, "cross_site_request", header);
    }
  });

  test("this page's own requests (same-origin, none, or no Sec-Fetch-Site) are answered", async () => {
    const { get, info, put, home } = makeFiles();
    const path = put(join(home, "invoice.pdf"));
    for (const site of ["same-origin", "none", undefined]) {
      expect([site, (await get(path, { site })).status, (await info(path, { site })).status]).toEqual([site, 200, 200]);
    }
  });

  test("only GET: other methods are 405 and nothing is written", async () => {
    const { get, info, put, home, listing } = makeFiles();
    const path = put(join(home, "invoice.pdf"));
    const before = listing();
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      await expectRefused(await get(path, { method }), 405, "method_not_allowed", method);
      await expectRefused(await info(path, { method }), 405, "method_not_allowed", method);
    }
    expect(listing()).toEqual(before);
  });

  test("without the files module the routes are unknown, and so is anything else below them", async () => {
    const { request } = makeFiles();
    const bare = createApp({ herdr: createHerdr("/nonexistent/herdr"), allowedLogin: ALLOWED_LOGIN, webRoot: WEB });
    for (const route of ["/api/files?path=/tmp/x.pdf", "/api/files/info?path=/tmp/x.pdf"]) {
      const response = await bare(new Request(`http://127.0.0.1:8787${route}`, { headers: { "Tailscale-User-Login": ALLOWED_LOGIN, [FILE_HEADER]: "1" } }));
      expect([route, response.status]).toEqual([route, 404]);
    }
    for (const below of ["/x.pdf?path=/tmp/x.pdf", "/info/x?path=/tmp/x.pdf"]) expect([below, (await request(below)).status]).toEqual([below, 404]);
  });
});

describe("what a path may be", () => {
  test("400 bad_request for a missing, empty, relative or NUL-holding path", async () => {
    const { request, get, info, home, put } = makeFiles();
    const good = put(join(home, "invoice.pdf"));
    await expectRefused(await request(""), 400, "bad_request", "missing");
    await expectRefused(await request("?other=1"), 400, "bad_request", "other");
    for (const path of ["", "invoice.pdf", "home/invoice.pdf", "~user/invoice.pdf", "~invoice.pdf", `${good}\u0000.pdf`, "\u0000"]) {
      await expectRefused(await get(path), 400, "bad_request", path);
      await expectRefused(await info(path), 400, "bad_request", path);
    }
  });

  test("a leading ~/ is the home folder", async () => {
    const { get, put, home } = makeFiles();
    put(join(home, "docs", "invoice.pdf"));
    const response = await get("~/docs/invoice.pdf");
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PDF);
    await expectRefused(await get("~"), 404, "file_not_found", "~ is a folder");
  });

  test("403 path_not_allowed outside the home folder and /tmp, whether the file is there or not", async () => {
    const { get, info, put, outside, scratch } = makeFiles();
    const there = put(join(outside, "invoice.pdf"));
    for (const path of [there, join(outside, "missing.pdf"), join(scratch, "invoice.pdf"), "/etc/passwd", "/etc/hostname", "/etc/nothing-here.zip", "/", "/home"]) {
      await expectRefused(await get(path), 403, "path_not_allowed", path);
      await expectRefused(await info(path), 403, "path_not_allowed", path);
    }
  });

  test("a folder whose name merely starts with the home folder's or /tmp's name is outside", async () => {
    const { get, put, home, tmp } = makeFiles();
    for (const path of [put(`${home}2/invoice.pdf`), put(`${tmp}-other/invoice.pdf`)]) await expectRefused(await get(path), 403, "path_not_allowed", path);
  });

  test("403 for a hidden part anywhere in the path, whether it exists or not, and never through `..`", async () => {
    const { get, info, put, home, tmp } = makeFiles();
    put(join(home, ".push", "vapid.json"), "{}");
    put(join(home, ".uploads", "shot.zip"), ZIP);
    put(join(home, ".ssh", "id_ed25519"), "secret");
    put(join(home, ".hidden.pdf"));
    put(join(tmp, ".x", "a.pdf"));
    put(join(home, "docs", "invoice.pdf"));
    for (const path of [
      join(home, ".push", "vapid.json"),
      join(home, ".uploads", "shot.zip"),
      join(home, ".ssh", "id_ed25519"),
      join(home, ".ssh", "missing"),
      join(home, ".hidden.pdf"),
      join(tmp, ".x", "a.pdf"),
      join(tmp, ".x", "missing.pdf"),
      "~/.ssh/id_ed25519",
      `${home}/docs/../.push/vapid.json`,
      `${home}/docs/../docs/invoice.pdf`,
      `${home}/./docs/invoice.pdf`,
      `${tmp}/../outside/invoice.pdf`,
    ]) {
      await expectRefused(await get(path), 403, "path_not_allowed", path);
      await expectRefused(await info(path), 403, "path_not_allowed", path);
    }
  });

  test("a link inside the allowed places is followed, and the download keeps the link's name", async () => {
    const { get, put, home, tmp } = makeFiles();
    const target = put(join(tmp, "made", "build-1234.zip"), ZIP);
    symlinkSync(target, join(home, "backup.zip"));
    symlinkSync(join(tmp, "made"), join(home, "made"));
    for (const [path, name] of [[join(home, "backup.zip"), "backup.zip"], [join(home, "made", "build-1234.zip"), "build-1234.zip"]]) {
      const response = await get(path);
      expect([path, response.status, response.headers.get("content-disposition")]).toEqual([path, 200, `attachment; filename="${name}"; filename*=UTF-8''${name}`]);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(ZIP);
    }
  });

  test("a visible link into a hidden folder, or out of the allowed places, is refused with 403", async () => {
    const { get, info, put, home, tmp, outside } = makeFiles();
    const secret = put(join(home, ".push", "vapid.json"), "{}");
    put(join(home, ".uploads", "shot.zip"), ZIP);
    const away = put(join(outside, "invoice.pdf"));
    symlinkSync(secret, join(home, "vapid.json"));
    symlinkSync(join(home, ".uploads"), join(home, "uploads"));
    symlinkSync(away, join(tmp, "away.pdf"));
    symlinkSync(outside, join(home, "outside"));
    symlinkSync(join(home, ".push"), join(tmp, "push"));
    symlinkSync("/etc/passwd", join(tmp, "passwd.txt"));
    for (const path of [join(home, "vapid.json"), join(home, "uploads", "shot.zip"), join(tmp, "away.pdf"), join(home, "outside", "invoice.pdf"), join(tmp, "push", "vapid.json"), join(tmp, "passwd.txt")]) {
      await expectRefused(await get(path), 403, "path_not_allowed", path);
      await expectRefused(await info(path), 403, "path_not_allowed", path);
    }
  });

  test("404 file_not_found for a missing file, a dangling link, a folder or a pipe, and a pipe never holds the server up", async () => {
    const { get, info, put, home, tmp } = makeFiles();
    put(join(home, "docs", "invoice.pdf"));
    symlinkSync(join(home, "gone.pdf"), join(home, "dangling.pdf"));
    const fifo = join(tmp, "pipe.pdf");
    expect(Bun.spawnSync(["mkfifo", fifo]).exitCode).toBe(0);
    for (const path of [join(home, "missing.pdf"), join(home, "docs", "invoice.pdf", "deeper.pdf"), join(home, "dangling.pdf"), join(home, "docs"), tmp, fifo]) {
      await expectRefused(await get(path), 404, "file_not_found", path);
      await expectRefused(await info(path), 404, "file_not_found", path);
    }
  });

  test("403 for a file the server may not read", async () => {
    const { get, info, put, home } = makeFiles();
    const path = put(join(home, "locked.pdf"));
    chmodSync(path, 0o000);
    await expectRefused(await get(path), 403, "path_not_allowed");
    await expectRefused(await info(path), 403, "path_not_allowed");
  });
});

describe("what is sent back", () => {
  test("a PDF comes back as its own bytes, as a download typed from its bytes, nosniff, private and never cached", async () => {
    const { get, put, home } = makeFiles();
    const response = await get(put(join(home, "docs", "invoice-november.pdf")));
    expect(response.status).toBe(200);
    expect(headersOf(response)).toEqual({
      "content-type": "application/pdf",
      "content-length": String(PDF.length),
      "content-disposition": `attachment; filename="invoice-november.pdf"; filename*=UTF-8''invoice-november.pdf`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    });
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PDF);
  });

  test("over a real connection the download keeps its Content-Length, so the phone can show its progress", async () => {
    const { app, put, home } = makeFiles();
    const path = put(join(home, "invoice.pdf"));
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app });
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/api/files?path=${encodeURIComponent(path)}`, { headers: { "Tailscale-User-Login": ALLOWED_LOGIN, [FILE_HEADER]: "1" } });
      expect([response.status, response.headers.get("content-length"), response.headers.get("transfer-encoding")]).toEqual([200, String(PDF.length), null]);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(PDF);
    } finally {
      server.stop(true);
    }
  });

  test("pictures are typed from their bytes; everything else, a zip included, is application/octet-stream", async () => {
    const { get, put, home } = makeFiles();
    const cases: [string, Bytes | string, string][] = [
      ["backup.zip", ZIP, "application/octet-stream"],
      ["shot.png", image.png(), "image/png"],
      ["photo.jpg", image.jpeg(), "image/jpeg"],
      ["anim.gif", image.gif(), "image/gif"],
      ["sticker.webp", image.webp(), "image/webp"],
      ["really-a-pdf.zip", PDF, "application/pdf"],
      ["fake.pdf", "this is not a PDF", "application/octet-stream"],
      ["page.html", "<!doctype html><script>alert(1)</script>", "application/octet-stream"],
      ["vector.svg", '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', "application/octet-stream"],
      ["photo.heic", image.heic("heic"), "application/octet-stream"],
      ["notes.txt", "plain words", "application/octet-stream"],
      ["empty.pdf", "", "application/octet-stream"],
    ];
    for (const [name, bytes, type] of cases) {
      const response = await get(put(join(home, name), bytes));
      expect([name, response.status, response.headers.get("content-type"), response.headers.get("x-content-type-options")]).toEqual([name, 200, type, "nosniff"]);
      const body = new Uint8Array(await response.arrayBuffer());
      expect([name, body]).toEqual([name, typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes]);
    }
  });

  test("a file of exactly 100 MB is sent whole; one byte more is 413 payload_too_large", async () => {
    const { get, put, home } = makeFiles();
    const fits = put(join(home, "fits.zip"), ZIP);
    truncateSync(fits, MAX_FILE_BYTES);
    const over = put(join(home, "over.zip"), ZIP);
    truncateSync(over, MAX_FILE_BYTES + 1);
    expect(MAX_FILE_BYTES).toBe(100 * 1024 * 1024);
    const response = await get(fits);
    expect([response.status, response.headers.get("content-length")]).toEqual([200, String(MAX_FILE_BYTES)]);
    expect((await response.arrayBuffer()).byteLength).toBe(MAX_FILE_BYTES);
    await expectRefused(await get(over), 413, "payload_too_large");
  });

  test("a hostile file name can't break the Content-Disposition header, and its full name survives in filename*", async () => {
    const { get, put, home } = makeFiles();
    const names = ['say "hi".pdf', "semi;colon=1.pdf", "line\r\nSet-Cookie: x=1.pdf", "tab\there.pdf", "résumé ✓.pdf", "100%25 sure.pdf", "it's (1)*.pdf", "日本語.zip"];
    for (const name of names) {
      const response = await get(put(join(home, name)));
      const disposition = response.headers.get("content-disposition") ?? "";
      expect([name, response.status]).toEqual([name, 200]);
      const match = /^attachment; filename="([^"]*)"; filename\*=UTF-8''([A-Za-z0-9%._~-]+)$/.exec(disposition);
      expect([name, match !== null]).toEqual([name, true]);
      expect(match?.[1]).toMatch(/^[\x20-\x7e]+$/);
      expect(match?.[1]).not.toMatch(/["\\%;]/);
      expect(decodeURIComponent(match?.[2] ?? "")).toBe(name);
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  });

  test("the quoted name replaces a backslash and quotes, and filename* keeps them", () => {
    expect(attachmentHeader("back\\slash \"q\".pdf")).toBe(`attachment; filename="back_slash _q_.pdf"; filename*=UTF-8''back%5Cslash%20%22q%22.pdf`);
  });

  test("errors are JSON, never cached", async () => {
    const { get, home } = makeFiles();
    const response = await get(join(home, "missing.pdf"));
    expect([response.headers.get("content-type"), response.headers.get("cache-control")]).toEqual(["application/json;charset=utf-8", "no-store"]);
  });

  test("nothing is ever written: files, folders, modes and times are as they were", async () => {
    const { get, info, put, home, tmp, scratch, listing } = makeFiles();
    const path = put(join(home, "docs", "invoice.pdf"));
    put(join(home, ".push", "vapid.json"), "{}");
    put(join(tmp, "backup.zip"), ZIP);
    const before = listing();
    const stamp = statSync(path).mtimeMs;
    for (const target of [path, join(home, ".push", "vapid.json"), join(tmp, "backup.zip"), join(home, "new.pdf"), join(scratch, "outside", "x.pdf")]) {
      await (await get(target)).arrayBuffer();
      await info(target);
    }
    expect(listing()).toEqual(before);
    expect(statSync(path).mtimeMs).toBe(stamp);
  });
});

describe("the info lookup", () => {
  test("gives the name, size, changed time and the type the download would have", async () => {
    const { info, put, home, tmp } = makeFiles();
    const pdf = put(join(home, "docs", "invoice-november.pdf"));
    const zip = put(join(tmp, "photos-backup.zip"), ZIP);
    for (const [path, name, size, kind] of [[pdf, "invoice-november.pdf", PDF.length, "application/pdf"], [zip, "photos-backup.zip", ZIP.length, "application/octet-stream"]] as const) {
      const response = await info(path);
      expect([response.status, response.headers.get("cache-control")]).toEqual([200, "no-store"]);
      expect(await response.json()).toEqual({ name, size, modified: Math.floor(statSync(path).mtimeMs), kind });
    }
  });

  test("a file over 100 MB still gets its info, so the sheet can say it is too big", async () => {
    const { info, put, home } = makeFiles();
    const over = put(join(home, "over.zip"), ZIP);
    truncateSync(over, MAX_FILE_BYTES + 1);
    const response = await info(over);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { size: number }).size).toBe(MAX_FILE_BYTES + 1);
  });

  test("a link's info carries the link's name", async () => {
    const { info, put, home, tmp } = makeFiles();
    symlinkSync(put(join(tmp, "made", "build-1234.pdf")), join(home, "report.pdf"));
    expect(((await (await info(join(home, "report.pdf"))).json()) as { name: string }).name).toBe("report.pdf");
  });
});

describe("the real /tmp", () => {
  test("by default /tmp is allowed, and a hidden folder in it is not", async () => {
    const dir = mkdtempSync("/tmp/files-real-");
    folders.push(dir);
    const { get } = serve(createFiles());
    writeFileSync(join(dir, "invoice.pdf"), PDF);
    mkdirSync(join(dir, ".hid"));
    writeFileSync(join(dir, ".hid", "x.pdf"), PDF);
    const response = await get(join(dir, "invoice.pdf"));
    expect([response.status, response.headers.get("content-type")]).toEqual([200, "application/pdf"]);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PDF);
    await expectRefused(await get(join(dir, ".hid", "x.pdf")), 403, "path_not_allowed");
  });
});
