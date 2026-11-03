import { accessGate, boundedBody } from "@/lib/safety";
// Scout-guarded actions: a draft is created only under a signed high-risk contract,
// and nothing leaves the system until a human approves it.
import { decide, verifyContract, ExecutionContract } from "@/lib/scout";
import { agentChat, runtimeConfigFromEnv } from "@/lib/ai";
import { BORROWERS, LOANS, PAYMENTS } from "@/lib/data";

export const runtime = "nodejs";

const pending = new Map<string, { contract: ExecutionContract; draft: string; borrowerId: string }>();

export async function POST(req: Request) {
  const denied=accessGate(req);if(denied)return denied;
  let body:Record<string,unknown>;try{body=await boundedBody(req)}catch{return Response.json({error:"Valid JSON object required (8KB max)."},{status:400})}
  if (typeof body.approveId==="string") {
    const p = pending.get(body.approveId);
    if (!p) return Response.json({ error: "unknown action id" }, { status: 404 });
    if (body.approved !== true) { pending.delete(body.approveId); return Response.json({ status: "rejected", note: "Draft discarded. Nothing was sent." }); }
    pending.delete(body.approveId);
    // Demo boundary: the letter is marked released to the borrower's file, not emailed.
    return Response.json({ status: "demo_acknowledged", note: "Demo approval acknowledged in this process only. No borrower file was written and nothing was sent." });
  }

  const { prompt } = body;
  if (typeof prompt!=="string"||!prompt.trim()||prompt.length>2000) return Response.json({ error: "prompt required" }, { status: 400 });
  const decision = await decide({ prompt, surface: "console", role: "analyst" });
  if (decision.kind !== "contract" || !decision.contract || !verifyContract(decision.contract)) {
    return Response.json({ refused: true, reason: decision.reason || "not permitted", decision }, { status: 403 });
  }
  if (decision.contract.intent !== "credit.draft_action" || decision.contract.risk !== "high") {
    return Response.json({ refused: true, reason: "Only the high-risk credit.draft_action intent reaches this endpoint." }, { status: 403 });
  }
  const borrowerId = decision.contract.params.borrowerId;
  const borrower = BORROWERS.find((b) => b.id === borrowerId);
  if (!borrower) return Response.json({ error: "No borrower id (e.g. B-041) in the request." }, { status: 400 });
  const loan = LOANS.find((l) => l.borrowerId === borrowerId);
  const late = PAYMENTS.filter((p) => p.loanId === loan?.id && !p.paidOnTime).length;

  const draft = await agentChat(runtimeConfigFromEnv(), [
    { role: "system", content: "Draft a short, courteous payment-plan letter from the lender to the borrower. Reference the facts given. Under 180 words. No invented facts." },
    { role: "user", content: `Borrower ${borrower.id} (${borrower.segment}, ${borrower.region} region). Loan ${loan?.id}: principal ${loan?.principal}, rate ${loan?.ratePct}%. ${late} late payments in the ledger. Offer a 3-month restructured plan.` },
  ], "deep");

  const id = "act_" + crypto.randomUUID();
  if(pending.size>=100)pending.delete(pending.keys().next().value!);
  setTimeout(()=>pending.delete(id),5*60*1000).unref();
  pending.set(id, { contract: decision.contract, draft, borrowerId });
  return Response.json({ actionId: id, status: "pending_approval", contract: decision.contract, draft, borrower: { id: borrower.id, segment: borrower.segment, region: borrower.region } });
}
