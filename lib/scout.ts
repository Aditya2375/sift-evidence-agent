// Scout Intent engine: sense -> interpret -> guard -> route -> recommend.
// Every action runs on a signed execution contract; raw prompts never reach tools.
import { createHmac } from "crypto";

export type Risk = "low" | "medium" | "high" | "block";

export interface Intent {
  id: string;
  category: string;
  description: string;
  riskClass: Risk;
  surfaces: string[];
  roles: string[];
  triggers: string[];
  examples: string[];
  version: number;
}

export const REGISTRY_VERSION = 3;

export const REGISTRY: Intent[] = [
  {
    id: "credit.investigate", category: "credit",
    description: "Investigate a credit/portfolio question and explain why with cited evidence",
    riskClass: "low", surfaces: ["console"], roles: ["analyst"],
    triggers: ["why", "explain", "investigate", "drop", "dropped", "decline", "late", "missed", "behind", "what happened", "cause", "driver", "drivers"],
    examples: ["Why did on-time payments drop in the South region?", "Why is B-041 always late?"],
    version: 3,
  },
  {
    id: "credit.compare", category: "credit",
    description: "Compare repayment behaviour between periods, regions or borrower segments",
    riskClass: "low", surfaces: ["console"], roles: ["analyst"],
    triggers: ["compare", "versus", "vs", "difference", "trend", "over time", "month over month"],
    examples: ["Compare North and South repayment rates this quarter"],
    version: 3,
  },
  {
    id: "credit.portfolio", category: "credit",
    description: "Summarise portfolio health and exposure",
    riskClass: "low", surfaces: ["console"], roles: ["analyst"],
    triggers: ["portfolio", "summary", "overview", "health", "exposure", "how are we doing"],
    examples: ["Give me a portfolio summary"],
    version: 3,
  },
  {
    id: "credit.draft_action", category: "credit",
    description: "Draft a borrower-facing action such as a payment-plan letter; sends nothing without human approval",
    riskClass: "high", surfaces: ["console"], roles: ["analyst"],
    triggers: ["draft", "letter", "email", "write to", "payment plan", "restructure", "reminder", "notice", "contact"],
    examples: ["Draft a payment-plan letter for B-041"],
    version: 3,
  },
  {
    id: "data.dump_pii", category: "data",
    description: "Bulk export of borrower personal data",
    riskClass: "block", surfaces: [], roles: [],
    triggers: ["dump", "export all", "all personal", "phone numbers", "addresses of", "list every borrower"],
    examples: [],
    version: 3,
  },
];

const INJECTION_PATTERNS = [
  /ignore (all |any )?(previous|prior|above) instructions/i,
  /system prompt/i, /you are now/i, /jailbreak/i, /do anything now/i,
  /\bDAN\b/, /reveal your (prompt|instructions|rules)/i,
];

export interface IntentCandidate { intent: string; score: number }
export interface ExecutionContract {
  traceId: string; intent: string; params: Record<string, string>;
  risk: Risk; registryVersion: number; issuedAt: string; surface: string; signature: string;
}
export interface Decision {
  kind: "contract" | "clarify" | "refuse";
  candidates: IntentCandidate[];
  flags: string[];
  contract?: ExecutionContract;
  reason?: string;
}

function scoreIntent(prompt: string, intent: Intent): number {
  const p = prompt.toLowerCase();
  let matched = 0, weight = 0;
  for (const t of intent.triggers) {
    weight += t.length > 5 ? 2 : 1;
    if (p.includes(t)) matched += t.length > 5 ? 2 : 1;
  }
  return weight === 0 ? 0 : matched / weight;
}

function sign(payload: string): string {
  const secret = process.env.SCOUT_SIGNING_KEY || "sift-dev-signing-key";
  return createHmac("sha256", secret).update(payload).digest("hex").slice(0, 32);
}

export function verifyContract(c: ExecutionContract): boolean {
  const { signature, ...rest } = c;
  return signature === sign(JSON.stringify(rest));
}

export async function decide(input: { prompt: string; surface?: string; role?: string }): Promise<Decision> {
  const surface = input.surface || "console";
  const role = input.role || "analyst";
  const flags: string[] = [];

  // Guard stage 1: injection screen runs before classification.
  for (const pat of INJECTION_PATTERNS) {
    if (pat.test(input.prompt)) {
      return { kind: "refuse", candidates: [], flags: ["injection-pattern"], reason: "The request looks like a prompt-injection attempt. Sift only answers credit questions." };
    }
  }

  // Sense: deterministic scan over the whole registry, top-k candidates.
  const candidates = REGISTRY
    .map((i) => ({ intent: i.id, score: scoreIntent(input.prompt, i) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (candidates.length === 0) {
    return { kind: "refuse", candidates, flags, reason: "No registered intent matches this request. Sift acts only on registered credit intents." };
  }

  const top = REGISTRY.find((i) => i.id === candidates[0].intent)!;
  const confidence = candidates[0].score;

  // Guard stage 2: risk floor from the registry, surface and role enforcement.
  let risk: Risk = top.riskClass;
  if (risk === "block") {
    return { kind: "refuse", candidates, flags: ["risk:block"], reason: "That request is outside what Sift is allowed to do: bulk export of borrower personal data is refused." };
  }
  if (!top.surfaces.includes(surface) || !top.roles.includes(role)) {
    return { kind: "refuse", candidates, flags: ["scope"], reason: `Intent ${top.id} is not permitted on surface=${surface} role=${role}.` };
  }
  if (/all borrowers|every borrower|entire book/i.test(input.prompt) && top.id !== "credit.portfolio") {
    flags.push("sensitivity:broad-set");
    risk = risk === "low" ? "medium" : risk;
  }
  if (confidence < 0.25) {
    return { kind: "clarify", candidates, flags, reason: "I am not confident which credit intent you mean. Pick one of the suggested intents or rephrase." };
  }

  // Interpret: bind the parameters the pipeline needs.
  const params: Record<string, string> = { question: input.prompt };
  const borrower = input.prompt.match(/B-\d{3}/i);
  if (borrower) params.borrowerId = borrower[0].toUpperCase();
  const region = input.prompt.match(/\b(north|south|east|west)\b/i);
  if (region) params.region = region[0][0].toUpperCase() + region[0].slice(1).toLowerCase();

  // Recommend + sign: the only artifact downstream engines accept.
  const unsigned = {
    traceId: "trc_" + Math.random().toString(36).slice(2, 12),
    intent: top.id, params, risk, registryVersion: REGISTRY_VERSION,
    issuedAt: new Date().toISOString(), surface,
  };
  const contract: ExecutionContract = { ...unsigned, signature: sign(JSON.stringify(unsigned)) };
  return { kind: "contract", candidates, flags, contract };
}
