import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../server/app";
import { createHerdr } from "../server/herdr";
import { createHttpClient } from "../web/api.js";
import { createAttachment, formatSize } from "../web/attach.js";
import { composerHtml, drawComposer } from "../web/composer.js";
import { WEB } from "./support/agents";
import { asPageElement, fakePage, type FakeElement } from "./support/fake-dom";
import { ALLOWED_LOGIN } from "./support/http";
import { keyBarScreen } from "./support/key-bar";
import { image, makeUploads, removeUploadFolders } from "./support/uploads";

afterAll(removeUploadFolders);

const SAVED = { path: "/home/you/app/.uploads/20261105T093015Z-0123456789abcdef.png", name: "20261105T093015Z-0123456789abcdef.png", size: 1_258_291 };

class Upload {
  settle!: (answer: typeof SAVED | Error) => void;
  promise: Promise<typeof SAVED>;
  constructor(readonly blob: Blob, readonly name: string, readonly signal: AbortSignal | undefined) {
    this.promise = new Promise((resolve, reject) => {
      this.settle = (answer) => (answer instanceof Error ? reject(answer) : resolve(answer));
    });
  }
}

const coded = (code: string, message: string) => Object.assign(new Error(message), { code });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const choose = (into: FakeElement, files: File[]) => {
  Object.assign(into, { files });
  into.value = `C:\\fakepath\\${files[0]?.name}`;
  into.dispatch("change");
};

function composer({ sample = false, prepare }: { sample?: boolean; prepare?: (file: File) => Promise<{ blob: Blob; name: string }> } = {}) {
  const { doc, root } = fakePage(`<div class="controls">${composerHtml()}</div>`);
  const uploads: Upload[] = [];
  const previews = { created: [] as string[], revoked: [] as string[] };
  const client = {
    isSample: sample,
    uploadImage: (blob: Blob, name: string, options?: { signal?: AbortSignal }) => {
      const upload = new Upload(blob, name, options?.signal);
      uploads.push(upload);
      return upload.promise;
    },
  };
  const attachment = createAttachment({
    client: client as unknown as Parameters<typeof createAttachment>[0]["client"],
    previews: {
      create: (blob) => {
        const url = `blob:preview-${previews.created.length + 1}-${(blob as File).name}`;
        previews.created.push(url);
        return url;
      },
      revoke: (url) => void previews.revoked.push(url),
    },
    prepare: prepare ?? (async (file) => ({ blob: file, name: file.name })),
  });
  attachment.attach(asPageElement(root));
  const input = root.querySelector(".attach-input")!;
  const camera = root.querySelector(".attach-camera")!;
  const pickerOpened = { times: 0 };
  Object.assign(input, { click: () => void pickerOpened.times++ });
  const chips = () => root.querySelectorAll(".attachment");
  const chip = () => chips()[0];
  const chipText = (element: FakeElement) => element.textContent.replace(/\s+/g, " ").trim();
  const removeOf = (index: number) => chips()[index].querySelector(".attachment-remove")!;
  const sentMessages: string[] = [];
  const deliver = (outcome = true) => async (message: string) => {
    sentMessages.push(message);
    return outcome;
  };
  return {
    doc,
    root,
    uploads,
    previews,
    attachment,
    chip,
    sentMessages,
    deliver,
    pickerOpened,
    chips,
    pick: (...files: File[]) => choose(input, files),
    takePhoto: (file: File) => choose(camera, [file]),
    state: () => (chip()?.shown ? chip().getAttribute("data-state") : null),
    text: () => chipText(chip()),
    shown: () => chips().filter((each) => each.shown).map((each) => [chipText(each), each.getAttribute("data-state")]),
    count: () => {
      const line = root.querySelector(".attachment-count")!;
      return line.shown ? line.textContent.trim() : null;
    },
    remove: () => removeOf(0),
    removeOf,
    button: () => root.querySelector(".attach")!,
  };
}

const shot = (name = "screenshot.png", bytes = 1_258_291) => new File([new Uint8Array(Math.min(bytes, 64))], name, { type: "image/png" });

describe("the attach button", () => {
  test("is a drawn paperclip inside the message box, before the / button, named 'Attach an image'", () => {
    const { root, button } = composer();
    const box = root.querySelector(".composer-box")!;
    expect(button().parent).toBe(box);
    expect(box.querySelectorAll("button").map((each) => each.getAttribute("class"))).toEqual(["attach", "slash", "send"]);
    expect(button().getAttribute("aria-label")).toBe("Attach an image");
    expect(button().getAttribute("type")).toBe("button");
    expect(button().querySelector("use")?.getAttribute("href")).toBe("#i-clip");
    expect(button().textContent.trim()).toBe("");
  });

  test("its gallery input takes several images at once: images only, and no camera", () => {
    const { root, button, pickerOpened } = composer();
    const input = root.querySelector(".attach-input")!;
    expect([input.getAttribute("type"), input.getAttribute("accept"), input.hasAttribute("multiple"), input.hasAttribute("capture")]).toEqual(["file", "image/*", true, false]);
    button().dispatch("click");
    expect(pickerOpened.times).toBe(0);
  });

  test("uploads nothing until an image is picked, and shows no chip", () => {
    const { uploads, state } = composer();
    expect([uploads.length, state()]).toEqual([0, null]);
  });
});

