/**
 * A file system for isomorphic-git built on Obsidian's DataAdapter, so the plugin works on mobile
 * (no Node fs there). Paths are vault-relative with forward slashes; the `.git` folder lives inside
 * the synced folder like it does on desktop.
 *
 * Only the subset isomorphic-git uses is implemented: readFile, writeFile, unlink, readdir, mkdir,
 * rmdir, stat, lstat (same as stat), readlink and symlink (unsupported: ENOSYS).
 */

/** The DataAdapter methods we rely on (a structural type, so tests can supply a fake). */
export interface AdapterLike {
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<{ type: "file" | "folder"; ctime: number; mtime: number; size: number } | null>;
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
  readBinary(path: string): Promise<ArrayBuffer>;
  writeBinary(path: string, data: ArrayBuffer): Promise<void>;
  mkdir(path: string): Promise<void>;
  remove(path: string): Promise<void>;
  rmdir(path: string, recursive: boolean): Promise<void>;
}

export interface VaultStat {
  type: "file" | "dir" | "symlink";
  mode: number;
  size: number;
  ino: number;
  mtimeMs: number;
  ctimeMs: number;
  uid: number;
  gid: number;
  dev: number;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

class FsError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "FsError";
  }
}

/** Normalize to a vault-relative path: forward slashes, no leading "./" or "/", no trailing "/". */
export function vaultPath(p: string): string {
  let out = p.replace(/\\/g, "/");
  out = out.replace(/\/+/g, "/");
  while (out.startsWith("./")) out = out.slice(2);
  out = out.replace(/^\/+/, "").replace(/\/+$/, "");
  // Collapse "a/./b" and "a/x/../b".
  const parts: string[] = [];
  for (const seg of out.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

function parentOf(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toUint8(data: string | Uint8Array | ArrayBuffer): Uint8Array {
  if (typeof data === "string") return encoder.encode(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return data;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function createVaultFs(adapter: AdapterLike) {
  const statOf = async (p: string): Promise<VaultStat> => {
    const s = await adapter.stat(p);
    if (!s) throw new FsError("ENOENT", `ENOENT: no such file or directory, stat '${p}'`);
    const isDir = s.type === "folder";
    return {
      type: isDir ? "dir" : "file",
      mode: isDir ? 0o40755 : 0o100644,
      size: s.size,
      ino: 0,
      mtimeMs: s.mtime,
      ctimeMs: s.ctime,
      uid: 0,
      gid: 0,
      dev: 0,
      isFile: () => !isDir,
      isDirectory: () => isDir,
      isSymbolicLink: () => false,
    };
  };

  const mkdirp = async (p: string): Promise<void> => {
    if (p === "" || (await adapter.exists(p))) return;
    await mkdirp(parentOf(p));
    await adapter.mkdir(p);
  };

  const promises = {
    async readFile(path: string, options?: string | { encoding?: string }): Promise<Uint8Array | string> {
      const p = vaultPath(path);
      if (!(await adapter.exists(p))) throw new FsError("ENOENT", `ENOENT: no such file or directory, open '${p}'`);
      const s = await adapter.stat(p);
      if (s?.type === "folder") throw new FsError("EISDIR", `EISDIR: illegal operation on a directory, read '${p}'`);
      const bytes = new Uint8Array(await adapter.readBinary(p));
      const encoding = typeof options === "string" ? options : options?.encoding;
      return encoding ? decoder.decode(bytes) : bytes;
    },

    async writeFile(path: string, data: string | Uint8Array | ArrayBuffer): Promise<void> {
      const p = vaultPath(path);
      await mkdirp(parentOf(p));
      await adapter.writeBinary(p, toArrayBuffer(toUint8(data)));
    },

    async unlink(path: string): Promise<void> {
      const p = vaultPath(path);
      if (!(await adapter.exists(p))) throw new FsError("ENOENT", `ENOENT: no such file or directory, unlink '${p}'`);
      await adapter.remove(p);
    },

    async readdir(path: string): Promise<string[]> {
      const p = vaultPath(path);
      const s = await adapter.stat(p);
      if (!s && p !== "") throw new FsError("ENOENT", `ENOENT: no such file or directory, scandir '${p}'`);
      if (s && s.type !== "folder") throw new FsError("ENOTDIR", `ENOTDIR: not a directory, scandir '${p}'`);
      const listing = await adapter.list(p);
      const names = [...listing.files, ...listing.folders].map((full) => full.split("/").pop() ?? full);
      return names.filter((n) => n !== "");
    },

    async mkdir(path: string): Promise<void> {
      const p = vaultPath(path);
      if (await adapter.exists(p)) throw new FsError("EEXIST", `EEXIST: file already exists, mkdir '${p}'`);
      await mkdirp(p);
    },

    async rmdir(path: string): Promise<void> {
      const p = vaultPath(path);
      if (!(await adapter.exists(p))) throw new FsError("ENOENT", `ENOENT: no such file or directory, rmdir '${p}'`);
      await adapter.rmdir(p, false);
    },

    async stat(path: string): Promise<VaultStat> {
      return statOf(vaultPath(path));
    },

    async lstat(path: string): Promise<VaultStat> {
      return statOf(vaultPath(path));
    },

    async readlink(path: string): Promise<string> {
      throw new FsError("ENOSYS", `ENOSYS: symbolic links are not supported, readlink '${path}'`);
    },

    async symlink(target: string, path: string): Promise<void> {
      throw new FsError("ENOSYS", `ENOSYS: symbolic links are not supported, symlink '${path}' -> '${target}'`);
    },

    async chmod(): Promise<void> {
      // File modes are not tracked by the adapter; nothing to do.
    },
  };

  return { promises };
}

export type VaultFs = ReturnType<typeof createVaultFs>;
