import { describe, expect, test } from "bun:test";
import { bellHtml, createNotifications, keyBytes, keysHtml, looksLikeBrave, statusLine, type Browser } from "../web/notifications.js";
import type { View } from "../web/notifications.js";
import { setup } from "./support/notifications";

describe("the states", () => {
  test("before it has looked, it says so, and offers nothing", () => {
    const { notifications } = setup();
    expect(notifications.view().status).toBe("checking");
  });

  test("a browser without service workers, notifications or push is unsupported", async () => {
    const { notifications, calls } = setup({ supported: false });
    await notifications.refresh();
    expect(notifications.view().status).toBe("unsupported");
    await notifications.enable();
    expect([notifications.view().status, calls]).toEqual(["unsupported", []]);
  });

  test("each part missing on its own is unsupported", async () => {
    const whole: Browser = {
      serviceWorker: { getRegistration: async () => undefined, ready: new Promise(() => {}) },
      notification: { permission: "default", requestPermission: async () => "default" },
      pushManager: true,
    };
    for (const missing of ["serviceWorker", "notification", "pushManager"] as const) {
      const partial = createNotifications({ browser: { ...whole, [missing]: missing === "pushManager" ? false : undefined }, api: null });
      await partial.refresh();
      expect([missing, partial.view().status]).toEqual([missing, "unsupported"]);
    }
    const complete = createNotifications({ browser: whole, api: null });
    await complete.refresh();
    expect(complete.view().status).toBe("off");
  });

  test("permission denied in the browser's settings is blocked, and the key does nothing", async () => {
    const { notifications, calls } = setup({ permission: "denied" });
    await notifications.refresh();
    expect(notifications.view().status).toBe("blocked");
    await notifications.enable();
    expect([notifications.view().status, calls]).toEqual(["blocked", []]);
  });

  test("not subscribed is off, with or without permission already granted", async () => {
    for (const permission of ["default", "granted"] as const) {
      const { notifications } = setup({ permission });
      await notifications.refresh();
      expect([permission, notifications.view().status]).toEqual([permission, "off"]);
    }
  });

  test("subscribed with permission is on", async () => {
    const { notifications } = setup({ permission: "granted", subscribed: true });
    await notifications.refresh();
    expect(notifications.view().status).toBe("on");
  });

  test("looking never asks for permission or talks to the server", async () => {
    for (const options of [{}, { permission: "granted" as const }, { permission: "granted" as const, subscribed: true }, { permission: "denied" as const }]) {
      const { notifications, calls } = setup(options);
      await notifications.refresh();
      await notifications.refresh();
      expect(calls).toEqual([]);
    }
  });
});

describe("turning on", () => {
  test("a tap asks for permission, then subscribes with the server's key and tells the server", async () => {
    const { notifications, calls, changes } = setup();
    await notifications.refresh();
    await notifications.enable();
    expect(calls).toEqual([
      "request permission",
      "server key",
      "browser subscribe true 1,2,3,251,255",
      `server subscribe ${JSON.stringify({ endpoint: "https://push.example.com/send/phone", keys: { p256dh: "p", auth: "a" } })}`,
    ]);
    expect(notifications.view()).toMatchObject({ status: "on", busy: false, message: "Notifications are on.", error: false });
    expect(changes.some((view) => view.busy)).toBe(true);
  });

  test("a second tap while it works does nothing more", async () => {
    const { notifications, calls } = setup();
    await notifications.refresh();
    await Promise.all([notifications.enable(), notifications.enable(), notifications.enable()]);
    expect(calls.filter((call) => call === "request permission")).toHaveLength(1);
  });

  test("a refused prompt makes it blocked and subscribes nothing", async () => {
    const { notifications, calls } = setup({ asked: "denied" });
    await notifications.refresh();
    await notifications.enable();
    expect([notifications.view().status, notifications.view().message, calls]).toEqual(["blocked", "", ["request permission"]]);
  });

  test("a dismissed prompt leaves it off, says so, and can be tried again", async () => {
    const { notifications, calls } = setup({ asked: "default" });
    await notifications.refresh();
    await notifications.enable();
    expect(notifications.view()).toMatchObject({ status: "off", error: true, message: "Notifications weren't allowed. Tap Turn on to try again." });
    await notifications.enable();
    expect(calls.filter((call) => call === "request permission")).toHaveLength(2);
  });

  test("if the server can't be told, the browser's subscription is dropped too and the error is shown", async () => {
    const { notifications, calls, permission } = setup({ serverFails: true });
    await notifications.refresh();
    await notifications.enable();
    expect(calls).toContain("browser unsubscribe");
    expect(notifications.view()).toMatchObject({ status: "off", busy: false, error: true, message: "Couldn't turn notifications on. The laptop didn't answer." });
    expect(permission()).toBe("granted");
  });

  test("the permission is asked for by no other call", async () => {
    const { notifications, calls } = setup();
    await notifications.refresh();
    await notifications.test();
    await notifications.disable();
    expect(calls).toEqual([]);
  });
});