describe("the chip", () => {
  test("shows the picked image as uploading, with its thumbnail, its name and a way to remove it, while the laptop takes it", async () => {
    const { pick, state, text, uploads, chip, remove, previews } = composer();
    pick(shot("screenshot.png"));
    await flush();
    expect(state()).toBe("uploading");
    expect(text()).toBe("screenshot.png Uploading…");
    expect(chip().querySelector("img")?.getAttribute("src")).toBe(previews.created[0]);
    expect(chip().querySelectorAll(".attachment-busy")).toHaveLength(1);
    expect(remove().getAttribute("aria-label")).toBe("Remove screenshot.png");
    expect(uploads.map((upload) => [upload.name, upload.blob.type])).toEqual([["screenshot.png", "image/png"]]);
  });

  test("each remove key is named after its own picture, with a hostile name kept as text", async () => {
    const { pick, root, previews } = composer();
    pick(shot("a.png"), shot('b "><img src=x>.png'));
    await flush();
    const labels = [...root.querySelectorAll(".attachment-remove")].map((key) => key.getAttribute("aria-label"));
    expect(labels).toEqual(["Remove a.png", 'Remove b "><img src=x>.png']);
    expect(root.querySelectorAll(".attachment img")).toHaveLength(previews.created.length);
  });

  test("becomes attached with the name and the size the laptop saved, and the busy mark goes", async () => {
    const { pick, state, text, uploads, chip } = composer();
    pick(shot("screenshot.png"));
    await flush();
    uploads[0].settle(SAVED);
    await flush();
    expect(state()).toBe("attached");
    expect(text()).toBe("screenshot.png 1.2 MB");
    expect(chip().querySelectorAll(".attachment-busy")).toEqual([]);
  });

  test("says plainly why an upload failed, for each way it can", async () => {
    const reasons: [Error, string][] = [
      [coded("payload_too_large", "Too big. The limit is 15 MB."), "Too big. The limit is 15 MB."],
      [coded("unsupported_media_type", "Not an image the laptop can take. Use PNG, JPEG, WebP, GIF or HEIC."), "Not an image the laptop can take. Use PNG, JPEG, WebP, GIF or HEIC."],
      [coded("unreachable", "The laptop didn't answer."), "The laptop didn't answer."],
    ];
    for (const [error, shown] of reasons) {
      const { pick, state, text, uploads, remove } = composer();
      pick(shot());
      await flush();
      uploads[0].settle(error);
      await flush();
      expect([state(), text()]).toEqual(["error", shown]);
      expect(remove().getAttribute("aria-label")).toBe("Remove screenshot.png");
    }
  });

  test("an image over the limit after any downscaling is refused on the phone, without uploading it", async () => {
    const { pick, state, text, uploads } = composer({ prepare: async () => ({ blob: new Blob([new Uint8Array(15 * 1024 * 1024 + 1)]), name: "huge.jpg" }) });
    pick(shot("huge.png"));
    await flush();
    expect([state(), text(), uploads.length]).toEqual(["error", "Too big. The limit is 15 MB.", 0]);
  });

  test("uploads what the downscaler made, under its name", async () => {
    const small = new Blob([new Uint8Array(10)], { type: "image/jpeg" });
    const { pick, uploads } = composer({ prepare: async () => ({ blob: small, name: "screenshot.jpg" }) });
    pick(shot("screenshot.png"));
    await flush();
    expect([uploads[0].blob, uploads[0].name]).toEqual([small, "screenshot.jpg"]);
  });

  test("the ✕ removes it in any state, lets go of its thumbnail, and puts the focus back on the attach button", async () => {
    for (const settle of [undefined, SAVED, coded("unreachable", "The laptop didn't answer.")]) {
      const { pick, state, uploads, remove, previews, doc, button } = composer();
      pick(shot());
      await flush();
      if (settle) uploads[0].settle(settle);
      await flush();
      expect(state()).not.toBeNull();
      remove().dispatch("click");
      expect(state()).toBeNull();
      expect(previews.revoked).toEqual([previews.created[0]]);
      expect(doc.activeElement).toBe(button());
    }
  });

  test("removing it while it uploads stops the upload, and its late answer doesn't bring the chip back", async () => {
    const { pick, state, uploads, remove } = composer();
    pick(shot());
    await flush();
    remove().dispatch("click");
    expect(uploads[0].signal?.aborted).toBe(true);
    uploads[0].settle(SAVED);
    await flush();
    expect(state()).toBeNull();
  });

  test("a thumbnail the browser can't draw (a HEIC photo) is dropped, leaving the paperclip in its place", async () => {
    const { pick, chip, state } = composer();
    pick(shot("photo.heic"));
    await flush();
    expect(chip().querySelectorAll("img")).toHaveLength(1);
    chip().querySelector("img")!.dispatch("error");
    expect([chip().querySelectorAll("img").length, chip().querySelectorAll(".attachment-thumb use").map((use) => use.getAttribute("href")), state()]).toEqual([0, ["#i-clip", "#i-sending"], "uploading"]);
  });

  test("a picked file with no name is called 'image'", async () => {
    const { pick, text } = composer();
    pick(new File([new Uint8Array(4)], "", { type: "image/png" }));
    await flush();
    expect(text()).toBe("image Uploading…");
  });

  test("the same file can be picked again after it was removed", async () => {
    const { pick, state, remove, root } = composer();
    pick(shot());
    await flush();
    expect(root.querySelector(".attach-input")!.value).toBe("");
    remove().dispatch("click");
    pick(shot());
    await flush();
    expect(state()).toBe("uploading");
  });

  test("a hostile file name or problem text stays text: the chip keeps its own shape", async () => {
    const hostile = [`"><img src=x onerror=alert(1)>.png`, `<script>alert("x")</script>.png`, `' onmouseover='alert(1)`, "&lt;b&gt;.png"];
    const shape = (element: FakeElement) => element.descendants().map((each) => [each.localName, ...each.attributes.keys()].join(" "));
    const clean = composer();
    clean.pick(shot("plain.png"));
    await flush();
    const expected = shape(clean.chip());
    for (const name of hostile) {
      const { pick, uploads, chip, text } = composer();
      pick(shot(name));
      await flush();
      expect(text()).toBe(`${name} Uploading…`);
      expect(shape(chip())).toEqual(expected);
      uploads[0].settle(coded("herdr_failed", name));
      await flush();
      expect(text()).toContain(name);
      expect(chip().descendants().map((each) => each.localName).filter((tag) => tag === "img" || tag === "script")).toEqual(["img"]);
    }
  });
});

