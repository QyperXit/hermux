import { HerdrError } from "./herdr";
import { createLaptopPaths, type LaptopRoots } from "./laptop-paths";
import { detectImage } from "./uploads";

export const MAX_PICTURE_BYTES = 25 * 1024 * 1024;
const CHUNK_BYTES = 1024 * 1024;
export const PICTURE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

const notAbsolute = () => new HerdrError("bad_request", "Give the picture's absolute path.");
const notAllowed = () => new HerdrError("path_not_allowed", "Only pictures in your home folder or /tmp, outside hidden folders, can be shown.");
const notFound = () => new HerdrError("picture_not_found", "There is no picture file at that path.");
const tooBig = () => new HerdrError("payload_too_large", `That picture is over ${MAX_PICTURE_BYTES / (1024 * 1024)} MB.`);
const notAPicture = () => new HerdrError("unsupported_media_type", "That file isn't a PNG, JPEG, WebP or GIF picture.");

export function createPictures(roots: LaptopRoots = {}) {
  const paths = createLaptopPaths(roots, { notAbsolute, notAllowed, notFound });

  async function readCapped(real: string) {
    const { file, size } = await paths.openFile(real);
    try {
      if (size > MAX_PICTURE_BYTES) throw tooBig();
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
      const { real } = await paths.locate(given);
      const bytes = await readCapped(real);
      const kind = detectImage(bytes);
      if (!kind || !PICTURE_TYPES.has(kind.type)) throw notAPicture();
      return { bytes, type: kind.type };
    },
  };
}

export type Pictures = ReturnType<typeof createPictures>;
