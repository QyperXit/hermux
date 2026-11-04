import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { makeFakeHerdr } from "./fake-herdr";
import { cleanupAfterTests, runCleanups } from "./support/cleanup";
import { makeHarness } from "./support/http";
import { makeStore } from "./support/session-store";

test("a fake herdr, a harness's fake and a store remove their own temporary folders when the cleanups run", () => {
  const dirs = [dirname(makeFakeHerdr().bin), dirname(makeHarness({}).fake.bin), dirname(makeStore([]))];
  for (const dir of dirs) expect([dir, existsSync(dir)]).toEqual([dir, true]);
  runCleanups();
  for (const dir of dirs) expect([dir, existsSync(dir)]).toEqual([dir, false]);
});

test("a fake herdr already disposed by its test doesn't make the cleanups fail", () => {
  const fake = makeFakeHerdr();
  fake.dispose();
  expect(runCleanups).not.toThrow();
});

test("every cleanup runs even when one throws, and the failures are reported together; a second run has nothing left", () => {
  const dir = mkdtempSync(join(tmpdir(), "cleanup-test-"));
  cleanupAfterTests(() => {
    throw new Error("first");
  });
  cleanupAfterTests(() => rmSync(dir, { recursive: true, force: true }));
  cleanupAfterTests(() => {
    throw new Error("second");
  });
  let failure: unknown;
  try {
    runCleanups();
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(AggregateError);
  expect((failure as AggregateError).errors.map((error: Error) => error.message)).toEqual(["first", "second"]);
  expect(existsSync(dir)).toBe(false);
  expect(runCleanups).not.toThrow();
});

test("the test run itself removes what the factories made once its last test is done (the preload)", () => {
  const out = join(mkdtempSync(join(tmpdir(), "cleanup-probe-")), "dirs.json");
  try {
    const run = Bun.spawnSync([process.execPath, "test", "./test/support/cleanup-probe.ts"], {
      cwd: join(import.meta.dir, ".."),
      env: { ...process.env, CLEANUP_PROBE_OUT: out },
    });
    expect(run.exitCode).toBe(0);
    const dirs: string[] = JSON.parse(readFileSync(out, "utf8"));
    expect(dirs).toHaveLength(2);
    for (const dir of dirs) expect([dir, existsSync(dir)]).toEqual([dir, false]);
  } finally {
    rmSync(dirname(out), { recursive: true, force: true });
  }
});
