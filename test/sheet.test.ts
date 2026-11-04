import { expect, test } from "bun:test";
import { createSheet, nextRow, sheetFits } from "../web/sheet.js";

const pane = (pane_id: string) => ({ pane_id, kind: "shell", status: null });

test("the sheet stays open only while the workspace has another pane and still holds the open one", () => {
  const two = [pane("wF:p1"), pane("wF:p2")];
  expect(sheetFits(two, "wF:p1")).toBe(true);
  expect(sheetFits(two, "wF:p2")).toBe(true);
  expect(sheetFits(two, "wF:p9")).toBe(false);
  expect(sheetFits([pane("wF:p1")], "wF:p1")).toBe(false);
  expect(sheetFits([], "wF:p1")).toBe(false);
});

test("Tab goes round the rows forwards and Shift+Tab backwards; with no focused row Tab starts at the first and Shift+Tab at the last", () => {
  expect([0, 1, 2].map((at) => nextRow(at, 3, false))).toEqual([1, 2, 0]);
  expect([0, 1, 2].map((at) => nextRow(at, 3, true))).toEqual([2, 0, 1]);
  expect(nextRow(-1, 3, false)).toBe(0);
  expect(nextRow(-1, 3, true)).toBe(2);
  expect(nextRow(0, 1, false)).toBe(0);
  expect(nextRow(0, 1, true)).toBe(0);
});

test("making the sheet touches no page until it is opened; without a pane to switch to it does not open, and closing or drawing it does nothing", () => {
  const sheet = createSheet({ app: null, root: null, hrefOf: String, onSwap: () => {} });
  expect(Object.keys(sheet).sort()).toEqual(["close", "open", "render"]);
  sheet.open(null, undefined);
  sheet.close();
  sheet.render(null, undefined);
});
