import { find, findAll, fitField, need } from "./dom.js";
import { escapeHtml, icon } from "./html.js";
import {
  ANSWER_KEYS,
  KEY_ICONS,
  LABEL_MAX,
  PICKER_GROUPS,
  defaultLabel,
  isHoldKey,
  loadBar,
  loadCommands,
  moveItem,
  pickedKey,
  saveBar,
  saveCommands,
} from "./keys.js";

/**
 * @typedef {import("./keys.js").BarEntry} BarEntry
 * @typedef {import("./keys.js").Store} Store
 */

/**
 * @typedef {object} Timers
 * @property {(run: () => void, ms: number) => number} setTimeout
 * @property {(id: number) => void} clearTimeout
 * @property {() => number} now
 * @property {(run: () => void) => unknown} requestAnimationFrame
 */

/**
 * @typedef {object} KeyBarIntents
 * @property {(key: string, label: string) => unknown} sendKey
 * @property {(text: string) => unknown} sendText
 * @property {(message: string, options?: { error?: boolean }) => void} announce
 */

/** @type {Timers} */
const PAGE_TIMERS = {
  setTimeout: (run, ms) => window.setTimeout(run, ms),
  clearTimeout: (id) => window.clearTimeout(id),
  now: () => Date.now(),
  requestAnimationFrame: (run) => window.requestAnimationFrame(() => run()),
};

const HOLD_MS = 700;
const LONG_PRESS_MS = 500;
const KEYBOARD_CONFIRM_MS = 2500;

function pickerHtml() {
  const options = PICKER_GROUPS.map(
    ({ group, keys }) =>
      `<optgroup label="${escapeHtml(group)}">${keys.map(({ base, label }) => `<option value="${escapeHtml(base)}">${escapeHtml(label)}</option>`).join("")}</optgroup>`,
  ).join("");
  /**
   * @param {string} name
   * @param {string} label
   * @param {boolean} [checked]
   */
  const toggle = (name, label, checked = false) =>
    `<label class="toggle"><input type="checkbox" name="${name}" ${checked ? "checked" : ""}><span>${label}</span></label>`;
  return `
    <form class="picker" id="key-picker" aria-labelledby="picker-title" autocomplete="off" hidden>
      <p class="panel-title" id="picker-title">Add a key</p>
      <fieldset class="toggles">
        <legend class="visually-hidden">Modifiers</legend>
        ${toggle("ctrl", "Ctrl", true)}${toggle("alt", "Alt")}${toggle("shift", "Shift")}
      </fieldset>
      <div class="fields">
        <label class="field"><span class="field-label">Key</span><select name="base">${options}</select></label>
        <label class="field"><span class="field-label">Label</span><input name="label" type="text" maxlength="${LABEL_MAX}" autocapitalize="off" spellcheck="false" enterkeyhint="done"></label>
      </div>
      <p class="picker-status" aria-live="polite"></p>
      <p class="picker-note">herdr 0.9.5 can't send PgUp, PgDn, Home, End or Delete.</p>
      <div class="panel-actions">
        <button class="act act-dark" type="submit">Add key</button>
        <button class="act" type="button" data-picker-done>Done</button>
      </div>
      <p class="picker-note">While this is open, tap a key on the bar to move or remove it.</p>
    </form>`;
}

const controlsHtml = () => `
      <div class="keys" role="group" aria-label="Terminal keys"></div>
      <div class="key-menu" role="group" hidden>
        <p class="panel-title"><span class="key-menu-label"></span> <small class="key-menu-name"></small></p>
        <div class="key-menu-actions">
          <button class="act" type="button" data-move="-1">${icon("i-left")}<span>Left</span></button>
          <button class="act" type="button" data-move="1"><span>Right</span>${icon("i-right")}</button>
          <button class="act" type="button" data-remove>Remove</button>
          <button class="act" type="button" data-menu-done>Done</button>
        </div>
      </div>
      ${pickerHtml()}
      <div class="commands-editor" id="commands-editor" role="group" aria-labelledby="commands-title" hidden>
        <p class="panel-title" id="commands-title">Saved commands</p>
        <ol class="command-list"></ol>
        <div class="panel-actions">
          <button class="act" type="button" data-command-add>Add command</button>
          <button class="act act-dark" type="button" data-commands-done>Done</button>
        </div>
      </div>`;

/**
 * @param {BarEntry} entry
 * @param {{ index?: number, keyEdit?: KeyEdit }} [options]
 */
