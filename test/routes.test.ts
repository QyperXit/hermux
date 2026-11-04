import { expect, test } from "bun:test";
import { parseRoute, terminalHref } from "../web/routes.js";

test("a Terminal's link opens that Terminal, #/all opens All, and any other address opens home", () => {
  for (const paneId of ["w1:p1", "w1:p/2 ?#", "wF:pM"]) expect(parseRoute(terminalHref(paneId))).toEqual({ name: "agent", paneId });
  expect(parseRoute("#/all")).toEqual({ name: "all" });
  for (const hash of ["", "#/", "#/agent/", "#/elsewhere"]) expect(parseRoute(hash)).toEqual({ name: "home" });
});
