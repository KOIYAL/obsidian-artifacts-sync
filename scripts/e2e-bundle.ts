/**
 * Runs the built `main.js` inside a simulated Obsidian, once as desktop and once as mobile, and
 * performs a real sync against an Artifacts repository (opt-in; run `npm run build` first).
 *
 *   ARTIFACTS_REMOTE=… ARTIFACTS_TOKEN=… npm run e2e:bundle
 *
 * The mobile pass makes every Node built-in throw, so it also proves the bundle loads and syncs
 * without them.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import Module from "node:module";
import { fakeAdapter } from "./fake-adapter";

const remoteUrl = process.env.ARTIFACTS_REMOTE ?? "";
const token = process.env.ARTIFACTS_TOKEN ?? "";
if (!remoteUrl || !token) {
  console.error("Set ARTIFACTS_REMOTE and ARTIFACTS_TOKEN (a write token).");
  process.exit(2);
}
const mainJs = path.resolve("main.js");
if (!fs.existsSync(mainJs)) {
  console.error("main.js not found: run `npm run build` first.");
  process.exit(2);
}

type Mode = "desktop" | "mobile";
const NODE_ONLY = /^(node:)?(fs|path|http|https|url|querystring|crypto|zlib|stream|os|child_process)$/;

async function runMode(mode: Mode): Promise<boolean> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `artifacts-sync-bundle-${mode}-`));
  const notices: string[] = [];
  class FileSystemAdapter {
    constructor(private readonly base: string) {}
    getBasePath() {
      return this.base;
    }
  }
  const obsidianStub = {
    Plugin: class {
      addCommand() {}
      addSettingTab() {}
      addStatusBarItem() {
        return { setText() {}, addClass() {}, setAttr() {}, addEventListener() {} };
      }
      addRibbonIcon() {}
      registerEvent() {}
      registerInterval() {}
      async loadData() {
        return { remoteUrl, token, syncFolder: "Knowledge", showNotices: true };
      }
      async saveData() {}
    },
    PluginSettingTab: class {},
    FuzzySuggestModal: class {},
    FileSystemAdapter,
    Setting: class {},
    Notice: class {
      constructor(text: string) {
        notices.push(text);
      }
    },
    Platform: { isDesktop: mode === "desktop", isMobile: mode === "mobile" },
    normalizePath: (p: string) => p.replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""),
    requestUrl: async (params: { url: string; method?: string; headers?: Record<string, string>; body?: ArrayBuffer }) => {
      const res = await fetch(params.url, { method: params.method, headers: params.headers, body: params.body });
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => (headers[k] = v));
      return { status: res.status, headers, arrayBuffer: await res.arrayBuffer() };
    },
  };

  const origLoad = (Module as unknown as { _load: (...args: unknown[]) => unknown })._load;
  (Module as unknown as { _load: (...args: unknown[]) => unknown })._load = function (request: string, ...rest: unknown[]) {
    if (request === "obsidian") return obsidianStub;
    if (mode === "mobile" && NODE_ONLY.test(request)) throw new Error(`not available on mobile: ${request}`);
    return origLoad.call(this, request, ...rest);
  };
  // Phones have no global Buffer or process. Shadow both for the bundle only (Node's own fetch
  // still needs them), so a bare reference inside the bundle fails here instead of on a phone.
  let entry = mainJs;
  if (mode === "mobile") {
    entry = path.join(root, "main.mobile.js");
    fs.writeFileSync(entry, `(function (Buffer, process) {${fs.readFileSync(mainJs, "utf8")}\n})(undefined, undefined);`);
  }
  try {
    const require = createRequire(__filename);
    delete require.cache[entry];
    const mod = require(entry) as { default?: new () => PluginLike } & (new () => PluginLike);
    const PluginClass = mod.default ?? mod;
    const plugin = new PluginClass();
    const adapter = mode === "mobile" ? fakeAdapter(root) : Object.assign(new FileSystemAdapter(root), fakeAdapter(root));
    plugin.app = { vault: { adapter, getName: () => "bundle-vault", on: () => ({}) }, workspace: {} };
    await plugin.onload();
    const stamp = Date.now().toString(36);
    fs.mkdirSync(path.join(root, "Knowledge", "E2E"), { recursive: true });
    fs.writeFileSync(path.join(root, "Knowledge", "E2E", `${stamp}-${mode}.md`), `# ${mode} via bundle\n`);
    await plugin.runSync("manual");
    const ok = notices.some((n) => /synced at .*1 changed/.test(n));
    fs.rmSync(path.join(root, "Knowledge", "E2E"), { recursive: true, force: true });
    await plugin.runSync("manual");
    console.log(`${ok ? "ok " : "NG "} ${mode}: ${notices.map((n) => n.replaceAll(token, "<token>")).join(" || ")}`);
    return ok;
  } finally {
    (Module as unknown as { _load: unknown })._load = origLoad;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

interface PluginLike {
  app: unknown;
  onload(): Promise<void>;
  runSync(trigger: "manual"): Promise<void>;
}

async function main(): Promise<void> {
  const results = [await runMode("mobile"), await runMode("desktop")];
  process.exit(results.every(Boolean) ? 0 : 1);
}

main().catch((err) => {
  console.error("e2e:bundle failed:", String(err instanceof Error ? err.stack : err).replaceAll(token, "<token>").slice(0, 800));
  process.exit(1);
});
