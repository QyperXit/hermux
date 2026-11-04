import { createNotifications, type Browser, type View } from "../../web/notifications.js";

export type Permission = "default" | "granted" | "denied";

// A browser's push parts and the server's push routes, recording every call.
export function setup({ permission = "default", subscribed = false, asked = "granted", supported = true, demo = false, serverFails = false, unsubscribeFails = false, subscribeFails = false, brave, serverMessage = "The laptop didn't answer." }: { permission?: Permission; subscribed?: boolean; asked?: Permission; supported?: boolean; demo?: boolean; serverFails?: boolean; unsubscribeFails?: boolean; subscribeFails?: boolean; brave?: boolean; serverMessage?: string } = {}) {
  const calls: string[] = [];
  let current: Permission = permission;
  let own: { endpoint: string; toJSON(): unknown; unsubscribe(): Promise<boolean> } | null = null;
  const subscription = () => ({
    endpoint: "https://push.example.com/send/phone",
    toJSON: () => ({ endpoint: "https://push.example.com/send/phone", keys: { p256dh: "p", auth: "a" } }),
    unsubscribe: async () => {
      calls.push("browser unsubscribe");
      own = null;
      return true;
    },
  });
  if (subscribed) own = subscription();
  const registration = {
    pushManager: {
      getSubscription: async () => own,
      subscribe: async (options: { userVisibleOnly: boolean; applicationServerKey: Uint8Array }) => {
        calls.push(`browser subscribe ${options.userVisibleOnly} ${[...options.applicationServerKey].join(",")}`);
        if (subscribeFails) throw new DOMException("Registration failed - push service error", "AbortError");
        own = subscription();
        return own;
      },
    },
  };
  const browser: Browser = supported
    ? {
        serviceWorker: { getRegistration: async () => registration, ready: Promise.resolve(registration) },
        notification: {
          get permission() {
            return current;
          },
          requestPermission: async () => {
            calls.push("request permission");
            current = asked;
            return asked;
          },
        },
        pushManager: true,
        ...(brave === undefined ? {} : { isBrave: async () => brave }),
      }
    : { serviceWorker: undefined, notification: undefined, pushManager: false };
  const api = {
    key: async () => {
      calls.push("server key");
      return Buffer.from([1, 2, 3, 251, 255]).toString("base64url");
    },
    subscribe: async (subscription: unknown) => {
      calls.push(`server subscribe ${JSON.stringify(subscription)}`);
      if (serverFails) throw Object.assign(new Error(serverMessage), { code: "unreachable" });
    },
    unsubscribe: async (endpoint: string) => {
      calls.push(`server unsubscribe ${endpoint}`);
      if (unsubscribeFails) throw new Error("The laptop didn't answer.");
    },
    test: async (endpoint: string) => {
      calls.push(`server test ${endpoint}`);
      if (serverFails) throw Object.assign(new Error("The server doesn't have it."), { code: "subscription_not_found" });
    },
  };
  const notifications = createNotifications({ browser, api: demo ? null : api, demo });
  const changes: View[] = [];
  notifications.subscribe(() => changes.push(notifications.view()));
  return { notifications, browser, api, calls, changes, permission: () => current, dropBrowserSubscription: () => void (own = null) };
}
