import { describe, expect, test } from "bun:test";
import { MAX_EDGE, MAX_PLAIN_BYTES, downscalePlan, prepareImage } from "../web/downscale.js";

const MB = 1024 * 1024;

describe("when an image is made smaller before it goes up", () => {
  test("a screenshot under both limits is left exactly as it is", () => {
    expect(downscalePlan({ width: 1080, height: 2400, bytes: 2 * MB })).toBeNull();
    expect(downscalePlan({ width: MAX_EDGE, height: 1000, bytes: MAX_PLAIN_BYTES })).toBeNull();
  });

  test("a longest side over the limit is brought down to it, keeping the proportions, whichever side is longer", () => {
    expect(downscalePlan({ width: 5120, height: 2880, bytes: MB })).toEqual({ width: 2560, height: 1440 });
    expect(downscalePlan({ width: 3000, height: 6000, bytes: MB })).toEqual({ width: 1280, height: 2560 });
  });

  test("a heavy file with a modest size is redrawn at the same size", () => {
    expect(downscalePlan({ width: 2000, height: 1500, bytes: MAX_PLAIN_BYTES + 1 })).toEqual({ width: 2000, height: 1500 });
  });
});

function fakeTools({ width, height, jpegBytes = 1000, fails = false, noCanvas = false }: { width: number; height: number; jpegBytes?: number; fails?: boolean; noCanvas?: boolean }) {
  const log: string[] = [];
  return {
    log,
    tools: {
      decode: async () => {
        if (fails) throw new Error("can't decode");
        log.push("decode");
        return {
          width,
          height,
          close: () => void log.push("close"),
          jpeg: async (w: number, h: number) => {
            log.push(`jpeg ${w}x${h}`);
            return noCanvas ? null : new Blob([new Uint8Array(jpegBytes)], { type: "image/jpeg" });
          },
        };
      },
    },
  };
}

const picked = (name: string, type: string, bytes: number) => new File([new Uint8Array(bytes)], name, { type });

describe("preparing a picked image", () => {
  test("a small one goes up as picked, and what was read is let go", async () => {
    const { tools, log } = fakeTools({ width: 1080, height: 2400 });
    const file = picked("screenshot.png", "image/png", 2 * MB);
    expect(await prepareImage(file, tools)).toEqual({ blob: file, name: "screenshot.png" });
    expect(log).toEqual(["decode", "close"]);
  });

  test("a huge one goes up as a smaller JPEG named .jpg", async () => {
    const { tools, log } = fakeTools({ width: 6000, height: 4000, jpegBytes: 900_000 });
    const result = await prepareImage(picked("big.holiday.png", "image/png", 9 * MB), tools);
    expect([result.name, result.blob.type, result.blob.size, log]).toEqual(["big.holiday.jpg", "image/jpeg", 900_000, ["decode", "jpeg 2560x1707", "close"]]);
  });

  test("an animated GIF is never redrawn, so it keeps moving", async () => {
    const { tools, log } = fakeTools({ width: 6000, height: 4000 });
    const file = picked("loop.gif", "image/gif", 9 * MB);
    expect((await prepareImage(file, tools)).blob).toBe(file);
    expect(log).toEqual([]);
  });

  test("an image the browser can't read (HEIC), or can't redraw, goes up as picked", async () => {
    const file = picked("photo.heic", "image/heic", 9 * MB);
    expect((await prepareImage(file, fakeTools({ width: 1, height: 1, fails: true }).tools)).blob).toBe(file);
    const big = picked("big.png", "image/png", 9 * MB);
    expect((await prepareImage(big, fakeTools({ width: 6000, height: 4000, noCanvas: true }).tools)).blob).toBe(big);
  });

  test("a redraw that isn't smaller is not used", async () => {
    const file = picked("noise.png", "image/png", 6 * MB);
    const { tools } = fakeTools({ width: 3000, height: 2000, jpegBytes: 7 * MB });
    expect((await prepareImage(file, tools)).blob).toBe(file);
  });
});