describe("sending with an image", () => {
  async function attached(typedFile = "screenshot.png") {
    const made = composer();
    made.pick(shot(typedFile));
    await flush();
    made.uploads[0].settle(SAVED);
    await flush();
    return made;
  }

  test("the message is the typed text and then the file's absolute path, once", async () => {
    const { attachment, sentMessages, deliver } = await attached();
    expect(await attachment.send("What's wrong with this layout?", deliver())).toEqual({ sent: true });
    expect(sentMessages).toEqual([`What's wrong with this layout? ${SAVED.path}`]);
    expect(sentMessages[0].split(SAVED.path)).toHaveLength(2);
  });

  test("with nothing typed, the message is the path alone", async () => {
    for (const typed of ["", "   ", "\n\n"]) {
      const { attachment, sentMessages, deliver } = await attached();
      await attachment.send(typed, deliver());
      expect(sentMessages).toEqual([SAVED.path]);
    }
  });

  test("the text is kept as typed, apart from the trailing blanks before the path", async () => {
    const { attachment, sentMessages, deliver } = await attached();
    await attachment.send("  line one\nline two  \n", deliver());
    expect(sentMessages).toEqual([`  line one\nline two ${SAVED.path}`]);
  });

  test("the chip clears once the message went, and the next message has no path", async () => {
    const { attachment, sentMessages, deliver, state } = await attached();
    await attachment.send("look", deliver());
    expect(state()).toBeNull();
    await attachment.send("and again", deliver());
    expect(sentMessages).toEqual([`look ${SAVED.path}`, "and again"]);
  });

  test("a failed send keeps the chip, and sending again sends the same path, still once", async () => {
    const { attachment, sentMessages, deliver, state } = await attached();
    expect(await attachment.send("look", deliver(false))).toEqual({ sent: false });
    expect(state()).toBe("attached");
    await attachment.send("look", deliver(true));
    expect(sentMessages).toEqual([`look ${SAVED.path}`, `look ${SAVED.path}`]);
    expect(state()).toBeNull();
  });

  test("an image picked while the message is going isn't cleared by that message's success", async () => {
    const { attachment, pick, uploads, state, text } = await attached();
    let finish: (sent: boolean) => void = () => {};
    const sending = attachment.send("look", () => new Promise<boolean>((resolve) => (finish = resolve)));
    pick(shot("later.png"));
    await flush();
    uploads[1].settle({ ...SAVED, path: "/later.png" });
    await flush();
    finish(true);
    await sending;
    expect([state(), text()]).toEqual(["attached", "later.png 1.2 MB"]);
  });

  test("while it still uploads, nothing is sent and the reason is given; the chip stays", async () => {
    const { attachment, pick, sentMessages, deliver, state } = composer();
    pick(shot());
    await flush();
    const result = await attachment.send("look", deliver());
    expect([result.sent, result.refused, sentMessages, state()]).toEqual([false, "The image is still uploading. Wait for it, or remove it.", [], "uploading"]);
  });

  test("after a failed upload, nothing is sent either: the text doesn't go without the image it was about", async () => {
    const { attachment, pick, uploads, sentMessages, deliver, state } = composer();
    pick(shot());
    await flush();
    uploads[0].settle(coded("unreachable", "The laptop didn't answer."));
    await flush();
    const result = await attachment.send("look", deliver());
    expect([result.sent, result.refused, sentMessages, state()]).toEqual([false, "The image didn't upload. Remove it to send without it.", [], "error"]);
  });

  test("with no image attached, the text goes exactly as typed", async () => {
    const { attachment, sentMessages, deliver } = composer();
    await attachment.send("  as typed  \n", deliver());
    expect(sentMessages).toEqual(["  as typed  \n"]);
  });
});

