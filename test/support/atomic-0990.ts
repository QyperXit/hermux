// Atomic 0.9.90 in 98- to 101-column panes (JUMP_PILL and NEW_MESSAGES in 222),
// read with the server's own arguments (`agent read --source recent-unwrapped
// --lines 200 --format ansi`), escape for escape. The chrome under the
// IDLE_NAMED, IDLE_QUOTE and WORKING_NAMED screens is from real panes with their
// words, tab names, folders and usage figures swapped for made-up ones; the
// others are from a disposable Atomic running made-up test workflows (lamp-check
// asks one ctx.ui.select, slow-walk only waits, two-at-once asks two at once),
// its folder, run ids and usage figures swapped the same way. The INTERRUPTED and
// SPINNER screens are a disposable Atomic's turn read frame by frame, its folder
// and usage figures swapped and its runs of blank rows cut to one. JUMP_PILL and
// NEW_MESSAGES are disposable Atomics scrolled up, folder and usage swapped too.
// The LIST, KEYS_HELP and LIST_HELP screens are disposable Atomics in 221- and
// 222-column panes with their run list focused or their keys box open, folder
// and spend swapped and runs of blank rows cut to one.

const RULE_98 = "\u001b[0m\u001b[38;2;0;255;255m──────────────────────────────────────────────────────────────────────────────────────────────────\u001b[0m";
const EMPTY_PROMPT_98 = "❯ \u001b[0m\u001b[7m \u001b[0m                                                                                               ";
const RULE_97 = "\u001b[0m\u001b[38;2;0;255;255m─────────────────────────────────────────────────────────────────────────────────────────────────\u001b[0m\r";
const EMPTY_PROMPT_97 = "❯ \u001b[0m\u001b[7m \u001b[0m                                                                                              \r";
const RULE_222 = "\u001b[0m\u001b[38;2;0;255;255m──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────\u001b[0m\r";
const EMPTY_PROMPT_222 = "❯ \u001b[0m\u001b[7m \u001b[0m                                                                                                                                                                                                                           \r";
const RUN_LIST_KEYS_ROW = "\u001b[0m\u001b[38;5;240m  ↑↓ select · enter/→ to open · x stop · esc/← back to prompt · ? keys\u001b[0m";

// Idle, after a finished turn, the prompt box's rule named after its tab.
const IDLE_NAMED_LINES = [
  " Progress                                                                                         \r",
  " - The rain chart is live on staging, with filters and the alert badge.                           \r",
  " - Fixed two release problems: the build and the import job's memory.                             \r",
  "                                                                                                  \r",
  " Problems                                                                                         \r",
  " - The sharing rules still need the owner's OK.                                                   \r",
  "                                                                                                  \r",
  " Plans                                                                                            \r",
  " - Put the wind cards on staging.                                                                 \r",
  " - Connect the rest of the wind page: charts, then filters.                                       \r",
  "\r",
  " \u001b[0m\u001b[38;5;240m∀\u001b[0m \u001b[0m\u001b[38;5;240mEmancipated for 5s · ↓ 160 tokens\u001b[0m                                                              ",
  "                       \u001b[3m\u001b[80;6;513m↑\u001b[3m\u001b[80;6;515m76M\u001b[3m\u001b[80;6;513m • ↓\u001b[3m\u001b[80;6;515m8.8M\u001b[3m\u001b[80;6;513m • R\u001b[3m\u001b[80;6;515m5006M\u001b[3m\u001b[80;6;513m • W\u001b[3m\u001b[80;6;515m59M\u001b[3m\u001b[80;6;513m • CH\u001b[3m\u001b[80;6;515m3.3%\u001b[3m\u001b[80;6;513m • \u001b[3m\u001b[80;6;515m$9517.158\u001b[3m \u001b[3m\u001b[80;6;513m(sub) • \u001b[3m\u001b[80;6;515m22.3%/9.3M (auto)\u001b[3m",
  "\u001b[0m\u001b[38;2;0;255;255m───────────────────────────────────────────────────────────────────────────────────────── \u001b[0m\u001b[38;5;242mgarden\u001b[0m\u001b[38;2;0;255;255m ─\u001b[0m",
  EMPTY_PROMPT_98,
  RULE_98,
  "\u001b[0m\u001b[38;5;240manthropic/claude-opus-5-5  medium\u001b[0m \u001b[0m\u001b[38;5;240m•\u001b[0m \u001b[0m\u001b[38;5;242m~/projects/weather-app (previ\u001b[0m\u001b[38;5;240m... · \u001b[0m\u001b[38;5;242m? keys\u001b[0m",
];
export const IDLE_NAMED_SCREEN = IDLE_NAMED_LINES.join("\n");

// Idle, the agent's last words a quote, a tab name with a space in it.
const IDLE_QUOTE_LINES = [
  " Here is a shorter way to say it:                                                                 \r",
  "                                                                                                  \r",
  " │ I can meet on Thursday or Friday, any time after 2pm. If neither suits you, tell me            \r",
  " │ a time that does.                                                                              \r",
  "\r",
  " \u001b[0m\u001b[38;5;240m∀\u001b[0m \u001b[0m\u001b[38;5;240mYammered for 3s · ↓ 209 tokens\u001b[0m                                                                 ",
  "                        \u001b[3m\u001b[80;6;513m↑\u001b[3m\u001b[80;6;515m149k\u001b[3m\u001b[80;6;513m • ↓\u001b[3m\u001b[80;6;515m155k\u001b[3m\u001b[80;6;513m • R\u001b[3m\u001b[80;6;515m500M\u001b[3m\u001b[80;6;513m • W\u001b[3m\u001b[80;6;515m99M\u001b[3m\u001b[80;6;513m • CH\u001b[3m\u001b[80;6;515m44.2%\u001b[3m\u001b[80;6;513m • \u001b[3m\u001b[80;6;515m$964.134\u001b[3m \u001b[3m\u001b[80;6;513m(sub) • \u001b[3m\u001b[80;6;515m0.5%/9.3M (auto)\u001b[3m",
  "\u001b[0m\u001b[38;2;255;0;255m────────────────────────────────────────────────────────────────────────────────────── \u001b[0m\u001b[38;5;242mdraft one\u001b[0m\u001b[38;2;255;0;255m ─\u001b[0m",
  EMPTY_PROMPT_98,
  "\u001b[0m\u001b[38;2;255;0;255m──────────────────────────────────────────────────────────────────────────────────────────────────\u001b[0m",
  "\u001b[0m\u001b[38;5;240manthropic/claude-opus-5-5  high\u001b[0m \u001b[0m\u001b[38;5;240m•\u001b[0m \u001b[0m\u001b[38;5;242m~/letters/cover\u001b[0m\u001b[38;5;240m · \u001b[0m\u001b[38;5;242m? keys\u001b[0m",
];
export const IDLE_QUOTE_SCREEN = IDLE_QUOTE_LINES.join("\n");

// Working: a tool row, the turn's spinner, "esc to interrupt · ? keys".
const WORKING_NAMED_LINES = [
  " The key stays where it is, since it's the only way to reach the shed list, so I'm leaving it     \r",
  " alone and starting the layout fix now.                                                           \r",
  "\r",
  " \u001b[0m\u001b[38;2;255;102;0m∀\u001b[0m \u001b[0m\u001b[1m\u001b[38;2;255;102;0mBash\u001b[0m(ls ~/projects/yard && grep -rn \"fence\" ~/projects/yard/notes --include=*.md | head -…)",
  "\r",
  " \u001b[0m\u001b[38;2;255;102;0m∀\u001b[0m \u001b[0m\u001b[38;5;242mAbyss staring back… (7s · ↓ 573 tokens)\u001b[0m                                                        ",
  "                      \u001b[3m\u001b[80;6;513m↑\u001b[3m\u001b[80;6;515m428k\u001b[3m\u001b[80;6;513m • ↓\u001b[3m\u001b[80;6;515m834k\u001b[3m\u001b[80;6;513m • R\u001b[3m\u001b[80;6;515m559M\u001b[3m\u001b[80;6;513m • W\u001b[3m\u001b[80;6;515m2.7M\u001b[3m\u001b[80;6;513m • CH\u001b[3m\u001b[80;6;515m44.2%\u001b[3m\u001b[80;6;513m • \u001b[3m\u001b[80;6;515m$937.275\u001b[3m \u001b[3m\u001b[80;6;513m(sub) • \u001b[3m\u001b[80;6;515m13.9%/9.3M (auto)\u001b[3m",
  "\u001b[0m\u001b[38;2;0;255;255m───────────────────────────────────────────────────────────────────────────────────────── \u001b[0m\u001b[38;5;242myard ?\u001b[0m\u001b[38;2;0;255;255m ─\u001b[0m",
  EMPTY_PROMPT_98,
  RULE_98,
  "\u001b[0m\u001b[38;5;242mesc to interrupt\u001b[0m\u001b[38;5;240m · \u001b[0m\u001b[38;5;242m? keys\u001b[0m",
];
export const WORKING_NAMED_SCREEN = WORKING_NAMED_LINES.join("\n");

