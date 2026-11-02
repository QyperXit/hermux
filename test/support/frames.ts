// herdr's `terminal session observe` frames (D30) as a test scripts them: the
// JSON line shape probed read-only on herdr 0.9.5 (every row placed with a
// cursor move, styles as SGR), with generic content.
import type { Frame } from "../../server/herdr";

export type FrameLine = { type: "terminal.frame"; encoding: "ansi"; full: boolean; width: number; height: number; seq: number; bytes: string };
type Size = { width?: number; height?: number; seq?: number };

const line = (full: boolean, body: string, { width = 30, height = 4, seq = 1 }: Size): FrameLine => ({
  type: "terminal.frame",
  encoding: "ansi",
  full,
  width,
  height,
  seq,
  bytes: Buffer.from(`\x1b[?2026h\x1b[?25l${body}\x1b[0m\x1b[?2026l`).toString("base64"),
});

// The whole screen: the canvas cleared, then each row from its first column.
export const fullFrame = (rows: string[], size: Size = {}) =>
  line(true, `\x1b[2J${rows.map((row, index) => `\x1b[${index + 1};1H\x1b[0;39;49m${row}`).join("")}`, size);

// Only what changed: text written at a row and column (both from 1).
export const partialFrame = (writes: [row: number, column: number, text: string][], size: Size = {}) =>
  line(false, writes.map(([row, column, text]) => `\x1b[${row};${column}H${text}`).join(""), { seq: 2, ...size });

// A frame as server/herdr.ts hands it on, its bytes decoded.
export const decoded = ({ full, width, height, seq, bytes }: FrameLine): Frame => ({ full, width, height, seq, bytes: Buffer.from(bytes, "base64") });
