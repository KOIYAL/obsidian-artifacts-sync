import { describe, expect, it } from "vitest";
import { ArtifactsApi, ArtifactsApiError, pickExpiry, pickToken, repoNameFromVault } from "./api";

const ACCOUNT = "0123456789abcdef0123456789abcdef";

function fakeFetch(routes: Record<string, (init?: RequestInit) => { status: number; body: unknown }>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const key = `${init?.method ?? "GET"} ${url.replace(/^https:\/\/api\.cloudflare\.com\/client\/v4/, "")}`;
    const handler = routes[key];
    if (!handler) return new Response(JSON.stringify({ success: false, errors: [{ code: 7000, message: "No route" }] }), { status: 404 });
    const { status, body } = handler(init);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

describe("pickToken and pickExpiry", () => {
  it("reads the token under any of the known keys and the expiry from its suffix", () => {
    expect(pickToken({ token: "art_v2_x_abc?expires=1791714567" })).toBe("art_v2_x_abc?expires=1791714567");
    expect(pickToken({ plaintext: "art_v1_abc" })).toBe("art_v1_abc");
    expect(pickToken({ token: "not-a-token" })).toBeNull();
    expect(pickExpiry({}, "art_v2_x_abc?expires=1791714567")).toBe(1791714567000);
    expect(pickExpiry({ expires_at: "2026-10-11T00:00:00Z" }, "art_v1_abc")).toBe(Date.parse("2026-10-11T00:00:00Z"));
    expect(pickExpiry({ expires_at: 1791714567 }, null)).toBe(1791714567000);
    expect(pickExpiry({}, null)).toBeNull();
  });
});

describe("ArtifactsApi", () => {
  const base = `/accounts/${ACCOUNT}/artifacts/namespaces`;

  it("creates the namespace and repository when missing, then issues a token", async () => {
    const calls: string[] = [];
    const api = new ArtifactsApi({
      accountId: ACCOUNT,
      apiToken: "cf-api-token",
      fetchImpl: fakeFetch({
        [`POST ${base}`]: () => { calls.push("ns"); return { status: 200, body: { success: true, result: { namespace: "default" } } }; },
        [`GET ${base}/default/repos/my-vault`]: () => ({ status: 404, body: { success: false, errors: [{ code: 10007, message: "not found" }] } }),
        [`POST ${base}/default/repos`]: (init) => {
          calls.push(`repo:${JSON.parse(String(init?.body)).name}`);
          return { status: 200, body: { success: true, result: { name: "my-vault", remote: `https://${ACCOUNT}.artifacts.cloudflare.net/git/default/my-vault.git`, token: "art_v2_x_initial?expires=1" } } };
        },
        [`POST ${base}/default/tokens`]: (init) => {
          const body = JSON.parse(String(init?.body));
          calls.push(`token:${body.repo}:${body.scope}:${body.ttl}`);
          // Real shape (2026-10): bare secret in `plaintext`, ISO `expires_at`.
          return { status: 200, body: { success: true, result: { id: "t1", plaintext: "art_v2_x_write", scope: "write", expires_at: "2026-10-11T00:00:00.000Z" } } };
        },
      }),
    });
    await api.ensureNamespace("default");
    const repo = await api.ensureRepo("default", "my-vault");
    expect(repo.remote).toContain("/git/default/my-vault.git");
    const token = await api.issueToken("default", "my-vault");
    const expiresAt = Date.parse("2026-10-11T00:00:00.000Z");
    expect(token).toEqual({ token: `art_v2_x_write?expires=${Math.floor(expiresAt / 1000)}`, expiresAt });
    expect(calls).toEqual(["ns", "repo:my-vault", "token:my-vault:write:2592000"]);
  });

  it("treats an existing namespace as success and reuses an existing repository", async () => {
    const api = new ArtifactsApi({
      accountId: ACCOUNT,
      apiToken: "cf-api-token",
      fetchImpl: fakeFetch({
        [`POST ${base}`]: () => ({ status: 409, body: { success: false, errors: [{ code: 1, message: "namespace already exists" }] } }),
        [`GET ${base}/default/repos/my-vault`]: () => ({ status: 200, body: { success: true, result: { name: "my-vault", remote: "https://x.artifacts.cloudflare.net/git/default/my-vault.git" } } }),
      }),
    });
    await expect(api.ensureNamespace("default")).resolves.toBeUndefined();
    await expect(api.ensureRepo("default", "my-vault")).resolves.toEqual({ name: "my-vault", remote: "https://x.artifacts.cloudflare.net/git/default/my-vault.git" });
  });

  it("surfaces API errors with their message", async () => {
    const api = new ArtifactsApi({
      accountId: ACCOUNT,
      apiToken: "bad",
      fetchImpl: fakeFetch({ [`GET ${base}`]: () => ({ status: 401, body: { success: false, errors: [{ code: 10000, message: "Authentication error" }] } }) }),
    });
    await expect(api.listNamespaces()).rejects.toThrow(ArtifactsApiError);
    await expect(api.listNamespaces()).rejects.toThrow(/Authentication error/);
  });
});

describe("repoNameFromVault", () => {
  it("makes a safe repository name", () => {
    expect(repoNameFromVault("My Vault 2026")).toBe("my-vault-2026");
    expect(repoNameFromVault("シェバ知識")).toBe("obsidian-vault");
    expect(repoNameFromVault("--Notes.v2--")).toBe("notes.v2");
  });
});
