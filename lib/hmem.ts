// H-MEM: hierarchical case memory with provenance and a trust ledger.
// Layers: short_term (session) -> working (active cases) -> long_term (validated knowledge).
// Every record carries confidence, source and provenance; sourceless records are rejected.

export type MemoryLayer = "short_term" | "working" | "long_term";
export type MemoryType = "personal" | "factual" | "preference" | "general";

export interface Provenance {
  origin: "case_outcome" | "analyst_feedback" | "seed" | "synthesis";
  learnedAt: string;
  label: string;
  refs?: string[];
}

export interface MemoryRecord {
  id: string; content: string; type: MemoryType; layer: MemoryLayer;
  timestamp: string; lastAccessed: string; accessCount: number;
  tags: string[]; confidence: number; source: string;
  provenance: Provenance;
  entities: { name: string; type: string }[];
  relatedTo: string[]; supersedes?: string; supersededBy?: string; derivedFrom: string[];
}

export interface LedgerEntry { id: string; at: string; op: "add" | "access" | "supersede" | "mine"; memoryId: string; detail: string }

export class MemoryRejected extends Error {}

export function validateRecord(r: MemoryRecord): MemoryRecord {
  if (!r.source) throw new MemoryRejected("memory record has no source");
  if (!r.provenance?.label) throw new MemoryRejected("memory record has no provenance label");
  if (r.entities.length > 10) throw new MemoryRejected("entities cap is 10");
  if (r.relatedTo.length > 5) throw new MemoryRejected("relatedTo cap is 5");
  return r;
}

export class HMem {
  private records = new Map<string, MemoryRecord>();
  ledger: LedgerEntry[] = [];

  private log(op: LedgerEntry["op"], memoryId: string, detail: string) {
    this.ledger.push({ id: "led_" + Math.random().toString(36).slice(2, 10), at: new Date().toISOString(), op, memoryId, detail });
  }

  add(input: Omit<MemoryRecord, "id" | "timestamp" | "lastAccessed" | "accessCount">): MemoryRecord {
    const rec: MemoryRecord = {
      ...input,
      id: "mem_" + Math.random().toString(36).slice(2, 10),
      timestamp: new Date().toISOString(),
      lastAccessed: new Date().toISOString(),
      accessCount: 0,
    };
    validateRecord(rec);
    this.records.set(rec.id, rec);
    this.log("add", rec.id, `layer=${rec.layer} source=${rec.source}`);
    return rec;
  }

  recall(query: string, limit = 4): MemoryRecord[] {
    const q = query.toLowerCase();
    const qTokens = new Set(q.split(/[^a-z0-9-]+/).filter((t) => t.length > 2));
    const scored = Array.from(this.records.values()).map((r) => {
      let score = 0;
      for (const e of r.entities) if (q.includes(e.name.toLowerCase())) score += 3;
      for (const t of r.tags) if (qTokens.has(t.toLowerCase())) score += 1.5;
      const contentTokens = r.content.toLowerCase().split(/[^a-z0-9-]+/);
      for (const t of contentTokens) if (qTokens.has(t)) score += 0.2;
      score *= r.confidence;
      if (r.supersededBy) score *= 0.3; // retrieval penalty for superseded memories
      const ageDays = (Date.now() - new Date(r.timestamp).getTime()) / 86400000;
      score *= 1 / (1 + Math.max(0, ageDays - 30) / 90); // gentle forgetting on old working memory
      return { r, score };
    }).filter((s) => s.score > 0.5).sort((a, b) => b.score - a.score).slice(0, limit);
    for (const { r } of scored) {
      r.accessCount++; r.lastAccessed = new Date().toISOString();
      this.log("access", r.id, "recalled");
    }
    return scored.map((s) => s.r);
  }

  supersede(oldId: string, newer: MemoryRecord) {
    const old = this.records.get(oldId);
    if (old) { old.supersededBy = newer.id; newer.supersedes = oldId; this.log("supersede", oldId, `by ${newer.id}`); }
  }

  all(): MemoryRecord[] { return Array.from(this.records.values()); }
}

// Seeded case memory: the prior investigations Sift recalls during the demo.
export function seedMemory(mem: HMem) {
  mem.add({
    content: "March 2026 South-region case: on-time payments dipped 14 points in the festival fortnight (Holi). Cause was timing, not distress: collections staff took leave and borrowers paid in cash at branches that were closed two days. Payments normalised within 3 weeks and bureau scores never moved. Lesson: a sharp short dip in the South with stable bureau scores is usually operational, not credit.",
    type: "factual", layer: "long_term", tags: ["south", "dip", "festival", "operational", "prior-case"],
    confidence: 0.9, source: "case-2026-03-south-festival",
    provenance: { origin: "seed", learnedAt: "2026-03-30T00:00:00Z", label: "Closed case: South festival dip, March 2026" },
    entities: [{ name: "South", type: "region" }], relatedTo: [], derivedFrom: [],
  });
  mem.add({
    content: "B-041 is a chronic structural late payer, not a distressed one: 11 of the last 14 payments were 6-12 days late, always eventually paid in full. Pattern predates any regional event. Root cause on file: owner pays suppliers first, loan last. Payment plan offered and refused in May 2026.",
    type: "factual", layer: "long_term", tags: ["b-041", "chronic", "late", "structural", "prior-case"],
    confidence: 0.85, source: "case-2026-05-b041",
    provenance: { origin: "seed", learnedAt: "2026-05-20T00:00:00Z", label: "Closed case: B-041 chronic lateness review" },
    entities: [{ name: "B-041", type: "borrower" }], relatedTo: [], derivedFrom: [],
  });
  mem.add({
    content: "Analyst preference: regional repayment questions should always separate weather/seasonal operational effects from credit deterioration before recommending action.",
    type: "preference", layer: "long_term", tags: ["methodology", "regional", "seasonality"],
    confidence: 0.8, source: "analyst-standing-note",
    provenance: { origin: "analyst_feedback", learnedAt: "2026-04-02T00:00:00Z", label: "Standing analyst note" },
    entities: [], relatedTo: [], derivedFrom: [],
  });
}