// Blocked on one workflow question, listed under the footer.
const ONE_QUESTION_LINES = [
  " Started. \u001b[0m\u001b[38;2;0;255;255mlamp-check\u001b[0m wouldn't load at first with the error \"outputs must be a schema map\", so I   ",
  " added \u001b[0m\u001b[38;2;0;255;255moutputs: {},\u001b[0m to \u001b[0m\u001b[38;2;0;255;255m.atomic/workflows/lamp-check.ts\u001b[0m to get it running.                         ",
  "",
  " \u001b[0m\u001b[38;5;240m∀\u001b[0m \u001b[0m\u001b[38;5;240mZigzagged for 19s · ↓ 1k tokens\u001b[0m                                                                ",
  "                          \u001b[3m\u001b[80;6;513m↑\u001b[3m\u001b[80;6;515m9.0k\u001b[3m\u001b[80;6;513m • ↓\u001b[3m\u001b[80;6;515m9.9k\u001b[3m\u001b[80;6;513m • R\u001b[3m\u001b[80;6;515m834k\u001b[3m\u001b[80;6;513m • W\u001b[3m\u001b[80;6;515m12k\u001b[3m\u001b[80;6;513m • CH\u001b[3m\u001b[80;6;515m44.1%\u001b[3m\u001b[80;6;513m • \u001b[3m\u001b[80;6;515m$3.123\u001b[3m \u001b[3m\u001b[80;6;513m(sub) • \u001b[3m\u001b[80;6;515m1.2%/9.3M (auto)\u001b[3m",
  RULE_98,
  EMPTY_PROMPT_98,
  RULE_98,
  "\u001b[0m\u001b[38;5;240manthropic/claude-opus-5-5  medium\u001b[0m \u001b[0m\u001b[38;5;240m•\u001b[0m \u001b[0m\u001b[38;5;242m~/projects/yard\u001b[0m\u001b[38;5;240m · \u001b[0m\u001b[38;5;242m1 needs input\u001b[0m\u001b[38;5;240m · \u001b[0m\u001b[38;5;242m? keys\u001b[0m",
  "",
  "  \u001b[0m\u001b[38;2;255;255;0m◆\u001b[0m \u001b[0m\u001b[38;5;242mlamp-check\u001b[0m  \u001b[0m\u001b[38;5;242mPaint the new fence green, or keep the old brown? The paint s\u001b[0m...  \u001b[0m\u001b[38;5;242mneeds input · 9s\u001b[0m",
];
export const ONE_QUESTION_SCREEN = ONE_QUESTION_LINES.join("\n");

// The waiting run beside a run that is still going.
const CROWDED_LINES = [
  " started.                                                                                            ",
  "",
  " \u001b[0m\u001b[38;5;240m∀\u001b[0m \u001b[0m\u001b[38;5;240mTickled for 4s · ↓ 234 tokens\u001b[0m                                                                     ",
  "                             \u001b[3m\u001b[80;6;513m↑\u001b[3m\u001b[80;6;515m1.5k\u001b[3m\u001b[80;6;513m • ↓\u001b[3m\u001b[80;6;515m9.8k\u001b[3m\u001b[80;6;513m • R\u001b[3m\u001b[80;6;515m146k\u001b[3m\u001b[80;6;513m • W\u001b[3m\u001b[80;6;515m17k\u001b[3m\u001b[80;6;513m • CH\u001b[3m\u001b[80;6;515m44.6%\u001b[3m\u001b[80;6;513m • \u001b[3m\u001b[80;6;515m$3.653\u001b[3m \u001b[3m\u001b[80;6;513m(sub) • \u001b[3m\u001b[80;6;515m1.7%/9.3M (auto)\u001b[3m",
  "\u001b[0m\u001b[38;2;0;255;255m─────────────────────────────────────────────────────────────────────────────────────────────────────\u001b[0m",
  "❯ \u001b[0m\u001b[7m \u001b[0m                                                                                                  ",
  "\u001b[0m\u001b[38;2;0;255;255m─────────────────────────────────────────────────────────────────────────────────────────────────────\u001b[0m",
  "\u001b[0m\u001b[38;5;240manthropic/claude-opus-5-5  medium\u001b[0m \u001b[0m\u001b[38;5;240m•\u001b[0m \u001b[0m\u001b[38;5;242m~/projects/yard\u001b[0m\u001b[38;5;240m · \u001b[0m\u001b[38;5;242m1 needs input\u001b[0m\u001b[38;5;240m · \u001b[0m\u001b[38;5;242m? keys\u001b[0m",
  "",
  "  \u001b[0m\u001b[38;2;255;255;0m◆\u001b[0m \u001b[0m\u001b[38;5;242mlamp-check\u001b[0m  \u001b[0m\u001b[38;5;242mPaint the new fence green, or keep the old brown? The paint shop\u001b[0m...  \u001b[0m\u001b[38;5;242mneeds input · 1m\u001b[0m",
  "  \u001b[0m\u001b[38;5;240m∀\u001b[0m \u001b[0m\u001b[38;5;242mslow-walk \u001b[0m                                                                                    \u001b[0m\u001b[38;5;242m35s\u001b[0m",
];
export const CROWDED_SCREEN = CROWDED_LINES.join("\n");

// Two runs waiting, one on two questions at once, beside a failed run.
const GENERAL_LINES = [
  " The fix is to wrap the work in a tracked step. For \u001b[0m\u001b[38;2;0;255;255mslow-walk\u001b[0m, that means running the wait inside ",
  " \u001b[0m\u001b[38;2;0;255;255mctx.tool(\"wait\", {}, …, { timeoutMs: 200_000 })\u001b[0m with an abort signal. I haven't changed any of   ",
  " the three files. If you want them fixed, tell me and I'll edit them and rerun.                   ",
  "",
  " \u001b[0m\u001b[38;5;240m∀\u001b[0m \u001b[0m\u001b[38;5;240mWhispered for 7s · ↓ 495 tokens\u001b[0m                                                                ",
  "                           \u001b[3m\u001b[80;6;513m↑\u001b[3m\u001b[80;6;515m98k\u001b[3m\u001b[80;6;513m • ↓\u001b[3m\u001b[80;6;515m5.5k\u001b[3m\u001b[80;6;513m • R\u001b[3m\u001b[80;6;515m050k\u001b[3m\u001b[80;6;513m • W\u001b[3m\u001b[80;6;515m10k\u001b[3m\u001b[80;6;513m • CH\u001b[3m\u001b[80;6;515m44.6%\u001b[3m\u001b[80;6;513m • \u001b[3m\u001b[80;6;515m$3.214\u001b[3m \u001b[3m\u001b[80;6;513m(sub) • \u001b[3m\u001b[80;6;515m1.4%/9.3M (auto)\u001b[3m",
  RULE_98,
  EMPTY_PROMPT_98,
  RULE_98,
  "\u001b[0m\u001b[38;5;240manthropic/claude-opus-5-5  medium\u001b[0m \u001b[0m\u001b[38;5;240m•\u001b[0m \u001b[0m\u001b[38;5;242m~/projects/yard\u001b[0m\u001b[38;5;240m · \u001b[0m\u001b[38;5;242m2 needs input\u001b[0m\u001b[38;5;240m · \u001b[0m\u001b[38;5;242m? keys\u001b[0m",
  "",
  "  \u001b[0m\u001b[38;2;255;255;0m◆\u001b[0m \u001b[0m\u001b[38;5;242mtwo-at-once\u001b[0m  \u001b[0m\u001b[38;5;242mstage select\u001b[0m                                                    \u001b[0m\u001b[38;5;242mneeds input · 42s\u001b[0m",
  "  \u001b[0m\u001b[38;2;255;255;0m◆\u001b[0m \u001b[0m\u001b[38;5;242mlamp-check \u001b[0m  \u001b[0m\u001b[38;5;242mPaint the new fence green, or keep the old brown? The paint \u001b[0m...  \u001b[0m\u001b[38;5;242mneeds input · 5m\u001b[0m",
  "  \u001b[0m\u001b[38;2;255;0;0m✗\u001b[0m \u001b[0m\u001b[38;5;240mslow-walk  \u001b[0m  \u001b[0m\u001b[38;5;240mWorkflow run completed without creating any workflow stages or du\u001b[0m...  \u001b[0m\u001b[38;5;240mfailed · 3m\u001b[0m",
];
export const GENERAL_SCREEN = GENERAL_LINES.join("\n");

