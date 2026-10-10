# Cloudflare Artifacts Sync

Sync your Obsidian vault, or one folder of it, with a [Cloudflare Artifacts](https://developers.cloudflare.com/artifacts/) repository. Artifacts is Cloudflare's versioned file store that speaks Git, so your notes get history and an off-device copy without a GitHub account.

One command (or a timer) does commit → pull → push. No Git knowledge is needed: paste a remote URL and a token, and press **Sync now**.

日本語の説明は下にあります。

## What it does

- Commits every change in the chosen folder (new, modified and deleted files), pulls what others pushed, then pushes.
- Fast-forwards when it can and makes a merge commit otherwise. If the remote conflicts with your edits, it stops and tells you to resolve with a Git client (no data is overwritten).
- Optional automatic sync on a timer and shortly after a note changes.
- Ignores the `.obsidian` folder and trash by default (configurable).

## Network use

This plugin talks to two Cloudflare endpoints and nothing else:

- the Artifacts remote URL you configure (`https://<account>.artifacts.cloudflare.net/…`), where your note contents are pushed and pulled with the repository token;
- `https://api.cloudflare.com` with your Cloudflare API token, only when you press **Set up** or when a repository token is renewed.

There is no telemetry. Tokens are stored in this vault's plugin data (`.obsidian/plugins/cloudflare-artifacts-sync/data.json`), like other sync plugins store credentials.

## Setup (no command line needed)

1. Create a Cloudflare API token once: dashboard → **My profile → API tokens → Create token → Create custom token**, permission **Account / Artifacts / Edit**, scoped to your account. Copy the token. (Artifacts needs the Workers Paid plan; see Cloudflare's pricing.)
2. In Obsidian, install the plugin, open its settings and paste your **Account ID** and the **API token**. Leave the namespace as `default` and the repository name empty (the vault name is used), or choose your own.
3. Press **Set up**. The plugin creates the namespace and repository if needed, issues a 30-day write token and fills in the remote URL and token. Tokens are renewed automatically while the API token is present.
4. Run **Sync now** from the command palette. Optionally set an automatic sync interval.

If you prefer not to store an API token, you can instead paste a remote URL and a repository token by hand (from the dashboard or `wrangler artifacts repos issue-token`). You will then need to paste a new token when it expires.

## When two places edit the same note

If the remote changed a note that you also edited (or deleted) since your last sync, the plugin stops before pushing and shows a notice. Nothing is overwritten. Resolve it with any Git client (or copy the note aside, delete the folder's `.git`, sync again, and paste your version back). Automatic "keep both versions" handling is planned.

## Desktop and mobile

- Desktop uses the vault's folder on disk with Node's file system (fast).
- Mobile (iOS and Android) uses Obsidian's own file access and `requestUrl`, so no Git client or Node is needed. The `.git` folder lives inside the synced folder; Obsidian hides it. Large vaults sync more slowly on a phone, so pick one folder to sync there.
- Both sides use the same Git engine (isomorphic-git), so a vault can be synced from a laptop and a phone alternately.

## Requirements and limits

- Repository size up to 1 GB and files up to 32 MB (Artifacts limits).
- Tokens expire; the settings page shows the remaining time, and they renew automatically when an API token is set.

## Development

```sh
npm install
npm run build     # type-check and bundle to main.js
npm test          # unit tests (pure logic, vault file system, requestUrl client, REST client)
# Opt-in checks against a real Artifacts repository:
ARTIFACTS_REMOTE=… ARTIFACTS_TOKEN=… npm run e2e          # desktop code path
ARTIFACTS_REMOTE=… ARTIFACTS_TOKEN=… npm run e2e:mobile   # mobile code path (adapter fs + requestUrl)
ARTIFACTS_REMOTE=… ARTIFACTS_TOKEN=… npm run e2e:bundle   # the built main.js in simulated desktop and mobile Obsidian
CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… npm run e2e:api   # REST client: namespace, repo, token, push
```

## 日本語

Obsidian の保管庫（またはその中の 1 フォルダ）を Cloudflare Artifacts のリポジトリと同期します。Git の知識は不要で、remote URL とトークンを貼って「Sync now」を押すだけです。

- 通信先は、設定した Artifacts の URL（ノートの内容を送る）と、準備・トークン更新のときだけ使う api.cloudflare.com の 2 つです。その他の送信や計測はありません。
- トークンはこの保管庫のプラグイン設定（`.obsidian/plugins/cloudflare-artifacts-sync/data.json`）に保存されます。
- 手順（コマンド不要）: ① Cloudflare ダッシュボード → マイプロフィール → API トークン → トークンを作成 → カスタムトークン（権限: アカウント / Artifacts / 編集）で API トークンを 1 つ作る ② プラグイン設定にアカウント ID と API トークンを貼る ③「Set up」を押す（名前空間とリポジトリを作り、30 日有効の書き込みトークンを発行して自動で入れます。期限前に自動更新） ④ コマンドパレットで「Sync now」。
- デスクトップとスマホ（iOS / Android）の両方で動きます。スマホでは Obsidian のファイル機能と通信機能だけで同期するので、Git の道具は要りません。大きな保管庫はスマホでは遅くなるので、同期するフォルダを 1 つに絞るのがおすすめです。
- リモートと衝突したときは上書きせずに止まり、Git クライアントでの解決を案内します。
