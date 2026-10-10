import { describe, expect, it } from "vitest";
import { createRequestUrlHttp, type RequestUrlLike } from "./obsidian-http";

describe("createRequestUrlHttp", () => {
  it("buffers the request body, forwards headers, and returns status and body chunks", async () => {
    let seen: Parameters<RequestUrlLike>[0] | null = null;
    const requestUrl: RequestUrlLike = async (params) => {
      seen = params;
      return { status: 401, headers: { "Content-Type": "text/plain" }, arrayBuffer: new TextEncoder().encode("nope").buffer as ArrayBuffer };
    };
    const http = createRequestUrlHttp(requestUrl);
    async function* body() {
      yield new Uint8Array([1, 2]);
      yield new Uint8Array([3]);
    }
    const res = await http.request({ url: "https://x.artifacts.cloudflare.net/git/default/r.git/info/refs", method: "POST", headers: { authorization: "Basic abc" }, body: body() });
    expect(seen).not.toBeNull();
    expect(seen!.method).toBe("POST");
    expect(seen!.headers).toEqual({ authorization: "Basic abc" });
    expect(Array.from(new Uint8Array(seen!.body as ArrayBuffer))).toEqual([1, 2, 3]);
    expect(seen!.throw).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(res.headers).toEqual({ "content-type": "text/plain" });
    expect(new TextDecoder().decode((res.body as Uint8Array[])[0])).toBe("nope");
  });
});