// The /workflows picker in the prompt box's place.
const PICKER_LINES = [
  " started.                                                                                            ",
  "                             \u001b[3m\u001b[80;6;513m↑\u001b[3m\u001b[80;6;515m1.5k\u001b[3m\u001b[80;6;513m • ↓\u001b[3m\u001b[80;6;515m9.8k\u001b[3m\u001b[80;6;513m • R\u001b[3m\u001b[80;6;515m146k\u001b[3m\u001b[80;6;513m • W\u001b[3m\u001b[80;6;515m17k\u001b[3m\u001b[80;6;513m • CH\u001b[3m\u001b[80;6;515m44.6%\u001b[3m\u001b[80;6;513m • \u001b[3m\u001b[80;6;515m$3.653\u001b[3m \u001b[3m\u001b[80;6;513m(sub) • \u001b[3m\u001b[80;6;515m1.7%/9.3M (auto)\u001b[3m",
  "\u001b[0m\u001b[38;2;255;102;0m▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔\u001b[0m",
  "  \u001b[0m\u001b[1mWorkflows\u001b[0m  ⌕ \u001b[0m\u001b[7m\u001b[38;5;240mS\u001b[0m\u001b[38;5;240mearch…\u001b[0m                                                                        \u001b[0m\u001b[38;5;240m  1-2/2\u001b[0m",
  " \u001b[0m\u001b[1m\u001b[38;2;255;102;0m❯ slow-walk · 9c2e5a71\u001b[0m",
  "   \u001b[0m\u001b[38;5;242mrunning · 41s\u001b[0m",
  "   lamp-check · 4b7d2c19                                                                            \u001b[0m\u001b[38;2;255;255;0m◆\u001b[0m",
  "   \u001b[0m\u001b[38;5;242mneeds input · Paint the new fence green, or keep the old brown? The paint shop closes Friday. · 2m\u001b[0m",
  "\u001b[0m\u001b[38;5;240m  ↑↓ select · space preview · enter open · type to search · esc close\u001b[0m",
  "\u001b[0m\u001b[38;5;240manthropic/claude-opus-5-5  medium\u001b[0m \u001b[0m\u001b[38;5;240m•\u001b[0m \u001b[0m\u001b[38;5;242m~/projects/yard\u001b[0m",
];
export const PICKER_SCREEN = PICKER_LINES.join("\n");

// A workflow stage's chat with its ctx.ui.select.
const STAGE_LINES = [
  "\u001b[0m\u001b[1m\u001b[38;2;203;166;247m   \u001b[0m\u001b[1m\u001b[38;2;108;108;108mSTAGE\u001b[0m  \u001b[0m\u001b[38;2;108;108;108mlamp-check\u001b[0m\u001b[38;2;88;88;88m / \u001b[0m\u001b[1m\u001b[38;2;205;214;244mselect\u001b[0m                                                                     ",
  "\u001b[0m\u001b[38;2;108;108;108m──────────────────────────────────────────────────────────────────────────────────────────────────\u001b[0m",
  "\u001b[0m\u001b[38;2;255;102;0m╭\u001b[0m\u001b[1m\u001b[38;2;108;108;108m AWAITING INPUT \u001b[0m\u001b[38;2;108;108;108m [stage: \u001b[0m\u001b[1m\u001b[38;2;205;214;244mselect\u001b[0m\u001b[38;2;108;108;108m] \u001b[0m\u001b[38;2;255;102;0m───────────────────────────────────────────────────────────────╮\u001b[0m",
  "\u001b[0m\u001b[38;2;255;102;0m│\u001b[0m \u001b[0m\u001b[38;2;255;102;0m？\u001b[0m \u001b[0m\u001b[38;2;255;102;0m4b7d2c19-8e3a-4f06-9d51-2a6c0e8b7f34\u001b[0m                                                        \u001b[0m\u001b[38;2;255;102;0m│\u001b[0m",
  "\u001b[0m\u001b[38;2;255;102;0m│\u001b[0m    \u001b[0m\u001b[1m\u001b[38;2;205;214;244mlamp-check\u001b[0m                                                                                  \u001b[0m\u001b[38;2;255;102;0m│\u001b[0m",
  "\u001b[0m\u001b[38;2;255;102;0m╰────────────────────────────────────────────────────────────────────────────────────────────────╯\u001b[0m",
  "\u001b[0m\u001b[38;2;255;102;0m╭────────────────────────────────────────────────────────────────────────────────────────────────╮\u001b[0m",
  "\u001b[0m\u001b[38;2;255;102;0m│\u001b[0m                                                                                                \u001b[0m\u001b[38;2;255;102;0m│\u001b[0m",
  "\u001b[0m\u001b[38;2;255;102;0m│\u001b[0m  \u001b[0m\u001b[38;2;205;214;244mPaint the new fence green, or keep the old brown? The paint shop closes Friday.\u001b[0m               \u001b[0m\u001b[38;2;255;102;0m│\u001b[0m",
  "\u001b[0m\u001b[38;2;255;102;0m│\u001b[0m                                                                                                \u001b[0m\u001b[38;2;255;102;0m│\u001b[0m",
  "\u001b[0m\u001b[38;2;255;102;0m│\u001b[0m  \u001b[0m\u001b[38;2;255;102;0m╭\u001b[0m\u001b[1m\u001b[38;2;108;108;108m response \u001b[0m\u001b[38;2;255;102;0m────────────────────────────────────────────────────────────────────────────────╮\u001b[0m  \u001b[0m\u001b[38;2;255;102;0m│\u001b[0m",
  "\u001b[0m\u001b[38;2;255;102;0m│\u001b[0m  \u001b[0m\u001b[38;2;255;102;0m│\u001b[0m\u001b[1m\u001b[38;2;205;214;244m❯ Green\u001b[0m                                                                                   \u001b[0m\u001b[38;2;255;102;0m│\u001b[0m  \u001b[0m\u001b[38;2;255;102;0m│\u001b[0m",
  "\u001b[0m\u001b[38;2;255;102;0m│\u001b[0m  \u001b[0m\u001b[38;2;255;102;0m│\u001b[0m  \u001b[0m\u001b[38;2;88;88;88mKeep the brown\u001b[0m                                                                          \u001b[0m\u001b[38;2;255;102;0m│\u001b[0m  \u001b[0m\u001b[38;2;255;102;0m│\u001b[0m",
  "\u001b[0m\u001b[38;2;255;102;0m│\u001b[0m  \u001b[0m\u001b[38;2;255;102;0m│\u001b[0m  \u001b[0m\u001b[38;2;88;88;88mAsk me next week\u001b[0m                                                                        \u001b[0m\u001b[38;2;255;102;0m│\u001b[0m  \u001b[0m\u001b[38;2;255;102;0m│\u001b[0m",
  "\u001b[0m\u001b[38;2;255;102;0m│\u001b[0m  \u001b[0m\u001b[38;2;255;102;0m╰──────────────────────────────────────────────────────────────────────────────────────────╯\u001b[0m  \u001b[0m\u001b[38;2;255;102;0m│\u001b[0m",
  "\u001b[0m\u001b[38;2;255;102;0m│\u001b[0m                                                                                                \u001b[0m\u001b[38;2;255;102;0m│\u001b[0m",
  "\u001b[0m\u001b[38;2;255;102;0m│\u001b[0m  \u001b[0m\u001b[38;5;240m↑↓\u001b[0m\u001b[38;5;242m Choose\u001b[0m\u001b[38;2;88;88;88m · \u001b[0m\u001b[38;5;240menter\u001b[0m\u001b[38;5;242m Submit\u001b[0m\u001b[38;2;88;88;88m · \u001b[0m\u001b[38;5;240mctrl+c\u001b[0m\u001b[38;5;242m Skip\u001b[0m                                   \u001b[0m\u001b[1m\u001b[38;2;205;214;244m←\u001b[0m\u001b[38;2;108;108;108m graph · \u001b[0m\u001b[1m\u001b[38;2;205;214;244mesc\u001b[0m\u001b[38;2;108;108;108m close\u001b[0m  │",
  "\u001b[0m\u001b[38;2;255;102;0m╰────────────────────────────────────────────────────────────────────────────────────────────────╯\u001b[0m",
];
export const STAGE_SCREEN = STAGE_LINES.join("\n");