describe("several pictures in one message", () => {
  const savedAs = (path: string) => ({ ...SAVED, path, name: path.slice(1) });
  const shots = (count: number, from = 1) => Array.from({ length: count }, (_, index) => shot(`shot-${from + index}.png`));
  const SCROLLED_PX = 263;
  const rowOf = (root: ReturnType<typeof composer>["root"]) => root.querySelector(".attachment-row")!;

  async function threeAttached() {
    const made = composer();
    made.pick(shot("a.png"), shot("b.png"), shot("c.png"));
    await flush();
    made.uploads.forEach((upload, index) => upload.settle(savedAs(`/up/${"abc"[index]}.png`)));
    await flush();
    return made;
  }

  test("several picked at once become one chip each, in the order picked, each uploading on its own, with how many there are", async () => {
    const { pick, shown, uploads, count, previews } = composer();
    expect(count()).toBeNull();
    pick(shot("a.png"), shot("b.png"), shot("c.png"));
    await flush();
    expect(shown()).toEqual([
      ["a.png Uploading…", "uploading"],
      ["b.png Uploading…", "uploading"],
      ["c.png Uploading…", "uploading"],
    ]);
    expect(uploads.map((upload) => upload.name)).toEqual(["a.png", "b.png", "c.png"]);
    expect(previews.created).toHaveLength(3);
    expect(count()).toBe("3 of 10 pictures");
    uploads[1].settle(savedAs("/up/b.png"));
    uploads[2].settle(coded("unreachable", "The laptop didn't answer."));
    await flush();
    expect(shown()).toEqual([
      ["a.png Uploading…", "uploading"],
      ["b.png 1.2 MB", "attached"],
      ["The laptop didn't answer.", "error"],
    ]);
  });

  test("they all sit in one row inside one group", async () => {
    const { pick, root } = composer();
    pick(shot("a.png"), shot("b.png"));
    await flush();
    const group = root.querySelector(".attachments")!;
    const row = group.querySelector(".attachment-row")!;
    expect([group.getAttribute("role"), group.getAttribute("aria-label")]).toEqual(["group", "Attached images"]);
    expect(row.children.map((each) => each.getAttribute("class"))).toEqual(["attachment", "attachment"]);
  });

  test("a photo from the camera is added after the pictures already there, and the gallery adds after it again", async () => {
    const { pick, takePhoto, shown, uploads } = composer();
    pick(shot("a.png"), shot("b.png"));
    await flush();
    takePhoto(shot("photo.jpg"));
    await flush();
    takePhoto(shot("photo-2.jpg"));
    await flush();
    pick(shot("c.png"));
    await flush();
    expect(shown().map(([text]) => text)).toEqual(["a.png Uploading…", "b.png Uploading…", "photo.jpg Uploading…", "photo-2.jpg Uploading…", "c.png Uploading…"]);
    expect(uploads.filter((upload) => upload.signal?.aborted)).toEqual([]);
  });

  test("the first picture of each pick is brought into view in the row, without moving the page up or down", async () => {
    const { pick, takePhoto, chips } = composer();
    pick(shot("a.png"), shot("b.png"), shot("c.png"));
    await flush();
    takePhoto(shot("photo.jpg"));
    await flush();
    expect(chips().map((chip) => chip.scrolledIntoView)).toEqual([[{ block: "nearest", inline: "nearest" }], [], [], [{ block: "nearest", inline: "nearest" }]]);
  });

  test("once ✕ empties the row, it starts again from its start, so the next first picture isn't scrolled out of sight", async () => {
    const { pick, root, removeOf } = composer();
    pick(shot("a.png"), shot("b.png"));
    await flush();
    rowOf(root).scrollLeft = SCROLLED_PX;
    removeOf(0).dispatch("click");
    removeOf(0).dispatch("click");
    expect(rowOf(root).scrollLeft).toBe(0);
  });

  test("once a send empties the row, it starts again from its start, so the next first picture isn't scrolled out of sight", async () => {
    const { pick, root, uploads, attachment, deliver } = composer();
    pick(shot("c.png"), shot("d.png"));
    await flush();
    uploads.forEach((upload) => upload.settle(SAVED));
    await flush();
    rowOf(root).scrollLeft = SCROLLED_PX;
    await attachment.send("", deliver());
    expect(rowOf(root).scrollLeft).toBe(0);
  });

  test("at most 10: picking past 10 attaches the first ones up to 10 and says plainly that the rest were left out", async () => {
    const { pick, takePhoto, chips, uploads, previews, count, removeOf } = composer();
    pick(...shots(3));
    await flush();
    pick(...shots(9, 4));
    await flush();
    expect(chips().map((each) => each.querySelector(".attachment-name")!.textContent)).toEqual(shots(10).map((file) => file.name));
    expect([uploads.length, previews.created.length]).toEqual([10, 10]);
    expect(count()).toBe("10 of 10 pictures · 2 left out (10 at most)");
    takePhoto(shot("photo.jpg"));
    await flush();
    expect([chips().length, uploads.length, count()]).toEqual([10, 10, "10 of 10 pictures · 1 left out (10 at most)"]);
    removeOf(0).dispatch("click");
    expect([chips().length, count()]).toEqual([9, "9 of 10 pictures"]);
    pick(shot("last.png"));
    await flush();
    expect([chips().length, count()]).toEqual([10, "10 of 10 pictures"]);
  });

  test("✕ removes only its own picture: only its upload stops and only its thumbnail goes", async () => {
    const { pick, shown, uploads, previews, removeOf } = composer();
    pick(shot("a.png"), shot("b.png"), shot("c.png"));
    await flush();
    removeOf(1).dispatch("click");
    expect(shown().map(([text]) => text)).toEqual(["a.png Uploading…", "c.png Uploading…"]);
    expect(uploads.map((upload) => upload.signal?.aborted)).toEqual([false, true, false]);
    expect(previews.revoked).toEqual([previews.created[1]]);
  });

  test("after ✕ the focus goes to the next chip's ✕, to the one before when it was the last, and to the paperclip when none is left", async () => {
    const { pick, removeOf, chips, doc, button } = composer();
    pick(shot("a.png"), shot("b.png"), shot("c.png"), shot("d.png"));
    await flush();
    const [a, b, c, d] = chips().map((each) => each.querySelector(".attachment-remove")!);
    removeOf(1).dispatch("click");
    expect(doc.activeElement).toBe(c);
    removeOf(2).dispatch("click");
    expect(doc.activeElement).toBe(c);
    removeOf(0).dispatch("click");
    expect(doc.activeElement).toBe(c);
    removeOf(0).dispatch("click");
    expect([chips().length, doc.activeElement, [a, b, d].every((key) => !key.isConnected)]).toEqual([0, button(), true]);
  });

  test("pictures are made smaller one at a time, and one removed while it waits is never redrawn", async () => {
    const waiting: { name: string; done: () => void }[] = [];
    const prepare = (file: File) => new Promise<{ blob: Blob; name: string }>((resolve) => waiting.push({ name: file.name, done: () => resolve({ blob: file, name: file.name }) }));
    const { pick, uploads, removeOf } = composer({ prepare });
    pick(shot("a.png"), shot("b.png"), shot("c.png"));
    await flush();
    expect(waiting.map(({ name }) => name)).toEqual(["a.png"]);
    removeOf(1).dispatch("click");
    waiting[0].done();
    await flush();
    expect(waiting.map(({ name }) => name)).toEqual(["a.png", "c.png"]);
    waiting[1].done();
    await flush();
    expect(uploads.map((upload) => upload.name)).toEqual(["a.png", "c.png"]);
  });

  test("a late answer for a removed picture is ignored, and the others still take theirs", async () => {
    const { pick, shown, uploads, removeOf, attachment, sentMessages, deliver } = composer();
    pick(shot("a.png"), shot("b.png"));
    await flush();
    removeOf(0).dispatch("click");
    uploads[0].settle(savedAs("/up/a.png"));
    uploads[1].settle(savedAs("/up/b.png"));
    await flush();
    expect(shown()).toEqual([["b.png 1.2 MB", "attached"]]);
    await attachment.send("", deliver());
    expect(sentMessages).toEqual(["/up/b.png"]);
  });

  test("the message is the typed text, one space, then every path in chip order, space-separated, once", async () => {
    const { attachment, sentMessages, deliver, shown, count } = await threeAttached();
    expect(await attachment.send("Compare these  \n", deliver())).toEqual({ sent: true });
    expect(sentMessages).toEqual(["Compare these /up/a.png /up/b.png /up/c.png"]);
    expect([shown(), count()]).toEqual([[], null]);
  });

  test("with nothing typed the message is the paths alone", async () => {
    const { attachment, sentMessages, deliver } = await threeAttached();
    await attachment.send(" \n", deliver());
    expect(sentMessages).toEqual(["/up/a.png /up/b.png /up/c.png"]);
  });

  test("the send waits until every picture is attached, and then sends them all", async () => {
    const { attachment, pick, uploads, sentMessages, deliver } = composer();
    pick(shot("a.png"), shot("b.png"), shot("c.png"));
    await flush();
    uploads[0].settle(savedAs("/up/a.png"));
    uploads[2].settle(savedAs("/up/c.png"));
    await flush();
    expect(await attachment.send("look", deliver())).toEqual({ sent: false, refused: "The image is still uploading. Wait for it, or remove it." });
    uploads[1].settle(savedAs("/up/b.png"));
    await flush();
    await attachment.send("look", deliver());
    expect(sentMessages).toEqual(["look /up/a.png /up/b.png /up/c.png"]);
  });

  test("while several upload, or after any failed, nothing is sent and the reason counts them", async () => {
    const { attachment, pick, uploads, sentMessages, deliver, removeOf, shown } = composer();
    pick(shot("a.png"), shot("b.png"), shot("c.png"));
    await flush();
    expect((await attachment.send("look", deliver())).refused).toBe("3 images are still uploading. Wait for them, or remove them.");
    uploads[0].settle(coded("unreachable", "The laptop didn't answer."));
    uploads[1].settle(coded("payload_too_large", "Too big. The limit is 15 MB."));
    await flush();
    expect((await attachment.send("look", deliver())).refused).toBe("2 images didn't upload. Remove them to send without them.");
    removeOf(0).dispatch("click");
    uploads[2].settle(savedAs("/up/c.png"));
    await flush();
    expect((await attachment.send("look", deliver())).refused).toBe("The image didn't upload. Remove it to send without it.");
    removeOf(0).dispatch("click");
    await attachment.send("look", deliver());
    expect([sentMessages, shown()]).toEqual([["look /up/c.png"], []]);
  });

  test("a failed send keeps every chip, and sending again sends the same paths, still once", async () => {
    const { attachment, sentMessages, deliver, shown, count } = await threeAttached();
    expect(await attachment.send("look", deliver(false))).toEqual({ sent: false });
    expect([shown().length, count()]).toEqual([3, "3 of 10 pictures"]);
    await attachment.send("look", deliver(true));
    expect(sentMessages).toEqual(["look /up/a.png /up/b.png /up/c.png", "look /up/a.png /up/b.png /up/c.png"]);
  });

  test("a picture added while the message is going stays after it went; the ones sent clear", async () => {
    const { attachment, pick, uploads, shown } = await threeAttached();
    let finish: (sent: boolean) => void = () => {};
    const sending = attachment.send("look", () => new Promise<boolean>((resolve) => (finish = resolve)));
    pick(shot("later.png"));
    await flush();
    uploads[3].settle(savedAs("/up/later.png"));
    await flush();
    finish(true);
    await sending;
    expect(shown()).toEqual([["later.png 1.2 MB", "attached"]]);
  });

  test("a newly drawn screen drops them all: every upload stops and every thumbnail goes", async () => {
    const made = composer();
    made.pick(shot("a.png"), shot("b.png"), shot("c.png"));
    await flush();
    made.uploads[0].settle(savedAs("/up/a.png"));
    await flush();
    made.root.innerHTML = `<div class="controls">${composerHtml()}</div>`;
    made.attachment.attach(asPageElement(made.root));
    expect([made.chips().length, made.count(), made.uploads.slice(1).map((upload) => upload.signal?.aborted), made.previews.revoked]).toEqual([0, null, [true, true], made.previews.created]);
    made.uploads[1].settle(savedAs("/up/b.png"));
    await flush();
    expect(made.chips()).toEqual([]);
  });

  test("a blocked Agent hides every chip and the count with the message box, and they are back as they were", async () => {
    const made = await threeAttached();
    const draw = (blocked: boolean) => drawComposer(asPageElement(made.root), { target: "weather-app", sending: false, blocked });
    draw(true);
    expect([made.shown(), made.count()]).toEqual([[], null]);
    draw(false);
    expect([made.shown(), made.count()]).toEqual([
      [
        ["a.png 1.2 MB", "attached"],
        ["b.png 1.2 MB", "attached"],
        ["c.png 1.2 MB", "attached"],
      ],
      "3 of 10 pictures",
    ]);
  });
});

