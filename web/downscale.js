// Very large images are made smaller before they leave the phone, so an upload
// over a poor connection stays quick. A screenshot under both limits goes up
// untouched and stays crisp; only one with a longest side over MAX_EDGE, or
// over MAX_PLAIN_BYTES, becomes a JPEG (its longest side capped at MAX_EDGE).

export const MAX_EDGE = 2560;
export const MAX_PLAIN_BYTES = 5 * 1024 * 1024;
const JPEG_QUALITY = 0.9;

/**
 * @typedef {object} Decoded an image the browser has read
 * @property {number} width
 * @property {number} height
 * @property {(width: number, height: number) => Promise<Blob | null>} jpeg it redrawn at that size
 * @property {() => void} close
 */

/**
 * @typedef {object} ImageTools
 * @property {(file: Blob) => Promise<Decoded>} decode
 */

/**
 * The size to redraw an image at, or null to leave it as it is.
 * @param {{ width: number, height: number, bytes: number }} image
 * @returns {{ width: number, height: number } | null}
 */
export function downscalePlan({ width, height, bytes }) {
  const longest = Math.max(width, height);
  if (longest > MAX_EDGE) {
    const scale = MAX_EDGE / longest;
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
  }
  return bytes > MAX_PLAIN_BYTES ? { width, height } : null;
}

/** @type {ImageTools} */
const BROWSER = {
  decode: async (file) => {
    const bitmap = await createImageBitmap(file);
    return {
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
      jpeg: async (width, height) => {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) return null;
        context.fillStyle = "#fff";
        context.fillRect(0, 0, width, height);
        context.drawImage(bitmap, 0, 0, width, height);
        return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
      },
    };
  },
};

/** @param {string} name */
const asJpegName = (name) => `${name.replace(/\.[^./\\]*$/, "")}.jpg`;

/**
 * What to upload for a picked image: the image itself, or a smaller JPEG of it.
 * An animated GIF, an image the browser can't decode (HEIC) and a result that
 * isn't smaller all go up as picked.
 * @param {File} file
 * @param {ImageTools} [tools]
 * @returns {Promise<{ blob: Blob, name: string }>}
 */
export async function prepareImage(file, tools = BROWSER) {
  const asPicked = { blob: file, name: file.name };
  if (file.type === "image/gif") return asPicked;
  try {
    const image = await tools.decode(file);
    try {
      const plan = downscalePlan({ width: image.width, height: image.height, bytes: file.size });
      if (!plan) return asPicked;
      const smaller = await image.jpeg(plan.width, plan.height);
      return smaller && smaller.size < file.size ? { blob: smaller, name: asJpegName(file.name) } : asPicked;
    } finally {
      image.close();
    }
  } catch {
    return asPicked;
  }
}
