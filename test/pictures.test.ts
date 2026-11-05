import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app";
import { createHerdr } from "../server/herdr";
import { MAX_PICTURE_BYTES, createPictures, type Pictures } from "../server/pictures";
import { WEB } from "./support/agents";
import { ALLOWED_LOGIN } from "./support/http";
import { image, type Bytes } from "./support/uploads";

const folders: string[] = [];
afterAll(() => folders.splice(0).forEach((folder) => rmSync(folder, { recursive: true, force: true })));

type Options = { login?: string | null; site?: string; method?: string };
const errorCode = async (response: Response) => ((await response.json()) as { error: { code: string } }).error.code;

function serve(pictures: Pictures) {
  const app = createApp({ herdr: createHerdr("/nonexistent/herdr"), allowedLogin: ALLOWED_LOGIN, webRoot: WEB, pictures });
  const request = (query: string, { login = ALLOWED_LOGIN, site, method = "GET" }: Options = {}) => {
    const headers = new Headers();
    if (login !== null) headers.set("Tailscale-User-Login", login);
    if (site !== undefined) headers.set("sec-fetch-site", site);
    return app(new Request(`http://127.0.0.1:8787/api/pictures${query}`, { method, headers }));
  };
  return { app, request, get: (path: string, options?: Options) => request(`?path=${encodeURIComponent(path)}`, options) };
}