// The workflow graph that F2 opens, its blank middle rows left out.
const GRAPH_LINES = [
  "                                                                                                  ",
  "\u001b[0m\u001b[48;2;30;30;46m \u001b[0m\u001b[38;2;255;102;0m\u001b[48;2;30;30;46m╭──────────────╮\u001b[0m\u001b[48;2;30;30;46m                                                                                 \u001b[0m",
  "\u001b[0m\u001b[48;2;30;30;46m \u001b[0m\u001b[38;2;255;102;0m\u001b[48;2;30;30;46m│\u001b[0m\u001b[1m\u001b[38;2;255;102;0m\u001b[48;2;30;30;46m ORCHESTRATOR \u001b[0m\u001b[38;2;255;102;0m\u001b[48;2;30;30;46m│\u001b[0m\u001b[48;2;30;30;46m  \u001b[0m\u001b[38;2;108;108;108m\u001b[48;2;30;30;46mlamp-check\u001b[0m\u001b[48;2;30;30;46m                                                                \u001b[0m\u001b[38;2;255;102;0m\u001b[48;2;30;30;46m↵ 1\u001b[0m\u001b[48;2;30;30;46m  \u001b[0m",
  "\u001b[0m\u001b[48;2;30;30;46m \u001b[0m\u001b[38;2;255;102;0m\u001b[48;2;30;30;46m╰──────────────╯\u001b[0m\u001b[48;2;30;30;46m                                                                                 \u001b[0m",
  "                                                                                                  ",
  "                                                                                                  ",
  "                                                                                                  ",
  "                                   \u001b[0m\u001b[38;2;255;102;0m╭───────\u001b[0m\u001b[1m\u001b[38;2;17;17;27m\u001b[48;2;255;102;0m select \u001b[0m\u001b[38;2;255;102;0m───────╮\u001b[0m                                       ",
  "                                   \u001b[0m\u001b[38;2;255;102;0m│\u001b[0m  \u001b[0m\u001b[1m\u001b[38;2;255;102;0m？ awaiting input\u001b[0m   \u001b[0m\u001b[38;2;255;102;0m│\u001b[0m                                       ",
  "                                   \u001b[0m\u001b[38;2;255;102;0m│\u001b[0m \u001b[0m\u001b[38;2;255;102;0mwaiting for response\u001b[0m \u001b[0m\u001b[38;2;255;102;0m│\u001b[0m                                       ",
  "                                   \u001b[0m\u001b[38;2;255;102;0m│\u001b[0m  \u001b[0m\u001b[38;2;88;88;88m↵ enter to respond\u001b[0m  \u001b[0m\u001b[38;2;255;102;0m│\u001b[0m                                       ",
  "                                   \u001b[0m\u001b[38;2;255;102;0m╰──────────────────────╯\u001b[0m                                       ",
  "                                                                                                  ",
  "                                                                                                  ",
  "                                                                                                  ",
  "\u001b[0m\u001b[48;2;30;30;46m \u001b[0m\u001b[38;2;255;102;0m\u001b[48;2;30;30;46m╭───────╮\u001b[0m\u001b[48;2;30;30;46m                                                                                        \u001b[0m",
  "\u001b[0m\u001b[48;2;30;30;46m \u001b[0m\u001b[38;2;255;102;0m\u001b[48;2;30;30;46m│\u001b[0m\u001b[1m\u001b[38;2;255;102;0m\u001b[48;2;30;30;46m GRAPH \u001b[0m\u001b[38;2;255;102;0m\u001b[48;2;30;30;46m│\u001b[0m\u001b[48;2;30;30;46m          \u001b[0m\u001b[1m\u001b[38;2;205;214;244m\u001b[48;2;30;30;46mesc\u001b[0m\u001b[48;2;30;30;46m \u001b[0m\u001b[38;2;108;108;108m\u001b[48;2;30;30;46mback\u001b[0m\u001b[48;2;30;30;46m \u001b[0m\u001b[38;2;88;88;88m\u001b[48;2;30;30;46m·\u001b[0m\u001b[48;2;30;30;46m \u001b[0m\u001b[1m\u001b[38;2;205;214;244m\u001b[48;2;30;30;46m↵\u001b[0m\u001b[48;2;30;30;46m \u001b[0m\u001b[38;2;108;108;108m\u001b[48;2;30;30;46mopen\u001b[0m\u001b[48;2;30;30;46m \u001b[0m\u001b[38;2;88;88;88m\u001b[48;2;30;30;46m·\u001b[0m\u001b[48;2;30;30;46m \u001b[0m\u001b[1m\u001b[38;2;205;214;244m\u001b[48;2;30;30;46mp\u001b[0m\u001b[48;2;30;30;46m \u001b[0m\u001b[38;2;108;108;108m\u001b[48;2;30;30;46mpause\u001b[0m\u001b[48;2;30;30;46m \u001b[0m\u001b[38;2;88;88;88m\u001b[48;2;30;30;46m·\u001b[0m\u001b[48;2;30;30;46m \u001b[0m\u001b[1m\u001b[38;2;205;214;244m\u001b[48;2;30;30;46mq\u001b[0m\u001b[48;2;30;30;46m \u001b[0m\u001b[38;2;108;108;108m\u001b[48;2;30;30;46mquit\u001b[0m\u001b[48;2;30;30;46m \u001b[0m\u001b[38;2;88;88;88m\u001b[48;2;30;30;46m·\u001b[0m\u001b[48;2;30;30;46m \u001b[0m\u001b[1m\u001b[38;2;205;214;244m\u001b[48;2;30;30;46m/\u001b[0m\u001b[48;2;30;30;46m \u001b[0m\u001b[38;2;108;108;108m\u001b[48;2;30;30;46mstages\u001b[0m\u001b[48;2;30;30;46m \u001b[0m\u001b[38;2;88;88;88m\u001b[48;2;30;30;46m·\u001b[0m\u001b[48;2;30;30;46m \u001b[0m\u001b[1m\u001b[38;2;205;214;244m\u001b[48;2;30;30;46mf\u001b[0m\u001b[48;2;30;30;46m \u001b[0m\u001b[38;2;108;108;108m\u001b[48;2;30;30;46mfilter\u001b[0m\u001b[48;2;30;30;46m \u001b[0m\u001b[38;2;88;88;88m\u001b[48;2;30;30;46m·\u001b[0m\u001b[48;2;30;30;46m \u001b[0m\u001b[1m\u001b[38;2;205;214;244m\u001b[48;2;30;30;46m?\u001b[0m\u001b[48;2;30;30;46m \u001b[0m\u001b[38;2;108;108;108m\u001b[48;2;30;30;46mkeys\u001b[0m\u001b[48;2;30;30;46m \u001b[0m\u001b[38;2;88;88;88m\u001b[48;2;30;30;46m·\u001b[0m\u001b[48;2;30;30;46m \u001b[0m\u001b[1m\u001b[38;2;205;214;244m\u001b[48;2;30;30;46mh\u001b[0m\u001b[48;2;30;30;46m \u001b[0m\u001b[38;2;108;108;108m\u001b[48;2;30;30;46mhide\u001b[0m\u001b[48;2;30;30;46m  \u001b[0m",
  "\u001b[0m\u001b[48;2;30;30;46m \u001b[0m\u001b[38;2;255;102;0m\u001b[48;2;30;30;46m╰───────╯\u001b[0m\u001b[48;2;30;30;46m                                                                                        \u001b[0m",
  "                                                                                                  ",
];
export const GRAPH_SCREEN = GRAPH_LINES.join("\n");

