import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type ArtifactsSyncPlugin from "./main";
import { DEFAULT_IGNORE, tokenStatus, validateSettings } from "./core";

export interface ArtifactsSyncSettings {
  /** https://<account>.artifacts.cloudflare.net/git/<namespace>/<repo>.git */
  remoteUrl: string;
  /** Repository write token from the Cloudflare dashboard (art_…). Stored in this vault's plugin data. */
  token: string;
  branch: string;
  /** Vault-relative folder to sync. Empty = the whole vault. */
  syncFolder: string;
  /** Minutes between automatic syncs. 0 = manual only. */
  autoSyncMinutes: number;
  /** Also sync when a note changes (debounced). */
  syncOnChange: boolean;
  ignore: string[];
  authorName: string;
  authorEmail: string;
  showNotices: boolean;
}

export const DEFAULT_SETTINGS: ArtifactsSyncSettings = {
  remoteUrl: "",
  token: "",
  branch: "main",
  syncFolder: "",
  autoSyncMinutes: 0,
  syncOnChange: false,
  ignore: [...DEFAULT_IGNORE],
  authorName: "Obsidian",
  authorEmail: "obsidian@localhost",
  showNotices: true,
};

export class ArtifactsSyncSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: ArtifactsSyncPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;

    new Setting(containerEl)
      .setName("Remote URL")
      .setDesc("Copy it from the Cloudflare dashboard: Storage & databases → Artifacts → your repository.")
      .addText((text) =>
        text
          .setPlaceholder("https://<account>.artifacts.cloudflare.net/git/default/my-vault.git")
          .setValue(s.remoteUrl)
          .onChange(async (value) => {
            s.remoteUrl = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    const tokenSetting = new Setting(containerEl)
      .setName("Repository token")
      .setDesc("A write token for this repository. Tokens expire; issue a new one in the dashboard when this one does.")
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("art_…")
          .setValue(s.token)
          .onChange(async (value) => {
            s.token = value.trim();
            await this.plugin.saveSettings();
            this.describeToken(tokenSetting);
          });
      });
    this.describeToken(tokenSetting);

    new Setting(containerEl)
      .setName("Branch")
      .addText((text) =>
        text.setValue(s.branch).onChange(async (value) => {
          s.branch = value.trim() || "main";
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Folder to sync")
      .setDesc("Leave empty to sync the whole vault. Otherwise a folder inside the vault, for example Knowledge.")
      .addText((text) =>
        text.setValue(s.syncFolder).onChange(async (value) => {
          s.syncFolder = value.trim().replace(/^\/+|\/+$/g, "");
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Automatic sync interval (minutes)")
      .setDesc("0 turns automatic sync off. You can always run Sync now from the command palette.")
      .addText((text) =>
        text.setValue(String(s.autoSyncMinutes)).onChange(async (value) => {
          const n = Number(value);
          s.autoSyncMinutes = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
          await this.plugin.saveSettings();
          this.plugin.scheduleAutoSync();
        }),
      );

    new Setting(containerEl)
      .setName("Sync shortly after a note changes")
      .addToggle((toggle) =>
        toggle.setValue(s.syncOnChange).onChange(async (value) => {
          s.syncOnChange = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Ignore")
      .setDesc("One pattern per line. A trailing slash means a folder. The Obsidian config folder is ignored by default.")
      .addTextArea((area) =>
        area.setValue(s.ignore.join("\n")).onChange(async (value) => {
          s.ignore = value.split("\n").map((l) => l.trim()).filter(Boolean);
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl).setName("Commit author").setHeading();
    new Setting(containerEl).setName("Name").addText((text) =>
      text.setValue(s.authorName).onChange(async (value) => {
        s.authorName = value.trim() || DEFAULT_SETTINGS.authorName;
        await this.plugin.saveSettings();
      }),
    );
    new Setting(containerEl).setName("Email").addText((text) =>
      text.setValue(s.authorEmail).onChange(async (value) => {
        s.authorEmail = value.trim() || DEFAULT_SETTINGS.authorEmail;
        await this.plugin.saveSettings();
      }),
    );

    new Setting(containerEl)
      .setName("Show a notice after each sync")
      .addToggle((toggle) =>
        toggle.setValue(s.showNotices).onChange(async (value) => {
          s.showNotices = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Check settings")
      .setDesc("Validates the remote URL, token and branch without syncing.")
      .addButton((button) =>
        button.setButtonText("Check").onClick(() => {
          const problems = validateSettings(s);
          new Notice(problems.length ? problems.join("\n") : "Settings look good.");
        }),
      );
  }

  private describeToken(setting: Setting): void {
    const token = this.plugin.settings.token;
    if (!token) {
      setting.setDesc("A write token for this repository. Tokens expire; issue a new one in the dashboard when this one does.");
      return;
    }
    const status = tokenStatus(token, Date.now());
    if (status.expired) setting.setDesc("This token has expired. Issue a new write token in the Cloudflare dashboard.");
    else if (status.remainingMs === null) setting.setDesc("Token set (no expiry found in it).");
    else setting.setDesc(`Token set. Expires in about ${Math.max(1, Math.round(status.remainingMs / 3_600_000))} hours.`);
  }
}
