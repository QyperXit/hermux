import { describe, expect, test } from "bun:test";
import { createNotifyPanel } from "../web/notify-panel.js";
import { FakeDocument, asPageElement, type FakeElement } from "./support/fake-dom";
import { setup } from "./support/notifications";

const BELL = '<button class="bell-key" type="button" aria-expanded="false"></button>';
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// A page with a header bell and the layer the panel is drawn in, over the notifications `options` make.
async function screen(options: Parameters<typeof setup>[0] = {}) {
  const made = setup(options);
  await made.notifications.refresh();
  const doc = new FakeDocument();
  doc.root.innerHTML = `<main id="app"><header>${BELL}</header><button class="outside" type="button">Outside</button></main><div id="notify-root" class="switcher-layer" hidden></div>`;
  const find = (selector: string) => doc.root.querySelector(selector) as FakeElement;
  const panel = createNotifyPanel({ page: asPageElement(find("#app")), root: asPageElement(find("#notify-root")), keys: asPageElement(doc.root), notifications: made.notifications });
  const bell = () => find(".bell-key");
  const press = (key: string, shiftKey = false) => (doc.activeElement ?? doc.root).dispatch("keydown", { key, shiftKey });
  const focused = () => doc.activeElement;
  const open = () => {
    bell().focus();
    panel.open(asPageElement(bell()));
  };
  const inert = () => (find("#app") as unknown as { inert?: boolean }).inert === true;
  return { ...made, doc, find, panel, bell, press, focused, open, inert, layer: find("#notify-root") };
}

describe("opening", () => {
  test("it shows a modal dialog named Notifications with the state in words, and the page behind it goes inert", async () => {
    const { layer, open, find, bell, inert } = await screen();
    expect(layer.hidden).toBe(true);
    open();
    expect(layer.hidden).toBe(false);
    const dialog = find('[role="dialog"]');
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(find(`#${dialog.getAttribute("aria-labelledby")}`).textContent).toBe("Notifications");
    expect(find(".notify-line").textContent).toBe("Off. Turn on to get a notice when an agent needs you or finishes.");
    expect(find(".notify-toggle").textContent).toBe("Turn on");
    expect(inert()).toBe(true);
    expect(bell().getAttribute("aria-expanded")).toBe("true");
  });

  test("focus moves in, to the first key that works", async () => {
    const { open, focused, find } = await screen();
    open();
    expect(focused()).toBe(find(".notify-toggle"));
  });

  test("with no key that works (blocked, unsupported, demo) focus goes to the dialog itself", async () => {
    for (const options of [{ permission: "denied" as const }, { supported: false }, { demo: true }]) {
      const { open, focused, find, calls } = await screen(options);
      open();
      expect([options, focused()]).toEqual([options, find('[role="dialog"]')]);
      expect(find(".notify-toggle").disabled).toBe(true);
      expect(calls).toEqual([]);
    }
  });

  test("a blocked browser's panel says what happened and the fix", async () => {
    const { open, find } = await screen({ permission: "denied" });
    open();
    expect(find(".notify-line").textContent).toBe("Your browser didn't allow push notifications. Allow notifications for this site in the browser's settings, then reopen the app.");
  });

  test("the demo panel says the sample data never turns notifications on, and its keys do nothing", async () => {
    const { open, find, calls, notifications } = await screen({ demo: true });
    open();
    expect(find(".notify-line").textContent).toBe("Off. The sample data never turns notifications on.");
    find(".notify-toggle").dispatch("click");
    await settle();
    expect([notifications.view().status, calls]).toEqual(["off", []]);
  });

  test("opening it again while it is open draws nothing new", async () => {
    const { open, find, panel } = await screen();
    open();
    const dialog = find('[role="dialog"]');
    open();
    expect(find('[role="dialog"]')).toBe(dialog);
    expect(panel.isOpen()).toBe(true);
  });

  test("making the panel touches no page until it is opened", async () => {
    const { notifications } = await screen();
    const panel = createNotifyPanel({ page: null, root: null, keys: { addEventListener() {}, removeEventListener() {} }, notifications });
    expect(Object.keys(panel).sort()).toEqual(["close", "isOpen", "open"]);
    panel.close();
    expect(panel.isOpen()).toBe(false);
  });
});

