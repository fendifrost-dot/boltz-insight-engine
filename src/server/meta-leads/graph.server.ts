// Meta Graph API adapter (REST). Server-only: never call from the browser.
import {
  configuredLeadgenPageIds,
  graphApiVersion,
  readMetaSecret,
  requireMetaSecret,
} from "./env.server";
import type { GraphLead, GraphLeadForm } from "./normalize";
import { nextPageCursor } from "./paging";
import type { GraphPaging } from "./paging";
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

const pageTokenCache = new Map<
  string,
  { stored: string; token: string; source: "stored" | "derived"; until: number }
>();

/**
 * Page token for one Page. The stored credential may be a Page token, or a
 * User / System-user token with a role on the Page; in the latter case Meta
 * rejects Page calls ("must be called with a Page Access Token"). Asking that
 * Page for its own access_token with the stored credential yields a Page token
 * either way. Cached per Page so a second Page is not called with the first
 * Page's token.
 */
export async function pageAccessTokenFor(
  pageId: string,
): Promise<{ token: string; source: "stored" | "derived" }> {
  const stored = requireMetaSecret("META_PAGE_ACCESS_TOKEN");
  const cached = pageTokenCache.get(pageId);
  if (cached && cached.stored === stored && Date.now() < cached.until) {
    return { token: cached.token, source: cached.source };
  }
  let token = stored;
  let source: "stored" | "derived" = "stored";
  let ttl = 5 * 60_000;
  try {
    const res = await graphRequest<{ access_token?: string }>(
      `/${encodeURIComponent(pageId)}`,
      { fields: "access_token" },
      { token: stored },
    );
    if (res.access_token) {
      source = res.access_token === stored ? "stored" : "derived";
      token = res.access_token;
      ttl = 30 * 60_000;
    }
  } catch {
    // Fall back to the stored value; the real call will surface Meta's error.
  }
  const entry = { stored, token, source, until: Date.now() + ttl };
  pageTokenCache.set(pageId, entry);
  return { token: entry.token, source: entry.source };
}

/** Token for the first configured Page. Other Pages use pageAccessTokenFor. */
export async function pageAccessToken(): Promise<{ token: string; source: "stored" | "derived" }> {
  const pageId = configuredLeadgenPageIds()[0] ?? requireMetaSecret("META_PAGE_ID");
  return pageAccessTokenFor(pageId);
}