function keyButtonHtml({ key, label }, { index = -1, keyEdit = { picker: false, menu: null } } = {}) {
  const answer = index < 0;
  const hold = isHoldKey(key);
  const editing = !answer && keyEdit.picker;
  const iconId = label === defaultLabel(key) ? KEY_ICONS[key] : undefined;
  const legend = iconId
    ? icon(iconId)
    : `<span class="key-label ${label.length > 3 ? "is-long" : ""}">${escapeHtml(label)}</span>${hold ? `<span class="key-hint">hold</span>` : ""}`;
  const name = editing ? `Edit ${label}` : hold ? `Hold to send ${label}` : `Send ${label}`;
  const classes = ["key", hold && "key-hold", answer && "key-answer", !answer && index === keyEdit.menu && "is-picked"].filter(Boolean).join(" ");
  return `<button class="${classes}" type="button" data-key="${escapeHtml(key)}" ${answer ? "" : `data-index="${index}"`} aria-label="${escapeHtml(name)}">${legend}</button>`;
}

/**
 * @param {BarEntry[]} bar
 * @param {KeyEdit} keyEdit
 */
function keysHtml(bar, keyEdit) {
  return [
    ...ANSWER_KEYS.map((entry) => keyButtonHtml(entry)),
    ...bar.map((entry, index) => keyButtonHtml(entry, { index, keyEdit })),
    `<button class="key key-add" type="button" aria-label="Add a key" aria-controls="key-picker" aria-expanded="${keyEdit.picker}">${icon("i-plus")}</button>`,
  ].join("");
}

/** @param {string[]} commands */
function savedHtml(commands) {
  return commands.map((command, index) => (command.trim() ? `<button class="saved-item" type="button" data-index="${index}">${escapeHtml(command)}</button>` : "")).join("");
}

/** @param {string[]} commands */
function commandListHtml(commands) {
  const last = commands.length - 1;
  return commands
    .map(
      (_, index) => `
      <li class="command" data-index="${index}">
        <label class="visually-hidden" for="command-${index}">Command ${index + 1}</label>
        <textarea id="command-${index}" rows="1" spellcheck="true" autocapitalize="off"></textarea>
        <div class="command-actions">
          <button class="act" type="button" data-move="-1" aria-label="Move command ${index + 1} up" ${index === 0 ? "disabled" : ""}>${icon("i-up")}</button>
          <button class="act" type="button" data-move="1" aria-label="Move command ${index + 1} down" ${index === last ? "disabled" : ""}>${icon("i-down")}</button>
          <button class="act" type="button" data-delete aria-label="Delete command ${index + 1}">Delete</button>
        </div>
      </li>`,
    )
    .join("");
}

/**
 * @typedef {{ picker: boolean, menu: number | null }} KeyEdit
 */

/**
 * @typedef {object} PickerFields
 * @property {HTMLFormElement} form
 * @property {HTMLInputElement} ctrl
 * @property {HTMLInputElement} alt
 * @property {HTMLInputElement} shift
 * @property {HTMLSelectElement} base
 * @property {HTMLInputElement} label
 */

/**
 * @param {{ storage: Store, timers?: Timers }} options
 */