describe("closing", () => {
  test("Esc closes it and focus returns to the bell", async () => {
    const { open, press, layer, bell, focused, inert, panel } = await screen();
    open();
    press("Escape");
    expect(layer.hidden).toBe(true);
    expect(layer.children).toHaveLength(0);
    expect(inert()).toBe(false);
    expect(bell().getAttribute("aria-expanded")).toBe("false");
    expect(focused()).toBe(bell());
    expect(panel.isOpen()).toBe(false);
  });

  test("a tap outside it (the scrim) closes it and focus returns to the bell", async () => {
    const { open, find, layer, bell, focused, inert } = await screen();
    open();
    find(".switcher-dim").dispatch("click");
    expect(layer.hidden).toBe(true);
    expect(inert()).toBe(false);
    expect(focused()).toBe(bell());
  });

  test("a tap inside it does not close it", async () => {
    const { open, find, layer } = await screen({ demo: true });
    open();
    find(".notify-line").dispatch("click");
    find('[role="dialog"]').dispatch("click");
    expect(layer.hidden).toBe(false);
  });

  test("keys other than Esc don't close it, and once closed Esc does nothing", async () => {
    const { open, press, layer, focused, bell } = await screen();
    open();
    press("a");
    press("Enter");
    expect(layer.hidden).toBe(false);
    press("Escape");
    bell().focus();
    press("Escape");
    expect(focused()).toBe(bell());
  });

  test("when the header was redrawn while it was open, the bell now on the page gets the focus and says it is closed", async () => {
    const { open, press, find, focused } = await screen();
    open();
    find("#app").innerHTML = `<header>${BELL.replace('"false"', '"true"')}</header>`;
    press("Escape");
    expect(focused()).toBe(find(".bell-key"));
    expect(find(".bell-key").getAttribute("aria-expanded")).toBe("false");
  });

  test("closing without restoring focus (a route change) leaves focus alone", async () => {
    const { open, panel, focused, find } = await screen();
    open();
    panel.close({ restoreFocus: false });
    expect(find("#notify-root").hidden).toBe(true);
    expect(focused()).not.toBe(find(".bell-key"));
  });

  test("it can be opened again after closing", async () => {
    const { open, press, layer, find } = await screen();
    open();
    press("Escape");
    open();
    expect(layer.hidden).toBe(false);
    expect(find(".notify-toggle").textContent).toBe("Turn on");
  });
});

describe("Tab", () => {
  test("goes round the keys that work, forwards and backwards, and never leaves the panel", async () => {
    const { open, press, focused, find } = await screen({ permission: "granted", subscribed: true });
    open();
    const [toggle, test] = [find(".notify-toggle"), find(".notify-test")];
    expect(focused()).toBe(toggle);
    expect(press("Tab").defaultPrevented).toBe(true);
    expect(focused()).toBe(test);
    press("Tab");
    expect(focused()).toBe(toggle);
    press("Tab", true);
    expect(focused()).toBe(test);
    press("Tab", true);
    expect(focused()).toBe(toggle);
  });

  test("with no key that works it stays on the dialog, and brings focus back to it from nowhere", async () => {
    const { open, press, focused, find, doc } = await screen({ permission: "denied" });
    open();
    expect(press("Tab").defaultPrevented).toBe(true);
    expect(focused()).toBe(find('[role="dialog"]'));
    doc.activeElement = null;
    press("Tab");
    expect(focused()).toBe(find('[role="dialog"]'));
  });
});

