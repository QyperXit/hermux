// Who may use the server and from where: the login check, pane targets,
// cross-site requests and the static files.
import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app";
import { createHerdr } from "../server/herdr";
import { ALLOWED_LOGIN, disposeFakes } from "./support/http";
import { WEB } from "./support/agents";
import { PI, SHELL_PANE, keys, path as paneRoute, prompt, setup } from "./support/terminals";

afterAll(disposeFakes);

describe.concurrent("access control", () => {
  const paths: [string, string, unknown?][] = [
    ["GET", "/"],
    ["GET", "/index.html"],
    ["GET", "/manifest.webmanifest"],
    ["GET", "/app.js"],
    ["GET", "/sw.js"],
    ["GET", "/no-such-file"],
    ["GET", "/api/agents"],
    ["GET", "/api/terminals"],
    ["GET", "/api/workspaces/w9/terminals"],
    ["GET", paneRoute(PI, "output")],
    ["GET", paneRoute(PI, "history")],
    ["POST", paneRoute(PI, "prompt"), { text: "hi", kind: "pi" }],
    ["POST", paneRoute(PI, "keys"), { keys: ["enter"], kind: "pi" }],
    ["POST", paneRoute(SHELL_PANE, "prompt"), { text: "id", kind: "shell" }],
    ["POST", paneRoute(SHELL_PANE, "keys"), { keys: ["ctrl+c"], kind: "shell" }],
  ];
  const logins: [string, string | null][] = [
    ["no login header", null],
    ["an empty login", ""],
    ["another login", "someone.else@example.com"],
    ["a case variant of the login", "You@Example.com"],
    ["the login with extra text", "you@example.com.evil"],
  ];

  for (const [name, login] of logins) {
    test(`403 with ${name}, for pages and API, and herdr never runs`, async () => {
      const { request, calls } = setup();
      for (const [method, path, body] of paths) {
        const response = await request(method, path, { login, body });
        expect([method, path, response.status]).toEqual([method, path, 403]);
      }
      expect(calls()).toEqual([]);
    });
  }

  test("the right login gets the page and the API", async () => {
    const { request } = setup();
    expect((await request("GET", "/")).status).toBe(200);
    expect((await request("GET", "/api/agents")).status).toBe(200);
    expect((await request("GET", "/api/terminals")).status).toBe(200);
  });
});

describe.concurrent("targets", () => {
  for (const pane of ["-x", "--help", "--machine", "w1:p1;rm", "w1:p1 --machine x", "w1", "p1", "agent", "w1:p1/x", "w1:-p1"]) {
    test(`refuses target ${JSON.stringify(pane)} with 400 before herdr runs`, async () => {
      const { request, calls } = setup();
      for (const [method, path, init] of [
        ["GET", paneRoute(pane, "output"), {}],
        ["GET", paneRoute(pane, "history"), {}],
        ["POST", ...prompt(pane, "hi", "pi")],
        ["POST", ...keys(pane, ["enter"], "atomic")],
        ["POST", ...prompt(pane, "hi", "shell")],
        ["POST", ...keys(pane, ["enter"], "shell")],
      ] as const) {
        const response = await request(method, path, init);
        expect([path, response.status]).toEqual([path, 400]);
        expect((await response.json()).error.code).toBe("invalid_target");
      }
      expect(calls()).toEqual([]);
    });
  }
});

