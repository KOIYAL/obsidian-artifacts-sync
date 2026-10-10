/**
 * Thin wrapper over isomorphic-git for one working tree (the vault or a folder inside it).
 * Desktop only: uses Node's fs on the vault's real path. All network traffic goes to the single
 * Artifacts remote the user configured.
 */
import fs from "node:fs";
import path from "node:path";
import git from "isomorphic-git";
import http from "isomorphic-git/http/node";
import { authFor, commitMessage, planChanges, type StatusRow } from "./core";

export interface GitOptions {
  /** Absolute path of the working tree. */
  dir: string;
  remoteUrl: string;
  token: string;
  branch: string;
  ignore: readonly string[];
  author: { name: string; email: string };
}

export interface SyncResult {
  committed: boolean;
  added: number;
  removed: number;
  pulled: boolean;
  pushed: boolean;
  head: string | null;
}

export class GitConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitConflictError";
  }
}

const REMOTE_NAME = "origin";

export class ArtifactsGit {
  constructor(private readonly opts: GitOptions) {}

  private get onAuth() {
    const auth = authFor(this.opts.token);
    return () => auth;
  }

  private get base() {
    return { fs, dir: this.opts.dir };
  }

  /** Make sure the folder is a repository pointing at the configured remote and branch. */
  async ensureRepo(): Promise<void> {
    const { dir, branch, remoteUrl } = this.opts;
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(path.join(dir, ".git"))) {
      await git.init({ ...this.base, defaultBranch: branch });
    }
    const remotes = await git.listRemotes(this.base);
    const origin = remotes.find((r) => r.remote === REMOTE_NAME);
    if (!origin) {
      await git.addRemote({ ...this.base, remote: REMOTE_NAME, url: remoteUrl });
    } else if (origin.url !== remoteUrl) {
      await git.deleteRemote({ ...this.base, remote: REMOTE_NAME });
      await git.addRemote({ ...this.base, remote: REMOTE_NAME, url: remoteUrl });
    }
    // Point HEAD at the configured branch. With no commits yet there is nothing to check out, so
    // only the symbolic ref changes; with commits, switch (creating the branch if needed).
    const current = await git.currentBranch({ ...this.base, fullname: false }).catch(() => undefined);
    if (current !== branch) {
      const head = await this.head();
      if (!head) {
        fs.writeFileSync(path.join(dir, ".git", "HEAD"), `ref: refs/heads/${branch}\n`);
      } else {
        const branches = await git.listBranches(this.base);
        if (!branches.includes(branch)) await git.branch({ ...this.base, ref: branch, checkout: true });
        else await git.checkout({ ...this.base, ref: branch });
      }
    }
  }

  async head(): Promise<string | null> {
    return git.resolveRef({ ...this.base, ref: "HEAD" }).catch(() => null);
  }

  /**
   * First sync into a folder that has no commits yet: take the remote branch as the starting point
   * (files already in the folder stay and are committed on top). Returns true when adopted.
   */
  async adoptRemoteIfEmpty(): Promise<boolean> {
    if (await this.head()) return false;
    if (!(await this.remoteHasBranch())) return false;
    await git.fetch({
      ...this.base,
      http,
      remote: REMOTE_NAME,
      ref: this.opts.branch,
      singleBranch: true,
      onAuth: this.onAuth,
    });
    await git.checkout({ ...this.base, ref: this.opts.branch, remote: REMOTE_NAME });
    return true;
  }

  /** Stage every change (respecting the ignore list) and commit. Returns counts; 0/0 means nothing to commit. */
  async commitAll(now = new Date()): Promise<{ added: number; removed: number; committed: boolean }> {
    const matrix = (await git.statusMatrix({ ...this.base })) as StatusRow[];
    const { add, remove } = planChanges(matrix, this.opts.ignore);
    for (const filepath of add) await git.add({ ...this.base, filepath });
    for (const filepath of remove) await git.remove({ ...this.base, filepath });
    if (add.length === 0 && remove.length === 0) return { added: 0, removed: 0, committed: false };
    await git.commit({
      ...this.base,
      message: commitMessage(add.length, remove.length, now),
      author: this.opts.author,
    });
    return { added: add.length, removed: remove.length, committed: true };
  }

  /** Does the remote have the branch at all? (A brand-new repository has no refs.) */
  private async remoteHasBranch(): Promise<boolean> {
    const refs = await git.listServerRefs({
      http,
      url: this.opts.remoteUrl,
      prefix: `refs/heads/${this.opts.branch}`,
      onAuth: this.onAuth,
    });
    return refs.some((r) => r.ref === `refs/heads/${this.opts.branch}`);
  }

  /** Fetch and merge the remote branch. Fast-forward when possible, otherwise a merge commit. */
  async pull(): Promise<boolean> {
    if (await this.adoptRemoteIfEmpty()) return true;
    if (!(await this.remoteHasBranch())) return false;
    const before = await this.head();
    if (!before) return false; // nothing local and nothing remote: a brand-new repository
    try {
      await git.pull({
        ...this.base,
        http,
        remote: REMOTE_NAME,
        ref: this.opts.branch,
        singleBranch: true,
        onAuth: this.onAuth,
        author: this.opts.author,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/merge|conflict/i.test(message)) {
        throw new GitConflictError(
          "The remote has changes that conflict with yours. Resolve them with a Git client, then sync again.",
        );
      }
      throw err;
    }
    const after = await this.head();
    return before !== after;
  }

  async push(): Promise<boolean> {
    const res = await git.push({
      ...this.base,
      http,
      remote: REMOTE_NAME,
      ref: this.opts.branch,
      onAuth: this.onAuth,
    });
    if (!res.ok) throw new Error(res.error ?? "Push failed");
    return true;
  }

  /**
   * Commit local changes, pull, then push. On the very first sync of a folder the remote branch is
   * adopted first, so existing notes land on top of the remote history instead of forming an
   * unrelated one.
   */
  async sync(now = new Date()): Promise<SyncResult> {
    await this.ensureRepo();
    const adopted = await this.adoptRemoteIfEmpty();
    const commit = await this.commitAll(now);
    const pulled = adopted || (await this.pull());
    const pushed = await this.push();
    return { ...commit, pulled, pushed, head: await this.head() };
  }
}