describe("when the browser refuses", () => {
  const BRAVE = "In Brave, turn on Settings → Privacy and security → Use Google services for push messaging, then try again.";

  test("in Brave, a rejected subscribe names the Brave setting to turn on", async () => {
    const { notifications, calls } = setup({ subscribeFails: true, brave: true });
    await notifications.refresh();
    await notifications.enable();
    expect(notifications.view()).toMatchObject({ status: "off", busy: false, error: true });
    expect(notifications.view().message).toContain(BRAVE);
    expect(notifications.view().message).toStartWith("Brave didn't allow push notifications.");
    expect(calls.some((call) => call.startsWith("server subscribe"))).toBe(false);
  });

  test("in any other browser, a rejected subscribe says the browser didn't allow it and points at its site settings", async () => {
    for (const brave of [false, undefined]) {
      const { notifications } = setup({ subscribeFails: true, brave });
      await notifications.refresh();
      await notifications.enable();
      expect([brave, notifications.view().status, notifications.view().error]).toEqual([brave, "off", true]);
      expect(notifications.view().message).toBe("Your browser didn't allow push notifications. Allow notifications for this site in the browser's settings, then try again.");
    }
  });

  test("after a refusal the key still works for another try", async () => {
    const { notifications, calls } = setup({ subscribeFails: true, brave: true });
    await notifications.refresh();
    await notifications.enable();
    await notifications.enable();
    expect(calls.filter((call) => call === "request permission")).toHaveLength(2);
  });

  test("a failure of the laptop's server is not blamed on the browser, in Brave too", async () => {
    const { notifications } = setup({ serverFails: true, brave: true });
    await notifications.refresh();
    await notifications.enable();
    expect(notifications.view().message).toBe("Couldn't turn notifications on. The laptop didn't answer.");
  });

  test("a denied permission is blocked, and its line says what happened and the fix", async () => {
    const { notifications } = setup({ asked: "denied", brave: true });
    await notifications.refresh();
    await notifications.enable();
    expect(notifications.view().status).toBe("blocked");
    expect(statusLine(notifications.view())).toBe("Your browser didn't allow push notifications. Allow notifications for this site in the browser's settings, then reopen the app.");
  });

  test("a browser is Brave when navigator.brave.isBrave() says so", async () => {
    expect(await looksLikeBrave({ brave: { isBrave: async () => true } })).toBe(true);
    expect(await looksLikeBrave({ brave: { isBrave: async () => false } })).toBe(false);
    expect(await looksLikeBrave({})).toBe(false);
    expect(await looksLikeBrave({ brave: {} })).toBe(false);
  });
});