describe("the chip and the message box together", () => {
  test("a blocked Agent hides the chip with the box, and it is back, as it was, when the Agent isn't blocked", async () => {
    const made = composer();
    made.pick(shot());
    await flush();
    made.uploads[0].settle(SAVED);
    await flush();
    const draw = (blocked: boolean) => drawComposer(asPageElement(made.root), { target: "weather-app", sending: false, blocked });
    draw(false);
    expect(made.chip().shown).toBe(true);
    draw(true);
    expect([made.chip().shown, made.button().shown]).toEqual([false, false]);
    draw(false);
    expect([made.chip().shown, made.text()]).toEqual([true, "screenshot.png 1.2 MB"]);
  });

  test("a newly drawn screen starts with no chip, so an image never follows you into another Terminal", async () => {
    const made = composer();
    made.pick(shot());
    await flush();
    made.uploads[0].settle(SAVED);
    await flush();
    made.root.innerHTML = `<div class="controls">${composerHtml()}</div>`;
    made.attachment.attach(asPageElement(made.root));
    expect([made.state(), made.previews.revoked]).toEqual([null, [made.previews.created[0]]]);
    const results = await made.attachment.send("hello", made.deliver());
    expect([results.sent, made.sentMessages]).toEqual([true, ["hello"]]);
  });
});

