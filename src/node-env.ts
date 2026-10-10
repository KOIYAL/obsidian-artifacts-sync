/**
 * Desktop file system and HTTP for isomorphic-git (Node). Kept in its own module so the mobile
 * build path never touches Node modules at import time.
 */
import fs from "node:fs";
import path from "node:path";
import http from "isomorphic-git/http/node";
import type { GitFs, GitHttp } from "./git";

export function nodeFs(): GitFs {
  return fs as unknown as GitFs;
}

export function nodeHttp(): GitHttp {
  return http as unknown as GitHttp;
}

export function joinPath(base: string, folder: string): string {
  return path.join(base, folder);
}
