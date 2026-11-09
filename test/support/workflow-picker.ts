// Atomic's `/workflow connect` picker open in a pane, as herdr's
// `agent read --source recent-unwrapped --format ansi` returns it: escape for
// escape from a real pane (Atomic 0.9.74, 97 columns, one running and one
// finished no-model run), with generic run ids, names and folder of the same
// widths, under two rows of the agent's own words.
const WORKFLOW_PICKER_LINES = [
  " R5 is already running (run 3f6c2a10). It started right after your last message, so there's",
  " nothing more to start. I'll update you as it goes.",
  "",
  " \u001b[0m\u001b[38;2;255;102;0m∀\u001b[0m \u001b[0m\u001b[38;5;242mWorking\u001b[0m                                                                                       \r",
  "\r",
  "                           \u001b[0m\u001b[38;5;240m↑\u001b[0m\u001b[38;5;242m911\u001b[0m\u001b[38;5;240m • ↓\u001b[0m\u001b[38;5;242m374\u001b[0m\u001b[38;5;240m • R\u001b[0m\u001b[38;5;242m131k\u001b[0m\u001b[38;5;240m • W\u001b[0m\u001b[38;5;242m44k\u001b[0m\u001b[38;5;240m • CH\u001b[0m\u001b[38;5;242m99.6%\u001b[0m\u001b[38;5;240m • \u001b[0m\u001b[38;5;242m$0.390\u001b[0m \u001b[0m\u001b[38;5;240m(sub) • \u001b[0m\u001b[38;5;242m4.4%/1.0M (auto)\u001b[0m\r",
  "\u001b[0m\u001b[38;2;108;112;134m╭──\u001b[0m\u001b[38;2;137;180;250m Connect to workflow run \u001b[0m\u001b[38;2;108;112;134m" + "─".repeat(68) + "╮\u001b[0m\r",
  "\u001b[0m\u001b[38;2;108;112;134m│\u001b[0m\u001b[48;2;30;30;46m                                                                                               \u001b[0m\u001b[38;2;108;112;134m│\u001b[0m\r",
  "\u001b[0m\u001b[38;2;108;112;134m│\u001b[0m\u001b[48;2;30;30;46m \u001b[0m\u001b[38;2;203;166;247m\u001b[48;2;30;30;46m \u001b[0m\u001b[48;2;30;30;46m \u001b[0m\u001b[38;2;166;173;200m\u001b[48;2;30;30;46mfilter\u001b[0m\u001b[48;2;30;30;46m  \u001b[0m\u001b[38;2;166;173;200m\u001b[48;2;30;30;46m(type to filter by name or id)\u001b[0m\u001b[48;2;30;30;46m                                                      \u001b[0m\u001b[38;2;108;112;134m│\u001b[0m\r",
  "\u001b[0m\u001b[38;2;108;112;134m│\u001b[0m\u001b[48;2;30;30;46m                                                                                               \u001b[0m\u001b[38;2;108;112;134m│\u001b[0m\r",
  "\u001b[0m\u001b[38;2;108;112;134m│\u001b[0m\u001b[48;2;30;30;46m \u001b[0m\u001b[38;2;203;166;247m\u001b[48;2;30;30;46m \u001b[0m\u001b[48;2;30;30;46m \u001b[0m\u001b[1m\u001b[38;2;166;173;200m\u001b[48;2;30;30;46mACTIVE\u001b[0m\u001b[48;2;30;30;46m                                                                                      \u001b[0m\u001b[38;2;108;112;134m│\u001b[0m\r",
  "\u001b[0m\u001b[38;2;108;112;134m│\u001b[0m\u001b[1m\u001b[38;2;49;50;68m\u001b[48;2;137;180;250m ● 3f6c2a10-8b4e-4d2f-9a71-5e0b6c8d2f14                                                        \u001b[0m\u001b[38;2;108;112;134m│\u001b[0m\r",
  "\u001b[0m\u001b[38;2;108;112;134m│\u001b[0m\u001b[1m\u001b[38;2;49;50;68m\u001b[48;2;137;180;250m   lint-run                                                                                13s \u001b[0m\u001b[38;2;108;112;134m│\u001b[0m\r",
  "\u001b[0m\u001b[38;2;108;112;134m│\u001b[0m\u001b[48;2;30;30;46m \u001b[0m\u001b[38;2;203;166;247m\u001b[48;2;30;30;46m \u001b[0m\u001b[48;2;30;30;46m \u001b[0m\u001b[1m\u001b[38;2;166;173;200m\u001b[48;2;30;30;46mTERMINAL\u001b[0m\u001b[48;2;30;30;46m                                                                                    \u001b[0m\u001b[38;2;108;112;134m│\u001b[0m\r",
  "\u001b[0m\u001b[38;2;108;112;134m│\u001b[0m\u001b[48;2;30;30;46m \u001b[0m\u001b[38;2;166;227;161m\u001b[48;2;30;30;46m✓\u001b[0m\u001b[48;2;30;30;46m \u001b[0m\u001b[38;2;127;132;156m\u001b[48;2;30;30;46m8e21d7b4-0c5a-4f3e-b6d9-27a1f40c9e58\u001b[0m\u001b[48;2;30;30;46m                                                        \u001b[0m\u001b[38;2;108;112;134m│\u001b[0m\r",
  "\u001b[0m\u001b[38;2;108;112;134m│\u001b[0m\u001b[48;2;30;30;46m   \u001b[0m\u001b[38;2;205;214;244m\u001b[48;2;30;30;46mdocs-site\u001b[0m\u001b[48;2;30;30;46m                                                                          \u001b[0m\u001b[38;2;166;173;200m\u001b[48;2;30;30;46m      1s\u001b[0m\u001b[48;2;30;30;46m \u001b[0m\u001b[38;2;108;112;134m│\u001b[0m\r",
  "\u001b[0m\u001b[38;2;108;112;134m│\u001b[0m\u001b[48;2;30;30;46m                                                                                               \u001b[0m\u001b[38;2;108;112;134m│\u001b[0m\r",
  "\u001b[0m\u001b[38;2;108;112;134m╰" + "─".repeat(95) + "╯\u001b[0m\r",
  "  \u001b[0m\u001b[38;2;205;214;244mup/down\u001b[0m \u001b[0m\u001b[38;2;166;173;200mNavigate\u001b[0m\u001b[38;2;127;132;156m · \u001b[0m\u001b[38;2;205;214;244menter\u001b[0m \u001b[0m\u001b[38;2;166;173;200mConnect\u001b[0m\u001b[38;2;127;132;156m · \u001b[0m\u001b[38;2;205;214;244ma\u001b[0m \u001b[0m\u001b[38;2;166;173;200mActive Only\u001b[0m\u001b[38;2;127;132;156m · \u001b[0m\u001b[38;2;205;214;244m/\u001b[0m \u001b[0m\u001b[38;2;166;173;200mFilter\u001b[0m\u001b[38;2;127;132;156m · \u001b[0m\u001b[38;2;205;214;244mesc/ctrl+c\u001b[0m \u001b[0m\u001b[38;2;166;173;200mClose\u001b[0m                 \r",
  "\u001b[0m\u001b[38;5;240manthropic/claude-opus-5-5  medium\u001b[0m \u001b[0m\u001b[38;5;240m•\u001b[0m \u001b[0m\u001b[38;5;242m~/projects/notes-app\u001b[0m\r",
  "\r",
  "\u001b[0m\u001b[38;2;108;112;134m╭ BACKGROUND  1 run  \u001b[0m\u001b[38;2;249;226;175m● 1 running\u001b[0m\u001b[38;2;108;112;134m " + "─".repeat(63) + "╮\u001b[0m\r",
  "\u001b[0m\u001b[38;2;108;112;134m│\u001b[0m   \u001b[0m\u001b[38;2;249;226;175m●\u001b[0m  \u001b[0m\u001b[38;2;137;180;250m3f6c2a10-8b4e-4d2f-9a71-5e0b6c8d2f14\u001b[0m                                                     \u001b[0m\u001b[38;2;108;112;134m│\u001b[0m\r",
  "\u001b[0m\u001b[38;2;108;112;134m│\u001b[0m     \u001b[0m\u001b[1m\u001b[38;2;205;214;244mlint-run\u001b[0m · \u001b[0m\u001b[38;2;166;173;200msingle · pause · running · 13s\u001b[0m                                                 \u001b[0m\u001b[38;2;108;112;134m│\u001b[0m\r",
  "\u001b[0m\u001b[38;2;108;112;134m╰" + "─".repeat(95) + "╯\u001b[0m\r",
  " ↑↓ scroll · Alt+k/Alt+j",
];

