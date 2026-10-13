/**
 * Desktop file system and HTTP for isomorphic-git (Node). Kept in its own module so the mobile
 * build path never touches Node modules at import time.
 *
 * The HTTP client is a small one over Node's https, instead of isomorphic-git's bundled client
 * (simple-get), whose socket timeout aborted the first push of a large vault with
 * "Request timed out". A push is one long request, so no inactivity timeout is set here.
 */
import fs from "node:fs";
import path from "node:path";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { GitFs, GitHttp } from "./git";
import { collectBody, type GitHttpRequest, type GitHttpResponse } from "./obsidian-http";

export function nodeFs(): GitFs {
  return fs as unknown as GitFs;
}

export function nodeHttp(): GitHttp {
  return {
    async request(req: GitHttpRequest): Promise<GitHttpResponse> {
      const body = await collectBody(req.body);
      const url = new URL(req.url);
      const lib = url.protocol === "http:" ? httpRequest : httpsRequest;
      return new Promise<GitHttpResponse>((resolve, reject) => {
        // agent: false → one connection per request, closed when done. Node's default agent keeps
        // sockets alive, which keeps scripts (and tests) from exiting; the plugin makes a few
        // requests per sync, so a fresh connection each time costs nothing noticeable.
        const r = lib(url, { method: req.method ?? "GET", headers: req.headers ?? {}, agent: false }, (res) => {
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (v !== undefined) headers[k] = Array.isArray(v) ? v.join(", ") : v;
          }
          resolve({
            url: req.url,
            method: req.method,
            statusCode: res.statusCode ?? 0,
            statusMessage: res.statusMessage ?? "",
            headers,
            body: res as unknown as AsyncIterableIterator<Uint8Array>,
          });
        });
        r.on("error", reject);
        if (body) r.end(body);
        else r.end();
      });
    },
  };
}

export function joinPath(base: string, folder: string): string {
  return path.join(base, folder);
}
