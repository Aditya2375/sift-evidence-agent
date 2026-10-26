// Zetaris REST client. Talks to the running Zetaris platform through its UI
// origin, which proxies /api/* to the Lightning API. Verified contract:
//   POST /api/auth/login            {username, password} -> {idToken, orgId, ...}
//   POST /api/proxy/query/sql/start {select, pageLimit}  -> {records: [...], ...}
// The agent sends Lightning SQL here; Zetaris federates across the registered
// CSV filestore tables and REST sources and returns one result set.

export interface ZetarisConfig { baseUrl: string; orgId: string; username: string; password: string; apiKey: string }
export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
}

export function zetarisConfigFromEnv(): ZetarisConfig {
  return {
    baseUrl: (process.env.ZETARIS_BASE_URL ?? "http://localhost:3000").replace(/\/$/, ""),
    orgId: process.env.ZETARIS_ORG_ID ?? "",
    username: process.env.ZETARIS_USERNAME ?? "",
    password: process.env.ZETARIS_PASSWORD ?? "",
    apiKey: process.env.ZETARIS_API_KEY ?? "",
  };
}

// Login tokens last about 15 minutes; cache for 10 and re-login on demand.
let cached: { token: string; orgId: string; at: number } | null = null;

async function login(cfg: ZetarisConfig): Promise<{ token: string; orgId: string }> {
  if (cfg.apiKey) return { token: cfg.apiKey, orgId: cfg.orgId || "1" };
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached;
  const res = await fetch(`${cfg.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Request-ID": crypto.randomUUID() },
    body: JSON.stringify({ username: cfg.username, password: cfg.password }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Zetaris login: HTTP ${res.status}`);
  const body = (await res.json()) as { idToken?: string; token?: string; accessToken?: string; orgId?: number };
  const token = body.idToken ?? body.token ?? body.accessToken ?? "";
  if (!token) throw new Error("Zetaris login returned no token");
  const orgId = String(body.orgId ?? cfg.orgId ?? "1");
  cached = { token, orgId, at: Date.now() };
  return cached;
}

export async function runSql(cfg: ZetarisConfig, sql: string, limit = 500): Promise<QueryResult> {
  const { token, orgId } = await login(cfg);
  const res = await fetch(`${cfg.baseUrl}/api/proxy/query/sql/start`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Org-ID": orgId,
      "X-Request-ID": crypto.randomUUID(),
    },
    body: JSON.stringify({ select: sql, pageLimit: limit }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Zetaris query: HTTP ${res.status} ${text.slice(0, 300)}`);
  }
  const out = (await res.json()) as { records?: Record<string, unknown>[] };
  const rows = out.records ?? [];
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  return { columns, rows, rowCount: rows.length };
}

export async function zetarisHealth(cfg: ZetarisConfig): Promise<{ ok: boolean; detail: string }> {
  try {
    const r = await runSql(cfg, "SELECT 1 AS one", 1);
    return r.rowCount === 1 ? { ok: true, detail: "query engine answering" } : { ok: false, detail: "unexpected result" };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}