// A Terminal screen as the app draws it: the key bar first, then the attachment.
function clipScreen() {
  const screen = keyBarScreen();
  const uploads: Upload[] = [];
  const attachment = createAttachment({
    client: {
      isSample: false,
      uploadImage: (blob: Blob, name: string, options?: { signal?: AbortSignal }) => {
        const upload = new Upload(blob, name, options?.signal);
        uploads.push(upload);
        return upload.promise;
      },
    } as unknown as Parameters<typeof createAttachment>[0]["client"],
    previews: { create: () => "blob:preview", revoke: () => {} },
    prepare: async (file) => ({ blob: file, name: file.name }),
  });
  const opened: string[] = [];
  const draw = () => {
    attachment.attach(asPageElement(screen.root));
    Object.assign(screen.root.querySelector(".attach-camera")!, { click: () => void opened.push("camera") });
    Object.assign(screen.root.querySelector(".attach-input")!, { click: () => void opened.push("gallery") });
  };
  draw();
  const menu = () => screen.dialog("Attach an image");
  const clip = () => screen.button("Attach an image");
  return {
    ...screen,
    attachment,
    uploads,
    opened,
    menu,
    clip,
    menuState: () => [menu().shown, clip().getAttribute("aria-expanded")],
    rows: () => menu().querySelectorAll("button").filter((row) => row.shown).map((row) => row.getAttribute("aria-label") ?? row.textContent.trim()),
    open: () => screen.click(clip()),
    redraw() {
      screen.root.innerHTML = `<div class="output" tabindex="0"></div><div class="controls">${composerHtml()}<p class="notice"></p></div>`;
      screen.keyBar.attach(asPageElement(screen.root), { sendKey: () => {}, sendText: () => {}, announce: () => {} });
      draw();
    },
  };
}

