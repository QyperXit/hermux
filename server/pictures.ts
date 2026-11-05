import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { HerdrError } from "./herdr";
import { detectImage } from "./uploads";

export const MAX_PICTURE_BYTES = 25 * 1024 * 1024;
const CHUNK_BYTES = 1024 * 1024;
const PICTURE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

const notAbsolute = () => new HerdrError("bad_request", "Give the picture's absolute path.");
const notAllowed = () => new HerdrError("path_not_allowed", "Only pictures in your home folder or /tmp, outside hidden folders, can be shown.");
const notFound = () => new HerdrError("picture_not_found", "There is no picture file at that path.");
const tooBig = () => new HerdrError("payload_too_large", `That picture is over ${MAX_PICTURE_BYTES / (1024 * 1024)} MB.`);
const notAPicture = () => new HerdrError("unsupported_media_type", "That file isn't a PNG, JPEG, WebP or GIF picture.");

const hasHiddenPart = (path: string) => path.split("/").some((part) => part.startsWith("."));
const isInside = (path: string, roots: string[]) => roots.some((root) => path === root || path.startsWith(`${root}/`));

async function realOr(path: string) {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

function fsError(error: unknown) {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "EACCES" || code === "EPERM") return notAllowed();
  return notFound();
}

export function createPictures({ home = homedir(), tmp = "/tmp" }: { home?: string; tmp?: string } = {}) {
  function absolute(given: string | null) {
    if (!given || given.includes("\0")) throw notAbsolute();
    if (given === "~" || given.startsWith("~/")) return resolve(home) + given.slice(1);
    if (!given.startsWith("/")) throw notAbsolute();
    return given;
  }

  async function readCapped(path: string) {
    let file;
    try {
      file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    } catch (error) {
      throw fsError(error);
    }
    try {
      const info = await file.stat();
      if (!info.isFile()) throw notFound();
      if (info.size > MAX_PICTURE_BYTES) throw tooBig();
      const chunks: Uint8Array[] = [];
      let length = 0;
      for (;;) {
        const chunk = new Uint8Array(CHUNK_BYTES);
        const { bytesRead } = await file.read(chunk, 0, CHUNK_BYTES, length);
        if (bytesRead === 0) break;
        length += bytesRead;
        if (length > MAX_PICTURE_BYTES) throw tooBig();
        chunks.push(chunk.subarray(0, bytesRead));
      }
      const bytes = new Uint8Array(length);
      let at = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, at);
        at += chunk.length;
      }
      return bytes;
    } finally {
      await file.close();
    }
  }

  return {
    async read(given: string | null): Promise<{ bytes: Uint8Array<ArrayBuffer>; type: string }> {
      const path = absolute(given);
      if (hasHiddenPart(path)) throw notAllowed();
      const lexicalRoots = [resolve(home), resolve(tmp)];
      const realRoots = [await realOr(home), await realOr(tmp)];
      let real: string;
      try {
        real = await realpath(path);
      } catch (error) {
        if (!isInside(resolve(path), [...lexicalRoots, ...realRoots])) throw notAllowed();
        throw fsError(error);
      }
      if (hasHiddenPart(real) || !isInside(real, realRoots)) throw notAllowed();
      const bytes = await readCapped(real);
      const kind = detectImage(bytes);
      if (!kind || !PICTURE_TYPES.has(kind.type)) throw notAPicture();
      return { bytes, type: kind.type };
    },
  };
}

export type Pictures = ReturnType<typeof createPictures>;