async function graphRequest<T>(
  pathOrUrl: string,
  params: Record<string, string> = {},
  init: { method?: "GET" | "POST"; token?: string; appToken?: boolean } = {},
): Promise<T> {
  const url = new URL(pathOrUrl.startsWith("https://") ? pathOrUrl : `${base()}${pathOrUrl}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (!url.searchParams.has("access_token")) {
    const token = init.token ?? (await pageAccessToken()).token;
    url.searchParams.set("access_token", token);
  }
  // paging.next already carries access_token and omits appsecret_proof. Apps
  // that require the proof reject every page after the first unless it is added
  // for that token too. App tokens (id|secret) never take a proof.
  const appSecret = readMetaSecret("META_APP_SECRET");
  const tokenForProof = url.searchParams.get("access_token");
  if (appSecret && !init.appToken && tokenForProof && !url.searchParams.has("appsecret_proof")) {
    url.searchParams.set("appsecret_proof", await hmacSha256Hex(appSecret, tokenForProof));
  }
  const res = await fetch(url, {
    method: init.method ?? "GET",
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  if (!res.ok) {
    let code: number | null = null;
    let subcode: number | null = null;
    let message = text;
    try {
      const parsed = JSON.parse(text) as {
        error?: { code?: number; error_subcode?: number; message?: string };
      };
      code = parsed.error?.code ?? null;
      subcode = parsed.error?.error_subcode ?? null;
      message = parsed.error?.message ?? text;
    } catch {
      // non-JSON error body
    }
    const path = url.pathname.replace(/^\/v\d+\.\d+/, "");
    // Always carry Meta's numeric code: operators match on it, and the
    // message text alone often omits it.
    const codes = [
      code !== null ? `code ${code}` : null,
      subcode !== null ? `subcode ${subcode}` : null,
    ]
      .filter(Boolean)
      .join(", ");
    throw new GraphError(
      `Graph ${path} failed (${res.status}${codes ? `, ${codes}` : ""}): ${redactGraph(message)}`,
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

export async function getLead(leadgenId: string, token?: string): Promise<GraphLead> {
  const init = token ? { token } : {};
  const { result } = await withFieldFallback((fields) =>
    graphRequest<GraphLead>(`/${encodeURIComponent(leadgenId)}`, { fields }, init),
  );
  return result;
}

const formCache = new Map<string, { form: GraphLeadForm; at: number }>();

/** Form metadata + legal content (consent wording). Cached for an hour per worker. */
export async function getForm(formId: string, token?: string): Promise<GraphLeadForm | null> {
  const cached = formCache.get(formId);
  if (cached && Date.now() - cached.at < 60 * 60_000) return cached.form;
  const init = token ? { token } : {};
  const attempts = [
    "id,name,status,locale,privacy_policy_url,legal_content",
    "id,name,status,locale",
  ];
  for (const fields of attempts) {
    try {
      const form = await graphRequest<GraphLeadForm>(
        `/${encodeURIComponent(formId)}`,
        { fields },
        init,
      );
      formCache.set(formId, { form, at: Date.now() });
      return form;
    } catch (error) {
      if (!isFieldOrPermissionError(error)) throw error;
    }
  }
  return null;
}

type Paged<T> = { data?: T[]; paging?: GraphPaging };

async function collectEdge<T>(
  path: string,
  params: Record<string, string>,
  init: { token?: string },
  maxPages: number,
): Promise<{ items: T[]; truncated: boolean }> {
  const items: T[] = [];
  let after: string | undefined;
  let nextUrl: string | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    const result = nextUrl
      ? await graphRequest<Paged<T>>(nextUrl, {}, init)
      : await graphRequest<Paged<T>>(path, after ? { ...params, after } : params, init);
    items.push(...(result.data ?? []));
    const step = nextPageCursor(result.paging, after);
    if (step.kind === "end") return { items, truncated: false };
    if (page === maxPages - 1) return { items, truncated: true };
    if (step.kind === "cursor") {
      after = step.after;
      nextUrl = undefined;
    } else {
      nextUrl = step.url;
      after = undefined;
    }
  }
  return { items, truncated: true };
}

export type ListedForm = {
  id: string;
  name?: string;
  status?: string;
  leadsCount: number | null;
};

/** Every Instant Form on the Page, following cursors. `leads_count` is optional. */
export async function listForms(
  pageId: string,
): Promise<{ forms: ListedForm[]; truncated: boolean }> {
  const { token } = await pageAccessTokenFor(pageId);
  const fieldSets = ["id,name,status,leads_count", "id,name,status"];
  let lastError: unknown;
  for (const fields of fieldSets) {
    try {
      const { items, truncated } = await collectEdge<{
        id: string;
        name?: string;
        status?: string;
        leads_count?: number | string;
      }>(`/${encodeURIComponent(pageId)}/leadgen_forms`, { fields, limit: "100" }, { token }, 10);
      const seen = new Set<string>();
      const forms: ListedForm[] = [];
      for (const form of items) {
        if (!form.id || seen.has(form.id)) continue;
        seen.add(form.id);
        const count = Number(form.leads_count);
        const listed: ListedForm = {
          id: form.id,
          leadsCount: Number.isFinite(count) ? count : null,
        };
        if (form.name !== undefined) listed.name = form.name;
        if (form.status !== undefined) listed.status = form.status;
        forms.push(listed);
      }
      return { forms, truncated };
    } catch (error) {
      lastError = error;
      if (!isFieldOrPermissionError(error)) throw error;
    }
  }
  throw lastError;
}

/** Question keys only (`questions[].key`, else type). No labels, options, or answers. */
export async function listFormQuestionKeys(formId: string, token?: string): Promise<string[]> {
  const init = token ? { token } : {};
  const form = await graphRequest<{ questions?: { key?: string; type?: string }[] }>(
    `/${encodeURIComponent(formId)}`,
    { fields: "id,questions" },
    init,
  );
  const keys: string[] = [];
  if (!Array.isArray(form.questions)) return keys;
  for (const question of form.questions) {
    const key = (question.key ?? "").trim() || (question.type ?? "").trim();
    if (!key || keys.includes(key)) continue;
    keys.push(key);
    if (keys.length >= 40) break;
  }
  return keys;
}

/** Counts lead ids in a window. Requests `id` only, so answers are never read. */
export async function countFormLeads(
  formId: string,
  sinceUnix: number | null,
  token?: string,
): Promise<{ count: number; truncated: boolean }> {
  const params: Record<string, string> = { fields: "id", limit: "100" };
  if (sinceUnix !== null) {
    params["filtering"] = JSON.stringify([
      { field: "time_created", operator: "GREATER_THAN", value: sinceUnix },
    ]);
  }
  const { items, truncated } = await collectEdge<{ id?: string }>(
    `/${encodeURIComponent(formId)}/leads`,
    params,
    token ? { token } : {},
    20,
  );
  return { count: items.filter((lead) => lead.id).length, truncated };
}

/** Leads created after `sinceUnix` on one form, newest first, bounded by maxPages. */
export async function listFormLeads(
  formId: string,
  sinceUnix: number,
  maxPages = 10,
  token?: string,
): Promise<{ leads: GraphLead[]; truncated: boolean }> {
  const filtering = JSON.stringify([
    { field: "time_created", operator: "GREATER_THAN", value: sinceUnix },
  ]);
  const init = token ? { token } : {};
  const { result } = await withFieldFallback(async (fields) =>
    collectEdge<GraphLead>(
      `/${encodeURIComponent(formId)}/leads`,
      { fields, filtering, limit: "100" },
      init,
      maxPages,
    ),
  );
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
  /** "derived": the stored credential was a User/System-user token and the Engine derived the Page token. */
  source: "stored" | "derived";
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
  const effective = await pageAccessToken();
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
    // Inspect the token actually used for Page calls, not just the stored one.
    { input_token: effective.token },
    { token: appToken, appToken: true },
  );
  const d = res.data ?? {};
  return {
    source: effective.source,
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
