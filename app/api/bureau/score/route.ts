import { bureauScore, MONTHS, BORROWERS } from "@/lib/data";

export const runtime = "nodejs";

// Mock credit-bureau REST API. Registered in Zetaris as a LIGHTNING REST TABLE
// (LENDING.BUREAU_SCORES) so federated SQL can join bureau scores with the ledger.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = (searchParams.get("borrower_id") || "").toUpperCase();
  const month = searchParams.get("month");
  if (id) {
    if (!BORROWERS.some((b) => b.id === id)) {
      return Response.json({ error: "unknown borrower" }, { status: 404 });
    }
    const rows = MONTHS.filter((m) => !month || m === month)
      .map((m) => ({ borrower_id: id, month: m, score: bureauScore(id, m), band: band(bureauScore(id, m)) }));
    return Response.json({ data: rows });
  }
  // full history for federation (single call per table scan)
  const rows = BORROWERS.flatMap((b) =>
    MONTHS.map((m) => ({ borrower_id: b.id, month: m, score: bureauScore(b.id, m), band: band(bureauScore(b.id, m)) })),
  );
  return Response.json({ data: rows });
}
function band(s: number) { return s >= 750 ? "excellent" : s >= 700 ? "good" : s >= 650 ? "fair" : "poor"; }
