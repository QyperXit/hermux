import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../server/app";
import { createHerdr } from "../../server/herdr";
import { createUploads } from "../../server/uploads";
import { UPLOAD_HEADER } from "../../web/upload-header.js";
import { WEB } from "./agents";
import { ALLOWED_LOGIN } from "./http";

const folders: string[] = [];
export const removeUploadFolders = () => folders.splice(0).forEach((folder) => rmSync(folder, { recursive: true, force: true }));

export type Bytes = Uint8Array<ArrayBuffer>;

const bytesOf = (head: number[], size: number): Bytes => Uint8Array.from({ length: size }, (_, index) => head[index] ?? index % 251);
const text = (value: string) => [...value].map((char) => char.charCodeAt(0));

// The first bytes each kind of image starts with, padded to `size` bytes.
export const image = {
  png: (size = 64) => bytesOf([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], size),
  jpeg: (size = 64) => bytesOf([0xff, 0xd8, 0xff, 0xe0], size),
  gif: (size = 64) => bytesOf(text("GIF89a"), size),
  webp: (size = 64) => bytesOf([...text("RIFF"), 0, 0, 0, 0, ...text("WEBP")], size),
  heic: (major = "heic", compatible: string[] = []) => {
    const brands = compatible.map(text).flat();
    const head = [0, 0, 0, 16 + brands.length, ...text("ftyp"), ...text(major), 0, 0, 0, 0, ...brands];
    return bytesOf(head, 64);
  },
};

export const NOT_IMAGES: [name: string, bytes: Bytes][] = [
  ["plain text", new TextEncoder().encode("hello, this is not an image")],
  ["an SVG", new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
  ["HTML", new TextEncoder().encode("<!doctype html><title>x</title>")],
  ["a PDF", new TextEncoder().encode("%PDF-1.7\n")],
  ["a shell script", new TextEncoder().encode("#!/bin/sh\nrm -rf ~\n")],
  ["a video's ftyp box", image.heic("isom", ["mp41"])],
  ["a video that lists heic only as a compatible brand", image.heic("isom", ["heic"])],
  ["an AVIF", image.heic("avif", ["mif1"])],
  ["a HEIF container with no HEIC brand", image.heic("mif1", ["mp41"])],
  ["a PNG's head cut short", image.png(7)],
  ["nothing at all", new Uint8Array(0)],
];

export type UploadOptions = { login?: string | null; headers?: Record<string, string>; appHeader?: boolean };

export function makeUploads({ at = Date.now() }: { at?: number } = {}) {
  const parent = mkdtempSync(join(tmpdir(), "uploads-test-"));
  folders.push(parent);
  const dir = join(parent, ".uploads");
  let clock = at;
  const schedules: { run: () => void; ms: number; stopped: boolean }[] = [];
  const uploads = createUploads({
    dir,
    now: () => clock,
    schedule: (run, ms) => {
      const entry = { run, ms, stopped: false };
      schedules.push(entry);
      return () => void (entry.stopped = true);
    },
  });
  const app = createApp({ herdr: createHerdr("/nonexistent/herdr"), allowedLogin: ALLOWED_LOGIN, webRoot: WEB, uploads });
  const send = (method: string, body: BodyInit | null, headers: Record<string, string>, { login = ALLOWED_LOGIN, headers: extra = {}, appHeader = true }: UploadOptions = {}) => {
    const all = new Headers(headers);
    if (appHeader) all.set(UPLOAD_HEADER, "1");
    if (login !== null) all.set("Tailscale-User-Login", login);
    for (const [name, value] of Object.entries(extra)) all.set(name, value);
    return app(new Request("http://127.0.0.1:8787/api/uploads", { method, headers: all, body }));
  };
  const form = (bytes: Bytes, { filename = "screenshot.png", type = "image/png", field = "image" }: { filename?: string; type?: string; field?: string } = {}) => {
    const body = new FormData();
    body.append(field, new File([bytes], filename, { type }), filename);
    return body;
  };
  return {
    dir,
    parent,
    uploads,
    app,
    schedules,
    setClock: (ms: number) => (clock = ms),
    clock: () => clock,
    send,
    multipart: (bytes: Bytes, options: Parameters<typeof form>[1] & UploadOptions = {}) => send("POST", form(bytes, options), {}, options),
    raw: (bytes: Bytes, type: string, options: UploadOptions = {}) => send("POST", bytes, { "content-type": type }, options),
    form,
  };
}
