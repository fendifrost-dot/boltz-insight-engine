import { SquareApiError } from "./errors.ts";
import { SQUARE_VERSION } from "./version.ts";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type SquareHttp = {
  request(
    method: string,
    path: string,
    opts?: { query?: Record<string, string | undefined>; body?: unknown },
  ): Promise<unknown>;
};

const READ_POST_PATHS = new Set([
  "/v2/orders/search",
  "/v2/invoices/search",
  "/v2/customers/search",
]);

/** This client is read/sync only. Payment and invoice creation stay out. */
export function assertSquareReadOnly(method: string, path: string): void {
  const bare = path.split("?")[0] ?? path;
  if (method === "GET") return;
  if (method === "POST" && READ_POST_PATHS.has(bare)) return;
  throw new SquareApiError(0, "CLIENT", "WRITE_BLOCKED");
}

function errorFromBody(status: number, text: string): SquareApiError {
  try {
    const parsed = JSON.parse(text) as { errors?: { category?: string; code?: string }[] };
    const first = parsed.errors?.[0];
    return new SquareApiError(status, first?.category ?? "HTTP", first?.code ?? "HTTP_ERROR");
  } catch {
    return new SquareApiError(status, "HTTP", "HTTP_ERROR");
  }
}

function retryDelayMs(response: Response, attempt: number): number {
  const header = response.headers.get("retry-after");
  if (header && /^\d+$/.test(header.trim())) {
    return Math.min(Number(header.trim()) * 1000, 5_000);
  }
  return Math.min(200 * 2 ** attempt, 1_600);
}

export function createSquareHttp(options: {
  accessToken: string;
  baseUrl: string;
  version?: string;
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
}): SquareHttp {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const maxAttempts = options.maxAttempts ?? 4;
  const version = options.version ?? SQUARE_VERSION;

  return {
    async request(method, path, opts) {
      assertSquareReadOnly(method, path);
      const url = new URL(path.startsWith("http") ? path : `${options.baseUrl}${path}`);
      for (const [key, value] of Object.entries(opts?.query ?? {})) {
        if (value) url.searchParams.set(key, value);
      }

      let last: SquareApiError | null = null;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const response = await fetchImpl(url.toString(), {
          method,
          headers: {
            Authorization: `Bearer ${options.accessToken}`,
            "Square-Version": version,
            Accept: "application/json",
            ...(opts?.body !== undefined ? { "Content-Type": "application/json" } : {}),
          },
          ...(opts?.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
        });

        if (response.ok) {
          const text = await response.text();
          if (!text) return {};
          try {
            return JSON.parse(text) as unknown;
          } catch {
            throw new SquareApiError(response.status, "RESPONSE", "INVALID_JSON");
          }
        }

        const text = await response.text();
        last = errorFromBody(response.status, text);
        if (!last.retryable || attempt === maxAttempts - 1) throw last;
        await sleep(retryDelayMs(response, attempt));
      }
      throw last ?? new SquareApiError(0, "UNKNOWN", "NO_RESPONSE");
    },
  };
}

export async function collectCursorPages<T>(args: {
  maxPages: number;
  load: (cursor: string | undefined) => Promise<{ items: T[]; cursor: string | null }>;
}): Promise<{ items: T[]; truncated: boolean }> {
  const items: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < args.maxPages; page += 1) {
    const result = await args.load(cursor);
    items.push(...result.items);
    if (!result.cursor) return { items, truncated: false };
    cursor = result.cursor;
  }
  return { items, truncated: true };
}
