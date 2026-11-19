import { constants } from "node:fs";
import { open, realpath, type FileHandle } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { HerdrError } from "./herdr";

export type LaptopRoots = { home?: string; tmp?: string };

type PathErrors = {
  notAbsolute: () => HerdrError;
  notAllowed: () => HerdrError;
  notFound: () => HerdrError;
};

type OpenedFile = { file: FileHandle; size: number; modified: number };

const hasHiddenPart = (path: string) => path.split("/").some((part) => part.startsWith("."));
const isInside = (path: string, roots: string[]) => roots.some((root) => path === root || path.startsWith(`${root}/`));

async function realOr(path: string) {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

// Laptop files the phone may read: absolute paths (a leading ~/ is the home
// folder) whose real path is under the home folder or /tmp, with no part
// starting with "." in the given or the real path.
export function createLaptopPaths({ home = homedir(), tmp = "/tmp" }: LaptopRoots, errors: PathErrors) {
  function absolute(given: string | null) {
    if (!given || given.includes("\0")) throw errors.notAbsolute();
    if (given === "~" || given.startsWith("~/")) return resolve(home) + given.slice(1);
    if (!given.startsWith("/")) throw errors.notAbsolute();
    return given;
  }

  function fsError(error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EPERM") return errors.notAllowed();
    return errors.notFound();
  }

  return {
    async locate(given: string | null): Promise<{ path: string; real: string }> {
      const path = absolute(given);
      if (hasHiddenPart(path)) throw errors.notAllowed();
      const lexicalRoots = [resolve(home), resolve(tmp)];
      const realRoots = [await realOr(home), await realOr(tmp)];
      let real: string;
      try {
        real = await realpath(path);
      } catch (error) {
        if (!isInside(resolve(path), [...lexicalRoots, ...realRoots])) throw errors.notAllowed();
        throw fsError(error);
      }
      if (hasHiddenPart(real) || !isInside(real, realRoots)) throw errors.notAllowed();
      return { path, real };
    },

    // Opened no-follow and non-blocking, so a pipe can't hold the server up;
    // anything but a regular file is not found. The caller closes it.
    async openFile(real: string): Promise<OpenedFile> {
      let file;
      try {
        file = await open(real, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      } catch (error) {
        throw fsError(error);
      }
      try {
        const info = await file.stat();
        if (!info.isFile()) throw errors.notFound();
        return { file, size: info.size, modified: Math.floor(info.mtimeMs) };
      } catch (error) {
        await file.close();
        throw error;
      }
    },
  };
}
