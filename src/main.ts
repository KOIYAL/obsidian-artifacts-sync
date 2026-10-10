import { FileSystemAdapter, Notice, Plugin, TAbstractFile, normalizePath } from "obsidian";
import path from "node:path";
import { parseArtifactsRemote, tokenStatus, validateSettings } from "./core";
import { ArtifactsGit, GitConflictError } from "./git";
import { ArtifactsSyncSettingTab, DEFAULT_SETTINGS, type ArtifactsSyncSettings } from "./settings";

const CHANGE_DEBOUNCE_MS = 30_000;

export default class ArtifactsSyncPlugin extends Plugin {
  settings: ArtifactsSyncSettings = { ...DEFAULT_SETTINGS };
  private statusBar: HTMLElement | null = null;
  private autoSyncTimer: number | null = null;
  private changeTimer: number | null = null;
  private running = false;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new ArtifactsSyncSettingTab(this.app, this));
    this.statusBar = this.addStatusBarItem();
    this.setStatus("Artifacts: idle");

    this.addCommand({ id: "sync-now", name: "Sync now (commit, pull, push)", callback: () => void this.runSync("manual") });
    this.addCommand({ id: "pull", name: "Pull from Artifacts", callback: () => void this.runPull() });
    this.addCommand({ id: "push", name: "Push to Artifacts", callback: () => void this.runPush() });

    this.registerEvent(this.app.vault.on("modify", (file) => this.onVaultChange(file)));
    this.registerEvent(this.app.vault.on("create", (file) => this.onVaultChange(file)));
    this.registerEvent(this.app.vault.on("delete", (file) => this.onVaultChange(file)));
    this.registerEvent(this.app.vault.on("rename", (file) => this.onVaultChange(file)));
    this.scheduleAutoSync();
  }

  onunload(): void {
    if (this.autoSyncTimer !== null) window.clearInterval(this.autoSyncTimer);
    if (this.changeTimer !== null) window.clearTimeout(this.changeTimer);
  }

  async loadSettings(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS, ...((await this.loadData()) as Partial<ArtifactsSyncSettings> | null) };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  scheduleAutoSync(): void {
    if (this.autoSyncTimer !== null) {
      window.clearInterval(this.autoSyncTimer);
      this.autoSyncTimer = null;
    }
    const minutes = this.settings.autoSyncMinutes;
    if (minutes > 0) {
      this.autoSyncTimer = window.setInterval(() => void this.runSync("timer"), minutes * 60_000);
      this.registerInterval(this.autoSyncTimer);
    }
  }

  private onVaultChange(file: TAbstractFile): void {
    if (!this.settings.syncOnChange) return;
    const folder = this.settings.syncFolder;
    if (folder && !file.path.startsWith(`${folder}/`) && file.path !== folder) return;
    if (this.changeTimer !== null) window.clearTimeout(this.changeTimer);
    this.changeTimer = window.setTimeout(() => void this.runSync("change"), CHANGE_DEBOUNCE_MS);
  }

  /** Absolute path of the working tree, or null when this vault is not on a local disk. */
  private workingTree(): string | null {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) return null;
    const base = adapter.getBasePath();
    const folder = this.settings.syncFolder ? normalizePath(this.settings.syncFolder) : "";
    return folder ? path.join(base, folder) : base;
  }

  private client(): ArtifactsGit | null {
    const problems = validateSettings(this.settings);
    if (problems.length) {
      new Notice(`Cloudflare Artifacts Sync: ${problems.join(" ")}`);
      return null;
    }
    const expiry = tokenStatus(this.settings.token, Date.now());
    if (expiry.expired) {
      new Notice("Cloudflare Artifacts Sync: the repository token has expired. Issue a new one in the Cloudflare dashboard.");
      return null;
    }
    const dir = this.workingTree();
    if (!dir) {
      new Notice("Cloudflare Artifacts Sync works only with vaults stored on this computer.");
      return null;
    }
    const remote = parseArtifactsRemote(this.settings.remoteUrl);
    if (!remote) return null;
    return new ArtifactsGit({
      dir,
      remoteUrl: remote.url,
      token: this.settings.token,
      branch: this.settings.branch,
      ignore: this.settings.ignore,
      author: { name: this.settings.authorName, email: this.settings.authorEmail },
    });
  }

  private setStatus(text: string): void {
    this.statusBar?.setText(text);
  }

  private notice(text: string): void {
    if (this.settings.showNotices) new Notice(text);
  }

  private async guarded(label: string, work: (client: ArtifactsGit) => Promise<string>): Promise<void> {
    if (this.running) {
      new Notice("Cloudflare Artifacts Sync: a sync is already running.");
      return;
    }
    const client = this.client();
    if (!client) return;
    this.running = true;
    this.setStatus(`Artifacts: ${label}…`);
    try {
      const summary = await work(client);
      this.setStatus(`Artifacts: ${summary}`);
      this.notice(`Cloudflare Artifacts Sync: ${summary}`);
    } catch (err) {
      const message = err instanceof GitConflictError ? err.message : `${label} failed: ${err instanceof Error ? err.message : String(err)}`;
      this.setStatus("Artifacts: error");
      new Notice(`Cloudflare Artifacts Sync: ${message}`, 10_000);
      console.error("[cloudflare-artifacts-sync]", err);
    } finally {
      this.running = false;
    }
  }

  async runSync(trigger: "manual" | "timer" | "change"): Promise<void> {
    await this.guarded("syncing", async (client) => {
      const r = await client.sync();
      const when = new Date().toLocaleTimeString();
      const changes = r.committed ? `${r.added} changed, ${r.removed} removed` : "no local changes";
      return `synced at ${when} (${changes}${r.pulled ? ", pulled updates" : ""})${trigger === "manual" ? "" : ""}`;
    });
  }

  async runPull(): Promise<void> {
    await this.guarded("pulling", async (client) => {
      await client.ensureRepo();
      const pulled = await client.pull();
      return pulled ? "pulled updates from Artifacts" : "already up to date";
    });
  }

  async runPush(): Promise<void> {
    await this.guarded("pushing", async (client) => {
      await client.ensureRepo();
      const commit = await client.commitAll();
      await client.push();
      return commit.committed ? `pushed ${commit.added} changed, ${commit.removed} removed` : "pushed (nothing new to commit)";
    });
  }
}