// A turn stopped with esc before its first token: the finished line has no token count.
const INTERRUPTED_LINES = [
  " The command finished and printed \"done\".                                                        \r",
  "\r",
  "\u001b[0m\u001b[48;2;45;45;48m                                                                                                 \u001b[0m\r",
  "\u001b[0m\u001b[48;2;45;45;48m Say hello.                                                                                      \u001b[0m\r",
  "\u001b[0m\u001b[48;2;45;45;48m                                                                                                 \u001b[0m\r",
  "\r",
  " \u001b[0m\u001b[38;5;242m◼\u001b[0m \u001b[0m\u001b[1m\u001b[38;2;255;102;0mInterrupted\u001b[0m\u001b[38;5;240m · response\u001b[0m\r",
  "\r",
  " \u001b[0m\u001b[38;5;240m∀\u001b[0m \u001b[0m\u001b[38;5;240mRustled for 0s\u001b[0m                                                                                \r",
  "                                       \u001b[0m\u001b[38;5;240m↑\u001b[0m\u001b[38;5;242m412\u001b[0m\u001b[38;5;240m • ↓\u001b[0m\u001b[38;5;242m97\u001b[0m\u001b[38;5;240m • R\u001b[0m\u001b[38;5;242m58k\u001b[0m\u001b[38;5;240m • W\u001b[0m\u001b[38;5;242m22k\u001b[0m\u001b[38;5;240m • \u001b[0m\u001b[38;5;242m$0.208\u001b[0m \u001b[0m\u001b[38;5;240m(sub) • \u001b[0m\u001b[38;5;242m4.2%/1.0M (auto)\u001b[0m\r",
  RULE_97,
  EMPTY_PROMPT_97,
  RULE_97,
  "\u001b[0m\u001b[38;5;240manthropic/claude-opus-5-5  medium\u001b[0m \u001b[0m\u001b[38;5;240m•\u001b[0m \u001b[0m\u001b[38;5;242m~/projects/shed\u001b[0m\u001b[38;5;240m · \u001b[0m\u001b[38;5;242m? keys\u001b[0m",
];
export const INTERRUPTED_SCREEN = INTERRUPTED_LINES.join("\n");

// Working, before the first token: the spinner without its meta.
const SPINNER_LINES = [
  "\u001b[0m\u001b[48;2;45;45;48m                                                                                                 \u001b[0m\r",
  "\u001b[0m\u001b[48;2;45;45;48m Use the bash tool once to run: sleep 3; echo done. Then reply with one short sentence.          \u001b[0m\r",
  "\u001b[0m\u001b[48;2;45;45;48m                                                                                                 \u001b[0m\r",
  "\r",
  " \u001b[0m\u001b[38;5;240m∀\u001b[0m \u001b[0m\u001b[38;5;242mAligning the chakras…\u001b[0m                                                                         \r",
  "                                                                  \u001b[0m\u001b[38;5;242m$0.000\u001b[0m \u001b[0m\u001b[38;5;240m(sub) • \u001b[0m\u001b[38;5;242m3.0%/1.0M (auto)\u001b[0m\r",
  RULE_97,
  EMPTY_PROMPT_97,
  RULE_97,
  "\u001b[0m\u001b[38;5;242mesc to interrupt\u001b[0m\u001b[38;5;240m · \u001b[0m\u001b[38;5;242m? keys\u001b[0m",
];
export const SPINNER_SCREEN = SPINNER_LINES.join("\n");

// Working, a second in: the spinner with only its elapsed time.
const SPINNER_ELAPSED_LINES = [
  "\u001b[0m\u001b[48;2;45;45;48m                                                                                                 \u001b[0m\r",
  "\u001b[0m\u001b[48;2;45;45;48m Use the bash tool once to run: sleep 3; echo done. Then reply with one short sentence.          \u001b[0m\r",
  "\u001b[0m\u001b[48;2;45;45;48m                                                                                                 \u001b[0m\r",
  "\r",
  " \u001b[0m\u001b[38;2;255;102;0m∀\u001b[0m \u001b[0m\u001b[38;5;242mAligning the chakras… (1s)\u001b[0m                                                                    \r",
  "                                                                  \u001b[0m\u001b[38;5;242m$0.000\u001b[0m \u001b[0m\u001b[38;5;240m(sub) • \u001b[0m\u001b[38;5;242m3.0%/1.0M (auto)\u001b[0m\r",
  RULE_97,
  EMPTY_PROMPT_97,
  RULE_97,
  "\u001b[0m\u001b[38;5;242mesc to interrupt\u001b[0m\u001b[38;5;240m · \u001b[0m\u001b[38;5;242m? keys\u001b[0m",
];
export const SPINNER_ELAPSED_SCREEN = SPINNER_ELAPSED_LINES.join("\n");

// Waiting for the model's reply after a tool result: "↑ N tokens".
const SPINNER_REQUESTING_LINES = [
  "\u001b[0m\u001b[48;2;45;45;48m                                                                                                 \u001b[0m\r",
  "\u001b[0m\u001b[48;2;45;45;48m Use the bash tool once to run: sleep 3; echo done. Then reply with one short sentence.          \u001b[0m\r",
  "\u001b[0m\u001b[48;2;45;45;48m                                                                                                 \u001b[0m\r",
  "\r",
  " \u001b[0m\u001b[38;2;0;255;0m●\u001b[0m \u001b[0m\u001b[1m\u001b[38;2;255;102;0mBash\u001b[0m(sleep 3; echo done)\u001b[0m\u001b[38;5;240m · 3.0s\u001b[0m\r",
  " \u001b[0m\u001b[38;5;240m  ⎿  \u001b[0mdone\r",
  "\r",
  " \u001b[0m\u001b[38;5;240m∀\u001b[0m \u001b[0m\u001b[38;5;242mSurfing the syntax waves… (4s · ↑ 55 tokens)\u001b[0m                                                  \r",
  "                               \u001b[0m\u001b[38;5;240m↑\u001b[0m\u001b[38;5;242m4\u001b[0m\u001b[38;5;240m • ↓\u001b[0m\u001b[38;5;242m55\u001b[0m\u001b[38;5;240m • R\u001b[0m\u001b[38;5;242m17k\u001b[0m\u001b[38;5;240m • W\u001b[0m\u001b[38;5;242m22k\u001b[0m\u001b[38;5;240m • CH\u001b[0m\u001b[38;5;242m46.6%\u001b[0m\u001b[38;5;240m • \u001b[0m\u001b[38;5;242m$0.172\u001b[0m \u001b[0m\u001b[38;5;240m(sub) • \u001b[0m\u001b[38;5;242m4.2%/1.0M (auto)\u001b[0m\r",
  RULE_97,
  EMPTY_PROMPT_97,
  RULE_97,
  "\u001b[0m\u001b[38;5;242mesc to interrupt\u001b[0m\u001b[38;5;240m · \u001b[0m\u001b[38;5;242m? keys\u001b[0m",
];
export const SPINNER_REQUESTING_SCREEN = SPINNER_REQUESTING_LINES.join("\n");

