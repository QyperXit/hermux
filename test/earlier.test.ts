import { describe, expect, test } from "bun:test";
import type { HistoryPage, Message } from "../server/history";
import { createEarlier } from "../web/earlier.js";

type EarlierScreen = Parameters<ReturnType<typeof createEarlier>["open"]>[2];

const MESSAGE_PX = 100;
const NOTE_PX = 40;
const JOIN_PX = 40;
const CLIENT_PX = 800;

function screen(liveHeight = 2000) {
  const listeners = new Set<() => void>();
  const items: { seq: number; html: string }[] = [];
  const note = { textContent: "" as string | null };
  const region = { hidden: true as boolean | "until-found", dataset: {} as DOMStringMap };
  const gap = { hidden: true as boolean | "until-found" };
  let top = 0;
  let reported = 0;
  const shown = () => region.hidden === false;
  const contentAbove = () => (shown() ? NOTE_PX + items.length * MESSAGE_PX : 0);
  const output = {
    clientHeight: CLIENT_PX,
    get scrollHeight() {
      return contentAbove() + (shown() ? JOIN_PX : 0) + liveHeight;
    },
    get scrollTop() {
      return top;
    },
    set scrollTop(value: number) {
      top = Math.max(0, Math.min(value, output.scrollHeight - CLIENT_PX));
    },
    getBoundingClientRect: () => ({ top: 0 }),
    addEventListener: (_type: "scroll", listener: () => void) => void listeners.add(listener),
    removeEventListener: (_type: "scroll", listener: () => void) => void listeners.delete(listener),
  };
  const itemsElement = {
    insertAdjacentHTML(where: "afterbegin" | "beforeend", html: string) {
      const added = html.split(/(?=<div class="h-msg")/).map((one) => ({ seq: Number(/data-seq="(\d+)"/.exec(one)?.[1]), html: one }));
      if (where === "afterbegin") items.unshift(...added);
      else items.push(...added);
    },
    replaceChildren() {
      items.length = 0;
      output.scrollTop = top;
    },
    get firstElementChild() {
      return items.length
        ? {
            remove() {
              items.shift();
              output.scrollTop = top;
            },
          }
        : null;
    },
    querySelector(selector: string) {
      const found = items.find((item) => selector.includes(`data-seq="${item.seq}"`));
      return found
        ? {
            get outerHTML() {
              return found.html;
            },
            set outerHTML(html: string) {
              found.html = html;
            },
          }
        : null;
    },
  };
  const elements: EarlierScreen = { output, region, note, items: itemsElement, gap, join: { getBoundingClientRect: () => ({ top: contentAbove() - top }) } };
  return {
    elements,
    note,
    region,
    gap,
    seqs: () => items.map((item) => item.seq),
    html: (seq: number) => items.find((item) => item.seq === seq)?.html,
    scrollTop: () => output.scrollTop,
    viewTop: () => {
      const into = output.scrollTop - NOTE_PX;
      return { seq: items[Math.floor(into / MESSAGE_PX)]?.seq, into: into % MESSAGE_PX };
    },
    liveTop: () => contentAbove() + (shown() ? JOIN_PX : 0) - top,
    scrollTo(position: number) {
      output.scrollTop = position;
      reported = top;
      for (const listener of [...listeners]) listener();
    },
    flushScroll() {
      if (top === reported) return;
      reported = top;
      for (const listener of [...listeners]) listener();
    },
    scrollToEnd() {
      output.scrollTop = output.scrollHeight;
    },
    listeners: () => listeners.size,
    snapshot: () => JSON.stringify({ seqs: items.map((item) => item.seq), note: note.textContent, hidden: region.hidden, status: region.dataset.status, gap: gap.hidden, top, height: output.scrollHeight }),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function client() {
  const requests: { paneId: string; query: { before?: number | null; from?: number; limit?: number }; answer: ReturnType<typeof deferred<HistoryPage>> }[] = [];
  return {
    requests,
    readHistory(paneId: string, query: { before?: number | null; from?: number; limit?: number } = {}) {
      const answer = deferred<HistoryPage>();
      requests.push({ paneId, query, answer });
      return answer.promise;
    },
    asked: () => requests.map(({ paneId, query }) => ({ paneId, ...query })),
  };
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const message = (seq: number, text = `message ${seq}`): Message => ({ seq, role: "assistant", blocks: [{ kind: "text", text }] });
const range = (first: number, last: number) => Array.from({ length: last - first + 1 }, (_, n) => first + n);
const page = (seqs: number[], before: number | null, { join, session = "s1" }: { join?: number; session?: string } = {}): HistoryPage => ({
  history: { session, messages: seqs.map((seq) => message(seq)), before, ...(join === undefined ? {} : { join }) },
});
const NO_MATCH: HistoryPage = { history: null, reason: "no_match" };

const liveScreen = (top: number, timer = "12s") => [...range(top, top + 7).map((n) => ` report line ${n} of the long working session`), ` Working… ${timer}`].join("\n");

function agent({ liveHeight = 2000, paneId = "w8:p2" }: { liveHeight?: number; paneId?: string } = {}) {
  const fake = client();
  const earlier = createEarlier({ client: fake });
  const view = screen(liveHeight);
  earlier.open(paneId, "agent", view.elements);
  view.scrollToEnd();
  earlier.live(liveScreen(1));
  return { earlier, fake, view };
}

describe("an Agent's Earlier messages load as the reader scrolls up", () => {
  test("at the top, a page arrives above the Live screen and the view stays where it was", async () => {
    const { fake, view } = agent();
    expect(fake.requests).toHaveLength(0);
    expect(view.region.hidden).toBe(false);
    expect(view.note.textContent).toBe("Scroll up for earlier messages");

    view.scrollTo(100);
    expect(fake.asked()).toEqual([{ paneId: "w8:p2", before: undefined }]);
    expect(view.note.textContent).toBe("Loading earlier messages…");
    const liveTop = view.liveTop();

    fake.requests[0].answer.resolve(page(range(11, 20), 10, { join: 21 }));
    await settle();
    expect(view.seqs()).toEqual(range(11, 20));
    expect(view.note.textContent).toBe("Scroll up for earlier messages");
    expect(view.liveTop()).toBe(liveTop);
    expect(view.scrollTop()).toBe(100 + 10 * MESSAGE_PX);
  });

  test("it asks only within 240px of the top, and one page at a time", async () => {
    const { fake, view } = agent();
    view.scrollTo(100);
    view.scrollTo(50);
    expect(fake.requests).toHaveLength(1);
    fake.requests[0].answer.resolve(page(range(11, 20), 10, { join: 21 }));
    await settle();

    view.scrollTo(240);
    expect(fake.requests).toHaveLength(1);
    view.scrollTo(239);
    expect(fake.asked()[1]).toEqual({ paneId: "w8:p2", before: 10 });
  });

  test("the start of the conversation says so, and nothing more is asked", async () => {
    const { fake, view } = agent();
    view.scrollTo(100);
    fake.requests[0].answer.resolve(page([1, 2], null, { join: 3 }));
    await settle();
    expect(view.note.textContent).toBe("Start of the conversation");
    view.scrollTo(0);
    expect(fake.requests).toHaveLength(1);
  });

  test("a failed read says so, and the next scroll to the top tries again", async () => {
    const { fake, view } = agent();
    view.scrollTo(100);
    fake.requests[0].answer.reject(new Error("The laptop didn't answer."));
    await settle();
    expect(view.note.textContent).toBe("Earlier messages not loaded. The laptop didn't answer. Scroll up to try again.");
    view.scrollTo(100);
    expect(fake.requests).toHaveLength(2);
  });

  test("a screen too short to scroll loads without a scroll, and stops asking once the messages fill it", async () => {
    const { earlier, fake, view } = agent({ liveHeight: 500 });
    expect(fake.asked()).toEqual([{ paneId: "w8:p2", before: undefined }]);
    fake.requests[0].answer.resolve(page(range(11, 20), 10, { join: 21 }));
    await settle();
    earlier.live(liveScreen(1, "14s"));
    expect(view.seqs()).toEqual(range(11, 20));
    expect(fake.requests).toHaveLength(1);
  });

  test("a Terminal that is only known after its Live screen was drawn shows the note without loading until the reader scrolls", () => {
    const fake = client();
    const earlier = createEarlier({ client: fake });
    const view = screen(760);
    view.scrollToEnd();
    earlier.live(liveScreen(1));
    view.flushScroll();
    earlier.open("w8:p2", "agent", view.elements);
    expect(view.region.hidden).toBe(false);
    expect(view.note.textContent).toBe("Scroll up for earlier messages");
    // Showing the note moved the view to the end, near the top of a screen this short: not the reader's scroll.
    expect(view.scrollTop()).toBe(40);
    view.flushScroll();
    expect(fake.requests).toHaveLength(0);
    view.scrollTo(20);
    expect(fake.requests).toHaveLength(1);
  });

  test("at the cap of 300 loading stops; what the Agent adds then pushes the oldest out, and the view stays", async () => {
    const { earlier, fake, view } = agent();
    for (const [n, seqs] of [range(501, 600), range(401, 500), range(301, 400)].entries()) {
      view.scrollTo(100);
      fake.requests[n].answer.resolve(page(seqs, seqs[0] - 1, n === 0 ? { join: 601 } : {}));
      await settle();
    }
    expect(view.seqs()).toEqual(range(301, 600));
    expect(view.note.textContent).toBe("Showing the 300 earlier messages nearest the screen");
    view.scrollTo(100);
    expect(fake.requests).toHaveLength(3);

    view.scrollTo(10100);
    const reading = view.viewTop();
    earlier.live(liveScreen(4));
    fake.requests[3].answer.resolve(page([601, 602, 603], null, { join: 604 }));
    await settle();
    expect(view.seqs()).toEqual(range(304, 603));
    expect(view.note.textContent).toBe("Showing the 300 earlier messages nearest the screen");
    expect(view.viewTop()).toEqual(reading);
  });

  test("a page on its way when what the Agent adds reaches the cap isn't put above: it would leave a hole", async () => {
    const { earlier, fake, view } = agent();
    for (const [n, seqs] of [range(511, 600), range(411, 510), range(311, 410)].entries()) {
      view.scrollTo(100);
      fake.requests[n].answer.resolve(page(seqs, seqs[0] - 1, n === 0 ? { join: 601 } : {}));
      await settle();
    }
    expect(view.seqs()).toEqual(range(311, 600));
    view.scrollTo(100);
    expect(fake.asked()[3]).toEqual({ paneId: "w8:p2", before: 310 });

    earlier.live(liveScreen(4));
    fake.requests[4].answer.resolve(page(range(601, 615), null, { join: 616 }));
    await settle();
    expect(view.seqs()).toEqual(range(316, 615));

    fake.requests[3].answer.resolve(page(range(211, 310), 210));
    await settle();
    expect(view.seqs()).toEqual(range(316, 615));
    expect(view.note.textContent).toBe("Showing the 300 earlier messages nearest the screen");
    view.scrollTo(100);
    expect(fake.requests).toHaveLength(5);
  });
});

describe("the Join stays joined while the Agent works", () => {
  const firstPage = () => ({ history: { session: "s1", messages: [...range(36, 39).map((seq) => message(seq)), message(40, "head of 40")], before: 35, join: 40 } });
  const scrolledOn = (fake: ReturnType<typeof client>, answer: HistoryPage) => fake.requests.at(-1)!.answer.resolve(answer);

  test("what scrolled off is added under the Earlier messages, once, with no message twice at the Join", async () => {
    const { earlier, fake, view } = agent();
    view.scrollTo(100);
    fake.requests[0].answer.resolve(firstPage());
    await settle();
    const liveTop = view.liveTop();

    // Only the timer changed: nothing scrolled off, nothing asked.
    earlier.live(liveScreen(1, "14s"));
    expect(fake.requests).toHaveLength(1);

    earlier.live(liveScreen(4));
    expect(fake.asked()[1]).toEqual({ paneId: "w8:p2", from: 40, limit: 100 });
    scrolledOn(fake, { history: { session: "s1", messages: [message(40, "the whole of 40"), message(41), message(42)], before: null, join: 43 } });
    await settle();
    expect(view.seqs()).toEqual([36, 37, 38, 39, 40, 41, 42]);
    expect(view.html(40)).toContain("the whole of 40");
    expect(view.html(40)).not.toContain("head of 40");
    expect(view.gap.hidden).toBe(true);
    expect(view.liveTop()).toBe(liveTop);

    earlier.live(liveScreen(9));
    expect(fake.asked()[2]).toEqual({ paneId: "w8:p2", from: 43, limit: 100 });
  });

  test("a reader at the top of the Earlier messages isn't moved by what is added below", async () => {
    const { earlier, fake, view } = agent();
    view.scrollTo(100);
    fake.requests[0].answer.resolve({ history: { ...firstPage().history, before: null } });
    await settle();
    view.scrollTo(100);
    earlier.live(liveScreen(4));
    scrolledOn(fake, { history: { session: "s1", messages: [message(41), message(42)], before: null, join: 43 } });
    await settle();
    expect(view.seqs()).toEqual([36, 37, 38, 39, 40, 41, 42]);
    expect(view.scrollTop()).toBe(100);
  });

  test("text that scrolled off while the first page was on its way is added when it arrives", async () => {
    const { earlier, fake, view } = agent();
    view.scrollTo(100);
    earlier.live(liveScreen(4));
    fake.requests[0].answer.resolve({ history: { ...firstPage().history, before: null } });
    await settle();
    expect(fake.asked()[1]).toEqual({ paneId: "w8:p2", from: 40, limit: 100 });
  });

  test("a gap that can't be filled is said once, and the next scroll-off tries again from the same Join", async () => {
    const { earlier, fake, view } = agent();
    view.scrollTo(100);
    fake.requests[0].answer.resolve(firstPage());
    await settle();

    earlier.live(liveScreen(4));
    scrolledOn(fake, NO_MATCH);
    await settle();
    expect(view.gap.hidden).toBe(false);

    earlier.live(liveScreen(9));
    expect(fake.asked()[2]).toEqual({ paneId: "w8:p2", from: 40, limit: 100 });
    scrolledOn(fake, { history: { session: "s1", messages: [message(40), message(41)], before: null, join: 42 } });
    await settle();
    expect(view.gap.hidden).toBe(true);
    expect(view.seqs()).toEqual([36, 37, 38, 39, 40, 41]);
  });

  test("a scroll-off while a fill is on its way asks nothing more then, and once after it from the new Join, with no message twice", async () => {
    const { earlier, fake, view } = agent();
    view.scrollTo(100);
    fake.requests[0].answer.resolve(firstPage());
    await settle();

    earlier.live(liveScreen(4));
    expect(fake.asked()[1]).toEqual({ paneId: "w8:p2", from: 40, limit: 100 });
    earlier.live(liveScreen(9));
    expect(fake.requests).toHaveLength(2);

    scrolledOn(fake, { history: { session: "s1", messages: [message(40, "the whole of 40"), message(41), message(42)], before: null, join: 43 } });
    await settle();
    expect(fake.asked()[2]).toEqual({ paneId: "w8:p2", from: 43, limit: 100 });
    scrolledOn(fake, { history: { session: "s1", messages: [message(43), message(44), message(45)], before: null, join: 46 } });
    await settle();
    expect(fake.requests).toHaveLength(3);
    expect(view.seqs()).toEqual(range(36, 45));
    expect(view.html(40)).toContain("the whole of 40");
  });
});

describe("a change of Session starts the Earlier messages again", () => {
  test("a page from another Session isn't joined to the ones shown", async () => {
    const { fake, view } = agent();
    view.scrollTo(100);
    fake.requests[0].answer.resolve(page(range(11, 20), 10, { join: 21 }));
    await settle();
    view.scrollTo(100);
    fake.requests[1].answer.resolve(page(range(91, 95), 90, { session: "s2" }));
    await settle();
    expect(view.seqs()).toEqual([]);
    expect(fake.asked()[2]).toEqual({ paneId: "w8:p2", before: undefined });
    fake.requests[2].answer.resolve(page(range(1, 4), null, { join: 5, session: "s2" }));
    await settle();
    expect(view.seqs()).toEqual(range(1, 4));
  });

  test("a gap answer from another Session drops the Earlier messages and loads the new Session's", async () => {
    const { earlier, fake, view } = agent();
    view.scrollTo(100);
    fake.requests[0].answer.resolve(page(range(11, 20), null, { join: 21 }));
    await settle();
    view.scrollTo(100);

    earlier.live(liveScreen(4));
    fake.requests[1].answer.resolve(page([1, 2], null, { join: 3, session: "s2" }));
    await settle();
    expect(view.seqs()).toEqual([]);
    expect(view.gap.hidden).toBe(true);
    expect(view.scrollTop()).toBe(0);
    expect(fake.asked()[2]).toEqual({ paneId: "w8:p2", before: undefined });
    fake.requests[2].answer.resolve(page([1, 2], null, { join: 3, session: "s2" }));
    await settle();
    expect(view.seqs()).toEqual([1, 2]);
  });
});

describe("a pane with no match", () => {
  test("is asked again when the Live screen has changed and the view is at the top, not when it hasn't", async () => {
    const { earlier, fake, view } = agent();
    view.scrollTo(100);
    fake.requests[0].answer.resolve(NO_MATCH);
    await settle();
    expect(view.note.textContent).toBe("No earlier messages: this pane's Atomic session wasn't found.");

    view.scrollTo(50);
    expect(fake.requests).toHaveLength(1);

    earlier.live(liveScreen(1, "14s"));
    expect(fake.requests).toHaveLength(2);
    expect(view.note.textContent).toBe("No earlier messages: this pane's Atomic session wasn't found.");
    fake.requests[1].answer.resolve(NO_MATCH);
    await settle();
    view.scrollTo(30);
    expect(fake.requests).toHaveLength(2);

    view.scrollTo(1000);
    earlier.live(liveScreen(1, "16s"));
    expect(fake.requests).toHaveLength(2);

    view.scrollTo(30);
    expect(fake.requests).toHaveLength(3);
    fake.requests[2].answer.resolve(page([7, 8], 6, { join: 9 }));
    await settle();
    expect(view.seqs()).toEqual([7, 8]);
    expect(view.note.textContent).toBe("Scroll up for earlier messages");
  });
});

describe("answers for a screen that was left", () => {
  // Leaving while a page is on its way writes the note only, at once (the screen
  // may still be shown, its Terminal gone): back to what it said before that page.
  function leaveWhileLoading(earlier: ReturnType<typeof createEarlier>, view: ReturnType<typeof screen>) {
    const loading = JSON.parse(view.snapshot());
    expect(loading.status).toBe("loading");
    earlier.leave();
    expect(JSON.parse(view.snapshot())).toEqual({ ...loading, note: "Scroll up for earlier messages", status: "idle" });
    return view.snapshot();
  }

  test("a page that arrives after leaving is dropped: nothing written after leaving, nothing kept for a reopened screen", async () => {
    const { earlier, fake, view } = agent();
    view.scrollTo(100);
    const left = leaveWhileLoading(earlier, view);
    fake.requests[0].answer.resolve(page(range(11, 20), 10, { join: 21 }));
    await settle();
    expect(view.snapshot()).toBe(left);

    // The same Terminal opened again starts from nothing.
    const reopened = screen();
    earlier.open("w8:p2", "agent", reopened.elements);
    reopened.scrollToEnd();
    earlier.live(liveScreen(1));
    reopened.scrollTo(100);
    expect(fake.asked()[1]).toEqual({ paneId: "w8:p2", before: undefined });
    expect(reopened.seqs()).toEqual([]);
  });

  test("a failure that arrives after leaving is dropped too", async () => {
    const { earlier, fake, view } = agent();
    view.scrollTo(100);
    const left = leaveWhileLoading(earlier, view);
    fake.requests[0].answer.reject(new Error("The laptop didn't answer."));
    await settle();
    expect(view.snapshot()).toBe(left);
  });

  test("a gap answer that arrives after leaving is dropped", async () => {
    const { earlier, fake, view } = agent();
    view.scrollTo(100);
    fake.requests[0].answer.resolve(page(range(11, 20), null, { join: 21 }));
    await settle();
    earlier.live(liveScreen(4));
    const left = view.snapshot();
    earlier.leave();
    fake.requests[1].answer.resolve(page([21, 22], null, { join: 23 }));
    await settle();
    expect(view.snapshot()).toBe(left);
  });

  test("opening another Terminal while a page is on its way: the late page is dropped and the new one loads on its own", async () => {
    const { earlier, fake, view } = agent({ paneId: "w8:p2" });
    view.scrollTo(100);
    const first = view.snapshot();

    const other = screen();
    earlier.open("w8:p4", "agent", other.elements);
    other.scrollToEnd();
    earlier.live(liveScreen(1));
    other.scrollTo(100);
    expect(fake.asked()).toEqual([
      { paneId: "w8:p2", before: undefined },
      { paneId: "w8:p4", before: undefined },
    ]);

    fake.requests[0].answer.resolve(page(range(11, 20), 10, { join: 21 }));
    await settle();
    expect(view.snapshot()).toBe(first);
    expect(other.seqs()).toEqual([]);
    fake.requests[1].answer.resolve(page([5, 6], null, { join: 7 }));
    await settle();
    expect(other.seqs()).toEqual([5, 6]);
    expect(view.seqs()).toEqual([]);
  });

  test("a screen that was left no longer listens for scrolls, and a reopened one listens once", () => {
    const { earlier, fake, view } = agent();
    const elements = view.elements;
    earlier.open("w8:p2", "agent", elements);
    earlier.open("w8:p2", "agent", elements);
    expect(view.listeners()).toBe(1);
    earlier.leave();
    expect(view.listeners()).toBe(0);
    view.scrollTo(0);
    expect(fake.requests).toHaveLength(0);

    const again = screen();
    earlier.open("w8:p2", "agent", again.elements);
    again.scrollToEnd();
    earlier.live(liveScreen(1));
    again.scrollTo(0);
    expect(fake.requests).toHaveLength(1);
    expect(again.listeners()).toBe(1);
  });
});

describe("a Terminal that is gone", () => {
  test("a scroll to the top or a changed short screen asks nothing, and the note and the messages shown stay", async () => {
    const { earlier, fake, view } = agent();
    view.scrollTo(100);
    fake.requests[0].answer.resolve(page(range(11, 20), 10, { join: 21 }));
    await settle();
    expect(view.seqs()).toEqual(range(11, 20));
    expect(view.note.textContent).toBe("Scroll up for earlier messages");

    // "Terminal gone": the page leaves, and its Live screen stays as it was.
    earlier.leave();
    view.scrollTo(0);
    earlier.live(liveScreen(1, "14s"));
    await settle();
    expect(fake.requests).toHaveLength(1);
    expect(view.note.textContent).toBe("Scroll up for earlier messages");
    expect(view.region.hidden).toBe(false);
    expect(view.seqs()).toEqual(range(11, 20));

    // A screen too short to scroll, after a no-match, asked again whenever the Live screen changed.
    const short = agent({ liveHeight: 500, paneId: "w8:p5" });
    short.fake.requests[0].answer.resolve(NO_MATCH);
    await settle();
    const noMatch = short.view.note.textContent;
    short.earlier.leave();
    short.earlier.live(liveScreen(1, "14s"));
    await settle();
    expect(short.fake.requests).toHaveLength(1);
    expect(short.view.note.textContent).toBe(noMatch);

    // Should the Terminal be known again on the same screen, the messages still shown start again rather than being joined twice.
    earlier.open("w8:p2", "agent", view.elements);
    expect(view.seqs()).toEqual([]);
    earlier.live(liveScreen(1, "16s"));
    view.scrollTo(0);
    expect(fake.asked()[1]).toEqual({ paneId: "w8:p2", before: undefined });
    fake.requests[1].answer.resolve(page(range(11, 20), 10, { join: 21 }));
    await settle();
    expect(view.seqs()).toEqual(range(11, 20));
  });

  test("a page on its way when the Terminal goes: the note doesn't stay at Loading, whether the page arrives or fails, and nothing more is asked", async () => {
    for (const arrives of [true, false]) {
      const { earlier, fake, view } = agent();
      view.scrollTo(100);
      fake.requests[0].answer.resolve(page(range(11, 20), 10, { join: 21 }));
      await settle();
      view.scrollTo(100);
      expect(view.note.textContent).toBe("Loading earlier messages…");

      // "Terminal gone" while the second page is on its way: the note is back to what it said before it.
      earlier.leave();
      expect(view.note.textContent).toBe("Scroll up for earlier messages");
      expect(view.region.dataset.status).toBe("idle");
      if (arrives) fake.requests[1].answer.resolve(page(range(1, 10), null));
      else fake.requests[1].answer.reject(new Error("That terminal has gone."));
      await settle();
      expect(view.note.textContent).toBe("Scroll up for earlier messages");
      expect(view.region.dataset.status).toBe("idle");
      expect(view.region.hidden).toBe(false);
      // The page isn't put on the screen it was left on; the messages shown stay.
      expect(view.seqs()).toEqual(range(11, 20));
      view.scrollTo(0);
      expect(fake.requests).toHaveLength(2);
    }
  });
});

describe("a Shell has no Earlier messages", () => {
  test("it asks for none, however it is scrolled or short", () => {
    for (const liveHeight of [2000, 300]) {
      const fake = client();
      const earlier = createEarlier({ client: fake });
      const view = screen(liveHeight);
      earlier.open("w8:p3", "shell", view.elements);
      view.scrollToEnd();
      earlier.live("$ ls\nfile");
      view.scrollTo(0);
      earlier.live("$ ls\nfile\n$ ");
      expect(fake.requests).toHaveLength(0);
      expect(view.region.hidden).toBe(true);
      expect(view.seqs()).toEqual([]);
    }
  });

  test("a pane that turns into a Shell drops its Earlier messages and its late answer, and one that turns into an Agent starts them", async () => {
    const { earlier, fake, view } = agent();
    view.scrollTo(100);
    fake.requests[0].answer.resolve(page(range(11, 20), null, { join: 21 }));
    await settle();
    earlier.live(liveScreen(4));
    expect(view.seqs()).toEqual(range(11, 20));

    earlier.open("w8:p2", "shell", view.elements);
    expect(view.seqs()).toEqual([]);
    expect(view.region.hidden).toBe(true);
    expect(view.gap.hidden).toBe(true);
    // The gap answer on its way is dropped.
    fake.requests[1].answer.resolve(page([21, 22], null, { join: 23 }));
    await settle();
    expect(view.seqs()).toEqual([]);
    view.scrollTo(0);
    expect(fake.requests).toHaveLength(2);

    earlier.open("w8:p2", "agent", view.elements);
    expect(view.region.hidden).toBe(false);
    view.scrollTo(100);
    expect(fake.asked()[2]).toEqual({ paneId: "w8:p2", before: undefined });
  });
});