function makePictures() {
  const scratch = mkdtempSync(join(tmpdir(), "pictures-test-"));
  folders.push(scratch);
  const home = join(scratch, "home");
  const tmp = join(scratch, "tmp");
  const outside = join(scratch, "outside");
  for (const dir of [home, tmp, outside]) mkdirSync(dir);
  const served = serve(createPictures({ home, tmp }));
  const put = (path: string, bytes: Bytes | string = image.png()) => {
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

describe("who may look", () => {
  test("403 without the login or with another one", async () => {
    const { get, put, home } = makePictures();
    const path = put(join(home, "sketch.png"));
    for (const login of [null, "other@example.com", ""]) expect([login, (await get(path, { login })).status]).toEqual([login, 403]);
  });

  test("403 cross_site_request from another site, even for a real picture", async () => {
    const { get, put, home } = makePictures();
    const path = put(join(home, "sketch.png"));
    for (const site of ["cross-site", "same-site"]) await expectRefused(await get(path, { site }), 403, "cross_site_request", site);
  });

  test("this page's own requests (same-origin, none, or no header) are answered", async () => {
    const { get, put, home } = makePictures();
    const path = put(join(home, "sketch.png"));
    for (const site of ["same-origin", "none", undefined]) expect([site, (await get(path, { site })).status]).toEqual([site, 200]);
  });

  test("only GET: other methods are 405 and nothing is written", async () => {
    const { get, put, home, listing } = makePictures();
    const path = put(join(home, "sketch.png"));
    const before = listing();
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) await expectRefused(await get(path, { method }), 405, "method_not_allowed", method);
    expect(listing()).toEqual(before);
  });

  test("without the pictures module the route is unknown, and so is anything below it", async () => {
    const { request } = makePictures();
    const bare = createApp({ herdr: createHerdr("/nonexistent/herdr"), allowedLogin: ALLOWED_LOGIN, webRoot: WEB });
    const response = await bare(new Request("http://127.0.0.1:8787/api/pictures?path=/tmp/x.png", { headers: { "Tailscale-User-Login": ALLOWED_LOGIN } }));
    expect(response.status).toBe(404);
    expect((await request("/x.png?path=/tmp/x.png")).status).toBe(404);
  });
});

describe("what a path may be", () => {
  test("400 bad_request for a missing, empty, relative or NUL-holding path", async () => {
    const { request, get, home, put } = makePictures();
    const good = put(join(home, "sketch.png"));
    await expectRefused(await request(""), 400, "bad_request", "missing");
    await expectRefused(await request("?other=1"), 400, "bad_request", "other");
    for (const path of ["", "sketch.png", "home/sketch.png", "~user/sketch.png", "~sketch.png", `${good}\u0000.png`, "\u0000"]) {
      await expectRefused(await get(path), 400, "bad_request", path);
    }
  });

  test("a leading ~ or ~/ is the home folder", async () => {
    const { get, put, home } = makePictures();
    const bytes = image.png(80);
    put(join(home, "art", "sketch.png"), bytes);
    const response = await get("~/art/sketch.png");
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    await expectRefused(await get("~"), 404, "picture_not_found", "~ is a folder");
  });

  test("403 path_not_allowed outside the home folder and /tmp, whether the file is there or not", async () => {
    const { get, put, outside, scratch } = makePictures();
    const there = put(join(outside, "sketch.png"));
    for (const path of [there, join(outside, "missing.png"), join(scratch, "sketch.png"), "/etc/passwd", "/etc/nothing-here.png", "/", "/home"]) {
      await expectRefused(await get(path), 403, "path_not_allowed", path);
    }
  });

  test("a folder whose name merely starts with the home folder's or /tmp's name is outside", async () => {
    const { get, put, home, tmp } = makePictures();
    for (const path of [put(`${home}2/sketch.png`), put(`${tmp}-other/sketch.png`)]) await expectRefused(await get(path), 403, "path_not_allowed", path);
  });

  test("a home folder that is itself a link works by either name", async () => {
    const { scratch, put } = makePictures();
    const realHome = join(scratch, "var-home");
    const linkedHome = join(scratch, "linked-home");
    mkdirSync(realHome);
    symlinkSync(realHome, linkedHome);
    const { get } = serve(createPictures({ home: linkedHome, tmp: join(scratch, "tmp") }));
    put(join(realHome, "sketch.png"));
    for (const path of [join(linkedHome, "sketch.png"), join(realHome, "sketch.png"), "~/sketch.png"]) expect([path, (await get(path)).status]).toEqual([path, 200]);
    for (const path of [join(linkedHome, "missing.png"), join(realHome, "missing.png")]) await expectRefused(await get(path), 404, "picture_not_found", path);
  });

  test("403 for a hidden part anywhere in the path, whether it exists or not, and never through `..`", async () => {
    const { get, put, home, tmp } = makePictures();
    put(join(home, ".push", "sketch.png"));
    put(join(home, ".uploads", "shot.png"));
    put(join(home, ".hidden.png"));
    put(join(tmp, ".x", "a.png"));
    put(join(home, "art", "sketch.png"));
    for (const path of [
      join(home, ".push", "sketch.png"),
      join(home, ".uploads", "shot.png"),
      join(home, ".ssh", "missing.png"),
      join(home, ".hidden.png"),
      join(tmp, ".x", "a.png"),
      join(tmp, ".x", "missing.png"),
      "~/.push/sketch.png",
      `${home}/art/../.push/sketch.png`,
      `${home}/art/../art/sketch.png`,
      `${home}/./art/sketch.png`,
    ]) {
      await expectRefused(await get(path), 403, "path_not_allowed", path);
    }
  });

  test("a link inside the allowed places is followed", async () => {
    const { get, put, home, tmp } = makePictures();
    const bytes = image.gif(90);
    const target = put(join(tmp, "made", "sketch.gif"), bytes);
    symlinkSync(target, join(home, "sketch.gif"));
    symlinkSync(join(tmp, "made"), join(home, "made"));
    for (const path of [join(home, "sketch.gif"), join(home, "made", "sketch.gif")]) {
      const response = await get(path);
      expect([path, response.status, response.headers.get("content-type")]).toEqual([path, 200, "image/gif"]);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    }
  });

  test("a visible link into a hidden folder, or out of the allowed places, is refused with 403", async () => {
    const { get, put, home, tmp, outside } = makePictures();
    const secret = put(join(home, ".push", "keys.png"));
    put(join(home, ".uploads", "shot.png"));
    const away = put(join(outside, "sketch.png"));
    symlinkSync(secret, join(home, "keys.png"));
    symlinkSync(join(home, ".uploads"), join(home, "uploads"));
    symlinkSync(away, join(tmp, "away.png"));
    symlinkSync(outside, join(home, "outside"));
    symlinkSync(join(home, ".push"), join(tmp, "push"));
    for (const path of [join(home, "keys.png"), join(home, "uploads", "shot.png"), join(tmp, "away.png"), join(home, "outside", "sketch.png"), join(tmp, "push", "keys.png")]) {
      await expectRefused(await get(path), 403, "path_not_allowed", path);
    }
  });

  test("404 picture_not_found for a missing file, a dangling link, a folder or a pipe", async () => {
    const { get, put, home, tmp } = makePictures();
    put(join(home, "art", "sketch.png"));
    symlinkSync(join(home, "gone.png"), join(home, "dangling.png"));
    const fifo = join(tmp, "pipe.png");
    expect(Bun.spawnSync(["mkfifo", fifo]).exitCode).toBe(0);
    for (const path of [join(home, "missing.png"), join(home, "art", "sketch.png", "deeper.png"), join(home, "dangling.png"), join(home, "art"), tmp, fifo]) {
      await expectRefused(await get(path), 404, "picture_not_found", path);
    }
  });

  test("403 for a picture the server may not read", async () => {
    const { get, put, home } = makePictures();
    const path = put(join(home, "locked.png"));
    chmodSync(path, 0o000);
    await expectRefused(await get(path), 403, "path_not_allowed");
  });
});

describe("what is sent back", () => {
  const KINDS: [string, Bytes, string][] = [
    ["PNG", image.png(), "image/png"],
    ["JPEG", image.jpeg(), "image/jpeg"],
    ["GIF", image.gif(), "image/gif"],
    ["WebP", image.webp(), "image/webp"],
  ];

  for (const [name, bytes, type] of KINDS) {
    test(`a ${name} comes back as its own bytes with its own type, private and never cached`, async () => {
      const { get, put, home, tmp } = makePictures();
      for (const path of [put(join(home, "art", `sketch.${name.toLowerCase()}`), bytes), put(join(tmp, "picture.bin"), bytes)]) {
        const response = await get(path);
        expect([path, response.status]).toEqual([path, 200]);
        expect(Object.fromEntries(["content-type", "x-content-type-options", "cache-control", "content-length"].map((header) => [header, response.headers.get(header)]))).toEqual({
          "content-type": type,
          "x-content-type-options": "nosniff",
          "cache-control": "private, no-store",
          "content-length": String(bytes.length),
        });
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
      }
    });
  }

  test("the type comes from the bytes, never the name", async () => {
    const { get, put, home } = makePictures();
    const response = await get(put(join(home, "really-a-png.jpg"), image.png()));
    expect([response.status, response.headers.get("content-type")]).toEqual([200, "image/png"]);
  });

  test("415 unsupported_media_type for anything that isn't a PNG, JPEG, WebP or GIF by its bytes, HEIC included", async () => {
    const { get, put, home } = makePictures();
    const cases: [string, Bytes | string][] = [
      ["text.png", "hello, this is not a picture"],
      ["page.png", "<!doctype html><script>alert(1)</script>"],
      ["vector.svg", '<svg xmlns="http://www.w3.org/2000/svg"></svg>'],
      ["photo.heic", image.heic("heic")],
      ["photo.png", image.heic("mif1", ["miaf", "heic"])],
      ["short.png", image.png(7)],
      ["empty.png", ""],
    ];
    for (const [name, bytes] of cases) await expectRefused(await get(put(join(home, name), bytes)), 415, "unsupported_media_type", name);
  });

  test("a picture of exactly 25 MB is sent; one byte more is 413 payload_too_large", async () => {
    const { get, put, home } = makePictures();
    const fits = put(join(home, "fits.png"));
    truncateSync(fits, MAX_PICTURE_BYTES);
    const over = put(join(home, "over.png"));
    truncateSync(over, MAX_PICTURE_BYTES + 1);
    expect(MAX_PICTURE_BYTES).toBe(25 * 1024 * 1024);
    const response = await get(fits);
    expect([response.status, response.headers.get("content-length")]).toEqual([200, String(MAX_PICTURE_BYTES)]);
    expect((await response.arrayBuffer()).byteLength).toBe(MAX_PICTURE_BYTES);
    await expectRefused(await get(over), 413, "payload_too_large");
  });

  test("errors are JSON, never cached", async () => {
    const { get, home } = makePictures();
    const response = await get(join(home, "missing.png"));
    expect([response.headers.get("content-type"), response.headers.get("cache-control")]).toEqual(["application/json;charset=utf-8", "no-store"]);
  });

  test("nothing is ever written: files, folders, modes and times are as they were", async () => {
    const { get, put, home, tmp, scratch, listing } = makePictures();
    const path = put(join(home, "art", "sketch.png"));
    put(join(home, ".push", "keys.png"));
    put(join(tmp, "text.png"), "not a picture");
    const before = listing();
    const stamp = statSync(path).mtimeMs;
    for (const target of [path, join(home, ".push", "keys.png"), join(tmp, "text.png"), join(home, "new.png"), join(scratch, "outside", "x.png")]) await get(target);
    expect(listing()).toEqual(before);
    expect(statSync(path).mtimeMs).toBe(stamp);
  });
});

describe("the real /tmp", () => {
  test("by default /tmp is allowed, and a hidden folder in it is not", async () => {
    const dir = mkdtempSync("/tmp/pictures-real-");
    folders.push(dir);
    const { get } = serve(createPictures());
    const bytes = image.webp(70);
    writeFileSync(join(dir, "sketch.webp"), bytes);
    mkdirSync(join(dir, ".hid"));
    writeFileSync(join(dir, ".hid", "x.png"), image.png());
    const response = await get(join(dir, "sketch.webp"));
    expect([response.status, response.headers.get("content-type")]).toEqual([200, "image/webp"]);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    await expectRefused(await get(join(dir, ".hid", "x.png")), 403, "path_not_allowed");
  });
});
