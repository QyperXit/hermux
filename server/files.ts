import type { FileHandle } from "node:fs/promises";
import { basename } from "node:path";
import { MAX_FILE_BYTES } from "../web/file-rules.js";
import { HerdrError } from "./herdr";
import { createLaptopPaths, type LaptopRoots } from "./laptop-paths";
import { PICTURE_TYPES } from "./pictures";
import { detectImage } from "./uploads";

const CHUNK_BYTES = 1024 * 1024;
const HEAD_BYTES = 64;
const PDF_MAGIC = "%PDF-";
const UNTYPED = "application/octet-stream";

const notAbsolute = () => new HerdrError("bad_request", "Give the file's absolute path.");
const notAllowed = () => new HerdrError("path_not_allowed", "Only files in your home folder or /tmp, outside hidden folders, can be sent.");
const notFound = () => new HerdrError("file_not_found", "There is no file at that path.");
const tooBig = () => new HerdrError("payload_too_large", `That file is over ${MAX_FILE_BYTES / (1024 * 1024)} MB.`);

export type FileInfo = { name: string; size: number; modified: number; kind: string };

function typeOf(head: Uint8Array) {
  if (String.fromCharCode(...head.subarray(0, PDF_MAGIC.length)) === PDF_MAGIC) return "application/pdf";
  const picture = detectImage(head);
  return picture && PICTURE_TYPES.has(picture.type) ? picture.type : UNTYPED;
}

async function readHead(file: FileHandle) {
  const head = new Uint8Array(HEAD_BYTES);
  const { bytesRead } = await file.read(head, 0, HEAD_BYTES, 0);
  return head.subarray(0, bytesRead);
}

const RFC_5987_EXTRA = /['()*!]/g;

// The quoted name keeps printable ASCII only, without the characters that end
// or escape it; filename* carries the whole name.
export function attachmentHeader(name: string) {
  const plain = name.replace(/[^\x20-\x7e]|["\\%;]/g, "_");
  const encoded = encodeURIComponent(name).replace(RFC_5987_EXTRA, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${plain}"; filename*=UTF-8''${encoded}`;
}

// At most `size` bytes, read into one buffer so the answer carries its length.
async function readWhole(file: FileHandle, size: number) {
  const bytes = new Uint8Array(size);
  let at = 0;
  while (at < size) {
    const { bytesRead } = await file.read(bytes, at, Math.min(CHUNK_BYTES, size - at), at);
    if (bytesRead === 0) break;
    at += bytesRead;
  }
  return bytes.subarray(0, at);
}

export function createFiles(roots: LaptopRoots = {}) {
  const paths = createLaptopPaths(roots, { notAbsolute, notAllowed, notFound });

  return {
    async info(given: string | null): Promise<FileInfo> {
      const { path, real } = await paths.locate(given);
      const { file, size, modified } = await paths.openFile(real);
      try {
        return { name: basename(path), size, modified, kind: typeOf(await readHead(file)) };
      } finally {
        await file.close();
      }
    },

    async read(given: string | null): Promise<{ name: string; type: string; bytes: Uint8Array<ArrayBuffer> }> {
      const { path, real } = await paths.locate(given);
      const { file, size } = await paths.openFile(real);
      try {
        if (size > MAX_FILE_BYTES) throw tooBig();
        const bytes = await readWhole(file, size);
        return { name: basename(path), type: typeOf(bytes.subarray(0, HEAD_BYTES)), bytes };
      } finally {
        await file.close();
      }
    },
  };
}

export type Files = ReturnType<typeof createFiles>;
