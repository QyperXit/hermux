import { need } from "./dom.js";
import { icon } from "./html.js";

export const composerHtml = () => `
      <form class="composer" autocomplete="off">
        <div class="attachments" role="group" aria-label="Attached images" aria-live="polite" hidden>
          <div class="attachment-row"></div>
          <p class="attachment-count"></p>
        </div>
        <div class="composer-box">
          <label class="visually-hidden" for="message">Message</label>
          <textarea id="message" name="message" rows="1" placeholder="Message" enterkeyhint="enter" spellcheck="true" autocapitalize="sentences"></textarea>
          <button class="attach" type="button" aria-label="Attach an image" aria-haspopup="dialog" aria-controls="clip-menu" aria-expanded="false">${icon("i-clip")}</button>
          <button class="slash" type="button" aria-label="Saved commands" aria-haspopup="dialog" aria-controls="saved-commands" aria-expanded="false">/</button>
          <button class="send" type="submit" aria-label="Send">${icon("i-up", "send-arrow")}${icon("i-sending", "send-busy")}</button>
        </div>
        <input class="attach-input" type="file" accept="image/*" multiple tabindex="-1" hidden>
        <input class="attach-camera" type="file" accept="image/*" capture="environment" tabindex="-1" hidden>
        <div class="clip-menu" id="clip-menu" role="dialog" aria-label="Attach an image" hidden>
          <button class="clip-item clip-camera" type="button">${icon("i-camera")}Take a photo</button>
          <button class="clip-item clip-gallery" type="button">${icon("i-picture")}Choose a picture</button>
        </div>
        <div class="saved" id="saved-commands" role="dialog" aria-label="Saved commands" hidden>
          <div class="saved-list"></div>
          <button class="saved-edit" type="button" aria-label="Edit saved commands" aria-controls="commands-editor">Edit</button>
        </div>
      </form>
      <p class="blocked-note" hidden><span class="lamp" data-status="blocked" aria-hidden="true"></span><span>Waiting for your answer. Read the question above, then pick with the keys.</span></p>`;

/**
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
