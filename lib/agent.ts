// Sift orchestrator: Scout contract -> H-MEM recall -> plan -> Markovian execution
// with real tool calls (Zetaris federated SQL + bureau REST) -> cited report -> memory mining.
import { decide, verifyContract, ExecutionContract, Decision } from "./scout";
import { HMem, seedMemory, MemoryRecord } from "./hmem";
import { runMarkovian, MarkovianRun, ChunkInfo, estTokens } from "./markovian";
import { runSql, QueryResult, zetarisConfigFromEnv } from "./zetaris";
import { agentChat, runtimeConfigFromEnv } from "./ai";
import { bureauScore, MONTHS } from "./data";

export interface EvidenceItem {
  id: string; kind: "sql" | "bureau" | "memory" | "note";
  label: string; detail: string; rows?: Record<string, unknown>[];
}
export interface AgentEvent {
  type: "scout" | "memories" | "plan" | "chunk" | "tool" | "report" | "action" | "run-stats" | "error" | "done";
  data: unknown;
}

const SYSTEM = `You are Sift, an evidence agent for small-business credit analysts.
You investigate WHY, never guess. You answer only from tool results and cited memory.
You can issue exactly one directive per step, as the FIRST line of your reply:
SQL: <one Lightning SQL statement against the federated tables>
BUREAU: <borrower_id like B-041>   (fetches bureau score history)
or, when you have enough evidence, a line containing only CONCLUDE, then your reasoning.
Federated tables in Zetaris (schema LENDING):
  LENDING.BORROWERS(id, name, segment, region, district, since)   -- id like B-041
  LENDING.LOANS(id, borrowerId, principal, ratePct, termMonths, startMonth, status)
  LENDING.PAYMENTS(loanId, month, due, paid, paidOnTime)   -- month is a string like '2026-08-01 00:00:00.0' (use LIKE '2026-08%' or compare as text); paidOnTime is the string 'true' or 'false'
  LENDING.FIELD_NOTES(id, borrowerId, date, author, note)
Joins: PAYMENTS.loanId = LOANS.id, LOANS.borrowerId = BORROWERS.id.
Bureau scores come from the BUREAU directive, not SQL. Spark SQL dialect: information_schema is not available; use the table list above exactly.
Rules: one directive per step. Prefer aggregates. Cite evidence ids in your final reasoning.
Recalled case memory is precedent only: it may suggest what to check, but it is never proof of the cause for the period asked about. Base every conclusion on SQL or BUREAU results you actually ran for this question. If the data does not support a cause, conclude that the cause is not established and say what data would settle it.`;

export interface InvestigationResult {
  decision: Decision;
  memories: MemoryRecord[];
  run: MarkovianRun;
  evidence: EvidenceItem[];
  report?: string;
  refusal?: string;
}

