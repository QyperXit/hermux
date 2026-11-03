// The message box of a Terminal screen, drawn once with the screen (`composerHtml`)
// and told what it sends to on each refresh (`drawComposer`): one rounded field
// with the "/" button and the round send arrow inside it at the trailing edge,
// the saved commands' popover above it (listed by the key bar, web/key-bar.js)
// and the blocked note that takes the box's place while the Agent is blocked.
// Send must always name its target (D5): the placeholder, the field's label,
// the arrow's label and the popover's label all do, as text, never as markup.
// No DOM is touched on import, so the tests can import it.
import { need } from "./dom.js";
import { icon } from "./html.js";

export const composerHtml = () => `
      <form class="composer" autocomplete="off">
        <div class="composer-box">
          <label class="visually-hidden" for="message">Message</label>
          <textarea id="message" name="message" rows="1" placeholder="Message" enterkeyhint="enter" spellcheck="true" autocapitalize="sentences"></textarea>
          <button class="slash" type="button" aria-label="Saved commands" aria-haspopup="dialog" aria-controls="saved-commands" aria-expanded="false">/</button>
          <button class="send" type="submit" aria-label="Send">${icon("i-up", " send-arrow")}${icon("i-sending", " send-busy")}</button>
        </div>
        <div class="saved" id="saved-commands" role="dialog" aria-label="Saved commands" hidden>
          <div class="saved-list"></div>
          <button class="saved-edit" type="button" aria-label="Edit saved commands" aria-controls="commands-editor">Edit</button>
        </div>
      </form>
      <p class="blocked-note" hidden><span class="lamp" data-status="blocked" aria-hidden="true"></span><span>Waiting for your answer. Read the question above, then pick with the keys.</span></p>`;

/**
 * What the box says about its target and state: `target` is the Terminal's
 * name for sending (D31), `sending` while a send is in flight, `blocked` while
 * the Agent waits for an answer (the box is hidden, the note shown).
 * @param {HTMLElement} screen the Terminal screen holding the composer
 * @param {{ target: string, sending: boolean, blocked: boolean }} state
 */
export function drawComposer(screen, { target, sending, blocked }) {
  const message = `Message ${target}`;
  /** @type {HTMLTextAreaElement} */
  const field = need(screen, "#message");
  field.placeholder = message;
  need(screen, 'label[for="message"]').textContent = message;
  /** @type {HTMLButtonElement} */
  const send = need(screen, ".send");
  send.disabled = sending;
  send.setAttribute("aria-busy", String(sending));
  send.setAttribute("aria-label", `${sending ? "Sending to" : "Send to"} ${target}`);
  need(screen, ".saved").setAttribute("aria-label", `Send a saved command to ${target}`);
  need(screen, ".composer").hidden = blocked;
  need(screen, ".blocked-note").hidden = !blocked;
}