describe.concurrent("cross-site requests", () => {
  // tailscale serve adds the login header to any request from the user's phone,
  // including one a web page fires from another site, so POSTs must prove they
  // came from this page: a JSON content type (needs a CORS preflight, which the
  // server never grants) and no cross-site Sec-Fetch-Site.
  const promptPath = paneRoute(PI, "prompt");
  const keysPath = paneRoute(PI, "keys");

  const wrongTypes: [string, string, string, string][] = [
    ["a text/plain prompt", promptPath, "text/plain", JSON.stringify({ text: "rm -rf ~", kind: "pi" })],
    ["a form-urlencoded prompt", promptPath, "application/x-www-form-urlencoded", JSON.stringify({ text: "csrf", kind: "pi" })],
    ["a multipart prompt", promptPath, "multipart/form-data; boundary=x", JSON.stringify({ text: "csrf", kind: "pi" })],
    ["a text/plain ctrl+c", keysPath, "text/plain;charset=UTF-8", JSON.stringify({ keys: ["ctrl+c"], kind: "pi" })],
    ["a form-urlencoded ctrl+c", keysPath, "application/x-www-form-urlencoded", JSON.stringify({ keys: ["ctrl+c"], kind: "pi" })],
    ["a text/plain shell command", paneRoute(SHELL_PANE, "prompt"), "text/plain", JSON.stringify({ text: "rm -rf ~", kind: "shell" })],
  ];
  for (const [name, path, type, body] of wrongTypes) {
    test(`refuses ${name} with 415 before herdr runs`, async () => {
      const { request, calls } = setup();
      const response = await request("POST", path, { body, headers: { "content-type": type } });
      expect(response.status).toBe(415);
      expect((await response.json()).error.code).toBe("unsupported_media_type");
      expect(calls()).toEqual([]);
    });
  }

  for (const site of ["cross-site", "same-site"]) {
    test(`refuses a JSON POST with Sec-Fetch-Site: ${site} with 403 before herdr runs`, async () => {
      const { request, calls } = setup();
      for (const [route, init] of [prompt(PI, "csrf", "pi"), keys(PI, ["ctrl+c"], "pi"), prompt(SHELL_PANE, "csrf", "shell"), keys(SHELL_PANE, ["ctrl+c"], "shell")] as const) {
        const response = await request("POST", route, { ...init, headers: { "sec-fetch-site": site } });
        expect([route, response.status]).toEqual([route, 403]);
        expect((await response.json()).error.code).toBe("cross_site_request");
      }
      expect(calls()).toEqual([]);
    });
  }

  test("a same-origin JSON POST still works, with or without Sec-Fetch-Site", async () => {
    const { request, calls } = setup();
    const variants: Record<string, string>[] = [{}, { "sec-fetch-site": "same-origin" }, { "sec-fetch-site": "none" }, { "content-type": "application/json; charset=utf-8" }];
    for (const headers of variants) {
      for (const [route, init] of [prompt(PI, "hi", "pi"), keys(PI, ["esc"], "pi")] as const) {
        expect([route, (await request("POST", route, { ...init, headers })).status]).toEqual([route, 200]);
      }
    }
    expect(calls()).toEqual(
      variants.flatMap(() => [
        ["agent", "get", PI],
        ["agent", "prompt", PI, "hi"],
        ["agent", "get", PI],
        ["agent", "send-keys", PI, "esc"],
      ]),
    );
  });

  // Each route a page could POST to, with a body this page would send.
  const posts: [string, unknown][] = [
    [promptPath, { text: "csrf", kind: "pi" }],
    [keysPath, { keys: ["ctrl+c"], kind: "pi" }],
    [paneRoute(SHELL_PANE, "prompt"), { text: "csrf", kind: "shell" }],
    [paneRoute(SHELL_PANE, "keys"), { keys: ["ctrl+c"], kind: "shell" }],
  ];

  test("a POST with no Content-Type, or a type that only starts like JSON, is 415 before herdr runs", async () => {
    const { request, calls } = setup();
    for (const contentType of [null, "", "application/jsonp", "application/json-seq", "application/json+x", "text/json", "application/x-json"]) {
      for (const [path, body] of posts) {
        const response = await request("POST", path, { body, contentType });
        expect([contentType, path, response.status, (await response.json()).error.code]).toEqual([contentType, path, 415, "unsupported_media_type"]);
      }
    }
    expect(calls()).toEqual([]);
  });

  test("the JSON media type is matched in any letter case and with parameters", async () => {
    const { request, calls } = setup();
    for (const contentType of ["Application/JSON; charset=x", "APPLICATION/JSON", " application/json ;charset=utf-8"]) {
      const response = await request("POST", promptPath, { body: { text: "hi", kind: "pi" }, contentType });
      expect([contentType, response.status]).toEqual([contentType, 200]);
    }
    expect(calls().filter((call) => call[1] === "prompt")).toHaveLength(3);
  });

  test("an empty Sec-Fetch-Site counts as another site: 403 before herdr runs", async () => {
    const { request, calls } = setup();
    for (const [path, body] of posts) {
      const response = await request("POST", path, { body, headers: { "sec-fetch-site": "" } });
      expect([path, response.status, (await response.json()).error.code]).toEqual([path, 403, "cross_site_request"]);
    }
    expect(calls()).toEqual([]);
  });

  test("a cross-site PUT, DELETE or PATCH is 403 before the method check; herdr never runs", async () => {
    const { request, calls } = setup();
    for (const method of ["PUT", "DELETE", "PATCH"]) {
      for (const path of [`/api/agents/${encodeURIComponent(PI)}`, promptPath, keysPath, `/api/terminals/${encodeURIComponent(PI)}`, "/api/agents", "/"]) {
        const response = await request(method, path, { headers: { "sec-fetch-site": "cross-site" } });
        expect([method, path, response.status, (await response.json()).error.code]).toEqual([method, path, 403, "cross_site_request"]);
      }
    }
    expect(calls()).toEqual([]);
  });

  test("a cross-site GET is answered: reads are allowed from anywhere the login header comes", async () => {
    const { request } = setup();
    for (const path of ["/", "/api/agents", "/api/terminals", paneRoute(PI, "output"), paneRoute(SHELL_PANE, "output")]) {
      expect([path, (await request("GET", path, { headers: { "sec-fetch-site": "cross-site" } })).status]).toEqual([path, 200]);
    }
  });

  test("without the login, a wrong-type or cross-site POST is 403, not 415, and herdr never runs", async () => {
    const { request, calls } = setup();
    for (const [path, body] of posts) {
      for (const options of [{ contentType: "text/plain" }, { contentType: null }, { headers: { "sec-fetch-site": "cross-site" } }]) {
        const response = await request("POST", path, { body, login: null, ...options });
        expect([path, response.status, await response.text()]).toEqual([path, 403, "Forbidden\n"]);
      }
    }
    expect(calls()).toEqual([]);
  });
});