describe("turning off and testing", () => {
  test("turning off tells the server and drops the browser's subscription", async () => {
    const { notifications, calls } = setup({ permission: "granted", subscribed: true });
    await notifications.refresh();
    await notifications.disable();
    expect(calls).toEqual(["server unsubscribe https://push.example.com/send/phone", "browser unsubscribe"]);
    expect(notifications.view()).toMatchObject({ status: "off", message: "Notifications are off." });
  });

  test("turning off works even when the server can't be reached: the browser still stops", async () => {
    const { notifications, calls } = setup({ permission: "granted", subscribed: true, unsubscribeFails: true });
    await notifications.refresh();
    await notifications.disable();
    expect(calls).toEqual(["server unsubscribe https://push.example.com/send/phone", "browser unsubscribe"]);
    expect(notifications.view().status).toBe("off");
  });

  test("Send test asks the server to test this phone's subscription", async () => {
    const { notifications, calls } = setup({ permission: "granted", subscribed: true });
    await notifications.refresh();
    await notifications.test();
    expect(calls).toEqual(["server test https://push.example.com/send/phone"]);
    expect(notifications.view()).toMatchObject({ status: "on", busy: false, error: false, message: "Test sent. It should arrive in a moment." });
  });

  test("a test the server refuses shows why, and the control stays on", async () => {
    const { notifications } = setup({ permission: "granted", subscribed: true, serverFails: true });
    await notifications.refresh();
    await notifications.test();
    expect(notifications.view()).toMatchObject({ status: "on", error: true });
    expect(notifications.view().message).toStartWith("The test didn't go through. ");
  });

  test("a test when the browser's subscription has gone says to turn it on again, and asks the server nothing", async () => {
    const { notifications, calls, dropBrowserSubscription } = setup({ permission: "granted", subscribed: true });
    await notifications.refresh();
    dropBrowserSubscription();
    await notifications.test();
    expect(calls).toEqual([]);
    expect(notifications.view()).toMatchObject({ status: "off", error: true, message: "This phone isn't subscribed any more. Turn notifications on again." });
  });

  test("turn off and Send test do nothing unless it is on", async () => {
    const { notifications, calls } = setup();
    await notifications.refresh();
    await notifications.disable();
    await notifications.test();
    expect(calls).toEqual([]);
  });
});

describe("?demo", () => {
  test("the demo flag alone keeps the browser and the server out of it, even where a server client exists", async () => {
    const { calls, browser, api } = setup({ permission: "granted", subscribed: true });
    const notifications = createNotifications({ browser, api, demo: true });
    await notifications.refresh();
    await notifications.enable();
    await notifications.disable();
    await notifications.test();
    expect([notifications.view().status, calls]).toEqual(["off", []]);
  });

  test("shows the control off, and never asks the browser or the server for anything", async () => {
    const { notifications, calls } = setup({ demo: true, permission: "granted", subscribed: true });
    expect(notifications.view()).toMatchObject({ status: "off", demo: true });
    await notifications.refresh();
    await notifications.enable();
    await notifications.disable();
    await notifications.test();
    expect([notifications.view().status, calls]).toEqual(["off", []]);
  });

  test("its panel says so, with the key switched off", () => {
    const demo = { status: "off", busy: false, message: "", error: false, demo: true } as const;
    expect(statusLine(demo)).toBe("Off. The sample data never turns notifications on.");
    expect(keysHtml(demo)).toMatch(/class="act notify-toggle"[^>]*disabled/);
  });
});

