import { isBlank, leading, sliceLine, trimEnd } from "./line.js";

/**
 * @typedef {import("./screen.js").Line} Line
 * @typedef {"answer" | "type" | "chat" | "commit"} OptionRole
 * @typedef {{ number: number, label: string, description: string, selected: boolean, ticked: boolean | null, answered: boolean, role: OptionRole }} QuestionOption
 * @typedef {object} Question
 * @property {"ask" | "trust"} form Atomic's own question box, or its "Trust project folder?" prompt
 * @property {number} start its first row on the screen
 * @property {number} end the row after its key hint
 * @property {number | null} heading the "∀ Questions · …" row over the box
 * @property {string} title the question's header, or in a questionnaire the step's name
 * @property {{ at: number, of: number } | null} step which question of a questionnaire
 * @property {boolean} review a questionnaire's Review step
 * @property {string[]} text its paragraphs above the options
 * @property {number} prompt which of them asks the question
 * @property {QuestionOption[]} options numbered 1..n as ↑/↓ walk them
 * @property {string[]} after paragraphs under the options, as an open notes field
 * @property {boolean} typing Atomic's own typing field is open: the cursor's typing row shows the caret, or the notes are open
 */

// Atomic 0.9.90 draws an agent's question (ask_user_question) as a box in
// the prompt box's place, its key hint straight under it and nothing after:
// "↑↓ select · enter choose · esc cancel", "↑↓ select · esc cancel" on an
// empty typing field, "type a note · enter/esc close notes" in the notes,
// shortened on a narrow pane ("↑↓ · enter · esc", "type · enter/esc").
const ASK_HINT = /^ {2}(?:↑↓(?: select)?|type(?: a note)?) · \S.*$/;
const BOX_TOP = /^╭─+╮$/;
const BOX_SIDE = /^│ .* │$/;
const BOX_BOTTOM = /^╰─+╯$/;
const HEADING = /^\s*∀ Questions · .+ · \d+(?:s|m \d+s|h \d+m)$/;
// A questionnaire's steps over its question, the current one's count at the
// right: "Size ── Roof ── Extras ── Review   2/3", on Review "1/3 answered".
const STEPS = /^(\S.* ── .*?) {2,}(\d+)\/(\d+)( answered)?$/;
// "❯ 1. Red", "  2. [✔] Cheese", "  2. Pitched ✔" (answered before), and
// "❯ 3." on an empty typing field. The number is padded to the widest one.
const OPTION = /^(❯ | {2})( *)(\d+)\.(?: (.*))?$/;
const TICK = /^\[(✔| )\] (.*)$/;
const ANSWERED = / ✔$/;
const INNER_RULE = /^─{8,}$/;
// A preview box drawn to the right of the options, from its edge on.
const PREVIEW = / {2,}[┌│└]/;
const UNDRAWN = /^\s*(?:Notes: n add notes|\(\d+\/\d+\))$/;

/** @param {Line} line */
const isSoft = (line) => line.runs.every((run) => !run.text.trim() || run.cls.split(" ").includes("a-soft"));

/**
 * `rows` joined where Atomic wrapped them at `width`.
 * @param {string[]} rows
 * @param {number} width
 */
function paragraphsOf(rows, width) {
  /** @type {string[]} */
  const paragraphs = [];
  let previous = "";
  for (const row of rows) {
    const word = row.split(" ")[0];
    if (paragraphs.length && previous.length + 1 + word.length > width) paragraphs[paragraphs.length - 1] += ` ${row}`;
    else paragraphs.push(row);
    previous = row;
  }
  return paragraphs;
}

/**
 * @param {number} from
 * @param {number} to
 */
export const movesTo = (from, to) => Array.from({ length: Math.abs(to - from) }, () => (to > from ? "down" : "up"));

// "Type something." and "Chat about this": rows whose field takes your words.
/** @param {OptionRole} role */
export const isTypingRole = (role) => role === "type" || role === "chat";

/**
 * @typedef {{ number: number, selected: boolean, ticked: boolean | null, labels: string[], descriptions: string[], caret: boolean, underRule: boolean, indent: number }} DrawnOption
 */

/**
 * @param {Line[]} inner the box's rows inside its sides
 * @param {boolean[]} caret which of them show Atomic's text caret
 * @param {number} width the box's inner width
 * @param {boolean} notes the notes field is open
 */