describe.concurrent("static files", () => {
  test("serves the app with the right content types", async () => {
    const { request } = setup();
    const expected: [string, string][] = [
      ["/", "text/html; charset=utf-8"],
      ["/app.js", "text/javascript; charset=utf-8"],
      ["/api.js", "text/javascript; charset=utf-8"],
      ["/home.js", "text/javascript; charset=utf-8"],
      ["/sample-data.js", "text/javascript; charset=utf-8"],
      ["/app.css", "text/css; charset=utf-8"],
      ["/manifest.webmanifest", "application/manifest+json"],
      ["/icon.svg", "image/svg+xml"],
      ["/icon-192.png", "image/png"],
      ["/icon-512.png", "image/png"],
      ["/fonts/HankenGrotesk-latin-var.woff2", "font/woff2"],
    ];
    for (const [path, type] of expected) {
      const response = await request("GET", path);
      expect([path, response.status, response.headers.get("content-type")]).toEqual([path, 200, type]);
    }
    expect(await (await request("GET", "/")).text()).toContain('<link rel="manifest" href="manifest.webmanifest">');
  });

  test("nothing outside web/ is served", async () => {
    const { request } = setup();
    for (const path of ["/../package.json", "/%2e%2e/package.json", "/..%2fpackage.json", "/%2e%2e%2fserver%2fmain.ts", "/fonts", "/missing.js", "/%E0%A4%A"]) {
      expect([path, (await request("GET", path)).status]).toEqual([path, 404]);
    }
  });

  // The service worker's stamp (D29), as served.
  const stampOf = (text: string): { version: string; files: string[] } => {
    const match = text.match(/const STAMP = \/\*\* @type \{unknown\} \*\/ \((.*)\);/);
    expect(match).not.toBeNull();
    return JSON.parse(match?.[1] ?? "null");
  };

  test("serves the service worker stamped with the shell's version and files, revalidated on every load", async () => {
    const { request, calls } = setup();
    const response = await request("GET", "/sw.js");
    expect([response.status, response.headers.get("content-type"), response.headers.get("cache-control")]).toEqual([200, "text/javascript; charset=utf-8", "no-cache"]);
    const { version, files } = stampOf(await response.text());
    expect(version).toMatch(/^[0-9a-f]{16}$/);
    for (const file of ["./", "app.js", "reader.js", "sample-data.js", "app.css", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png", "fonts/HankenGrotesk-latin-var.woff2", "fonts/JetBrainsMono-Regular.woff2", "fonts/JetBrainsMono-Bold.woff2"]) {
      expect([file, files.includes(file)]).toEqual([file, true]);
    }
    // Not the worker itself, nor the page twice, the font licences, the design sketches or the API.
    const outside = (file: string) => file !== "./" && file.includes("/") && !file.startsWith("fonts/");
    expect(files.filter((file) => file === "sw.js" || file === "index.html" || file.endsWith(".txt") || file.startsWith("api/") || outside(file))).toEqual([]);
    for (const file of files) expect([file, (await request("GET", `/${file === "./" ? "" : file}`)).status]).toEqual([file, 200]);
    expect(stampOf(await (await request("GET", "/sw.js")).text()).version).toBe(version);
    expect(calls()).toEqual([]);
  });

  test("a changed shell file gives the service worker a new version", async () => {
    const root = mkdtempSync(join(tmpdir(), "web-shell-"));
    try {
      for (const entry of readdirSync(WEB, { withFileTypes: true })) {
        if (entry.isFile() || entry.name === "fonts") cpSync(join(WEB, entry.name), join(root, entry.name), { recursive: true });
      }
      const app = createApp({ herdr: createHerdr("/nonexistent/herdr"), allowedLogin: ALLOWED_LOGIN, webRoot: root });
      const version = async () => {
        const response = await app(new Request("http://127.0.0.1:8787/sw.js", { headers: { "Tailscale-User-Login": ALLOWED_LOGIN } }));
        return stampOf(await response.text()).version;
      };
      const first = await version();
      expect(await version()).toBe(first);
      writeFileSync(join(root, "app.css"), "body { color: red; }\n");
      const second = await version();
      expect(second).not.toBe(first);
      writeFileSync(join(root, "fonts", "JetBrainsMono-Bold.woff2"), "changed");
      expect(await version()).not.toBe(second);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
