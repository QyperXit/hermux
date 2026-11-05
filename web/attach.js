import { describeError, errorMessage } from "./api.js";
import { find, need } from "./dom.js";
import { prepareImage } from "./downscale.js";
import { escapeHtml, icon } from "./html.js";

/**
 * @typedef {import("./types.js").Client} Client
 */

/**
 * @typedef {object} Previews
 * @property {(blob: Blob) => string | null} create a thumbnail address for a picked image
 * @property {(url: string) => void} revoke
 */

/**
 * @typedef {object} Picked the one image attached to the message being written
 * @property {number} id
 * @property {string} name
 * @property {number} size
 * @property {string | null} preview
 * @property {"uploading" | "attached" | "error"} state
 * @property {string} [path] where the laptop saved it, once attached
 * @property {string} [problem] why it didn't upload, once it failed
 */

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/** @type {Previews} */
const BROWSER_PREVIEWS = {
  create: (blob) => URL.createObjectURL(blob),
  revoke: (url) => URL.revokeObjectURL(url),
};

/** @param {number} bytes */
export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.floor(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** @param {Picked} picked */
function chipHtml({ name, size, preview, state, problem }) {
  const thumb = `${icon("i-clip")}${preview ? `<img src="${escapeHtml(preview)}" alt="">` : ""}${state === "uploading" ? icon("i-sending", "attachment-busy") : ""}`;
  const text =
    state === "error"
      ? `<span class="attachment-problem">${escapeHtml(problem)}</span>`
      : `<span class="attachment-name">${escapeHtml(name)}</span> <span class="attachment-size">${state === "uploading" ? "Uploading…" : escapeHtml(formatSize(size))}</span>`;
  return `<span class="attachment-thumb">${thumb}</span><span class="attachment-text">${text}</span><button class="attachment-remove" type="button" aria-label="Remove image">${icon("i-close")}</button>`;
}

/** @type {Omit<Picked, "id">} */
const SAMPLE_CHIP = { name: "screenshot.png", size: 1_258_291, preview: null, state: "attached", path: "/home/you/hermux/.uploads/20261105T091500Z-3f9c2a71b8d04e65.png" };

/**
 * The image attached to the message being written: picked, uploaded to the
 * laptop, shown as a chip above the message box, and added to the message as
 * its path when that is sent. One image at a time: picking another replaces it.
 * @param {{ client: Client, previews?: Previews, prepare?: typeof prepareImage }} options
 */
export function createAttachment({ client, previews = BROWSER_PREVIEWS, prepare = prepareImage }) {
  /** @type {HTMLElement | null} */
  let screen = null;
  /** @type {Picked | null} */
  let picked = null;
  /** @type {AbortController | null} */
  let upload = null;
  let counter = 0;

  /** @returns {HTMLElement} */
  const page = () => {
    if (!screen) throw new Error("The attachment isn't attached to a screen.");
    return screen;
  };

  function draw() {
    const chip = need(page(), ".attachment");
    chip.hidden = !picked;
    if (!picked) {
      chip.innerHTML = "";
      delete chip.dataset.state;
      return;
    }
    chip.dataset.state = picked.state;
    chip.innerHTML = chipHtml(picked);
    need(chip, ".attachment-remove").addEventListener("click", remove);
    const thumbnail = find(chip, "img");
    thumbnail?.addEventListener("error", () => thumbnail.remove());
  }

  function drop() {
    upload?.abort();
    upload = null;
    if (picked?.preview) previews.revoke(picked.preview);
    picked = null;
  }

  function remove() {
    drop();
    draw();
    need(page(), ".attach").focus();
  }

  /** @param {File} file */
  async function pick(file) {
    drop();
    const id = ++counter;
    const controller = new AbortController();
    upload = controller;
    picked = { id, name: file.name || "image", size: file.size, preview: previews.create(file), state: "uploading" };
    draw();
    const current = () => picked?.id === id;
    try {
      const { blob, name } = await prepare(file);
      if (!current()) return;
      if (blob.size > MAX_UPLOAD_BYTES) {
        picked = { ...picked, state: "error", problem: errorMessage("payload_too_large", undefined) };
        draw();
        return;
      }
      const saved = await client.uploadImage(blob, name, { signal: controller.signal });
      if (!current() || !picked) return;
      picked = { ...picked, state: "attached", size: saved.size, path: saved.path };
    } catch (error) {
      if (!current() || !picked) return;
      picked = { ...picked, state: "error", problem: describeError(error).message };
    }
    draw();
  }

  return {
    // A newly drawn Terminal screen (`drawn` holds its composer): the
    // attach button opens the phone's picker, and a picked image becomes the
    // chip. The demo's chip is a made-up one, and nothing is uploaded for it.
    /** @param {HTMLElement} drawn */
    attach(drawn) {
      drop();
      screen = drawn;
      /** @type {HTMLInputElement} */
      const input = need(drawn, ".attach-input");
      need(drawn, ".attach").addEventListener("click", () => input.click());
      input.addEventListener("change", () => {
        const [file] = input.files ?? [];
        input.value = "";
        if (file) pick(file);
      });
      if (client.isSample) picked = { id: ++counter, ...SAMPLE_CHIP };
      draw();
    },

    /**
     * Sends what was typed through `deliver`, with an attached image's path
     * after the text (or as the whole message when nothing was typed). The
     * chip clears only when `deliver` says the message went; an image still
     * uploading or failed holds the send back, with the reason.
     * @param {string} typed
     * @param {(message: string) => Promise<boolean>} deliver
     * @returns {Promise<{ sent: boolean, refused?: string }>}
     */
    async send(typed, deliver) {
      if (!picked) return { sent: await deliver(typed) };
      if (picked.state === "uploading") return { sent: false, refused: "The image is still uploading. Wait for it, or remove it." };
      if (!picked.path) return { sent: false, refused: "The image didn't upload. Remove it to send without it." };
      const { id, path } = picked;
      const sent = await deliver(typed.trim() ? `${typed.trimEnd()} ${path}` : path);
      if (sent && picked?.id === id) {
        drop();
        draw();
      }
      return { sent };
    },
  };
}