function askBody(inner, caret, width, notes) {
  const steps = STEPS.exec(inner[0]?.text ?? "");
  const names = steps ? steps[1].split(" ── ") : [];
  const review = Boolean(steps?.[4]);
  const step = steps && !review ? { at: Number(steps[2]), of: Number(steps[3]) } : null;
  const title = steps ? (review ? "Review" : (names[Number(steps[2]) - 1] ?? "")) : (inner[0]?.text.trim() ?? "");
  /** @type {DrawnOption[]} */
  const drawn = [];
  /** @type {string[][]} */
  const before = [];
  /** @type {string[][]} */
  const after = [];
  let underRule = false;
  let preview = false;
  /** @type {DrawnOption | null} */
  let option = null;
  /** @type {string[] | null} */
  let paragraph = null;
  inner.slice(1).forEach((full, n) => {
    const cut = full.text.search(PREVIEW);
    if (cut >= 0) preview = true;
    const line = cut >= 0 ? trimEnd(sliceLine(full, 0, cut)) : full;
    const text = line.text;
    const rule = INNER_RULE.test(text.trim());
    if (isBlank(line) || rule) {
      underRule ||= rule;
      option = null;
      paragraph = null;
      return;
    }
    const row = OPTION.exec(text);
    if (row) {
      const [, pointer, pad, number, rest = ""] = row;
      const tick = TICK.exec(rest);
      const label = tick ? tick[2] : rest;
      option = { number: Number(number), selected: pointer === "❯ ", ticked: tick ? tick[1] === "✔" : null, labels: [label], descriptions: [], caret: caret[n + 1], underRule, indent: 2 + pad.length + number.length + 2 };
      drawn.push(option);
      paragraph = null;
      return;
    }
    if (option && leading(line) >= option.indent) {
      (isSoft(line) ? option.descriptions : option.labels).push(text.trim());
      option.caret ||= caret[n + 1];
      return;
    }
    if (UNDRAWN.test(text)) return;
    if (!paragraph) {
      paragraph = [];
      (drawn.length ? after : before).push(paragraph);
    }
    paragraph.push(text.trim());
  });
  const above = drawn.filter((each) => !each.underRule);
  const multi = above.some((each) => each.ticked !== null);
  /** @type {(each: DrawnOption) => OptionRole} */
  const roleOf = (each) => {
    if (each.underRule) return above.length ? "chat" : "answer";
    if (multi) return each.ticked === null ? "commit" : "answer";
    return !preview && above.length >= 2 && each === above.at(-1) ? "type" : "answer";
  };
  const options = drawn.map((each) => {
    const label = each.labels.join(" ");
    return {
      number: each.number,
      label: label.replace(ANSWERED, ""),
      description: each.descriptions.join(" "),
      selected: each.selected,
      ticked: each.ticked,
      answered: ANSWERED.test(label),
      role: roleOf(each),
    };
  });
  const text = before.flatMap((rows) => paragraphsOf(rows, width));
  const typing = notes || drawn.some((each) => each.selected && each.caret && isTypingRole(roleOf(each)));
  return { title, step, review, text, prompt: Math.max(0, text.length - 1), options, after: after.flatMap((rows) => paragraphsOf(rows, width)), typing };
}

// Atomic 0.9.90's question box at the foot of `lines`, or null.
/**
 * @param {Line[]} lines
 * @param {boolean[]} caret
 * @returns {Question | null}
 */
export function askQuestion(lines, caret) {
  let hint = lines.length - 1;
  while (hint >= 0 && isBlank(lines[hint])) hint--;
  if (hint < 2 || !ASK_HINT.test(lines[hint].text) || !BOX_BOTTOM.test(lines[hint - 1].text)) return null;
  let top = hint - 2;
  while (top >= 0 && BOX_SIDE.test(lines[top].text)) top--;
  if (top < 0 || !BOX_TOP.test(lines[top].text) || lines[top].text.length !== lines[hint - 1].text.length) return null;
  const width = lines[top].text.length - 4;
  const inner = lines.slice(top + 1, hint - 1).map((line) => trimEnd(sliceLine(line, 2, line.text.length - 2)));
  if (!inner.length) return null;
  const body = askBody(inner, caret.slice(top + 1, hint - 1), width, lines[hint].text.trimStart().startsWith("type"));
  if (!body.options.length) return null;
  const above = [top - 1, top - 2].find((at) => at >= 0 && !isBlank(lines[at]));
  const heading = above !== undefined && HEADING.test(lines[above].text) ? above : null;
  return { form: "ask", start: heading ?? top, end: hint + 1, heading, ...body };
}

