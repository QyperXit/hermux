import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, lutimesSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { KEEP_MS, MAX_UPLOAD_BYTES, SWEEP_EVERY_MS, createUploads } from "../server/uploads";
import { NOT_IMAGES, image, type Bytes, makeUploads, removeUploadFolders } from "./support/uploads";

afterAll(removeUploadFolders);

const ROOT = resolve(import.meta.dir, "..");
const mode = (path: string) => statSync(path).mode & 0o777;
const NAME = /^\d{8}T\d{6}Z-[0-9a-f]{16}\.(png|jpg|webp|gif|heic)$/;
const errorCode = async (response: Response) => ((await response.json()) as { error: { code: string } }).error.code;

describe("who may upload", () => {
  test("403 without the login or with another one, and nothing is saved", async () => {
    const { multipart, dir } = makeUploads();
    for (const login of [null, "other@example.com", ""]) {
      const response = await multipart(image.png(), { login });
      expect([login, response.status]).toEqual([login, 403]);
    }
    expect(readdirSync(dir)).toEqual([]);
  });

  test("403 from another site, whatever the image is, and nothing is saved", async () => {
    const { multipart, raw, dir } = makeUploads();
    for (const site of ["cross-site", "same-site"]) {
      const withForm = await multipart(image.png(), { headers: { "sec-fetch-site": site } });
      const asRaw = await raw(image.png(), "image/png", { headers: { "sec-fetch-site": site } });
      expect([site, withForm.status, await errorCode(withForm), asRaw.status]).toEqual([site, 403, "cross_site_request", 403]);
    }
    expect(readdirSync(dir)).toEqual([]);
  });

  test("403 without the app's own upload header, even with no Sec-Fetch-Site, and nothing is saved", async () => {
    const { multipart, raw, dir } = makeUploads();
    const withForm = await multipart(image.png(), { appHeader: false });
    const asRaw = await raw(image.png(), "image/png", { appHeader: false });
    expect([withForm.status, await errorCode(withForm), asRaw.status]).toEqual([403, "cross_site_request", 403]);
    expect(readdirSync(dir)).toEqual([]);
  });

  test("this page's own requests (same-origin, or none) are let through", async () => {
    const { multipart } = makeUploads();
    for (const site of ["same-origin", "none", undefined]) {
      const response = await multipart(image.png(), { headers: site ? { "sec-fetch-site": site } : {} });
      expect([site, response.status]).toEqual([site, 200]);
    }
  });

  test("only POST uploads, and without the uploads module the route is unknown", async () => {
    const { send } = makeUploads();
    for (const method of ["GET", "PUT", "DELETE"]) expect([method, (await send(method, null, {})).status]).toEqual([method, 405]);
    const { createApp } = await import("../server/app");
    const { createHerdr } = await import("../server/herdr");
    const bare = createApp({ herdr: createHerdr("/nonexistent/herdr"), allowedLogin: "you@example.com", webRoot: "/nonexistent" });
    const response = await bare(new Request("http://127.0.0.1:8787/api/uploads", { method: "POST", headers: { "Tailscale-User-Login": "you@example.com", "content-type": "image/png" }, body: image.png() }));
    expect(response.status).toBe(404);
  });
});

