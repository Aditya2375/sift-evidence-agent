# Sift / Synthetic evidence demonstration

Live: https://sift-evidence-agent.vercel.app/
Health/status: https://sift-evidence-agent.vercel.app/api/health

Synthetic lending-portfolio demonstration, not a credit decision or financial advice. Uses deterministic synthetic borrowers/loans/payments and seeded precedent memory. New memory is process-local to one investigation, not persistent learning. Bureau evidence is computed by a local synthetic function, not a network bureau pull. SQL evidence requires a reachable, separately configured Zetaris instance. Public status reports configuration only, not verified connectivity or model identity. The last live pre-fix check returned Zetaris login HTTP 404.

## Safe deployment boundary

Model-backed investigate/action endpoints fail closed unless SIFT_ACCESS_TOKEN is configured to at least 32 characters and the request supplies the exact private bearer token. Do not put this secret in client code or public repositories. The public UI has no token collection or storage. Enable generation only behind an authenticated server-side gateway with a durable rate limiter, usage budget and server-only secret handling. Those deployment controls remain BLOCKED/unconfigured in this audit. No paid or model generation request was used in QA.

The access gate is not a durable distributed quota. Restricted SELECT validation rejects comments, multiple statements, procedural keywords, unknown tables and functions; it is a conservative lexical guard, not a full SQL parser. Database credentials MUST be read-only and limited to the four synthetic LENDING tables. Endpoint limits: 8KB JSON objects and 2000-character questions, bounded SSE buffer and client timeout. Billable generation is never automatically retried or silently sent to another provider. Server cancellation cannot guarantee a provider stopped an already accepted request.

Scout signatures now have process-random fallback keys (not a known default), expiry and constant-time comparison. Intent classification and signatures do not authenticate an analyst or guarantee prompt-injection safety. Any matched bulk-PII intent is refused. Approval is an in-memory demo acknowledgment only: no borrower file is written and nothing is sent. Pending demo drafts expire in five minutes and may disappear on restart or cross-instance routing.

## Run

npm install; npm run dev; npm run build. Environment names are in .env.example. Configure actual server-owned provider and Zetaris connections separately; this audit did not inspect credentials or change account security. Token counts and savings are estimates, not provider billing metrics. Cause/evidence text is model output and needs analyst review.

## Remaining checks

Restore and verify the Zetaris connection; provision read-only DB permissions; configure private access plus durable distributed abuse/spend limits; then run an authorized end-to-end investigation using synthetic data. Actual provider/model availability is unverified. Do not assert a particular vendor, model, runtime compatibility or current price from configuration defaults alone.

Support: adityakulkarnicoding@gmail.com