// Atomic 0.9.90's "Trust project folder?" prompt, drawn under its usage line
// in place of the prompt box: the question, the folder, what trusting allows,
// its choices with ❯ before the one under the cursor, and its key hint.
const TRUST_TITLE = /^ {2}(Trust project folder\?)$/;
const TRUST_CHOICE = /^ (❯| ) (\S.*)$/;
const TRUST_HINT = /^ {2}↑↓ select · .*\besc \S+/;

/** @param {string} text */
export const isTrustTitle = (text) => TRUST_TITLE.test(text);

/**
 * @param {Line[]} lines
 * @param {number} from the first row of Atomic's chrome
 * @returns {Question | null}
 */
export function trustQuestion(lines, from) {
  const start = lines.findIndex((line, i) => i >= from && TRUST_TITLE.test(line.text));
  if (start < 0) return null;
  /** @type {string[][]} */
  const detail = [];
  let i = start + 1;
  for (; i < lines.length && !TRUST_CHOICE.test(lines[i].text); i++) {
    if (isBlank(lines[i])) continue;
    if (i === start + 1 || isBlank(lines[i - 1])) detail.push([]);
    detail[detail.length - 1].push(lines[i].text.trim());
  }
  /** @type {QuestionOption[]} */
  const options = [];
  for (; i < lines.length; i++) {
    const choice = TRUST_CHOICE.exec(lines[i].text);
    if (!choice) break;
    const [, pointer, label] = choice;
    options.push({ number: options.length + 1, label, description: "", selected: pointer === "❯", ticked: null, answered: false, role: "answer" });
  }
  while (i < lines.length && isBlank(lines[i])) i++;
  if (options.filter((option) => option.selected).length !== 1 || i >= lines.length || !TRUST_HINT.test(lines[i].text)) return null;
  const width = Math.max(...lines.slice(start, i).map((line) => line.text.length));
  const text = ["Trust project folder?", ...detail.flatMap((rows) => paragraphsOf(rows, width))];
  return { form: "trust", start, end: i + 1, heading: null, title: "", step: null, review: false, text, prompt: 0, options, after: [], typing: false };
}

// What answering option `number` takes: the ↑/↓ presses from the cursor's
// row to it, then ⏎, which chooses it, ticks it in a multi-select, or
// commits on Submit. A typing row is only moved to, which opens its field.
// Null when there is no cursor, no such option, or nothing to press.
/**
 * @param {Question | null} question
 * @param {number} number
 * @returns {string[] | null}
 */
export function answerKeys(question, number) {
  const from = question?.options.find((option) => option.selected);
  const to = question?.options.find((option) => option.number === number);
  if (!from || !to) return null;
  const moves = movesTo(from.number, to.number);
  if (isTypingRole(to.role)) return moves.length ? moves : null;
  return [...moves, "enter"];
}

/**
 * @param {Question} question
 * @param {number} number
 */
const labelOf = (question, number) => question.options.find((option) => option.number === number)?.label;

// The keys answering option `number` of `fresh`, the question read just
// before sending, while it is still the one tapped (`asked`): the same header
// and the same label on that option. Null otherwise, so nothing is sent.
/**
 * @param {Question | null} asked
 * @param {Question | null} fresh
 * @param {number} number
 * @returns {string[] | null}
 */
export function keysIfStillAsked(asked, fresh, number) {
  if (!asked || !fresh || asked.title !== fresh.title || labelOf(asked, number) !== labelOf(fresh, number)) return null;
  return answerKeys(fresh, number);
}

/**
 * @typedef {{ send: true, label: string, typing: boolean } | { send: false, message: string, error: boolean }} AnswerTap
 */

// What a tap on option `number`, or its number key, does to the question as
// last read: send its keys (`typing` when they only open a typing row), or
// say why nothing goes.
/**
 * @param {Question | null} question
 * @param {number} number
 * @returns {AnswerTap}
 */
export function answerTap(question, number) {
  const option = question?.options.find((each) => each.number === number);
  if (!option) return { send: false, message: `There is no answer ${number}.`, error: true };
  if (answerKeys(question, number)) return { send: true, label: option.label || `Answer ${number}`, typing: isTypingRole(option.role) };
  if (option.selected) return { send: false, message: "Type your answer in the box below.", error: false };
  return { send: false, message: "Close the notes with Enter first.", error: true };
}

// Whether text typed on the phone may go to an agent blocked on `question`:
// only while Atomic's own typing field for it is open.
/** @param {Question | null} question */
export const takesTypedAnswer = (question) => question?.form === "ask" && question.typing;

// What a question asks, as one line for the home screen and a
// notification: "Color: Red or blue?".
/** @param {Question} question */
export const questionLine = ({ title, text, prompt }) => [title, text[prompt]].filter(Boolean).join(": ");