describe("the panel's words and keys", () => {
  const view = (change: Partial<View>): View => ({ status: "off", busy: false, message: "", error: false, demo: false, ...change });
  const toggle = (html: string) => html.match(/<button class="act notify-toggle"[^>]*>[^<]*<\/button>/)?.[0] ?? "";

  test("off: a Turn on key that works, no Send test", () => {
    const html = keysHtml(view({ status: "off" }));
    expect(toggle(html)).toBe('<button class="act notify-toggle" type="button" data-action="enable">Turn on</button>');
    expect(statusLine(view({ status: "off" }))).toBe("Off. Turn on to get a notice when an agent needs you or finishes.");
    expect(html).not.toContain("Send test");
  });

  test("on: a Turn off key and a Send test key, both working", () => {
    const html = keysHtml(view({ status: "on" }));
    expect(toggle(html)).toBe('<button class="act notify-toggle" type="button" data-action="disable">Turn off</button>');
    expect(html).toContain('<button class="act notify-test" type="button" data-action="test">Send test</button>');
    expect(statusLine(view({ status: "on" }))).toStartWith("On. This phone gets a notice");
  });

  test("blocked and unsupported say why, and the key is off", () => {
    const blocked = view({ status: "blocked" });
    expect(statusLine(blocked)).toStartWith("Your browser didn't allow push notifications. Allow notifications for this site");
    expect(toggle(keysHtml(blocked))).toContain("disabled");
    const unsupported = view({ status: "unsupported" });
    expect(statusLine(unsupported)).toBe("This browser can't show push notifications.");
    expect(toggle(keysHtml(unsupported))).toContain("disabled");
  });

  test("while it works the keys are off", () => {
    expect(toggle(keysHtml(view({ status: "off", busy: true })))).toContain("disabled");
    expect(keysHtml(view({ status: "on", busy: true }))).toMatch(/notify-test[^>]*disabled/);
    expect(toggle(keysHtml(view({ status: "checking" })))).toContain("disabled");
  });
});

describe("keyBytes", () => {
  test("decodes the server's base64url key to its bytes, with or without padding", () => {
    expect([...keyBytes("AQID-_8")]).toEqual([1, 2, 3, 251, 255]);
    expect([...keyBytes("AQID-_8=")]).toEqual([1, 2, 3, 251, 255]);
    expect([...keyBytes("AQIDBA")]).toEqual([1, 2, 3, 4]);
  });
});

describe("the bell", () => {
  const view = (change: Partial<View>): View => ({ status: "off", busy: false, message: "", error: false, demo: false, ...change });
  const bell = (change: Partial<View>, expanded = false) => bellHtml(view(change), expanded);
  const icon = (html: string) => html.match(/<use href="#([^"]+)"/)?.[1];

  test("on is a bell, off a bell with a slash, and blocked or unsupported a slashed bell that is muted", () => {
    expect(icon(bell({ status: "on" }))).toBe("i-bell");
    expect(icon(bell({ status: "off" }))).toBe("i-bell-off");
    expect(icon(bell({ status: "blocked" }))).toBe("i-bell-off");
    expect(icon(bell({ status: "unsupported" }))).toBe("i-bell-off");
    const muted = (status: View["status"]) => bell({ status }).includes("is-muted");
    expect(["on", "off", "checking", "blocked", "unsupported"].map((status) => muted(status as View["status"]))).toEqual([false, false, false, true, true]);
  });

  test("its label names the state, and the key opens the panel", () => {
    const label = (status: View["status"]) => bell({ status }).match(/aria-label="([^"]*)"/)?.[1];
    expect(["on", "off", "checking", "blocked", "unsupported"].map((status) => label(status as View["status"]))).toEqual([
      "Notifications: on. Open settings",
      "Notifications: off. Open settings",
      "Notifications: checking. Open settings",
      "Notifications: blocked. Open settings",
      "Notifications: not supported. Open settings",
    ]);
    const html = bell({ status: "on" });
    expect(html).toContain('class="bell-key"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-controls="notify-panel"');
  });

  test("it says whether its panel is open", () => {
    expect(bell({}, false)).toContain('aria-expanded="false"');
    expect(bell({}, true)).toContain('aria-expanded="true"');
  });

  test("the demo bell is off, and a busy one still shows its state", () => {
    expect(icon(bell({ status: "off", demo: true }))).toBe("i-bell-off");
    expect(icon(bell({ status: "on", busy: true }))).toBe("i-bell");
  });
});
