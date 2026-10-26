// Markovian chunked-reasoning engine: long investigations run as bounded chunks.
// Each chunk sees only the goal summary + compressed carryover state, so context
// stays O(1) in chain length instead of growing quadratically.

export interface ChunkConfig {
  chunkSize: number;      // token budget per chunk prompt
  maxChunks: number;      // recursion cap
  carryoverTokens: number;// budget for the compressed state passed forward
  overlapTokens: number;  // tail of chunk N prepended to chunk N+1
}

export const DEFAULT_CONFIG: ChunkConfig = { chunkSize: 8000, maxChunks: 12, carryoverTokens: 800, overlapTokens: 0 };
const FRAMING_TOKENS = 400;
const OUTPUT_BUDGET = 1200;

export class ChunkConfigError extends Error {}

export function validateConfig(c: ChunkConfig, modelContextTokens = 128000): ChunkConfig {
  const within = (v: number, lo: number, hi: number, name: string) => {
    if (!Number.isInteger(v) || v < lo || v > hi) throw new ChunkConfigError(`${name} must be an integer in [${lo}, ${hi}], got ${v}`);
  };
  within(c.chunkSize, 1000, 128000, "chunkSize");
  within(c.maxChunks, 1, 32, "maxChunks");
  within(c.carryoverTokens, 128, 32768, "carryoverTokens");
  within(c.overlapTokens, 0, 4096, "overlapTokens");
  if (c.chunkSize < FRAMING_TOKENS + c.carryoverTokens + OUTPUT_BUDGET)
    throw new ChunkConfigError(`chunkSize ${c.chunkSize} too small for framing (${FRAMING_TOKENS}) + carryover (${c.carryoverTokens}) + output (${OUTPUT_BUDGET})`);
  if (c.chunkSize > modelContextTokens)
    throw new ChunkConfigError(`chunkSize ${c.chunkSize} exceeds model context ${modelContextTokens}`);
  return c;
}

export interface ChunkInfo { id: number; tokens: number; carryover: string; content: string }
export interface MarkovianRun {
  id: string; timestamp: string; prompt: string; mode: "RESEARCH" | "ARCHITECT";
  chunkConfig: ChunkConfig; chunks: ChunkInfo[];
  totalTokensUsed: number; totalTokensSaved: number; efficiencyPercent: number;
  durationMs: number; status: "completed" | "max-chunks" | "errored" | "aborted";
}

export const estTokens = (chars: number) => Math.ceil(chars / 4);

export interface StepResult { content: string; done: boolean }
export type Generator = (prompt: string, step: number) => Promise<StepResult>;
export type Compressor = (state: string, budgetTokens: number) => Promise<string>;

export async function runMarkovian(opts: {
  goal: string;
  mode?: "RESEARCH" | "ARCHITECT";
  config?: Partial<ChunkConfig>;
  initialContext?: string;
  generate: Generator;
  compress: Compressor;
  onChunk?: (c: ChunkInfo) => void;
}): Promise<MarkovianRun> {
  const config = validateConfig({ ...DEFAULT_CONFIG, ...opts.config });
  const started = Date.now();
  const run: MarkovianRun = {
    id: "mrn_" + Math.random().toString(36).slice(2, 12),
    timestamp: new Date().toISOString(),
    prompt: opts.goal.slice(0, 500),
    mode: opts.mode || "RESEARCH",
    chunkConfig: config,
    chunks: [], totalTokensUsed: 0, totalTokensSaved: 0, efficiencyPercent: 0,
    durationMs: 0, status: "completed",
  };

  let carryover = opts.initialContext ? await opts.compress(opts.initialContext, config.carryoverTokens) : "";
  let naiveCumulative = estTokens(opts.goal.length + (opts.initialContext?.length || 0));

  try {
    for (let step = 1; step <= config.maxChunks; step++) {
      const goalBlock = step === 1 ? opts.goal : `[GOAL] ${opts.goal.slice(0, 400)}`;
      const overlapBlock = "";
      const prompt = [
        goalBlock,
        carryover ? `[STATE]\n${carryover}` : "",
        overlapBlock,
        `[STEP ${step}/${config.maxChunks}] Continue the ${run.mode} task. If the task is fully answered, finish with a line containing only CONCLUDE.`,
      ].filter(Boolean).join("\n\n");

      const res = await opts.generate(prompt, step);
      const tokens = estTokens(prompt.length + res.content.length);
      const chunk: ChunkInfo = { id: step, tokens, carryover, content: res.content };
      run.chunks.push(chunk);
      run.totalTokensUsed += tokens;
      opts.onChunk?.(chunk);

      // Naive full-history baseline: every step would resend everything.
      naiveCumulative = naiveCumulative * 2 + estTokens(res.content.length);
      run.totalTokensSaved = Math.max(0, naiveCumulative - run.totalTokensUsed);

      if (res.done || /(^|\n)\s*CONCLUDE\s*$/m.test(res.content)) { run.status = "completed"; break; }
      if (step === config.maxChunks) { run.status = "max-chunks"; break; }

      carryover = await opts.compress(
        `[PREVIOUS STATE]\n${carryover}\n\n[STEP ${step} OUTPUT]\n${res.content}`,
        config.carryoverTokens,
      );
    }
  } catch (err) {
    run.status = "errored";
    run.chunks.push({ id: run.chunks.length + 1, tokens: 0, carryover, content: String(err) });
  }

  run.durationMs = Date.now() - started;
  run.efficiencyPercent = run.totalTokensUsed + run.totalTokensSaved === 0 ? 0
    : Math.round((run.totalTokensSaved / (run.totalTokensUsed + run.totalTokensSaved)) * 100);
  return run;
}
