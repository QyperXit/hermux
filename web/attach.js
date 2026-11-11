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
 * @typedef {object} Picture one image attached to the message being written
 * @property {string} name
 * @property {number} size
 * @property {string | null} preview
 * @property {"uploading" | "attached" | "error"} state
 * @property {string} [path] where the laptop saved it, once attached
 * @property {string} [problem] why it didn't upload, once it failed
 * @property {AbortController} [uploadAbort]
 * @property {HTMLElement} [chip]
 */

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const MAX_PICTURES = 10;

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

/** @param {Picture} picture */
function chipTextHtml({ name, size, state, problem }) {
  return state === "error"
    ? `<span class="attachment-problem">${escapeHtml(problem)}</span>`
    : `<span class="attachment-name">${escapeHtml(name)}</span> <span class="attachment-size">${state === "uploading" ? "Uploading…" : escapeHtml(formatSize(size))}</span>`;
}

/** @param {Picture} picture */
function chipHtml(picture) {
  const { preview, state, name } = picture;
  const thumb = `${icon("i-clip")}${preview ? `<img src="${escapeHtml(preview)}" alt="">` : ""}${state === "uploading" ? icon("i-sending", "attachment-busy") : ""}`;
  return `<div class="attachment" data-state="${state}"><span class="attachment-thumb">${thumb}</span><span class="attachment-text">${chipTextHtml(picture)}</span><button class="attachment-remove" type="button" aria-label="Remove ${escapeHtml(name)}">${icon("i-close")}</button></div>`;
}

/** @type {Picture[]} */
const SAMPLE_PICTURES = [
  { name: "screenshot.png", size: 1_258_291, preview: null, state: "attached", path: "/home/you/hermux/.uploads/20261105T091500Z-3f9c2a71b8d04e65.png" },
  { name: "error-dialog.png", size: 884_736, preview: null, state: "attached", path: "/home/you/hermux/.uploads/20261105T091512Z-8a1d4e07c2b95f36.png" },
  { name: "whiteboard.jpg", size: 2_202_009, preview: null, state: "attached", path: "/home/you/hermux/.uploads/20261105T091530Z-c70e2b9f41d6a853.jpg" },
];

/**
 * The images attached to the message being written, at most 10: each picked,
 * uploaded to the laptop on its own and shown as a chip in one row above the
 * message box, and added to the message as its path when that is sent.
 * @param {{ client: Client, previews?: Previews, prepare?: typeof prepareImage }} options
 */