export async function investigate(question: string, emit: (e: AgentEvent) => void): Promise<InvestigationResult> {
  const ai = runtimeConfigFromEnv();
  const zcfg = zetarisConfigFromEnv();
  const mem = new HMem(); seedMemory(mem);
  const evidence: EvidenceItem[] = [];
  let evN = 0;

  // Stage 1: Scout decides. Raw prompts never reach tools.
  const decision = await decide({ prompt: question, surface: "console", role: "analyst" });
  emit({ type: "scout", data: decision });
  if (decision.kind !== "contract" || !decision.contract) {
    emit({ type: "done", data: { refused: true } });
    return { decision, memories: [], run: emptyRun(question), evidence, refusal: decision.reason };
  }
  const contract = decision.contract;

  // Executor boundary: verify the contract signature before acting on it.
  if (!verifyContract(contract)) {
    emit({ type: "error", data: "Contract signature mismatch - refused to execute." });
    return { decision, memories: [], run: emptyRun(question), evidence, refusal: "bad signature" };
  }

  // Stage 2: H-MEM recall of prior cases.
  const memories = mem.recall(contract.params.question + " " + (contract.params.borrowerId || "") + " " + (contract.params.region || ""));
  for (const m of memories) {
    evidence.push({ id: "E" + (++evN), kind: "memory", label: m.provenance.label, detail: m.content.slice(0, 400) });
  }
  emit({ type: "memories", data: memories });

  const memoryBlock = memories.length
    ? "[RECALLED CASE MEMORY]\n" + memories.map((m, i) => `- (${evidence[i].id}) ${m.content}`).join("\n")
    : "";

  // Stage 3: Markovian investigation loop. Each chunk = one bounded step with one tool call.
  const goal = `[CONTRACT ${contract.traceId} intent=${contract.intent} risk=${contract.risk}]\nAnalyst question: ${contract.params.question}\n${contract.params.borrowerId ? "Borrower in scope: " + contract.params.borrowerId + "\n" : ""}${contract.params.region ? "Region in scope: " + contract.params.region + "\n" : ""}\nInvestigate and explain WHY, step by step, using SQL and BUREAU directives.`;

  const generate = async (prompt: string, step: number) => {
    const reply = await agentChat(ai, [{ role: "system", content: SYSTEM }, { role: "user", content: prompt }], "deep");
    const firstLine = reply.split("\n").find((l) => l.trim().length > 0) || "";
    let toolBlock = "";
    const sqlM = firstLine.match(/^SQL:\s*(.+)$/i);
    const burM = firstLine.match(/^BUREAU:\s*(B-\d{3})/i);
    if (sqlM) {
      const sql = sqlM[1].replace(/;$/, "");
      try {
        const res = await runSql(zcfg, sql, 200);
        const id = "E" + (++evN);
        evidence.push({ id, kind: "sql", label: "Zetaris Lightning SQL", detail: sql, rows: res.rows.slice(0, 12) });
        toolBlock = `\n[TOOL RESULT ${id}] ${res.rows.length} rows via Zetaris:\n` + JSON.stringify(res.rows.slice(0, 20));
        emit({ type: "tool", data: { id, kind: "sql", sql, rowCount: res.rows.length, sample: res.rows.slice(0, 5) } });
      } catch (err) {
        toolBlock = `\n[TOOL ERROR] ${String(err).slice(0, 300)}`;
        emit({ type: "tool", data: { kind: "sql", sql, error: String(err).slice(0, 300) } });
      }
    } else if (burM) {
      const id = "E" + (++evN);
      const rows = bureauHistory(burM[1].toUpperCase());
      evidence.push({ id, kind: "bureau", label: "Bureau score history " + burM[1].toUpperCase(), detail: "Bureau REST API", rows });
      toolBlock = `\n[TOOL RESULT ${id}] bureau history:\n` + JSON.stringify(rows.slice(0, 18));
      emit({ type: "tool", data: { id, kind: "bureau", borrowerId: burM[1].toUpperCase(), sample: rows.slice(-6) } });
    }
    const done = /(^|\n)\s*CONCLUDE\s*$/m.test(reply) || evN >= 9;
    return { content: reply + toolBlock, done };
  };

  const compress = async (state: string, budget: number) => {
    const out = await agentChat(ai, [
      { role: "system", content: `Compress this investigation state to under ${budget * 4} characters. Keep: every evidence id with its key numbers, open questions, hypotheses. Drop prose.` },
      { role: "user", content: state },
    ], "fast");
    return out.slice(0, budget * 4);
  };

  const run = await runMarkovian({
    goal, mode: "RESEARCH", initialContext: memoryBlock,
    config: { maxChunks: 8, chunkSize: 8000, carryoverTokens: 800, overlapTokens: 0 },
    generate, compress,
    onChunk: (c: ChunkInfo) => emit({ type: "chunk", data: { id: c.id, tokens: c.tokens, preview: c.content.slice(0, 600) } }),
  });

  // Stage 4: compose the cited report from the compressed final state + evidence index.
  const evIndex = evidence.map((e) => `${e.id} [${e.kind}] ${e.label}: ${e.detail}${e.rows ? " -> " + JSON.stringify(e.rows.slice(0, 6)) : ""}`).join("\n");
  const report = await agentChat(ai, [
    { role: "system", content: `Write the analyst's answer. Structure: **Answer** (one sentence), **Why** (the causal chain, each claim citing its evidence id like (E3)), **What it is NOT** (ruled-out explanations, cited), **Recommended action** (specific, conservative). Under 350 words. Never cite evidence not in the index. Evidence marked [memory] is precedent from an earlier case: cite it only as precedent (for example, a similar dip in a past period was operational), never as the cause of this period. State a cause only if the SQL or bureau evidence supports it; if it does not, write Answer as: Cause not established by the data, and recommend the next query or field check.` },
    { role: "user", content: `Question: ${contract.params.question}\n\nFinal investigation state:\n${run.chunks.map((c) => c.content).join("\n---\n").slice(0, 9000)}\n\nEvidence index:\n${evIndex}` },
  ], "deep");
  emit({ type: "report", data: { report, evidence } });
  emit({ type: "run-stats", data: run });

  // Stage 5: mine the case into memory (working layer, full provenance, trust ledger).
  const mined = mem.add({
    content: `Case ${contract.traceId}: "${contract.params.question.slice(0, 120)}" -> ${report.slice(0, 500)}`,
    type: "factual", layer: "working", tags: [contract.intent, contract.params.region, contract.params.borrowerId].filter(Boolean) as string[],
    confidence: 0.65, source: contract.traceId,
    provenance: { origin: "case_outcome", learnedAt: new Date().toISOString(), label: `Investigation ${contract.traceId}`, refs: evidence.map((e) => e.id) },
    entities: [contract.params.borrowerId && { name: contract.params.borrowerId, type: "borrower" }, contract.params.region && { name: contract.params.region, type: "region" }].filter(Boolean) as { name: string; type: string }[],
    relatedTo: memories.map((m) => m.id).slice(0, 5), derivedFrom: [],
  });
  void mined;

  emit({ type: "done", data: { refused: false } });
  return { decision, memories, run, evidence, report };
}

function emptyRun(prompt: string): MarkovianRun {
  return { id: "mrn_none", timestamp: new Date().toISOString(), prompt: prompt.slice(0, 200), mode: "RESEARCH", chunkConfig: { chunkSize: 0, maxChunks: 0, carryoverTokens: 0, overlapTokens: 0 }, chunks: [], totalTokensUsed: 0, totalTokensSaved: 0, efficiencyPercent: 0, durationMs: 0, status: "aborted" };
}

function bureauHistory(borrowerId: string): Record<string, unknown>[] {
  // same generator the bureau REST endpoint exposes; kept in sync with app/api/bureau
  return MONTHS.map((m) => ({ borrower_id: borrowerId, month: m, score: bureauScore(borrowerId, m) }));
}
