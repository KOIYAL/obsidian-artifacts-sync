/**
 * A DataAdapter look-alike backed by a folder on disk, mirroring Obsidian's path conventions
 * (vault-relative, forward slashes, `list()` returns full relative paths). Used by the unit tests
 * and by the mobile end-to-end script; never shipped in the plugin.
 */
import fs from "node:fs";
import path from "node:path";
import type { AdapterLike } from "../src/vault-fs";

export function fakeAdapter(root: string): AdapterLike {
  const abs = (p: string) => path.join(root, p);
  return {
    async exists(p) {
      return fs.existsSync(abs(p));
    },
    async stat(p) {
      try {
        const s = fs.statSync(abs(p));
        return { type: s.isDirectory() ? "folder" : "file", ctime: s.ctimeMs, mtime: s.mtimeMs, size: s.size };
      } catch {
        return null;
      }
    },
    async list(p) {
      const entries = fs.readdirSync(abs(p), { withFileTypes: true });
      const prefix = p ? `${p}/` : "";
      return {
        files: entries.filter((e) => e.isFile()).map((e) => `${prefix}${e.name}`),
        folders: entries.filter((e) => e.isDirectory()).map((e) => `${prefix}${e.name}`),
      };
    },
    async readBinary(p) {
      const b = fs.readFileSync(abs(p));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    },
    async writeBinary(p, data) {
      fs.mkdirSync(path.dirname(abs(p)), { recursive: true });
      fs.writeFileSync(abs(p), new Uint8Array(data));
    },
    async mkdir(p) {
      fs.mkdirSync(abs(p));
    },
    async remove(p) {
      fs.unlinkSync(abs(p));
    },
    async rmdir(p, recursive) {
      if (recursive) fs.rmSync(abs(p), { recursive: true, force: false });
      else fs.rmdirSync(abs(p));
    },
  };
}
