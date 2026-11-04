const SENDS_TO_PANE = new Set(["pane send-text", "pane send-keys", "pane run", "pane close", "agent prompt", "agent send-keys"]);
const SEND_ROUTE = /^\/api\/(?:terminals|agents)\/([^/?]+)\/(?:prompt|keys)$/;

// The tabs and panes a live script made. Every herdr command that types into or
// closes something, and every send through the server's routes, must name one
// of them; anything else throws before it runs.
export function createdPanes() {
  const tabs = new Set<string>();
  const panes = new Set<string>();
  const refuse = (what: string, id: string) => {
    throw new Error(`Refusing to touch ${what} ${id}: this script didn't create it.`);
  };
  return {
    addTab(tab: string) {
      tabs.add(tab);
    },
    addPane(pane: string) {
      panes.add(pane);
    },
    // A pane ID that names no pane, sent to on purpose to see the refusal.
    addMissing(pane: string) {
      panes.add(pane);
    },
    herdrArgs(args: string[]) {
      const command = args.slice(0, 2).join(" ");
      if (SENDS_TO_PANE.has(command) && !panes.has(args[2])) refuse("pane", args[2]);
      if (command === "tab close" && !tabs.has(args[2])) refuse("tab", args[2]);
      return args;
    },
    route(method: string, path: string) {
      const target = path.match(SEND_ROUTE)?.[1];
      if (method === "POST" && target !== undefined && !panes.has(decodeURIComponent(target))) refuse("pane", decodeURIComponent(target));
      return path;
    },
  };
}