describe("what the body may be", () => {
  test("JSON, text, a urlencoded form or no type at all is refused with 415, and nothing is saved", async () => {
    const { send, dir } = makeUploads();
    const body = JSON.stringify({ image: "data:image/png;base64,iVBORw0KGgo=" });
    const noType: Record<string, string> = {};
    for (const headers of [{ "content-type": "application/json" }, { "content-type": "text/plain" }, { "content-type": "application/x-www-form-urlencoded" }, noType]) {
      const response = await send("POST", body, headers);
      expect([headers, response.status, await errorCode(response)]).toEqual([headers, 415, "unsupported_media_type"]);
    }
    expect(readdirSync(dir)).toEqual([]);
  });

  test("a form with no image, or with several, is a bad request", async () => {
    const { send, form, dir } = makeUploads();
    expect((await send("POST", form(image.png(), { field: "file" }), {})).status).toBe(400);
    const several = form(image.png());
    several.append("image", new File([image.png()], "second.png", { type: "image/png" }));
    expect((await send("POST", several, {})).status).toBe(400);
    const textField = new FormData();
    textField.append("image", "just words");
    expect((await send("POST", textField, {})).status).toBe(400);
    expect((await send("POST", "not a multipart body", { "content-type": "multipart/form-data; boundary=x" })).status).toBe(400);
    expect(readdirSync(dir)).toEqual([]);
  });

  for (const [name, bytes] of NOT_IMAGES) {
    test(`${name} is refused with 415 by its bytes, even when it says it is a PNG`, async () => {
      const { multipart, raw, dir } = makeUploads();
      const asForm = await multipart(bytes, { filename: "holiday.png", type: "image/png" });
      const asRaw = await raw(bytes, "image/png");
      expect([asForm.status, await errorCode(asForm), asRaw.status, await errorCode(asRaw)]).toEqual([415, "unsupported_media_type", 415, "unsupported_media_type"]);
      expect(readdirSync(dir)).toEqual([]);
    });
  }

  test("an image sent as another image type is refused: the bytes and the declared type must agree", async () => {
    const { raw, dir } = makeUploads();
    expect((await raw(image.png(), "image/jpeg")).status).toBe(415);
    expect((await raw(image.jpeg(), "image/png")).status).toBe(415);
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe("how big it may be", () => {
  test("an image of exactly the limit is saved, and one byte more is refused with 413 and not saved", async () => {
    const { multipart, raw, dir } = makeUploads();
    expect((await multipart(image.png(MAX_UPLOAD_BYTES))).status).toBe(200);
    expect(readdirSync(dir)).toHaveLength(1);
    for (const response of [await multipart(image.png(MAX_UPLOAD_BYTES + 1)), await raw(image.png(MAX_UPLOAD_BYTES + 1), "image/png")]) {
      expect([response.status, await errorCode(response)]).toEqual([413, "payload_too_large"]);
    }
    expect(readdirSync(dir)).toHaveLength(1);
  });

  test("a body that says it is huge is refused before it is read", async () => {
    const { send, dir } = makeUploads();
    const response = await send("POST", image.png(), { "content-type": "image/png", "content-length": String(MAX_UPLOAD_BYTES * 4) });
    expect(response.status).toBe(413);
    expect(readdirSync(dir)).toEqual([]);
  });

  test("a body that doesn't say its size is cut off when it passes the limit", async () => {
    const { send, dir } = makeUploads();
    const chunk = image.png(1024 * 1024);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent++ >= 40) return controller.close();
        controller.enqueue(chunk);
      },
    });
    const response = await send("POST", body, { "content-type": "image/png" });
    expect(response.status).toBe(413);
    expect(sent).toBeLessThan(40);
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe("a good image", () => {
  const KINDS: [string, Bytes, string, string][] = [
    ["PNG", image.png(), "image/png", "png"],
    ["JPEG", image.jpeg(), "image/jpeg", "jpg"],
    ["GIF", image.gif(), "image/gif", "gif"],
    ["WebP", image.webp(), "image/webp", "webp"],
    ["HEIC", image.heic("heic"), "image/heic", "heic"],
    ["HEIC in a mif1 container", image.heic("mif1", ["miaf", "heic"]), "image/heic", "heic"],
  ];

  for (const [name, bytes, type, extension] of KINDS) {
    test(`${name}: saved as its own bytes under a server-chosen .${extension} name, for the user alone, whichever way it is sent`, async () => {
      const { multipart, raw, dir } = makeUploads();
      for (const response of [await multipart(bytes, { type: "application/octet-stream", filename: "whatever" }), await raw(bytes, type)]) {
        expect(response.status).toBe(200);
        const saved = (await response.json()) as { path: string; name: string; size: number };
        expect(saved.name).toMatch(NAME);
        expect(saved.name.endsWith(`.${extension}`)).toBe(true);
        expect([saved.path, saved.size]).toEqual([join(dir, saved.name), bytes.length]);
        expect(new Uint8Array(readFileSync(saved.path))).toEqual(bytes);
        expect(mode(saved.path)).toBe(0o600);
      }
      expect(mode(dir)).toBe(0o700);
      expect(readdirSync(dir)).toHaveLength(2);
    });
  }

  test("the name is the clock's time and a random part, so the same image twice is two files", async () => {
    const { multipart, dir } = makeUploads({ at: Date.UTC(2026, 10, 5, 9, 30, 15, 123) });
    const names = [];
    for (let upload = 0; upload < 3; upload++) names.push(((await (await multipart(image.png())).json()) as { name: string }).name);
    expect(names.every((name) => name.startsWith("20261105T093015Z-"))).toBe(true);
    expect(new Set(names).size).toBe(3);
    expect(readdirSync(dir).sort()).toEqual([...names].sort());
  });

  test("the path is absolute", async () => {
    const { multipart } = makeUploads();
    const saved = (await (await multipart(image.png())).json()) as { path: string };
    expect(saved.path.startsWith("/")).toBe(true);
  });

  test("a filename that tries to climb out, or to name a place, is ignored: the file lands in the folder under the server's name", async () => {
    const { multipart, dir, parent } = makeUploads();
    const hostile = ["../../escape.png", "/etc/cron.d/job.png", "..\\..\\escape.png", "x.png\u0000.sh", "../.uploads/../escape.png", "<img src=x onerror=alert(1)>.png"];
    for (const filename of hostile) {
      const response = await multipart(image.png(), { filename });
      const saved = (await response.json()) as { path: string; name: string };
      expect([filename, response.status, saved.path.startsWith(`${dir}/`), saved.name]).toEqual([filename, 200, true, expect.stringMatching(NAME)]);
      expect(saved.path).not.toContain("escape");
    }
    expect(readdirSync(dir)).toHaveLength(hostile.length);
    expect(readdirSync(parent)).toEqual([".uploads"]);
  });

  test("a folder left open to others is closed again on the next start", () => {
    const { dir } = makeUploads();
    chmodSync(dir, 0o755);
    createUploads({ dir });
    expect(mode(dir)).toBe(0o700);
  });
});

describe("clearing old uploads", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const age = (path: string, clock: number, olderThanMs: number) => utimesSync(path, (clock - olderThanMs) / 1000, (clock - olderThanMs) / 1000);

  async function saveOne(made: ReturnType<typeof makeUploads>) {
    return ((await (await made.multipart(image.png())).json()) as { path: string }).path;
  }

  test("a file older than seven days goes, one a little younger stays", async () => {
    const made = makeUploads();
    const [old, edge, fresh] = [await saveOne(made), await saveOne(made), await saveOne(made)];
    age(old, made.clock(), KEEP_MS + 1_000);
    age(edge, made.clock(), KEEP_MS - 1_000);
    expect(made.uploads.sweep()).toBe(1);
    expect([existsSync(old), existsSync(edge), existsSync(fresh)]).toEqual([false, true, true]);
  });

  test("the injected clock decides: the same files are old once the clock has moved on", async () => {
    const made = makeUploads();
    const path = await saveOne(made);
    expect(made.uploads.sweep()).toBe(0);
    made.setClock(made.clock() + KEEP_MS - 1_000);
    expect(made.uploads.sweep()).toBe(0);
    made.setClock(made.clock() + 2_000);
    expect(made.uploads.sweep()).toBe(1);
    expect(existsSync(path)).toBe(false);
  });

  test("only files the server named are ever deleted: other files, folders and links in the folder are left alone", async () => {
    const made = makeUploads();
    const keep = ["notes.txt", "20261105T093015Z-ABCDEF0123456789.png", "20261105T093015Z-0123456789abcdef.exe", "photo.png"].map((name) => join(made.dir, name));
    for (const path of keep) {
      writeFileSync(path, "mine");
      age(path, made.clock(), 30 * DAY);
    }
    const subfolder = join(made.dir, "20261105T093015Z-0123456789abcdef.png");
    mkdirSync(subfolder);
    age(subfolder, made.clock(), 30 * DAY);
    const target = join(made.parent, "outside.txt");
    writeFileSync(target, "outside");
    const link = join(made.dir, "20261105T093015Z-fedcba9876543210.png");
    symlinkSync(target, link);
    lutimesSync(link, (made.clock() - 30 * DAY) / 1000, (made.clock() - 30 * DAY) / 1000);
    expect(made.uploads.sweep()).toBe(0);
    expect([...keep, subfolder, link, target].map(existsSync)).toEqual(new Array(keep.length + 3).fill(true));
  });

  test("on start it clears what is already old, and then again every day, until stopped", async () => {
    const made = makeUploads();
    const old = await saveOne(made);
    age(old, made.clock(), 8 * DAY);
    const stop = made.uploads.tidyDaily();
    expect(existsSync(old)).toBe(false);
    expect(made.schedules.map((entry) => entry.ms)).toEqual([SWEEP_EVERY_MS]);
    expect(SWEEP_EVERY_MS).toBe(DAY);
    const later = await saveOne(made);
    made.setClock(made.clock() + 8 * DAY);
    made.schedules[0].run();
    expect(existsSync(later)).toBe(false);
    expect(made.schedules[0].stopped).toBe(false);
    stop();
    expect(made.schedules[0].stopped).toBe(true);
  });

  test("a folder that has gone missing is not an error", () => {
    const made = makeUploads();
    rmSync(made.dir, { recursive: true, force: true });
    expect(made.uploads.sweep()).toBe(0);
  });
});

describe("keeping them out of git", () => {
  test(".gitignore lists the uploads folder, so no upload can be committed", () => {
    expect(readFileSync(join(ROOT, ".gitignore"), "utf8").split("\n")).toContain(".uploads/");
  });

  test("git itself ignores an upload in the default place", () => {
    const check = Bun.spawnSync(["git", "check-ignore", ".uploads/20261105T093015Z-0123456789abcdef.png"], { cwd: ROOT });
    // Where git or its repository isn't there (a plain copy of the files), there is nothing to ask.
    if (check.exitCode === 128) return;
    expect(check.stdout.toString().trim()).toBe(".uploads/20261105T093015Z-0123456789abcdef.png");
  });

  test("the server's default folder is .uploads at the repo root, which is that ignored one", () => {
    const main = readFileSync(join(ROOT, "server/main.ts"), "utf8");
    expect(main).toContain('process.env.AGENTS_UPLOADS_DIR || resolve(import.meta.dir, "../.uploads")');
  });

  test("making uploads anywhere else leaves the repo's own .uploads untouched", async () => {
    const before = existsSync(join(ROOT, ".uploads"));
    await makeUploads().multipart(image.png());
    expect(existsSync(join(ROOT, ".uploads"))).toBe(before);
  });
});