export const WORKFLOW_PICKER_SCREEN = WORKFLOW_PICKER_LINES.join("\n");

const plain = (line: string) => line.replace(/\x1b\[[\d;:]*m/g, "").replace(/\r$/, "").trimEnd();
const rowOf = (start: string) => WORKFLOW_PICKER_LINES.map(plain).findIndex((line) => line.trimStart().startsWith(start));

export const ACTIVE_RUN = "3f6c2a10-8b4e-4d2f-9a71-5e0b6c8d2f14";
export const FINISHED_RUN = "8e21d7b4-0c5a-4f3e-b6d9-27a1f40c9e58";
export const PICKER_USAGE = plain(WORKFLOW_PICKER_LINES[rowOf("↑")]).trim();
export const PICKER_ROWS = WORKFLOW_PICKER_LINES.slice(rowOf("╭── Connect"), rowOf("╰") + 1).map(plain);
export const HINT = plain(WORKFLOW_PICKER_LINES[rowOf("up/down")]);
export const PICKER_FOOTER = plain(WORKFLOW_PICKER_LINES[rowOf("anthropic/")]);
const backgroundTop = rowOf("╭ BACKGROUND");
export const BACKGROUND = WORKFLOW_PICKER_LINES.slice(backgroundTop, backgroundTop + 4).map(plain);
export const SCROLL_HINT = plain(WORKFLOW_PICKER_LINES[rowOf("↑↓ scroll")]);