export function createAttachment({ client, previews = BROWSER_PREVIEWS, prepare = prepareImage }) {
  /** @type {HTMLElement | null} */
  let screen = null;
  /** @type {HTMLElement | null} */
  let outsideTapTarget = null;
  /** @type {Picture[]} */
  let pictures = [];
  let leftOut = 0;
  let menuOpen = false;
  /** @type {Promise<unknown>} */
  let redrawQueue = Promise.resolve();

  /** @returns {HTMLElement} */
  const page = () => {
    if (!screen) throw new Error("The attachment isn't attached to a screen.");
    return screen;
  };

  // A hidden row keeps its old scroll position, so an emptied one starts again from its start.
  function drawGroup() {
    if (!pictures.length) need(page(), ".attachment-row").scrollLeft = 0;
    need(page(), ".attachments").hidden = pictures.length === 0;
    need(page(), ".attachment-count").textContent = `${pictures.length} of ${MAX_PICTURES} pictures${leftOut ? ` · ${leftOut} left out (${MAX_PICTURES} at most)` : ""}`;
  }

  /** @param {Picture} picture */
  function drawChip(picture) {
    const row = need(page(), ".attachment-row");
    row.insertAdjacentHTML("beforeend", chipHtml(picture));
    const chip = /** @type {HTMLElement} */ (row.children[row.children.length - 1]);
    picture.chip = chip;
    need(chip, ".attachment-remove").addEventListener("click", () => remove(picture));
    const thumbnail = find(chip, "img");
    thumbnail?.addEventListener("error", () => thumbnail.remove());
  }

  /**
   * @param {Picture} picture
   * @param {Partial<Picture>} change
   */
  function update(picture, change) {
    Object.assign(picture, change);
    if (!picture.chip) return;
    picture.chip.dataset.state = picture.state;
    find(picture.chip, ".attachment-busy")?.remove();
    need(picture.chip, ".attachment-text").innerHTML = chipTextHtml(picture);
  }

  /** @param {Picture} picture */
  function drop(picture) {
    picture.uploadAbort?.abort();
    if (picture.preview) previews.revoke(picture.preview);
    picture.chip?.remove();
    pictures = pictures.filter((other) => other !== picture);
  }

  /** @param {Picture} picture */
  function remove(picture) {
    const at = pictures.indexOf(picture);
    drop(picture);
    leftOut = 0;
    drawGroup();
    const next = pictures[at] ?? pictures[at - 1];
    (next?.chip ? need(next.chip, ".attachment-remove") : need(page(), ".attach")).focus();
  }

  /** @param {File} file */
  async function addPicture(file) {
    const controller = new AbortController();
    /** @type {Picture} */
    const picture = { name: file.name || "image", size: file.size, preview: previews.create(file), state: "uploading", uploadAbort: controller };
    pictures.push(picture);
    drawChip(picture);
    const current = () => pictures.includes(picture);
    try {
      const prepared = redrawQueue.then(() => (current() ? prepare(file) : null));
      redrawQueue = prepared.catch(() => {});
      const ready = await prepared;
      if (!ready || !current()) return;
      const { blob, name } = ready;
      if (blob.size > MAX_UPLOAD_BYTES) {
        update(picture, { state: "error", problem: errorMessage("payload_too_large", undefined) });
        return;
      }
      const saved = await client.uploadImage(blob, name, { signal: controller.signal });
      update(picture, { state: "attached", size: saved.size, path: saved.path });
    } catch (error) {
      update(picture, { state: "error", problem: describeError(error).message });
    }
  }

  /** @param {File[]} files */
  function addPictures(files) {
    const room = MAX_PICTURES - pictures.length;
    leftOut = Math.max(0, files.length - room);
    const first = pictures.length;
    for (const file of files.slice(0, room)) addPicture(file);
    drawGroup();
    pictures[first]?.chip?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function openMenu() {
    const menu = need(page(), ".clip-menu");
    menuOpen = true;
    menu.hidden = false;
    need(page(), ".attach").setAttribute("aria-expanded", "true");
    need(menu, ".clip-item").focus();
  }

  /** @param {{ focus?: boolean }} [options] */
  function closeMenu({ focus = true } = {}) {
    if (!menuOpen) return;
    const clip = need(page(), ".attach");
    menuOpen = false;
    need(page(), ".clip-menu").hidden = true;
    clip.setAttribute("aria-expanded", "false");
    if (focus) clip.focus();
  }

  /** @param {Event} event */
  function closeOnOutsideTap(event) {
    if (!menuOpen) return;
    const clip = find(page(), ".attach");
    const menu = find(page(), ".clip-menu");
    // The page has moved on from this screen; the next one starts closed.
    if (!clip || !menu) return;
    const target = /** @type {Element | null} */ (event.target);
    if (menu.contains(target) || clip.contains(target)) return;
    closeMenu({ focus: false });
    const doc = page().ownerDocument;
    const active = doc.activeElement;
    if (!active || active === doc.body || menu.contains(active)) clip.focus();
  }

  return {
    // A newly drawn Terminal screen (`drawn` holds its composer): the
    // attach button opens the clip menu, whose rows open the phone's camera
    // or its pictures, and each picked image becomes a chip. The demo's chips
    // are made up, and nothing is uploaded for them.
    /** @param {HTMLElement} drawn */
    attach(drawn) {
      for (const picture of [...pictures]) drop(picture);
      leftOut = 0;
      screen = drawn;
      menuOpen = false;
      if (outsideTapTarget !== drawn) {
        drawn.addEventListener("click", closeOnOutsideTap);
        outsideTapTarget = drawn;
      }
      need(drawn, ".attach").addEventListener("click", () => (menuOpen ? closeMenu() : openMenu()));
      need(drawn, ".composer").addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || !menuOpen) return;
        event.preventDefault();
        closeMenu();
      });
      for (const [rowSelector, inputSelector] of [
        [".clip-camera", ".attach-camera"],
        [".clip-gallery", ".attach-input"],
      ]) {
        /** @type {HTMLInputElement} */
        const input = need(drawn, inputSelector);
        need(drawn, rowSelector).addEventListener("click", () => {
          closeMenu();
          input.click();
        });
        input.addEventListener("change", () => {
          const files = [...(input.files ?? [])];
          input.value = "";
          if (files.length) addPictures(files);
        });
      }
      if (client.isSample) {
        pictures = SAMPLE_PICTURES.map((sample) => ({ ...sample }));
        pictures.forEach(drawChip);
      }
      drawGroup();
    },

    /** @param {boolean} blocked */
    setBlocked(blocked) {
      if (blocked) closeMenu({ focus: false });
    },

    /**
     * Sends what was typed through `deliver`, with every attached image's
     * path after the text, in chip order and space-separated (or the paths
     * alone when nothing was typed). The chips clear only when `deliver` says
     * the message went; an image still uploading or failed holds the send
     * back, with the reason.
     * @param {string} typed
     * @param {(message: string) => Promise<boolean>} deliver
     * @returns {Promise<{ sent: boolean, refused?: string }>}
     */
    async send(typed, deliver) {
      if (!pictures.length) return { sent: await deliver(typed) };
      const failed = pictures.filter((picture) => picture.state === "error").length;
      if (failed) return { sent: false, refused: failed === 1 ? "The image didn't upload. Remove it to send without it." : `${failed} images didn't upload. Remove them to send without them.` };
      const uploading = pictures.filter((picture) => picture.state === "uploading").length;
      if (uploading) return { sent: false, refused: uploading === 1 ? "The image is still uploading. Wait for it, or remove it." : `${uploading} images are still uploading. Wait for them, or remove them.` };
      const going = [...pictures];
      const paths = going.map((picture) => picture.path).join(" ");
      const sent = await deliver(typed.trim() ? `${typed.trimEnd()} ${paths}` : paths);
      const stillHere = going.filter((picture) => pictures.includes(picture));
      if (sent && stillHere.length) {
        stillHere.forEach(drop);
        leftOut = 0;
        drawGroup();
      }
      return { sent };
    },
  };
}
