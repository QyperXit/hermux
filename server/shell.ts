import { readdir } from "node:fs/promises";
import { extname, join } from "node:path";

// The app shell the service worker keeps (web/sw.js, D29): the page, its
// styles, modules, icons and manifest at the top of web/, and the fonts.
// Nothing in web/'s other folders (the design sketches) is part of it.
const TOP_LEVEL = new Set([".html", ".css", ".js", ".webmanifest", ".svg", ".png"]);
const FONTS = "fonts";
const WORKER = "sw.js";

async function shellFiles(root: string): Promise<string[]> {
  const top = await readdir(root, { withFileTypes: true });
  const fonts = await readdir(join(root, FONTS), { withFileTypes: true }).catch(() => []);
  return [
    ...top.filter((entry) => entry.isFile() && entry.name !== WORKER && TOP_LEVEL.has(extname(entry.name))).map((entry) => entry.name),
    ...fonts.filter((entry) => entry.isFile() && extname(entry.name) === ".woff2").map((entry) => `${FONTS}/${entry.name}`),
  ].sort();
}

// The service worker as served: its stamp holds the shell's files, relative to
// the page ("./" is index.html), and a version that is a hash of those files
// and the worker itself, so a change to any of them is a new worker.
export async function stampedWorker(root: string, worker: string): Promise<string> {
  const files = await shellFiles(root);
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(worker);
  for (const file of files) {
    hasher.update(`\0${file}\0`);
    hasher.update(await Bun.file(join(root, file)).arrayBuffer());
  }
  const shell = { version: hasher.digest("hex").slice(0, 16), files: files.map((file) => (file === "index.html" ? "./" : file)) };
  return worker.replace('"__SHELL__"', () => JSON.stringify(shell));
}
