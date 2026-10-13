import { App, FuzzySuggestModal, Notice, PluginSettingTab, Setting } from "obsidian";
import type { RepoInfo } from "./api";
import type ArtifactsSyncPlugin from "./main";
import { DEFAULT_IGNORE, tokenStatus, validateSettings } from "./core";

/** Pick one of the repositories in the namespace (second device, or after a mistaken Set up). */
class RepoPickerModal extends FuzzySuggestModal<RepoInfo> {
  constructor(app: App, private readonly repos: RepoInfo[], private readonly onPick: (repo: RepoInfo) => void) {
    super(app);
    this.setPlaceholder("Choose the repository this vault should sync with");
  }
  getItems(): RepoInfo[] {
    return this.repos;
  }
  getItemText(repo: RepoInfo): string {
    return repo.name;
  }
  onChooseItem(repo: RepoInfo): void {
    this.onPick(repo);
  }
}

export interface ArtifactsSyncSettings {
  /** Cloudflare account ID (32 hex characters). Used with the API token to set things up. */
  accountId: string;
  /** Cloudflare API token with the Artifacts permission. Only sent to api.cloudflare.com. Optional. */
  apiToken: string;
  /** Artifacts namespace the repository lives in. */
  namespace: string;
  /** Repository name inside the namespace. */
  repoName: string;
  /** Issue a fresh repository token automatically before it expires (needs the API token). */
  autoRenewToken: boolean;
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
  accountId: "",
  apiToken: "",
  namespace: "default",
  repoName: "",
  autoRenewToken: true,
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
      .setName("Sync now")
      .setDesc("Commit, pull and push. The same as the refresh icon in the left ribbon and the Artifacts item in the status bar.")
      .addButton((button) =>
        button.setCta().setButtonText("Sync now").onClick(async () => {
          button.setDisabled(true);
          try {
            await this.plugin.runSync("manual");
          } finally {
            button.setDisabled(false);
          }
        }),
      );

    new Setting(containerEl).setName("Connect with a Cloudflare API token").setHeading();
    const intro = containerEl.createEl("p", { cls: "setting-item-description" });
    intro.setText(
      "Create an API token once (Cloudflare dashboard → My profile → API tokens → Create token → Custom token, " +
        "permission Account / Artifacts / Edit). The plugin then creates the repository and issues its own repository tokens.",
    );

    new Setting(containerEl)
      .setName("Account ID")
      .setDesc("32 characters, shown on the right of the Workers & Pages overview in the dashboard.")
      .addText((text) =>
        text.setPlaceholder("0123456789abcdef0123456789abcdef").setValue(s.accountId).onChange(async (value) => {
          s.accountId = value.trim().toLowerCase();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("API token")
      .setDesc("Stored in this vault's plugin data. Sent only to api.cloudflare.com when setting up or renewing tokens.")
      .addText((text) => {
        text.inputEl.type = "password";
        text.setValue(s.apiToken).onChange(async (value) => {
          s.apiToken = value.trim();
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Namespace")
      .setDesc("Created if it does not exist. default is fine.")
      .addText((text) =>
        text.setValue(s.namespace).onChange(async (value) => {
          s.namespace = value.trim() || "default";
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Repository name")
      .setDesc("Created if it does not exist. Leave empty to use a name made from the vault name.")
      .addText((text) =>
        text.setPlaceholder(this.plugin.suggestedRepoName()).setValue(s.repoName).onChange(async (value) => {
          s.repoName = value.trim();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Set up a new repository (first device)")
      .setDesc(
        "Creates the namespace and repository if needed, issues a 30-day write token, and fills in the fields below. " +
          "Do this on one device only. On every other device use \"Connect to an existing repository\".",
      )
      .addButton((button) =>
        button.setCta().setButtonText("Set up").onClick(async () => {
          button.setDisabled(true);
          try {
            await this.plugin.setupRepository();
          } finally {
            button.setDisabled(false);
            this.display();
          }
        }),
      );

    new Setting(containerEl)
      .setName("Connect to an existing repository (other devices)")
      .setDesc("Lists the repositories in the namespace so you can pick the one your first device created. Issues a token for it and fills in the fields below.")
      .addButton((button) =>
        button.setButtonText("Choose repository").onClick(async () => {
          button.setDisabled(true);
          try {
            const repos = await this.plugin.listRepositories();
            if (!repos) return;
            if (repos.length === 0) {
              new Notice("Cloudflare Artifacts Sync: no repositories in this namespace yet. Press Set up on your first device.");
              return;
            }
            new RepoPickerModal(this.app, repos, (repo) => {
              void this.plugin.connectToRepository(repo).then(() => this.display());
            }).open();
          } finally {
            button.setDisabled(false);
          }
        }),
      );

    new Setting(containerEl)
      .setName("Renew the repository token automatically")
      .setDesc("Issues a new token shortly before the current one expires. Needs the API token above.")
      .addToggle((toggle) =>
        toggle.setValue(s.autoRenewToken).onChange(async (value) => {
          s.autoRenewToken = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Renew token now")
      .addButton((button) =>
        button.setButtonText("Renew").onClick(async () => {
          button.setDisabled(true);
          try {
            await this.plugin.renewToken(true);
          } finally {
            button.setDisabled(false);
            this.display();
          }
        }),
      );

    new Setting(containerEl).setName("Repository (filled by Set up, or by hand)").setHeading();

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
      .setDesc("Leave it as main unless you created the repository with another default branch. It is shown on the repository page in the dashboard. Use the same value on every device.")
      .addText((text) =>
        text.setValue(s.branch).onChange(async (value) => {
          s.branch = value.trim() || "main";
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Folder to sync")
      .setDesc(
        "Leave empty to sync the whole vault. Otherwise type a folder name exactly as it appears in Obsidian's file list " +
          "(for example Knowledge, or Projects/Notes for a subfolder). Use the same value on every device. " +
          "A large vault syncs faster when you pick one folder.",
      )
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

    new Setting(containerEl).setName("Sync behavior").setHeading();
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

    new Setting(containerEl).setName("Recovery").setHeading();
    let armed = false;
    new Setting(containerEl)
      .setName("Reset local history (keep notes)")
      .setDesc(
        "Removes this folder's hidden .git history and nothing else. Use it after syncing to the wrong repository: " +
          "connect to the right one above, press this, then Sync now. The next sync starts from the repository's history.",
      )
      .addButton((button) =>
        button.setWarning().setButtonText("Reset").onClick(async () => {
          if (!armed) {
            armed = true;
            button.setButtonText("Press again to confirm");
            window.setTimeout(() => {
              armed = false;
              button.setButtonText("Reset");
            }, 8_000);
            return;
          }
          armed = false;
          button.setDisabled(true);
          try {
            await this.plugin.resetLocalHistory();
          } finally {
            button.setDisabled(false);
            button.setButtonText("Reset");
          }
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
