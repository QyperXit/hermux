import { takesTypedAnswer } from "./agent-question.js";
import { drawComposer } from "./composer.js";
import { drawPausedCard } from "./paused-card.js";
import { drawQuestionCard } from "./question-card.js";
import { drawSubagentStrip } from "./subagent-strip.js";
import { promptState, shownAgent, taskRows, waitingSubagent } from "./subagents.js";
import { isShell, sendTarget } from "./terminals.js";

/**
 * @typedef {import("./types.js").Terminal} Terminal
 * @typedef {import("./screen.js").Screen} Screen
 * @typedef {{ setHidden: (hidden: boolean) => void }} ClosesWithTheBox
 */

// The controls for the screen as last read: the message box labelled with
// whoever is on Atomic's screen (a subagent as "@asker"), hidden while a
// question is on screen; the card while a subagent waits and no question is
// on screen; the paused card while the agent is paused and main is on
// screen; the strip while a subagent is shown. The key bar's saved
// commands and the attach menu close whenever "/" and attach hide: with the
// message box, or while it types into a question, so a saved command never
// goes as an answer.
/**
 * @param {HTMLElement} page the Terminal screen
 * @param {{ terminal: Terminal, sending: boolean, screen: Screen | null }} state
 * @param {{ keyBar: ClosesWithTheBox, attachment: ClosesWithTheBox }} parts
 */
export function drawTerminalControls(page, { terminal, sending, screen }, { keyBar, attachment }) {
  const agentScreen = isShell(terminal) ? null : screen;
  const question = screen?.question ?? null;
  const shown = agentScreen ? shownAgent(agentScreen) : null;
  const waiting = agentScreen && !question ? waitingSubagent(agentScreen) : null;
  const target = shown ? `@${shown.name}` : sendTarget(terminal);
  const menusHidden = drawComposer(page, { target, sending, blocked: terminal.status === "blocked", asked: Boolean(question), answering: takesTypedAnswer(question), card: Boolean(waiting) });
  drawQuestionCard(page, waiting, { target: sendTarget(terminal), draft: Boolean(agentScreen && promptState(agentScreen) === "draft") });
  const paused = terminal.status === "paused" && agentScreen !== null && !question && !waiting && !shown;
  drawPausedCard(page, { shown: paused, listed: Boolean(agentScreen && taskRows(agentScreen)), draft: Boolean(agentScreen && promptState(agentScreen) === "draft") });
  drawSubagentStrip(page, shown);
  page.classList.toggle("has-question", Boolean(question));
  page.classList.toggle("has-subagent-card", Boolean(waiting));
  keyBar.setHidden(menusHidden);
  attachment.setHidden(menusHidden);
}