export function createKeyBar({ storage, timers = PAGE_TIMERS }) {
  /** @type {HTMLElement | null} */
  let screen = null;
  /** @type {KeyBarIntents} */
  let intents = { sendKey: () => {}, sendText: () => {}, announce: () => {} };

  /** @type {HTMLElement | null} */
  let outsideTapTarget = null;

  /** @returns {HTMLElement} */
  const page = () => {
    if (!screen) throw new Error("The key bar isn't attached to a screen.");
    return screen;
  };
  const assertAttached = () => void page();

  const state = {
    bar: loadBar(storage),
    commands: loadCommands(storage),
    /** @type {KeyEdit} */
    keyEdit: { picker: false, menu: null },
    editingCommands: false,
    savedOpen: false,
  };

  /** @returns {PickerFields} */
  function pickerFields() {
    /** @type {HTMLFormElement} */
    const form = need(page(), ".picker");
    /** @type {HTMLInputElement} */
    const ctrl = need(form, '[name="ctrl"]');
    /** @type {HTMLInputElement} */
    const alt = need(form, '[name="alt"]');
    /** @type {HTMLInputElement} */
    const shift = need(form, '[name="shift"]');
    /** @type {HTMLSelectElement} */
    const base = need(form, '[name="base"]');
    /** @type {HTMLInputElement} */
    const label = need(form, '[name="label"]');
    return { form, ctrl, alt, shift, base, label };
  }

  function renderKeys() {
    const group = find(page(), ".keys");
    if (!group) return;
    group.innerHTML = keysHtml(state.bar, state.keyEdit);
    for (const button of findAll(group, ".key[data-key]")) {
      const index = button.dataset.index === undefined ? -1 : Number(button.dataset.index);
      const entry = index < 0 ? ANSWER_KEYS.find((candidate) => candidate.key === button.dataset.key) : state.bar[index];
      if (!entry) continue;
      const { key, label } = entry;
      const send = () => intents.sendKey(key, label);
      if (index >= 0 && state.keyEdit.picker) {
        button.addEventListener("click", () => openKeyMenu(index));
      } else if (isHoldKey(key)) {
        bindHoldKey(button, label, send);
      } else if (index >= 0) {
        bindTapOrLongPress(button, send, () => openKeyMenu(index));
      } else {
        button.addEventListener("click", send);
      }
    }
    need(group, ".key-add").addEventListener("click", () => setPicker(!state.keyEdit.picker));
  }

  function savedParts() {
    return { slash: need(page(), ".slash"), popover: need(page(), ".saved") };
  }

  function openSaved() {
    if (state.savedOpen || state.keyEdit.picker || state.editingCommands) return;
    renderSaved();
    const { slash, popover } = savedParts();
    state.savedOpen = true;
    popover.hidden = false;
    slash.setAttribute("aria-expanded", "true");
    (find(popover, ".saved-item") ?? need(popover, ".saved-edit")).focus();
  }

  /** @param {{ focus?: boolean }} [options] */
  function closeSaved({ focus = true } = {}) {
    if (!state.savedOpen) return;
    const { slash, popover } = savedParts();
    state.savedOpen = false;
    popover.hidden = true;
    slash.setAttribute("aria-expanded", "false");
    if (focus) slash.focus();
  }

  /** @param {Event} event */
  function closeOnOutsideTap(event) {
    if (!state.savedOpen) return;
    const slash = /** @type {HTMLElement | null} */ (page().querySelector(".slash"));
    const popover = /** @type {HTMLElement | null} */ (page().querySelector(".saved"));
    if (!slash || !popover) {
      state.savedOpen = false;
      return;
    }
    const target = /** @type {Element | null} */ (event.target);
    if (popover.contains(target) || slash.contains(target)) return;
    closeSaved({ focus: false });
    const doc = page().ownerDocument;
    const active = doc.activeElement;
    if (!active || active === doc.body || popover.contains(active)) slash.focus();
  }

  function setEditingClasses() {
    page().classList.toggle("is-editing-keys", state.keyEdit.picker);
    page().classList.toggle("is-editing-commands", state.editingCommands);
  }

  /** @param {boolean} open */
  function setPicker(open) {
    state.keyEdit = { picker: open, menu: null };
    if (open) {
      closeSaved({ focus: false });
      setCommandsEditor(false, { focus: false });
    }
    need(page(), ".picker").hidden = !open;
    renderKeys();
    showKeyMenu();
    setEditingClasses();
    if (open) {
      updatePicker();
      need(page(), ".picker select").focus();
    } else {
      need(page(), ".key-add").focus();
    }
  }

  function pickerChoice() {
    const { ctrl, alt, shift, base } = pickerFields();
    return pickedKey({ ctrl: ctrl.checked, alt: alt.checked, shift: shift.checked, base: base.value });
  }

  function updatePicker() {
    const { form, label: field } = pickerFields();
    const { key, label, error } = pickerChoice();
    const custom = field.value.trim();
    field.placeholder = label ?? "";
    /** @type {HTMLButtonElement} */
    const submit = need(form, '[type="submit"]');
    submit.disabled = !key;
    need(form, ".picker-status").textContent = error ?? (custom && custom !== label ? `Adds ${label}, labelled “${custom}”.` : `Adds ${label}.`);
  }

  function addPickedKey() {
    const { label: field } = pickerFields();
    const { key, label } = pickerChoice();
    if (!key) return;
    const entry = { key, label: field.value.trim() || label };
    state.bar = [...state.bar, entry];
    saveBar(storage, state.bar);
    field.value = "";
    renderKeys();
    updatePicker();
    intents.announce(`Added ${entry.label}. The bar is saved on this phone.`);
  }

  /** @param {number} index */
  function openKeyMenu(index) {
    state.keyEdit.menu = index;
    showKeyMenu();
    find(page(), ".key-menu button:not(:disabled)")?.focus();
  }

  function showKeyMenu() {
    const menu = need(page(), ".key-menu");
    const index = state.keyEdit.menu;
    const entry = index === null ? undefined : state.bar[index];
    for (const button of findAll(page(), ".keys .key[data-index]")) button.classList.toggle("is-picked", Number(button.dataset.index) === index);
    menu.hidden = !entry;
    if (!entry) return;
    const named = defaultLabel(entry.key);
    menu.setAttribute("aria-label", `Edit the ${entry.label} key`);
    need(menu, ".key-menu-label").textContent = entry.label;
    need(menu, ".key-menu-name").textContent = named === entry.label ? "" : named;
    /** @type {HTMLButtonElement[]} */
    const moves = findAll(menu, "[data-move]");
    const [left, right] = moves;
    left.disabled = index === 0;
    right.disabled = index === state.bar.length - 1;
    left.setAttribute("aria-label", `Move ${entry.label} left`);
    right.setAttribute("aria-label", `Move ${entry.label} right`);
    need(menu, "[data-remove]").setAttribute("aria-label", `Remove ${entry.label}`);
  }

  function closeKeyMenu() {
    const index = state.keyEdit.menu;
    state.keyEdit.menu = null;
    showKeyMenu();
    find(page(), `.keys .key[data-index="${index}"]`)?.focus();
  }

  /** @param {number} delta */
  function moveKey(delta) {
    const index = state.keyEdit.menu;
    if (index === null) return;
    state.bar = moveItem(state.bar, index, delta);
    saveBar(storage, state.bar);
    state.keyEdit.menu = Math.max(0, Math.min(state.bar.length - 1, index + delta));
    renderKeys();
    showKeyMenu();
    /** @type {HTMLButtonElement} */
    const again = need(page(), `.key-menu [data-move="${delta}"]`);
    (again.disabled ? need(page(), ".key-menu [data-menu-done]") : again).focus();
  }

  function removeKey() {
    const index = state.keyEdit.menu;
    if (index === null) return;
    const { label } = state.bar[index];
    state.bar = state.bar.filter((_, at) => at !== index);
    saveBar(storage, state.bar);
    state.keyEdit.menu = null;
    renderKeys();
    showKeyMenu();
    intents.announce(`Removed ${label}. The bar is saved on this phone.`);
    need(page(), ".key-add").focus();
  }

  function renderSaved() {
    const list = need(page(), ".saved-list");
    list.innerHTML = savedHtml(state.commands);
    for (const button of findAll(list, ".saved-item")) {
      button.addEventListener("click", () => {
        intents.sendText(state.commands[Number(button.dataset.index)]);
        closeSaved();
      });
    }
  }

  function renderCommandList() {
    const list = need(page(), ".command-list");
    list.innerHTML = commandListHtml(state.commands);
    for (const item of findAll(list, ".command")) {
      const index = Number(item.dataset.index);
      /** @type {HTMLTextAreaElement} */
      const textarea = need(item, "textarea");
      // Set as a value, not markup, so a leading newline is kept too.
      textarea.value = state.commands[index];
      textarea.addEventListener("input", () => {
        state.commands[index] = textarea.value;
        saveCommands(storage, state.commands);
        fitField(textarea);
      });
      /** @type {HTMLButtonElement[]} */
      const moves = findAll(item, "[data-move]");
      for (const button of moves) {
        button.addEventListener("click", () => {
          const delta = Number(button.dataset.move);
          state.commands = moveItem(state.commands, index, delta);
          saveCommands(storage, state.commands);
          renderCommandList();
          const moved = need(page(), `.command[data-index="${index + delta}"]`);
          /** @type {HTMLButtonElement} */
          const again = need(moved, `[data-move="${delta}"]`);
          (again.disabled ? need(moved, "textarea") : again).focus();
        });
      }
      need(item, "[data-delete]").addEventListener("click", () => {
        state.commands = state.commands.filter((_, at) => at !== index);
        saveCommands(storage, state.commands);
        renderCommandList();
        intents.announce("Command deleted. Saved commands are kept on this phone.");
        need(page(), "[data-command-add]").focus();
      });
    }
    timers.requestAnimationFrame(() => {
      /** @type {HTMLTextAreaElement[]} */
      const boxes = findAll(list, "textarea");
      boxes.forEach(fitField);
    });
  }

  /**
   * @param {boolean} open
   * @param {{ focus?: boolean }} [options]
   */
  function setCommandsEditor(open, { focus = true } = {}) {
    if (!open && state.editingCommands) {
      // Empty commands can't be sent, so they aren't kept.
      state.commands = state.commands.filter((command) => command.trim());
      saveCommands(storage, state.commands);
    }
    state.editingCommands = open;
    if (open) closeSaved({ focus: false });
    if (open && state.keyEdit.picker) {
      state.keyEdit = { picker: false, menu: null };
      need(page(), ".picker").hidden = true;
      renderKeys();
      showKeyMenu();
    }
    need(page(), ".commands-editor").hidden = !open;
    setEditingClasses();
    if (open) renderCommandList();
    if (!focus) return;
    if (open) find(page(), ".command textarea, [data-command-add]")?.focus();
    else need(page(), ".slash").focus();
  }

  /**
   * @param {HTMLElement} button
   * @param {() => unknown} tap
   * @param {() => void} longPress
   */
  function bindTapOrLongPress(button, tap, longPress) {
    let timer = 0;
    let longFired = false;
    const cancel = () => {
      timers.clearTimeout(timer);
      timer = 0;
    };
    button.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      longFired = false;
      timer = timers.setTimeout(() => {
        timer = 0;
        longFired = true;
        longPress();
      }, LONG_PRESS_MS);
    });
    button.addEventListener("pointerup", cancel);
    button.addEventListener("pointercancel", cancel);
    button.addEventListener("pointerleave", cancel);
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      if (timer) {
        cancel();
        longFired = true;
        longPress();
      } else if (!longFired) {
        longPress();
      }
    });
    button.addEventListener("click", () => {
      if (longFired) {
        longFired = false;
        return;
      }
      tap();
    });
  }

  /**
   * @param {HTMLElement} button
   * @param {string} label
   * @param {() => unknown} fire
   */
  function bindHoldKey(button, label, fire) {
    let timer = 0;
    let armedUntil = 0;
    const clear = () => {
      timers.clearTimeout(timer);
      timer = 0;
      button.classList.remove("is-holding");
    };
    button.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      button.setPointerCapture(event.pointerId);
      button.classList.add("is-holding");
      timer = timers.setTimeout(() => {
        timer = 0;
        button.classList.remove("is-holding");
        fire();
      }, HOLD_MS);
    });
    const release = () => {
      if (!timer) return;
      clear();
      intents.announce(`Hold ${label} until it fills to send it.`);
    };
    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", clear);
    button.addEventListener("contextmenu", (event) => event.preventDefault());
    button.addEventListener("click", (event) => {
      if (event.detail !== 0) return;
      if (timers.now() < armedUntil) {
        armedUntil = 0;
        fire();
        return;
      }
      armedUntil = timers.now() + KEYBOARD_CONFIRM_MS;
      intents.announce(`Press ${label} again to send it.`);
    });
  }

  return {
    // A newly drawn Terminal screen (`screen` holds its `.controls`): the key
    // bar draws its part first in the controls, with the picker and the
    // commands editor closed, and asks `to` to send and announce. While a
    // panel is open the screen carries is-editing-keys or is-editing-commands.
    /**
     * @param {HTMLElement} drawn
     * @param {KeyBarIntents} to
     */
    attach(drawn, to) {
      screen = drawn;
      intents = to;
      state.keyEdit = { picker: false, menu: null };
      state.editingCommands = false;
      state.savedOpen = false;
      need(drawn, ".controls").insertAdjacentHTML("afterbegin", controlsHtml());
      renderKeys();

      if (outsideTapTarget !== drawn) {
        drawn.addEventListener("click", closeOnOutsideTap);
        outsideTapTarget = drawn;
      }
      need(drawn, ".slash").addEventListener("click", () => (state.savedOpen ? closeSaved() : openSaved()));
      need(drawn, ".saved-edit").addEventListener("click", () => setCommandsEditor(true));
      need(drawn, ".composer").addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || !state.savedOpen) return;
        event.preventDefault();
        closeSaved();
      });

      const picker = need(drawn, ".picker");
      picker.addEventListener("input", updatePicker);
      picker.addEventListener("change", updatePicker);
      picker.addEventListener("submit", (event) => {
        event.preventDefault();
        addPickedKey();
      });
      need(picker, "[data-picker-done]").addEventListener("click", () => setPicker(false));

      const menu = need(drawn, ".key-menu");
      for (const button of findAll(menu, "[data-move]")) button.addEventListener("click", () => moveKey(Number(button.dataset.move)));
      need(menu, "[data-remove]").addEventListener("click", removeKey);
      need(menu, "[data-menu-done]").addEventListener("click", closeKeyMenu);

      need(drawn, "[data-command-add]").addEventListener("click", () => {
        state.commands = [...state.commands, ""];
        saveCommands(storage, state.commands);
        renderCommandList();
        need(page(), `#command-${state.commands.length - 1}`).focus();
      });
      need(drawn, "[data-commands-done]").addEventListener("click", () => setCommandsEditor(false));
    },

    /** @param {boolean} blocked */
    setBlocked(blocked) {
      assertAttached();
      if (blocked) closeSaved({ focus: false });
    },
  };
}
