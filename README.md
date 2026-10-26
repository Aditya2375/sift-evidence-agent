# Sift: an evidence agent for credit analysts

Sift answers "why" questions about a lending portfolio and shows its evidence. Every claim in an answer links to the SQL that was run, the field note that was read, or the past case that was recalled. If the data does not support a cause, Sift says so instead of guessing.

Built for the Open Agent hackathon, Track 02: Agent That Can Explain Why.

- Live app: https://sift-evidence-agent.vercel.app/
- Health check: https://sift-evidence-agent.vercel.app/api/health

## The problem

A credit analyst sees a number move, for example on-time payments in one region falling from 100% to 50%, and has to answer "why" before the next committee. The data sits in several systems, field notes are free text, and past cases live in people's heads. Answers are slow, and a wrong confident answer is worse than none.

## What Sift does

1. **Scout** reads the question and maps it to a registered intent (investigate, draft an action, bulk export). Each request becomes a signed execution contract with a risk class. Bulk personal-data export is blocked. Drafting actions is high risk and sends nothing on its own.
2. **Memory** (H-MEM) recalls closed cases with provenance and confidence. Recalled cases are used only as precedent: "a similar dip in March was operational". They are never used as the cause of the current question.
3. **Zetaris** is the data layer. Sift writes Lightning SQL and runs it on a Zetaris instance over borrowers, loans, payments and field notes. Conclusions come only from the SQL that actually ran.
4. **Markovian chunked reasoning** runs long investigations as bounded chunks. Each chunk sees the goal and a compressed carryover state, so context stays flat as the chain grows. Run stats show tokens used and saved.
5. **Report** returns an answer, the reasoning, what the cause is not, a recommended action, and the evidence list (E1, E2, ...) with the exact SQL and rows.

## Sponsor technology

- **Zetaris** (required): all portfolio data is queried through Zetaris Lightning SQL over its REST API (`/api/auth/login`, `/api/proxy/query/sql/start`). The `LENDING` database holds borrowers, loans, payments, field notes and bureau data, all synthetic. Zetaris ran as the free local Docker distribution.
- **Meterless Runtime** (required): the model layer implements the Meterless Runtime contract (v0.90.0) in `lib/ai.ts`: base URL, runtime token and `meterless/auto` model routing.

### Honest note on the model actually used

The Nightshift desktop app has no Linux build, so the hosted demo could not run it. The demo routes through the documented OpenAI-compatible bridge instead, and the model that answers in the live demo is **Gemini (gemini-3.5-flash-lite) through that OpenAI-compatible bridge**. It is not Nemotron. The Nemotron default in the config is only a fallback and is not running in the demo. Real Nightshift works unchanged on Mac and Windows by setting the Meterless environment variables below.

## Run it

```
npm install
npm run dev
```

Environment variables:

| Variable | Purpose |
| --- | --- |
| `ZETARIS_BASE_URL`, `ZETARIS_ORG_ID`, `ZETARIS_USERNAME`, `ZETARIS_PASSWORD` | Zetaris instance |
| `SIFT_PROVIDER` | `nvidia` (OpenAI-compatible bridge) or `meterless` |
| `NVIDIA_BASE_URL`, `NVIDIA_API_KEY`, `NVIDIA_MODEL_FAST`, `NVIDIA_MODEL_DEEP` | OpenAI-compatible bridge and model names |
| `METERLESS_BASE_URL`, `METERLESS_RUNTIME_TOKEN`, `METERLESS_MODEL` | Meterless Runtime |
| `SCOUT_SIGNING_KEY` | signs execution contracts |

## Layout

- `app/` Next.js UI and API routes (`/api/investigate` streams the run over SSE)
- `lib/scout.ts` intent registry, guard and signed contracts
- `lib/hmem.ts` hierarchical memory with provenance and a trust ledger
- `lib/markovian.ts` chunked reasoning engine
- `lib/zetaris.ts` Zetaris REST client
- `lib/agent.ts` the investigation loop and prompts
- `lib/ai.ts` model providers

## Data

All data in the demo is synthetic. No real borrower or personal information is used.
