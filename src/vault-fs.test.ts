import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createVaultFs, vaultPath } from "./vault-fs";
import { fakeAdapter } from "../scripts/fake-adapter";

describe("vaultPath", () => {
  it("normalizes separators and relative segments", () => {
    expect(vaultPath("./a//b/")).toBe("a/b");
    expect(vaultPath("/a\\b\\c")).toBe("a/b/c");
    expect(vaultPath("a/./x/../b")).toBe("a/b");
    expect(vaultPath(".")).toBe("");
  });
});

describe("createVaultFs", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "vault-fs-"));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("writes, reads (bytes and text), lists, stats and removes", async () => {
    const vfs = createVaultFs(fakeAdapter(root)).promises;
    await vfs.writeFile("notes/a.md", "# hello");
    await vfs.writeFile(".git/objects/ab/cdef", new Uint8Array([1, 2, 3]));
    expect(await vfs.readFile("notes/a.md", "utf8")).toBe("# hello");
    expect(Array.from((await vfs.readFile(".git/objects/ab/cdef")) as Uint8Array)).toEqual([1, 2, 3]);
    expect((await vfs.readdir("notes")).sort()).toEqual(["a.md"]);
    expect((await vfs.readdir("")).sort()).toEqual([".git", "notes"]);
    const s = await vfs.stat("notes/a.md");
    expect(s.isFile()).toBe(true);
    expect(s.isDirectory()).toBe(false);
    expect(s.size).toBe(7);
    expect((await vfs.stat("notes")).isDirectory()).toBe(true);
    await vfs.unlink("notes/a.md");
    await vfs.rmdir("notes");
    expect((await vfs.readdir("")).sort()).toEqual([".git"]);
  });

  it("reports ENOENT the way isomorphic-git expects", async () => {
    const vfs = createVaultFs(fakeAdapter(root)).promises;
    await expect(vfs.stat("missing")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(vfs.readFile("missing")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(vfs.readdir("missing")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(vfs.unlink("missing")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(vfs.readlink("x")).rejects.toMatchObject({ code: "ENOSYS" });
  });

  it("creates parent folders on write and refuses to recreate an existing folder", async () => {
    const vfs = createVaultFs(fakeAdapter(root)).promises;
    await vfs.mkdir("a/b/c");
    expect((await vfs.stat("a/b/c")).isDirectory()).toBe(true);
    await expect(vfs.mkdir("a/b/c")).rejects.toMatchObject({ code: "EEXIST" });
  });
});