describe("the clip menu", () => {
  test("a tap on the paperclip opens a small menu instead of a picker, with Take a photo and Choose a picture, and the focus on Take a photo", () => {
    const screen = clipScreen();
    const clip = screen.clip();
    expect([clip.getAttribute("aria-haspopup"), clip.getAttribute("aria-controls"), clip.getAttribute("aria-expanded")]).toEqual(["dialog", screen.menu().id, "false"]);
    expect(screen.menu().shown).toBe(false);
    screen.open();
    expect(screen.menuState()).toEqual([true, "true"]);
    expect(screen.rows()).toEqual(["Take a photo", "Choose a picture"]);
    expect(screen.focused()).toBe(screen.button("Take a photo"));
    expect(screen.menu().querySelectorAll("button use").map((use) => use.getAttribute("href"))).toEqual(["#i-camera", "#i-picture"]);
    expect(screen.opened).toEqual([]);
  });

  test("Esc, a tap outside it and a second tap on the paperclip each close it, with the focus back on the paperclip and no picker opened", () => {
    const screen = clipScreen();
    const closes = [
      () => screen.focused()!.dispatch("keydown", { key: "Escape" }),
      () => screen.click(screen.root.querySelector(".output")!),
      () => screen.open(),
    ];
    for (const close of closes) {
      screen.open();
      expect(screen.menu().shown).toBe(true);
      close();
      expect(screen.menuState()).toEqual([false, "false"]);
      expect(screen.focused()).toBe(screen.clip());
    }
    expect(screen.opened).toEqual([]);
  });

  test("Esc says it handled the key, and does nothing while the menu is closed", () => {
    const screen = clipScreen();
    screen.open();
    expect(screen.focused()!.dispatch("keydown", { key: "Escape" }).defaultPrevented).toBe(true);
    expect(screen.root.querySelector("#message")!.dispatch("keydown", { key: "Escape" }).defaultPrevented).toBe(false);
    screen.open();
    expect(screen.focused()!.dispatch("keydown", { key: "Enter" }).defaultPrevented).toBe(false);
    expect(screen.menu().shown).toBe(true);
  });

  test("a tap inside the menu that isn't on a row leaves it open", () => {
    const screen = clipScreen();
    screen.open();
    screen.click(screen.menu());
    expect(screen.menu().shown).toBe(true);
  });

  test("Take a photo opens the camera and Choose a picture the gallery; either closes the menu and gives the focus back to the paperclip", () => {
    const screen = clipScreen();
    screen.open();
    screen.click(screen.button("Take a photo"));
    expect([screen.opened, screen.menu().shown, screen.focused()]).toEqual([["camera"], false, screen.clip()]);
    screen.open();
    screen.click(screen.button("Choose a picture"));
    expect([screen.opened, screen.menu().shown, screen.focused()]).toEqual([["camera", "gallery"], false, screen.clip()]);
  });

  test("the camera's input asks for the back camera, for one image; the gallery's doesn't ask for a camera", () => {
    const { root } = clipScreen();
    const camera = root.querySelector(".attach-camera")!;
    const gallery = root.querySelector(".attach-input")!;
    expect([camera.getAttribute("type"), camera.getAttribute("accept"), camera.getAttribute("capture"), camera.hasAttribute("multiple"), camera.hidden]).toEqual(["file", "image/*", "environment", false, true]);
    expect([gallery.getAttribute("accept"), gallery.hasAttribute("capture")]).toEqual(["image/*", false]);
  });

  test("a photo from the camera or a picture from the gallery becomes the chip and goes up once, and its input is ready for the same file again", async () => {
    for (const selector of [".attach-camera", ".attach-input"]) {
      const screen = clipScreen();
      const input = screen.root.querySelector(selector)!;
      Object.assign(input, { files: [shot("photo.jpg")] });
      input.value = "C:\\fakepath\\photo.jpg";
      input.dispatch("change");
      await flush();
      expect(screen.uploads.map((upload) => upload.name)).toEqual(["photo.jpg"]);
      expect(input.value).toBe("");
      screen.uploads[0].settle(SAVED);
      await flush();
      const chip = screen.root.querySelector(".attachment")!;
      expect([chip.shown, chip.getAttribute("data-state")]).toEqual([true, "attached"]);
      const sent: string[] = [];
      await screen.attachment.send("look", async (message) => Boolean(sent.push(message)));
      expect(sent).toEqual([`look ${SAVED.path}`]);
    }
  });

  test("opening / closes the clip menu, and opening the clip menu closes /, each taking the focus", () => {
    const screen = clipScreen();
    const saved = () => screen.root.querySelector(".saved")!;
    const slash = () => screen.button("Saved commands");
    screen.open();
    screen.click(slash());
    expect([screen.menu().shown, screen.clip().getAttribute("aria-expanded"), saved().shown]).toEqual([false, "false", true]);
    expect(screen.focused()).toBe(screen.button("continue"));
    screen.open();
    expect([saved().shown, slash().getAttribute("aria-expanded"), screen.menu().shown]).toEqual([false, "false", true]);
    expect(screen.focused()).toBe(screen.button("Take a photo"));
  });

  test("a saved command from / goes exactly as written, with no picture, and the pictures stay for the next message", async () => {
    const screen = clipScreen();
    choose(screen.root.querySelector(".attach-input")!, [shot("a.png"), shot("b.png")]);
    await flush();
    screen.uploads.forEach((upload) => upload.settle(SAVED));
    await flush();
    screen.click(screen.button("Saved commands"));
    screen.click(screen.button("continue"));
    expect(screen.sentTexts).toEqual(["continue"]);
    expect(screen.root.querySelectorAll(".attachment").map((chip) => chip.getAttribute("data-state"))).toEqual(["attached", "attached"]);
  });

  test("a blocked Agent closes it with the message box, and it stays closed when the Agent isn't blocked", () => {
    const screen = clipScreen();
    const draw = (blocked: boolean) => {
      drawComposer(asPageElement(screen.root), { target: "weather-app", sending: false, blocked });
      screen.keyBar.setBlocked(blocked);
      screen.attachment.setBlocked(blocked);
    };
    draw(false);
    screen.open();
    draw(false);
    expect(screen.menu().shown).toBe(true);
    draw(true);
    expect([screen.menu().shown, screen.root.querySelector(".attach")!.shown]).toEqual([false, false]);
    draw(false);
    expect(screen.menuState()).toEqual([false, "false"]);
    screen.open();
    expect(screen.menu().shown).toBe(true);
  });

  test("a newly drawn screen starts with it closed, and the first tap on its paperclip opens it", () => {
    const screen = clipScreen();
    screen.open();
    screen.redraw();
    expect(screen.menu().shown).toBe(false);
    screen.open();
    expect([screen.menu().shown, screen.focused()]).toEqual([true, screen.button("Take a photo")]);
  });

  test("leaving the screen with it open: a later tap on whatever the page shows next is ignored, not an error", () => {
    const screen = clipScreen();
    screen.open();
    screen.root.innerHTML = '<button type="button">A home row</button>';
    const homeRow = screen.root.querySelectorAll("button")[0];
    expect(() => screen.click(homeRow)).not.toThrow();
    expect(() => screen.click(homeRow)).not.toThrow();
  });

  test("its two icons are drawn in the page's sprite", () => {
    const page = readFileSync(join(import.meta.dir, "../web/index.html"), "utf8");
    expect(["i-camera", "i-picture"].filter((id) => !page.includes(`<symbol id="${id}" viewBox="0 0 24 24">`))).toEqual([]);
  });
});

describe("?demo", () => {
  test("shows the button and three made-up attached chips with no thumbnails, and uploads nothing", async () => {
    const { shown, count, uploads, button, chips } = composer({ sample: true });
    expect(shown()).toEqual([
      ["screenshot.png 1.2 MB", "attached"],
      ["error-dialog.png 864 KB", "attached"],
      ["whiteboard.jpg 2.1 MB", "attached"],
    ]);
    expect([count(), uploads.length, button().shown, chips().flatMap((each) => each.querySelectorAll("img")).length]).toEqual(["3 of 10 pictures", 0, true, 0]);
  });

  test("sending them puts the made-up paths in the message, and the chips clear", async () => {
    const { attachment, sentMessages, deliver, state } = composer({ sample: true });
    await attachment.send("what is this?", deliver());
    expect(sentMessages).toEqual([
      "what is this? /home/you/hermux/.uploads/20261105T091500Z-3f9c2a71b8d04e65.png /home/you/hermux/.uploads/20261105T091512Z-8a1d4e07c2b95f36.png /home/you/hermux/.uploads/20261105T091530Z-c70e2b9f41d6a853.jpg",
    ]);
    expect(state()).toBeNull();
  });
});

