/**
 * An isomorphic-git HTTP client built on Obsidian's `requestUrl`, which works on mobile and is not
 * subject to the web view's CORS rules. Request and response bodies are buffered in memory, which
 * is fine for a vault of notes.
 */

export interface RequestUrlLike {
  (params: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string | ArrayBuffer;
    throw?: boolean;
  }): Promise<{ status: number; headers: Record<string, string>; arrayBuffer: ArrayBuffer }>;
}

export interface GitHttpRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: AsyncIterableIterator<Uint8Array> | Iterable<Uint8Array> | Uint8Array[];
  onProgress?: unknown;
  signal?: unknown;
}

export interface GitHttpResponse {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: AsyncIterableIterator<Uint8Array> | Uint8Array[];
  statusCode: number;
  statusMessage: string;
}

async function collect(body: GitHttpRequest["body"]): Promise<Uint8Array | undefined> {
  if (!body) return undefined;
  const chunks: Uint8Array[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) chunks.push(chunk);
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

export function createRequestUrlHttp(requestUrl: RequestUrlLike) {
  return {
    async request(req: GitHttpRequest): Promise<GitHttpResponse> {
      const bytes = await collect(req.body);
      const res = await requestUrl({
        url: req.url,
        method: req.method ?? "GET",
        headers: req.headers ?? {},
        body: bytes ? (bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer) : undefined,
        throw: false,
      });
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(res.headers ?? {})) headers[k.toLowerCase()] = v;
      return {
        url: req.url,
        method: req.method,
        headers,
        body: [new Uint8Array(res.arrayBuffer)],
        statusCode: res.status,
        statusMessage: res.status >= 200 && res.status < 300 ? "OK" : `HTTP ${res.status}`,
      };
    },
  };
}
