// Zetaris REST client (direct REST API at /api/v1.0).
// The agent sends Lightning SQL here; Zetaris federates across the registered
// CSV files, REST tables and relational sources and returns one result set.

export interface ZetarisConfig { restUrl: string; orgId: string; apiKey: string }
export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
}

export function zetarisConfigFromEnv(): ZetarisConfig {
  return {
    restUrl: (process.env.ZETARIS_REST_URL ?? "http://localhost:8888/api/v1.0").replace(/\/$/, ""),
    orgId: process.env.ZETARIS_ORG_ID ?? "1",
    apiKey: process.env.ZETARIS_API_KEY ?? "",
  };
}

async function zfetch(cfg: ZetarisConfig, path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${cfg.restUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "X-Org-ID": cfg.orgId,
      "X-Request-ID": crypto.randomUUID(),
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Zetaris ${path}: HTTP ${res.status} ${text.slice(0, 300)}`);
  }
  return res.status === 204 ? null : res.json();
}

// POST /sql-editor/sqls/run - one statement per call, per Zetaris conventions.
export async function runSql(cfg: ZetarisConfig, sql: string, limit = 500): Promise<QueryResult> {
  const out = (await zfetch(cfg, "/sql-editor/sqls/run", {
    method: "POST",
    body: JSON.stringify({ queryId: crypto.randomUUID(), sql, source: "SqlEditor", limit }),
  })) as { data?: { columns?: unknown; records?: unknown; rows?: unknown } } | null;

  const data = out?.data ?? {};
  // Column/record shapes vary slightly across versions; normalise defensively.
  const rawCols = (data as { columns?: unknown }).columns;
  const rawRows = ((data as { records?: unknown }).records ?? (data as { rows?: unknown }).rows ?? []) as unknown[];
  const columns: string[] = Array.isArray(rawCols)
    ? rawCols.map((c) => (typeof c === "string" ? c : String((c as { name?: string })?.name ?? c)))
    : rawRows.length > 0 && typeof rawRows[0] === "object" && rawRows[0] !== null
      ? Object.keys(rawRows[0] as object)
      : [];
  const rows: Record<string, unknown>[] = rawRows.map((r) => {
    if (Array.isArray(r)) {
      const o: Record<string, unknown> = {};
      columns.forEach((c, i) => (o[c] = r[i]));
      return o;
    }
    return r as Record<string, unknown>;
  });
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