describe("sizes", () => {
  test("are written the way a phone shows them", () => {
    expect([0, 812, 1023, 1024, 340 * 1024 + 300, 1024 * 1024 - 1, 1024 * 1024, 1_258_291, 15 * 1024 * 1024].map(formatSize)).toEqual(["0 B", "812 B", "1023 B", "1 KB", "340 KB", "1023 KB", "1.0 MB", "1.2 MB", "15.0 MB"]);
  });
});

describe("the stylesheet's targets for the chip and the button, read because the fake DOM has no layout", () => {
  const css = readFileSync(join(import.meta.dir, "../web/app.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rulesFor = (selector: string) =>
    [...css.matchAll(/(?:^|\n)([^{}\n][^{}]*)\{([^}]*)\}/g)]
      .map(([, selectors, body]) => ({
        selectors: selectors.split(",").map((each) => each.trim()),
        body: Object.fromEntries(body.split(";").map((line) => line.split(":").map((part) => part.trim())).filter((pair) => pair.length === 2)),
      }))
      .filter((rule) => rule.selectors.includes(selector));
  const declarations = (selector: string) => {
    const [first] = rulesFor(selector);
    if (!first) throw new Error(`No rule for ${selector}`);
    return first.body;
  };

  test("the attach button and the ✕ are 48px targets, and the chip is one 48px row", () => {
    expect([declarations(".attach").width, declarations(".attach").height]).toEqual(["var(--key)", "var(--key)"]);
    expect([declarations(".attachment-remove").width, declarations(".attachment-remove").height]).toEqual(["var(--key)", "var(--key)"]);
    expect(declarations(".attachment").height).toBe("var(--key)");
  });

  test("the chips' row never wraps, swipes sideways edge to edge like the key row and hides its scrollbar as the key row does", () => {
    const ownRule = rulesFor(".attachment-row").find((rule) => rule.selectors.length === 1)?.body;
    expect([ownRule?.display, ownRule?.["flex-wrap"], ownRule?.["overflow-x"], ownRule?.margin, ownRule?.padding]).toEqual(["flex", "nowrap", "auto", "0 var(--bleed)", "0 var(--gutter)"]);
    const scrollbarRule = (selector: string) => rulesFor(selector).find((rule) => rule.body["scrollbar-width"] !== undefined);
    expect(scrollbarRule(".attachment-row")?.body["scrollbar-width"]).toBe("none");
    expect(scrollbarRule(".attachment-row")).toEqual(scrollbarRule(".keys"));
    expect(declarations(".attachment-row::-webkit-scrollbar").display).toBe("none");
    expect(declarations(".attachment").flex).toBe("none");
  });

  test("the count line is small Legend Grey text on one line", () => {
    const line = declarations(".attachment-count");
    expect([line["font-size"], line.color, line["white-space"]]).toEqual(["var(--text-s)", "var(--ink-soft)", "nowrap"]);
  });

  test("the clip menu's rows are at least 56px tall, and the menu is raised like the / popover, above the box", () => {
    expect([declarations(".clip-item")["min-height"], declarations(":root")["--row"]]).toEqual(["var(--row)", "56px"]);
    expect(declarations(".clip-menu")).toEqual(declarations(".saved"));
    expect(declarations(".clip-menu")["box-shadow"]).toBe("0 -4px 16px var(--switcher-shade)");
    expect(declarations(".clip-menu[hidden]").display).toBe("none");
  });

  test("while the clip menu is open the paperclip's face has the same ink ring as / while its popover is open", () => {
    const ring = declarations('.attach[aria-expanded="true"]::before');
    expect(ring["box-shadow"]).toBe("inset 0 0 0 2px var(--ink)");
    expect(ring).toEqual(declarations('.slash[aria-expanded="true"]::before'));
  });
});

describe("the page's client and the server agree", () => {
  const realFetch = globalThis.fetch;
  const servers: ReturnType<typeof Bun.serve>[] = [];
  afterAll(() => {
    globalThis.fetch = realFetch;
    for (const server of servers) server.stop(true);
  });

  function connect() {
    const { uploads, dir } = makeUploads();
    const app = createApp({ herdr: createHerdr("/nonexistent/herdr"), allowedLogin: ALLOWED_LOGIN, webRoot: WEB, uploads });
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app });
    servers.push(server);
    const toServer = (input: string | URL | Request, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set("Tailscale-User-Login", ALLOWED_LOGIN);
      return realFetch(`http://127.0.0.1:${server.port}/${input}`, { ...init, headers });
    };
    globalThis.fetch = Object.assign(toServer, { preconnect: realFetch.preconnect });
    return { dir };
  }

  test("uploadImage sends the image as a form and gets back where the laptop put it", async () => {
    const { dir } = connect();
    const saved = await createHttpClient().uploadImage(new File([image.png(128)], "ignored.png", { type: "image/png" }), "screenshot.png");
    expect(saved.path.startsWith(`${dir}/`)).toBe(true);
    expect(saved.size).toBe(128);
    expect(saved.name).not.toContain("screenshot");
  });

  test("a file that isn't an image comes back as the plain reason the chip shows", async () => {
    connect();
    const failure = await createHttpClient().uploadImage(new File(["words"], "notes.png", { type: "image/png" }), "notes.png").catch((error: Error) => error);
    expect(failure).toMatchObject({ code: "unsupported_media_type", message: "Not an image the laptop can take. Use PNG, JPEG, WebP, GIF or HEIC." });
  });

  test("an image over the limit comes back as the plain reason the chip shows", async () => {
    connect();
    const failure = await createHttpClient().uploadImage(new File([image.png(15 * 1024 * 1024 + 1)], "big.png", { type: "image/png" }), "big.png").catch((error: Error) => error);
    expect(failure).toMatchObject({ code: "payload_too_large", message: "Too big. The limit is 15 MB." });
  });
});
