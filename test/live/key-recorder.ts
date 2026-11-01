// Disposable stand-in agent for live checks. Runs in a pane that the live check
// created itself: reports itself to Herdr as an agent of the given kind (from
// inside its own pane, as real integrations do), puts the terminal in raw mode
// with bracketed paste on, as Atomic's TUI does, and appends every chunk it
// receives (as hex) to a log file, so the check can see the exact bytes herdr
// delivered.
//
//   bun test/live/key-recorder.ts <log-file> <agent-kind>
//
// The live check asks for a lifecycle state by writing it to "<log>.state".
// The state "exit" makes the recorder exit, which leaves the pane's shell.
// It makes the recorder print text, as an agent prints its output, by writing
// the text to "<log>.say"; each new text is printed once.
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const [log, kind] = process.argv.slice(2);
const paneId = process.env.HERDR_PANE_ID;
if (!log || !kind || !paneId) throw new Error("usage (inside a Herdr pane): bun test/live/key-recorder.ts <log-file> <agent-kind>");

const herdr = process.env.HERDR_BIN_PATH || "herdr";
let reported = "";
let said = "";
let seq = Date.now();

function report(state: string) {
  const result = Bun.spawnSync([herdr, "pane", "report-agent", paneId!, "--source", "agents-live-check", "--agent", kind, "--state", state, "--seq", String(++seq)]);
  appendFileSync(log, `${JSON.stringify({ reported: state, exit: result.exitCode, stderr: result.stderr.toString() })}\n`);
  reported = state;
}

process.stdin.setRawMode(true);
process.stdout.write("\x1b[?2004h");
process.stdout.write(`key recorder ready (${kind})\r\n`);
report("idle");
appendFileSync(log, `${JSON.stringify({ ready: true })}\n`);

setInterval(() => {
  const wanted = existsSync(`${log}.state`) ? readFileSync(`${log}.state`, "utf8").trim() : "idle";
  if (wanted === "exit") {
    process.stdout.write("\x1b[?2004l");
    process.stdin.setRawMode(false);
    process.exit(0);
  }
  if (wanted && wanted !== reported) report(wanted);
  const say = existsSync(`${log}.say`) ? readFileSync(`${log}.say`, "utf8") : "";
  if (say && say !== said) {
    said = say;
    process.stdout.write(say.replaceAll("\n", "\r\n"));
  }
}, 100);

process.stdin.on("data", (chunk: Buffer) => {
  appendFileSync(log, `${JSON.stringify({ hex: chunk.toString("hex") })}\n`);
  process.stdout.write(`got ${JSON.stringify(chunk.toString("utf8"))}\r\n`);
});
