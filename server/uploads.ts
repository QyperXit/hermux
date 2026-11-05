// Images the phone attaches to a message. They are saved in a folder of their
// own (`.uploads/` in the repo, git-ignored, never in the public copy), readable
// by the user only, under names the server picks, and cleared after a week.
// Nothing here serves them back, and their contents are never logged.
import { chmodSync, lstatSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { HerdrError } from "./herdr";

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const MAX_BODY_BYTES = MAX_UPLOAD_BYTES + 64 * 1024;
export const KEEP_MS = 7 * 24 * 60 * 60 * 1000;
export const SWEEP_EVERY_MS = 24 * 60 * 60 * 1000;

export type Saved = { path: string; name: string; size: number };
type Kind = { extension: string; type: string };

const RAW_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/heic", "image/heif"]);
const SAVED_NAME = /^\d{8}T\d{6}Z-[0-9a-f]{16}\.(png|jpg|webp|gif|heic)$/;
const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis"]);
const HEIC_ONLY_IF_LISTED = new Set(["mif1", "msf1"]);

const ascii = (bytes: Uint8Array, from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
const startsWith = (bytes: Uint8Array, head: number[]) => head.every((byte, index) => bytes[index] === byte);

function isHeic(bytes: Uint8Array) {
  if (bytes.length < 16 || ascii(bytes, 4, 8) !== "ftyp") return false;
  const boxEnd = Math.min(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0), bytes.length, 64);
  const major = ascii(bytes, 8, 12);
  if (HEIC_BRANDS.has(major)) return true;
  if (!HEIC_ONLY_IF_LISTED.has(major)) return false;
  for (let at = 16; at + 4 <= boxEnd; at += 4) if (HEIC_BRANDS.has(ascii(bytes, at, at + 4))) return true;
  return false;
}

// What the bytes are, by their own first bytes: never by what the sender called them.
export function detectImage(bytes: Uint8Array): Kind | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { extension: "png", type: "image/png" };
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { extension: "jpg", type: "image/jpeg" };
  if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a") return { extension: "gif", type: "image/gif" };
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return { extension: "webp", type: "image/webp" };
  if (isHeic(bytes)) return { extension: "heic", type: "image/heic" };
  return null;
}

const tooBig = () => new HerdrError("payload_too_large", `That image is over ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`);
const notAnImage = () => new HerdrError("unsupported_media_type", "That isn't a PNG, JPEG, WebP, GIF or HEIC image.");

type Bytes = Uint8Array<ArrayBuffer>;

async function readCapped(request: Request): Promise<Bytes> {
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) throw tooBig();
  const reader = request.body?.getReader();
  if (!reader) throw new HerdrError("bad_request", "The request has no image in it.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > MAX_BODY_BYTES) {
      await reader.cancel();
      throw tooBig();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
}

// The one image in the request: a multipart form's `image` file, or the whole
// body when it is sent as the image's own type. Anything else is refused
// before it is read.
async function imageOf(request: Request): Promise<{ bytes: Bytes; declared: string | null }> {
  const contentType = request.headers.get("content-type") ?? "";
  const mediaType = contentType.split(";")[0].trim().toLowerCase();
  if (RAW_TYPES.has(mediaType)) return { bytes: await readCapped(request), declared: mediaType === "image/heif" ? "image/heic" : mediaType };
  if (mediaType !== "multipart/form-data") {
    throw new HerdrError("unsupported_media_type", "Send the image as multipart/form-data or as its own image type.");
  }
  const body = await readCapped(request);
  let form: FormData;
  try {
    form = await new Response(body, { headers: { "content-type": contentType } }).formData();
  } catch {
    throw new HerdrError("bad_request", "The upload isn't a valid multipart form.");
  }
  const files = form.getAll("image");
  if (files.length !== 1 || typeof files[0] === "string") throw new HerdrError("bad_request", "Send one image in the `image` field.");
  return { bytes: new Uint8Array(await files[0].arrayBuffer()), declared: null };
}

const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]|\.\d{3}/g, "");
const randomName = () => [...crypto.getRandomValues(new Uint8Array(8))].map((byte) => byte.toString(16).padStart(2, "0")).join("");

type Schedule = (run: () => void, ms: number) => () => void;

const everyDay: Schedule = (run, ms) => {
  const timer = setInterval(run, ms);
  timer.unref();
  return () => clearInterval(timer);
};

export function createUploads({ dir, now = Date.now, schedule = everyDay }: { dir: string; now?: () => number; schedule?: Schedule }) {
  const folder = resolve(dir);
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  chmodSync(folder, 0o700);

  function sweep() {
    let removed = 0;
    let names: string[];
    try {
      names = readdirSync(folder);
    } catch {
      return 0;
    }
    for (const name of names) {
      if (!SAVED_NAME.test(name)) continue;
      try {
        const path = join(folder, name);
        const info = lstatSync(path);
        if (!info.isFile() || now() - info.mtimeMs <= KEEP_MS) continue;
        unlinkSync(path);
        removed += 1;
      } catch {}
    }
    return removed;
  }

  return {
    folder,
    sweep,

    async accept(request: Request): Promise<Saved> {
      const { bytes, declared } = await imageOf(request);
      if (bytes.length > MAX_UPLOAD_BYTES) throw tooBig();
      const kind = detectImage(bytes);
      if (!kind || (declared !== null && declared !== kind.type)) throw notAnImage();
      const name = `${stamp(now())}-${randomName()}.${kind.extension}`;
      const path = join(folder, name);
      writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
      return { path, name, size: bytes.length };
    },

    // Clears what is a week old now, and again every day; returns how to stop.
    tidyDaily() {
      sweep();
      return schedule(sweep, SWEEP_EVERY_MS);
    },
  };
}

export type Uploads = ReturnType<typeof createUploads>;