// Scrolled up from the bottom in a 222-column pane: Atomic's pill "↓ jump to
// bottom · ctrl+end" on its own row above the turn line.
const JUMP_PILL_LINES = [
  "\u001b[0m\u001b[48;2;45;45;48m                                                                                                                                                                                                                              \u001b[0m\r",
  "\u001b[0m\u001b[48;2;45;45;48m Use the workflow tool to run kettle-check in the background. Then stop and say only: started.                                                                                                                                \u001b[0m\r",
  "\u001b[0m\u001b[48;2;45;45;48m                                                                                                                                                                                                                              \u001b[0m\r",
  "\r",
  " \u001b[0m\u001b[3m\u001b[38;5;242mI'll check the workflow inputs first, then look at how to run \"kettle-check.\"\u001b[0m                                                                                                                                                \r",
  "\r",
  " \u001b[0m\u001b[38;2;0;255;0m●\u001b[0m \u001b[0m\u001b[1m\u001b[38;2;255;102;0mworkflow \u001b[0minputs \u001b[0m\u001b[38;2;255;102;0mkettle-check\u001b[0m\u001b[38;5;240m · 1s\u001b[0m\r",
  " \u001b[0m\u001b[38;5;240m  ⎿  kettle-check takes no inputs\u001b[0m \u001b[0m\u001b[38;5;242m(\u001b[0m\u001b[38;5;240mctrl+o\u001b[0m\u001b[38;5;242m to expand)\u001b[0m\r",
  "\r",
  " \u001b[0m\u001b[38;2;0;255;0m●\u001b[0m \u001b[0m\u001b[1m\u001b[38;2;255;102;0mWorkflow\u001b[0m(\u001b[0m\u001b[38;2;255;102;0mkettle-check\u001b[0m)\r",
  " \u001b[0m\u001b[38;5;240m  ⎿  \u001b[0m\u001b[38;2;255;255;0m!\u001b[0m Waiting for input at select · stage 1/1 select · 19s · Boil the kettle now, or wait for the guests? The tea shop shuts at noon. · ↓ to manage \u001b[0m\u001b[38;5;242m(\u001b[0m\u001b[38;5;240mctrl+o\u001b[0m\u001b[38;5;242m to expand)\u001b[0m\r",
  "\r",
  " started.                                                                                                                                                                                                                     \r",
  "\r",
  "                                                                                                \u001b[0m\u001b[48;2;45;45;48m ↓ jump to bottom · ctrl+end \u001b[0m                                                                                                 \r",
  "\r",
  " \u001b[0m\u001b[38;5;240m∀\u001b[0m \u001b[0m\u001b[38;5;240mRead for 6s · ↓ 215 tokens\u001b[0m                                                                                                                                                                                                 \r",
  "                                                                                                                                                        \u001b[0m\u001b[38;5;240m↑\u001b[0m\u001b[38;5;242m570\u001b[0m\u001b[38;5;240m • ↓\u001b[0m\u001b[38;5;242m247\u001b[0m\u001b[38;5;240m • R\u001b[0m\u001b[38;5;242m118k\u001b[0m\u001b[38;5;240m • W\u001b[0m\u001b[38;5;242m23k\u001b[0m\u001b[38;5;240m • CH\u001b[0m\u001b[38;5;242m97.1%\u001b[0m\u001b[38;5;240m • \u001b[0m\u001b[38;5;242m$0.187\u001b[0m \u001b[0m\u001b[38;5;240m(sub) • \u001b[0m\u001b[38;5;242m4.2%/1.0M (auto)\u001b[0m\r",
  RULE_222,
  EMPTY_PROMPT_222,
  RULE_222,
  "\u001b[0m\u001b[38;5;240manthropic/claude-opus-5-5  medium\u001b[0m \u001b[0m\u001b[38;5;240m•\u001b[0m \u001b[0m\u001b[38;5;242m~/projects/porch\u001b[0m\u001b[38;5;240m · \u001b[0m\u001b[38;5;242m1 needs input\u001b[0m\u001b[38;5;240m · \u001b[0m\u001b[38;5;242m? keys\u001b[0m\r",
  "\r",
  "  \u001b[0m\u001b[38;2;255;255;0m◆\u001b[0m \u001b[0m\u001b[38;5;242mkettle-check\u001b[0m  \u001b[0m\u001b[38;5;242mBoil the kettle now, or wait for the guests? The tea shop shuts at noon.\u001b[0m                                                                                                                   \u001b[0m\u001b[38;5;242mneeds input · 19s\u001b[0m",
];
export const JUMP_PILL_SCREEN = JUMP_PILL_LINES.join("\n");

// Scrolled up while a turn ran: "↓ 4 new messages · ctrl+end" drawn over the
// end of the agent's row "10".
const NEW_MESSAGES_LINES = [
  " 4                                                                                                                                                                                                                            \r",
  " 5                                                                                                                                                                                                                            \r",
  " 6                                                                                                                                                                                                                            \r",
  " 7                                                                                                                                                                                                                            \r",
  " 8                                                                                                                                                                                                                            \r",
  " 9                                                                                                                                                                                                                            \r",
  " 10                                                                                             \u001b[0m\u001b[48;2;45;45;48m ↓ 4 new messages · ctrl+end \u001b[0m                                                                                                 \r",
  "\r",
  " \u001b[0m\u001b[38;5;240m∀\u001b[0m \u001b[0m\u001b[38;5;240mChattered for 6s · ↓ 61 tokens\u001b[0m                                                                                                                                                                                             \r",
  "                                                                                                                                                       \u001b[0m\u001b[38;5;240m↑\u001b[0m\u001b[38;5;242m2.7k\u001b[0m\u001b[38;5;240m • ↓\u001b[0m\u001b[38;5;242m479\u001b[0m\u001b[38;5;240m • R\u001b[0m\u001b[38;5;242m231k\u001b[0m\u001b[38;5;240m • W\u001b[0m\u001b[38;5;242m42k\u001b[0m\u001b[38;5;240m • CH\u001b[0m\u001b[38;5;242m99.8%\u001b[0m\u001b[38;5;240m • \u001b[0m\u001b[38;5;242m$0.374\u001b[0m \u001b[0m\u001b[38;5;240m(sub) • \u001b[0m\u001b[38;5;242m4.2%/1.0M (auto)\u001b[0m\r",
  RULE_222,
  EMPTY_PROMPT_222,
  RULE_222,
  "\u001b[0m\u001b[38;5;240manthropic/claude-opus-5-5  medium\u001b[0m \u001b[0m\u001b[38;5;240m•\u001b[0m \u001b[0m\u001b[38;5;242m~/projects/shed (main)\u001b[0m\u001b[38;5;240m · \u001b[0m\u001b[38;5;242m? keys\u001b[0m",
];
export const NEW_MESSAGES_SCREEN = NEW_MESSAGES_LINES.join("\n");

// Idle, its list of runs focused with ↓ at the empty prompt, in the prompt box's
// place: the waiting run under ❯, the list's key hint, the footer without "· ? keys".
const LIST_FOCUSED_LINES = [
  " started.                                                                                                                                                                                                                     ",
  "",
  " \u001b[0m\u001b[38;5;240m∀\u001b[0m \u001b[0m\u001b[38;5;240mFreed for 6s · ↓ 201 tokens\u001b[0m                                                                                                                                                                                                ",
  "                                                                                                                                                           \u001b[0m\u001b[38;5;240m↑\u001b[0m\u001b[38;5;242m8\u001b[0m\u001b[38;5;240m • ↓\u001b[0m\u001b[38;5;242m201\u001b[0m\u001b[38;5;240m • R\u001b[0m\u001b[38;5;242m91k\u001b[0m\u001b[38;5;240m • W\u001b[0m\u001b[38;5;242m17k\u001b[0m\u001b[38;5;240m • CH\u001b[0m\u001b[38;5;242m99.3%\u001b[0m\u001b[38;5;240m • \u001b[0m\u001b[38;5;242m$2.418\u001b[0m \u001b[0m\u001b[38;5;240m(sub) • \u001b[0m\u001b[38;5;242m3.6%/1.0M (auto)\u001b[0m",
  "\u001b[0m\u001b[1m\u001b[38;2;255;102;0m❯ \u001b[0m\u001b[38;2;255;255;0m◆\u001b[0m \u001b[0m\u001b[1mhat-check\u001b[0m  Wear the red hat to the fair, or the blue one? The hat stall closes at four.                                                                                                                   needs input · 2m",
  RUN_LIST_KEYS_ROW,
  "",
  "\u001b[0m\u001b[38;5;240manthropic/claude-opus-5-5  medium\u001b[0m \u001b[0m\u001b[38;5;240m•\u001b[0m \u001b[0m\u001b[38;5;242m~/projects/attic\u001b[0m",
];
export const LIST_FOCUSED_SCREEN = LIST_FOCUSED_LINES.join("\n");

