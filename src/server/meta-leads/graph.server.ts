// Meta Graph API adapter (REST). Server-only: never call from the browser.
import { graphApiVersion, readMetaSecret, requireMetaSecret } from "./env.server";
import type { GraphLead, GraphLeadForm } from "./normalize";
import { hmacSha256Hex } from "./signature";

export class GraphError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: number | null,
  ) {
    super(message);
  }

  /** 190 = invalid/expired token; 102 = session; both need operator action. */
  get isAuthError(): boolean {
    return this.code === 190 || this.code === 102 || this.status === 401;
  }
}

/** Strip token-shaped values (access tokens, appsecret proofs) out of provider text. */
export function redactGraph(text: string): string {
  return text
    .replace(/access_token=[^&\s"]+/g, "access_token=[redacted]")
    .replace(/input_token=[^&\s"]+/g, "input_token=[redacted]")
    .replace(/appsecret_proof=[^&\s"]+/g, "appsecret_proof=[redacted]")
    .replace(/\bEA[A-Za-z0-9]{20,}\b/g, "[redacted-token]")
    .slice(0, 600);
}

function base(): string {
  return `https://graph.facebook.com/${graphApiVersion()}`;
}

async function graphRequest<T>(
  pathOrUrl: string,
  params: Record<string, string> = {},
  init: { method?: "GET" | "POST"; token?: string } = {},
): Promise<T> {
  const url = new URL(pathOrUrl.startsWith("https://") ? pathOrUrl : `${base()}${pathOrUrl}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (!url.searchParams.has("access_token")) {
    const token = init.token ?? requireMetaSecret("META_PAGE_ACCESS_TOKEN");
    url.searchParams.set("access_token", token);
    // appsecret_proof satisfies apps with "Require App Secret" on; harmless otherwise.
    const appSecret = readMetaSecret("META_APP_SECRET");
    if (appSecret && !init.token) {
      url.searchParams.set("appsecret_proof", await hmacSha256Hex(appSecret, token));
    }
  }
  const res = await fetch(url, {
    method: init.method ?? "GET",
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  if (!res.ok) {
    let code: number | null = null;
    let message = text;
    try {
      const parsed = JSON.parse(text) as { error?: { code?: number; message?: string } };
      code = parsed.error?.code ?? null;
      message = parsed.error?.message ?? text;
    } catch {
      // non-JSON error body
    }
    const path = url.pathname.replace(/^\/v\d+\.\d+/, "");
    throw new GraphError(
      `Graph ${path} failed (${res.status}): ${redactGraph(message)}`,
      res.status,
      code,
    );
  }
  return (text ? JSON.parse(text) : {}) as T;
}

// Field sets degrade gracefully: ad/campaign names need ads permissions some
// tokens lack, and a missing permission fails the whole request.
const LEAD_FIELD_SETS = [
  "id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,field_data,custom_disclaimer_responses,is_organic,platform",
  "id,created_time,ad_id,adset_id,campaign_id,form_id,field_data,custom_disclaimer_responses,is_organic,platform",
  "id,created_time,ad_id,form_id,field_data",
];

function isFieldOrPermissionError(error: unknown): boolean {
  return (
    error instanceof GraphError &&
    !error.isAuthError &&
    (error.code === 100 || error.code === 10 || error.code === 200)
  );
}

/** Tries each field set in order; returns the richest one the token can read. */
async function withFieldFallback<T>(
  run: (fields: string) => Promise<T>,
): Promise<{ result: T; fields: string }> {
  let lastError: unknown;
  for (const fields of LEAD_FIELD_SETS) {
    try {
      return { result: await run(fields), fields };
    } catch (error) {
      lastError = error;
      if (!isFieldOrPermissionError(error)) throw error;
    }
  }
  throw lastError;
}

export async function getLead(leadgenId: string): Promise<GraphLead> {
  const { result } = await withFieldFallback((fields) =>
    graphRequest<GraphLead>(`/${encodeURIComponent(leadgenId)}`, { fields }),
  );
  return result;
}

const formCache = new Map<string, { form: GraphLeadForm; at: number }>();

/** Form metadata + legal content (consent wording). Cached for an hour per worker. */
export async function getForm(formId: string): Promise<GraphLeadForm | null> {
  const cached = formCache.get(formId);
  if (cached && Date.now() - cached.at < 60 * 60_000) return cached.form;
  const attempts = [
    "id,name,status,locale,privacy_policy_url,legal_content",
    "id,name,status,locale",
  ];
  for (const fields of attempts) {
    try {
      const form = await graphRequest<GraphLeadForm>(`/${encodeURIComponent(formId)}`, { fields });
      formCache.set(formId, { form, at: Date.now() });
      return form;
    } catch (error) {
      if (!isFieldOrPermissionError(error)) throw error;
    }
  }
  return null;
}

type Paged<T> = { data?: T[]; paging?: { next?: string } };

async function collectPages<T>(
  first: Paged<T>,
  maxPages: number,
): Promise<{ items: T[]; truncated: boolean }> {
  const items = [...(first.data ?? [])];
  let next = first.paging?.next;
  let pages = 1;
  while (next && pages < maxPages) {
    const page = await graphRequest<Paged<T>>(next);
    items.push(...(page.data ?? []));
    next = page.paging?.next;
    pages += 1;
  }
  return { items, truncated: Boolean(next) };
}

export async function listForms(
  pageId: string,
): Promise<{ id: string; name?: string; status?: string }[]> {
  const first = await graphRequest<Paged<{ id: string; name?: string; status?: string }>>(
    `/${encodeURIComponent(pageId)}/leadgen_forms`,
    { fields: "id,name,status", limit: "100" },
  );
  return (await collectPages(first, 10)).items;
}

/** Leads created after `sinceUnix` on one form, newest first, bounded by maxPages. */
export async function listFormLeads(
  formId: string,
  sinceUnix: number,
  maxPages = 10,
): Promise<{ leads: GraphLead[]; truncated: boolean }> {
  const filtering = JSON.stringify([
    { field: "time_created", operator: "GREATER_THAN", value: sinceUnix },
  ]);
  const { result } = await withFieldFallback(async (fields) => {
    const first = await graphRequest<Paged<GraphLead>>(`/${encodeURIComponent(formId)}/leads`, {
      fields,
      filtering,
      limit: "100",
    });
    return collectPages(first, maxPages);
  });
  return { leads: result.items, truncated: result.truncated };
}

export type PageSubscription = {
  subscribed: boolean;
  fields: string[];
  appFound: boolean;
};

export async function getPageSubscription(
  pageId: string,
  appId: string,
): Promise<PageSubscription> {
  const res = await graphRequest<{ data?: { id?: string; subscribed_fields?: string[] }[] }>(
    `/${encodeURIComponent(pageId)}/subscribed_apps`,
  );
  const app = (res.data ?? []).find((a) => a.id === appId);
  const fields = app?.subscribed_fields ?? [];
  return { subscribed: fields.includes("leadgen"), fields, appFound: Boolean(app) };
}

/** Subscribes this app to the Page's leadgen field (idempotent on Meta's side). */
export async function subscribePageLeadgen(pageId: string): Promise<boolean> {
  const res = await graphRequest<{ success?: boolean }>(
    `/${encodeURIComponent(pageId)}/subscribed_apps`,
    { subscribed_fields: "leadgen" },
    { method: "POST" },
  );
  return res.success === true;
}

export type TokenDebug = {
  isValid: boolean;
  type: string | null;
  expiresAt: string | null;
  scopes: string[];
  profileId: string | null;
  error: string | null;
};

/** Inspects the Page token with an app token; never returns the token itself. */
export async function debugPageToken(): Promise<TokenDebug> {
  const appToken = `${requireMetaSecret("META_APP_ID")}|${requireMetaSecret("META_APP_SECRET")}`;
  const res = await graphRequest<{
    data?: {
      is_valid?: boolean;
      type?: string;
      expires_at?: number;
      scopes?: string[];
      profile_id?: string;
      error?: { message?: string };
    };
  }>(
    "/debug_token",
    { input_token: requireMetaSecret("META_PAGE_ACCESS_TOKEN") },
    { token: appToken },
  );
  const d = res.data ?? {};
  return {
    isValid: d.is_valid === true,
    type: d.type ?? null,
    // expires_at 0 means a never-expiring Page / system-user token.
    expiresAt: d.expires_at ? new Date(d.expires_at * 1000).toISOString() : null,
    scopes: d.scopes ?? [],
    profileId: d.profile_id ?? null,
    error: d.error?.message ? redactGraph(d.error.message) : null,
  };
}

export const REQUIRED_SCOPES = [
  "leads_retrieval",
  "pages_manage_metadata",
  "pages_show_list",
  "pages_read_engagement",
];
