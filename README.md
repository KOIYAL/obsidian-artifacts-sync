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

This plugin talks only to the Artifacts remote URL you configure (`https://<account>.artifacts.cloudflare.net/…`), using the repository token you paste. It sends your note contents there and nowhere else. There is no telemetry.

The token is stored in this vault's plugin data (`.obsidian/plugins/cloudflare-artifacts-sync/data.json`), like other sync plugins store credentials. Use a repository-scoped write token and issue a new one when it expires.

## Setup

1. In the Cloudflare dashboard open **Storage & databases → Artifacts**, create a namespace (or use `default`) and a repository. Copy its **remote URL** and issue a **write token**. (Artifacts needs the Workers Paid plan; see Cloudflare's pricing.)
2. In Obsidian, install the plugin and open its settings. Paste the remote URL and the token. Choose a branch (default `main`) and, optionally, a folder to sync.
3. Run **Sync now** from the command palette. The first run creates the repository contents.

## When two places edit the same note

If the remote changed a note that you also edited (or deleted) since your last sync, the plugin stops before pushing and shows a notice. Nothing is overwritten. Resolve it with any Git client (or copy the note aside, delete the folder's `.git`, sync again, and paste your version back). Automatic "keep both versions" handling is planned.

## Requirements and limits

- Desktop only (uses the vault's folder on disk).
- Repository size up to 1 GB and files up to 32 MB (Artifacts limits).
- Tokens expire; the settings page shows the remaining time.

## Development

```sh
npm install
npm run build     # type-check and bundle to main.js
npm test          # unit tests for the pure logic
```

## 日本語

Obsidian の保管庫（またはその中の 1 フォルダ）を Cloudflare Artifacts のリポジトリと同期します。Git の知識は不要で、remote URL とトークンを貼って「Sync now」を押すだけです。

- 通信先は設定した Artifacts の URL だけです。ノートの内容をそこへ送ります。その他の送信や計測はありません。
- トークンはこの保管庫のプラグイン設定（`.obsidian/plugins/cloudflare-artifacts-sync/data.json`）に保存されます。リポジトリ単位の書き込みトークンを使い、期限が切れたら発行し直してください。
- 手順: Cloudflare ダッシュボード → Storage & databases → Artifacts でリポジトリを作り、remote URL と書き込みトークンを取る → プラグイン設定に貼る → コマンドパレットで「Sync now」。
- デスクトップ版のみ。リモートと衝突したときは上書きせずに止まり、Git クライアントでの解決を案内します。