// The list focused while a turn runs: Atomic drops the footer.
const LIST_FOCUSED_WORKING_LINES = [
  " \u001b[0m\u001b[3m\u001b[38;5;242mThe workflow wasn't found, so I'm weighing whether to still run the shell command, since it doesn't depend on the workflow. I'll run the sleep and then report, but I need to be honest with the user that the workflow     \u001b[0m",
  " \u001b[0m\u001b[3m\u001b[38;5;242mfailed rather than just saying \"done.\"\u001b[0m                                                                                                                                                                                      ",
  "",
  " \u001b[0m\u001b[38;2;0;255;0m●\u001b[0m \u001b[0m\u001b[1m\u001b[38;2;255;102;0mBash\u001b[0m(sleep 40; echo tide)\u001b[0m\u001b[38;5;240m · background\u001b[0m",
  " \u001b[0m\u001b[38;5;240m  ⎿  \u001b[0mRunning in background\u001b[0m\u001b[38;5;240m · /tasks to manage\u001b[0m",
  "",
  " \u001b[0m\u001b[1m∀\u001b[0m \u001b[0m\u001b[1m\u001b[38;2;255;102;0mWait\u001b[0m(task-1-0-0)\u001b[0m\u001b[38;5;240m · 8s\u001b[0m",
  "",
  " \u001b[0m\u001b[1m∀\u001b[0m \u001b[0m\u001b[38;5;242mStumbling… (25s · ↓ 357 tokens)\u001b[0m                                                                                                                                                                                           ",
  "                                                                                                                                                        \u001b[0m\u001b[38;5;240m↑\u001b[0m\u001b[38;5;242m16\u001b[0m\u001b[38;5;240m • ↓\u001b[0m\u001b[38;5;242m509\u001b[0m\u001b[38;5;240m • R\u001b[0m\u001b[38;5;242m230k\u001b[0m\u001b[38;5;240m • W\u001b[0m\u001b[38;5;242m23k\u001b[0m\u001b[38;5;240m • CH\u001b[0m\u001b[38;5;242m99.4%\u001b[0m\u001b[38;5;240m • \u001b[0m\u001b[38;5;242m$1.093\u001b[0m \u001b[0m\u001b[38;5;240m(sub) • \u001b[0m\u001b[38;5;242m4.3%/1.0M (auto)\u001b[0m",
  "\u001b[0m\u001b[1m\u001b[38;2;255;102;0m❯ \u001b[0m\u001b[38;2;255;255;0m◆\u001b[0m \u001b[0m\u001b[1mkite-check\u001b[0m  Fly the yellow kite today, or the green one? The wind drops after lunch.                                                                                                                     needs input · 4m",
  RUN_LIST_KEYS_ROW,
];
export const LIST_FOCUSED_WORKING_SCREEN = LIST_FOCUSED_WORKING_LINES.join("\n");

// Two runs waiting, the cursor moved down to the second.
const LIST_TWO_LINES = [
  " \u001b[0m\u001b[38;2;0;255;0m●\u001b[0m \u001b[0m\u001b[1m\u001b[38;2;255;102;0mWorkflow\u001b[0m(\u001b[0m\u001b[38;2;255;102;0mkite-check\u001b[0m)",
  " \u001b[0m\u001b[38;5;240m  ⎿  \u001b[0m\u001b[38;2;255;255;0m!\u001b[0m Waiting for input at select · stage 1/1 select · Fly the yellow kite today, or the green one? The wind drops after lunch. · ↓ to manage \u001b[0m\u001b[38;5;242m(\u001b[0m\u001b[38;5;240mctrl+o\u001b[0m\u001b[38;5;242m to expand)\u001b[0m",
  "",
  " again.                                                                                                                                                                                                                      ",
  "",
  " \u001b[0m\u001b[38;5;240m∀\u001b[0m \u001b[0m\u001b[38;5;240mRecombobulated for 3s · ↓ 77 tokens\u001b[0m                                                                                                                                                                                       ",
  "                                                                                                                                                        \u001b[0m\u001b[38;5;240m↑\u001b[0m\u001b[38;5;242m28\u001b[0m\u001b[38;5;240m • ↓\u001b[0m\u001b[38;5;242m690\u001b[0m\u001b[38;5;240m • R\u001b[0m\u001b[38;5;242m401k\u001b[0m\u001b[38;5;240m • W\u001b[0m\u001b[38;5;242m24k\u001b[0m\u001b[38;5;240m • CH\u001b[0m\u001b[38;5;242m99.4%\u001b[0m\u001b[38;5;240m • \u001b[0m\u001b[38;5;242m$1.507\u001b[0m \u001b[0m\u001b[38;5;240m(sub) • \u001b[0m\u001b[38;5;242m4.3%/1.0M (auto)\u001b[0m",
  "  \u001b[0m\u001b[38;2;255;255;0m◆\u001b[0m \u001b[0m\u001b[38;5;242mkite-check\u001b[0m  \u001b[0m\u001b[38;5;242mFly the yellow kite today, or the green one? The wind drops after lunch.\u001b[0m                                                                                                                    \u001b[0m\u001b[38;5;242mneeds input · 44s\u001b[0m",
  "\u001b[0m\u001b[1m\u001b[38;2;255;102;0m❯ \u001b[0m\u001b[38;2;255;255;0m◆\u001b[0m \u001b[0m\u001b[1mkite-check\u001b[0m  Fly the yellow kite today, or the green one? The wind drops after lunch.                                                                                                                     needs input · 6m",
  RUN_LIST_KEYS_ROW,
  "\u001b[0m\u001b[38;5;240manthropic/claude-opus-5-5  medium\u001b[0m \u001b[0m\u001b[38;5;240m•\u001b[0m \u001b[0m\u001b[38;5;242m~/projects/porch\u001b[0m",
];
export const LIST_TWO_SCREEN = LIST_TWO_LINES.join("\n");

// After x on a run: the key hint becomes Atomic's warning to press it again.
const LIST_PRESS_AGAIN_LINES = LIST_TWO_LINES.slice(3).map((line) => (line === RUN_LIST_KEYS_ROW ? "\u001b[0m\u001b[38;2;255;255;0m  Press x again within 3s to stop kite-check\u001b[0m" : line));
export const LIST_PRESS_AGAIN_SCREEN = LIST_PRESS_AGAIN_LINES.join("\n");