describe("its keys", () => {
  test("Turn on asks the browser, and when it is on the panel offers Turn off and Send test, with focus kept on the toggle", async () => {
    const { open, find, focused, notifications, calls } = await screen();
    open();
    find(".notify-toggle").dispatch("click");
    await settle();
    expect(calls).toContain("request permission");
    expect(notifications.view().status).toBe("on");
    expect(find(".notify-toggle").textContent).toBe("Turn off");
    expect(find(".notify-test").textContent).toBe("Send test");
    expect(find(".notify-line").textContent).toStartWith("On. This phone gets a notice");
    expect(find(".notify-note").textContent).toBe("Notifications are on.");
    expect(focused()).toBe(find(".notify-toggle"));
  });

  test("while it works the keys are off and focus waits on the dialog until a key works again", async () => {
    const { open, find, focused, notifications } = await screen({ permission: "granted", subscribed: true });
    open();
    const pending = notifications.disable();
    expect(find(".notify-toggle").disabled).toBe(true);
    expect(focused()).toBe(find('[role="dialog"]'));
    await pending;
    expect(find(".notify-toggle").textContent).toBe("Turn on");
    expect(find(".notify-toggle").disabled).toBe(false);
    expect(focused()).toBe(find(".notify-toggle"));
  });

  test("Send test asks the server to test this phone, and says so", async () => {
    const { open, find, calls } = await screen({ permission: "granted", subscribed: true });
    open();
    find(".notify-test").dispatch("click");
    await settle();
    expect(calls).toEqual(["server test https://push.example.com/send/phone"]);
    expect(find(".notify-note").textContent).toBe("Test sent. It should arrive in a moment.");
    expect(find(".notify-note").classList.contains("is-error")).toBe(false);
  });

  test("Turn off tells the server and the panel goes back to offering Turn on", async () => {
    const { open, find, calls } = await screen({ permission: "granted", subscribed: true });
    open();
    find(".notify-toggle").dispatch("click");
    await settle();
    expect(calls).toEqual(["server unsubscribe https://push.example.com/send/phone", "browser unsubscribe"]);
    expect(find(".notify-toggle").textContent).toBe("Turn on");
    expect(find(".notify-test")).toBeNull();
  });

  test("a change made elsewhere while it is open is shown in place", async () => {
    const { open, find, notifications, dropBrowserSubscription } = await screen({ permission: "granted", subscribed: true });
    open();
    const note = find(".notify-note");
    dropBrowserSubscription();
    await notifications.refresh();
    expect(find(".notify-line").textContent).toStartWith("Off.");
    expect(find(".notify-note")).toBe(note);
  });
});

describe("what the browser refused", () => {
  test("in Brave the panel names the setting to turn on, as an error", async () => {
    const { open, find } = await screen({ subscribeFails: true, brave: true });
    open();
    find(".notify-toggle").dispatch("click");
    await settle();
    expect(find(".notify-note").textContent).toBe("Brave didn't allow push notifications. In Brave, turn on Settings → Privacy and security → Use Google services for push messaging, then try again.");
    expect(find(".notify-note").classList.contains("is-error")).toBe(true);
    expect(find(".notify-toggle").textContent).toBe("Turn on");
    expect(find(".notify-toggle").disabled).toBe(false);
  });

  test("elsewhere it says the browser didn't allow it and where to allow it", async () => {
    const { open, find } = await screen({ subscribeFails: true });
    open();
    find(".notify-toggle").dispatch("click");
    await settle();
    expect(find(".notify-note").textContent).toBe("Your browser didn't allow push notifications. Allow notifications for this site in the browser's settings, then try again.");
    expect(find(".notify-note").textContent).not.toContain("Brave");
  });

  test("a permission refused at the prompt leaves the panel blocked, with the fix", async () => {
    const { open, find, focused } = await screen({ asked: "denied" });
    open();
    find(".notify-toggle").dispatch("click");
    await settle();
    expect(find(".notify-line").textContent).toStartWith("Your browser didn't allow push notifications. Allow notifications for this site");
    expect(find(".notify-toggle").disabled).toBe(true);
    expect(focused()).toBe(find('[role="dialog"]'));
  });

  test("a message from the server is shown as text, never as markup", async () => {
    const { open, find } = await screen({ serverFails: true, serverMessage: '<img src=x onerror=alert(1)> & "q"' });
    open();
    find(".notify-toggle").dispatch("click");
    await settle();
    expect(find(".notify-note").textContent).toBe(`Couldn't turn notifications on. <img src=x onerror=alert(1)> & "q"`);
    expect(find(".notify-note").querySelector("img")).toBeNull();
    expect(find(".notify-note").classList.contains("is-error")).toBe(true);
  });
});
