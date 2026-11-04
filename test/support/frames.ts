// herdr's frame line shape, probed read-only on herdr 0.9.5: every row placed with
// a cursor move, styles as SGR.
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

export const fullFrame = (rows: string[], size: Size = {}) =>
  line(true, `\x1b[2J${rows.map((row, index) => `\x1b[${index + 1};1H\x1b[0;39;49m${row}`).join("")}`, size);

export const partialFrame = (writes: [row: number, column: number, text: string][], size: Size = {}) =>
  line(false, writes.map(([row, column, text]) => `\x1b[${row};${column}H${text}`).join(""), { seq: 2, ...size });

export const decoded = ({ full, width, height, seq, bytes }: FrameLine): Frame => ({ full, width, height, seq, bytes: Buffer.from(bytes, "base64") });
