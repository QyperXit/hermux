import { test } from "bun:test";
import { writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { makeFakeHerdr } from "../fake-herdr";
import { makeStore } from "./session-store";

test("makes a fake herdr and a store, and leaves them for the end of the run", () => {
  const dirs = [dirname(makeFakeHerdr().bin), dirname(makeStore([]))];
  writeFileSync(String(process.env.CLEANUP_PROBE_OUT), JSON.stringify(dirs));
});