// ? at the empty prompt: Atomic's keys box in the prompt box's place, over its footer.
const KEYS_HELP_LINES = [
  " The hat-check workflow finished after about 4 minutes. Its answer was \u001b[0m\u001b[1m\"Blue hat\"\u001b[0m, and nothing blocked the run.                                                                                                               ",
  "",
  " \u001b[0m\u001b[38;5;240m∀\u001b[0m \u001b[0m\u001b[38;5;240mPulsated for 3s · ↓ 181 tokens\u001b[0m                                                                                                                                                                                             ",
  "                                                                                                                                                         \u001b[0m\u001b[38;5;240m↑\u001b[0m\u001b[38;5;242m14\u001b[0m\u001b[38;5;240m • ↓\u001b[0m\u001b[38;5;242m382\u001b[0m\u001b[38;5;240m • R\u001b[0m\u001b[38;5;242m164k\u001b[0m\u001b[38;5;240m • W\u001b[0m\u001b[38;5;242m17k\u001b[0m\u001b[38;5;240m • CH\u001b[0m\u001b[38;5;242m99.1%\u001b[0m\u001b[38;5;240m • \u001b[0m\u001b[38;5;242m$3.906\u001b[0m \u001b[0m\u001b[38;5;240m(sub) • \u001b[0m\u001b[38;5;242m3.7%/1.0M (auto)\u001b[0m",
  "\u001b[0m\u001b[38;5;242m╭─\u001b[0m\u001b[1m keys \u001b[0m\u001b[38;5;242m─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮\u001b[0m",
  "\u001b[0m\u001b[38;5;242m│ \u001b[0menter      \u001b[0m\u001b[38;5;242msend the prompt\u001b[0m                                                                                                                                                                                                \u001b[0m\u001b[38;5;242m │\u001b[0m",
  "\u001b[0m\u001b[38;5;242m│ \u001b[0m/          \u001b[0m\u001b[38;5;242mcommands, at the start of the prompt\u001b[0m                                                                                                                                                                           \u001b[0m\u001b[38;5;242m │\u001b[0m",
  "\u001b[0m\u001b[38;5;242m│ \u001b[0m@          \u001b[0m\u001b[38;5;242minsert a file path\u001b[0m                                                                                                                                                                                             \u001b[0m\u001b[38;5;242m │\u001b[0m",
  "\u001b[0m\u001b[38;5;242m│ \u001b[0mctrl+r     \u001b[0m\u001b[38;5;242msearch past prompts\u001b[0m                                                                                                                                                                                            \u001b[0m\u001b[38;5;242m │\u001b[0m",
  "\u001b[0m\u001b[38;5;242m│ \u001b[0mpgup/pgdn  \u001b[0m\u001b[38;5;242mscroll\u001b[0m                                                                                                                                                                                                         \u001b[0m\u001b[38;5;242m │\u001b[0m",
  "\u001b[0m\u001b[38;5;242m│ \u001b[0mctrl+end   \u001b[0m\u001b[38;5;242mjump to the latest message\u001b[0m                                                                                                                                                                                     \u001b[0m\u001b[38;5;242m │\u001b[0m",
  "\u001b[0m\u001b[38;5;242m│ \u001b[0mctrl+o     \u001b[0m\u001b[38;5;242mexpand tool output\u001b[0m                                                                                                                                                                                             \u001b[0m\u001b[38;5;242m │\u001b[0m",
  "\u001b[0m\u001b[38;5;242m│ \u001b[0mctrl+t     \u001b[0m\u001b[38;5;242mshow or hide thinking\u001b[0m                                                                                                                                                                                          \u001b[0m\u001b[38;5;242m │\u001b[0m",
  "\u001b[0m\u001b[38;5;242m│ \u001b[0mctrl+x     \u001b[0m\u001b[38;5;242mthen the stop-all key: stop all background work\u001b[0m                                                                                                                                                                \u001b[0m\u001b[38;5;242m │\u001b[0m",
  "\u001b[0m\u001b[38;5;242m│ \u001b[0mesc/?      \u001b[0m\u001b[38;5;242mclose this help\u001b[0m                                                                                                                                                                                                \u001b[0m\u001b[38;5;242m │\u001b[0m",
  "\u001b[0m\u001b[38;5;242m╰────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯\u001b[0m",
  "\u001b[0m\u001b[38;5;240manthropic/claude-opus-5-5  medium\u001b[0m \u001b[0m\u001b[38;5;240m•\u001b[0m \u001b[0m\u001b[38;5;242m~/projects/attic\u001b[0m\u001b[38;5;240m · \u001b[0m\u001b[38;5;242m? keys\u001b[0m",
];
export const KEYS_HELP_SCREEN = KEYS_HELP_LINES.join("\n");

// ? in the focused list while a turn runs: the keys box, and no footer under it.
const LIST_HELP_WORKING_LINES = [
  " \u001b[0m\u001b[38;2;0;255;0m●\u001b[0m \u001b[0m\u001b[1m\u001b[38;2;255;102;0mBash\u001b[0m(sleep 40; echo tide)\u001b[0m\u001b[38;5;240m · background\u001b[0m",
  " \u001b[0m\u001b[38;5;240m  ⎿  \u001b[0mRunning in background\u001b[0m\u001b[38;5;240m · /tasks to manage\u001b[0m",
  "",
  " \u001b[0m\u001b[38;5;240m∀\u001b[0m \u001b[0m\u001b[1m\u001b[38;2;255;102;0mWait\u001b[0m(task-1-0-0)\u001b[0m\u001b[38;5;240m · 10s\u001b[0m",
  "",
  " \u001b[0m\u001b[38;5;240m∀\u001b[0m \u001b[0m\u001b[38;5;242mStumbling… (27s · ↓ 357 tokens)\u001b[0m                                                                                                                                                                                           ",
  "                                                                                                                                                        \u001b[0m\u001b[38;5;240m↑\u001b[0m\u001b[38;5;242m16\u001b[0m\u001b[38;5;240m • ↓\u001b[0m\u001b[38;5;242m509\u001b[0m\u001b[38;5;240m • R\u001b[0m\u001b[38;5;242m230k\u001b[0m\u001b[38;5;240m • W\u001b[0m\u001b[38;5;242m23k\u001b[0m\u001b[38;5;240m • CH\u001b[0m\u001b[38;5;242m99.4%\u001b[0m\u001b[38;5;240m • \u001b[0m\u001b[38;5;242m$1.093\u001b[0m \u001b[0m\u001b[38;5;240m(sub) • \u001b[0m\u001b[38;5;242m4.3%/1.0M (auto)\u001b[0m",
  "\u001b[0m\u001b[38;5;242m╭─\u001b[0m\u001b[1m keys · agents \u001b[0m\u001b[38;5;242m───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮\u001b[0m",
  "\u001b[0m\u001b[38;5;242m│ \u001b[0m↑↓                  \u001b[0m\u001b[38;5;242mselect\u001b[0m                                                                                                                                                                                               \u001b[0m\u001b[38;5;242m │\u001b[0m",
  "\u001b[0m\u001b[38;5;242m│ \u001b[0menter/→             \u001b[0m\u001b[38;5;242mto open\u001b[0m                                                                                                                                                                                              \u001b[0m\u001b[38;5;242m │\u001b[0m",
  "\u001b[0m\u001b[38;5;242m│ \u001b[0mx                   \u001b[0m\u001b[38;5;242mstop\u001b[0m                                                                                                                                                                                                 \u001b[0m\u001b[38;5;242m │\u001b[0m",
  "\u001b[0m\u001b[38;5;242m│ \u001b[0mesc/←               \u001b[0m\u001b[38;5;242mback to prompt\u001b[0m                                                                                                                                                                                       \u001b[0m\u001b[38;5;242m │\u001b[0m",
  "\u001b[0m\u001b[38;5;242m│ \u001b[0m↑ on the first row  \u001b[0m\u001b[38;5;242mback to prompt\u001b[0m                                                                                                                                                                                       \u001b[0m\u001b[38;5;242m │\u001b[0m",
  "\u001b[0m\u001b[38;5;242m│ \u001b[0mctrl+x              \u001b[0m\u001b[38;5;242mthen the stop-all key: stop all background work\u001b[0m                                                                                                                                                      \u001b[0m\u001b[38;5;242m │\u001b[0m",
  "\u001b[0m\u001b[38;5;242m│ \u001b[0mesc/?               \u001b[0m\u001b[38;5;242mclose this help\u001b[0m                                                                                                                                                                                      \u001b[0m\u001b[38;5;242m │\u001b[0m",
  "\u001b[0m\u001b[38;5;242m╰───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯\u001b[0m",
];
export const LIST_HELP_WORKING_SCREEN = LIST_HELP_WORKING_LINES.join("\n");
