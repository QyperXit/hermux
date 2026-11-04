import { expect, test } from "bun:test";
import { isAtBottom, keepView } from "../web/scroll.js";

const view = (scrollHeight: number, scrollTop: number, clientHeight = 800) => ({ scrollHeight, scrollTop, clientHeight });

test("the view follows the output while it is less than 32px from the end", () => {
  expect(isAtBottom(view(2000, 1200))).toBe(true);
  expect(isAtBottom(view(2000, 1169))).toBe(true);
  expect(isAtBottom(view(2000, 1168))).toBe(false);
  expect(isAtBottom(view(2000, 0))).toBe(false);
  expect(isAtBottom(view(500, 0))).toBe(true);
});

test("content added or removed above the view moves the view by the same amount", () => {
  const el = view(2000, 300);
  const restore = keepView(el);
  el.scrollHeight = 2600;
  restore();
  expect(el.scrollTop).toBe(900);
  const again = keepView(el);
  el.scrollHeight = 2100;
  again();
  expect(el.scrollTop).toBe(400);
});

test("from the saved position, a scrollTop already clamped by a removal is not counted twice", () => {
  const el = view(3000, 2100);
  const fromNow = keepView(el);
  const fromSaved = keepView(el, { fromTop: true });
  el.scrollHeight = 2000;
  el.scrollTop = 1200;
  fromSaved();
  expect(el.scrollTop).toBe(1100);
  el.scrollTop = 1200;
  fromNow();
  expect(el.scrollTop).toBe(200);
});
