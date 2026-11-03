"use client";
import { useEffect, useRef, useState } from "react";

type Any = any;

const SAMPLES = [
  "Why did on-time payments drop in the South region this quarter?",
  "Why is B-041 always late?",
  "Compare South agri borrowers with the rest of the book since July",
  "Give me a portfolio summary",
];
const GUARDED = "Draft a payment-plan letter for B-041";
const REFUSED = "Export all borrower phone numbers and addresses";

function mdLite(s: string) {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/^### (.*)$/gm, "<h3>$1</h3>")
    .replace(/^## (.*)$/gm, "<h2>$1</h2>")
    .replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br/>");
}

export default function Console() {
  const [q, setQ] = useState(SAMPLES[0]);
  const [running, setRunning] = useState(false);
  const [scout, setScout] = useState<Any>(null);
  const [memories, setMemories] = useState<Any[]>([]);
  const [chunks, setChunks] = useState<Any[]>([]);
  const [tools, setTools] = useState<Any[]>([]);
  const [report, setReport] = useState<string>("");
  const [evidence, setEvidence] = useState<Any[]>([]);
  const [stats, setStats] = useState<Any>(null);
  const [refusal, setRefusal] = useState<string>("");
  const [health, setHealth] = useState<Any>(null);
  const [action, setAction] = useState<Any>(null);
  const [actionResult, setActionResult] = useState<string>("");
  const abortRef=useRef<AbortController|null>(null);
  const traceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/health",{signal:AbortSignal.timeout(8000)}).then((r) => r.json()).then(setHealth).catch(() => setHealth(null));
  }, []);
  useEffect(() => {
    traceRef.current?.scrollTo({ top: traceRef.current.scrollHeight, behavior: "smooth" });
  }, [chunks, tools, report]);

  async function ask(question: string) {
    if(running||!question.trim())return;
    const controller=new AbortController();abortRef.current=controller;const timer=setTimeout(()=>controller.abort(),240000);
    try{
    setRunning(true); setScout(null); setMemories([]); setChunks([]); setTools([]);
    setReport(""); setEvidence([]); setStats(null); setRefusal(""); setAction(null); setActionResult("");
    const res = await fetch("/api/investigate", {
      method: "POST", signal:controller.signal,headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question }),
    });
    if(!res.ok)throw Error((await res.json()).error||"Investigation unavailable");
    if(!res.body)throw Error("No response stream");const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });if(buf.length>1000000){await reader.cancel();throw Error("Response too large")}
      const parts = buf.split("\n\n"); buf = parts.pop() || "";
      for (const p of parts) {
        if (!p.startsWith("data: ")) continue;
        const ev = JSON.parse(p.slice(6));
        if (ev.type === "scout") {
          setScout(ev.data);
          if (ev.data.kind !== "contract") setRefusal(ev.data.reason || "Refused.");
        }
        if (ev.type === "memories") setMemories(ev.data);
        if (ev.type === "chunk") setChunks((c) => [...c, ev.data]);
        if (ev.type === "tool") setTools((t) => [...t, ev.data]);
        if (ev.type === "report") { setReport(ev.data.report); setEvidence(ev.data.evidence); }
        if (ev.type === "run-stats") setStats(ev.data);
        if (ev.type === "error") setRefusal(String(ev.data));
      }
    }
    }catch(e){setRefusal(e instanceof Error?e.message:"Connection interrupted")}finally{clearTimeout(timer);abortRef.current=null;setRunning(false)}
  }

  async function draftAction(){setRefusal("Private model-backed demo is paused. A deployed authenticated gateway and usage budget are required before enabling generation.")}
  async function decideAction(approved:boolean){setActionResult(approved?"Demo acknowledgment only. No borrower file written or external send.":"Draft discarded in this view.");setAction(null)}

  const stageState = (n: number) => {
    if (n === 1) return scout ? "done" : running ? "active" : "";
    if (n === 2) return chunks.length || tools.length ? (report ? "done" : "active") : memories.length ? "active" : "";
    if (n === 3) return report ? "done" : chunks.length ? "active" : "";
    return "";
  };

  return (
    <div className="shell">
      <header className="top">
        <span className="wordmark">Sift<em>.</em></span>
        <span className="tagline">Ask why. Get an investigation with receipts, not a vibe.</span>
        <span className="status-dot mono">
          <span>Zetaris {health ? (health.zetaris?.ok ? <b className="ok">federated</b> : <b className="warn">unverified</b>) : <b className="warn">...</b>}</span>
          <span>Reasoning {health ? <b className="warn">configured, not probed</b> : <b className="warn">...</b>}</span>
        </span>
      </header>

      <p className="demo-note">Synthetic demonstration only, not lending advice. Model-backed endpoints are paused for unauthenticated callers. Zetaris connectivity and actual model identity are not verified by this public page. New runs do not retain case memory. No letters are sent or borrower files written.</p>
      <div className="ask">
        <input aria-label="Synthetic portfolio question" maxLength={2000} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !running && ask(q)} placeholder="Ask a why question about the book..." />
        <button disabled={running} onClick={() => ask(q)}>{running ? "Investigating" : "Investigate"}</button>
      </div>
      <div className="samples">
        {SAMPLES.map((s) => <button key={s} onClick={() => { setQ(s); if (!running) ask(s); }}>{s}</button>)}
        <button onClick={() => !running && draftAction()}>{GUARDED} (guarded)</button>
        <button className="danger" onClick={() => { setQ(REFUSED); if (!running) ask(REFUSED); }}>{REFUSED}</button>
      </div>

      <div className="grid">
        <div>
          <div className="panel" ref={traceRef} style={{ maxHeight: 640, overflow: "auto" }}>
            <h3>Investigation trace</h3>

            {refusal && <div className="refusal"><b>Refused at the boundary.</b> {refusal}</div>}

            {scout?.contract && (
              <div className={`stage ${stageState(1)}`}>
                <h4>1 · Sense, guard &amp; sign</h4>
                <div className="body">Scout classified the request and issued a signed execution contract. The bound question is still passed to the model; classification is not a prompt-injection defense.</div>
                <div className="contract mono">
                  <div className="row"><span className="k">intent</span><span className="v">{scout.contract.intent}</span></div>
                  <div className="row"><span className="k">risk</span><span className={`v risk-${scout.contract.risk}`}>{scout.contract.risk}</span></div>
                  <div className="row"><span className="k">trace</span><span className="v">{scout.contract.traceId}</span></div>
                  <div className="row"><span className="k">registry</span><span className="v">v{scout.contract.registryVersion}</span></div>
                  <div className="row"><span className="k">signature</span><span className="v">{scout.contract.signature.slice(0, 16)}...</span></div>
                  {scout.flags?.length > 0 && <div className="row"><span className="k">flags</span><span className="v">{scout.flags.join(", ")}</span></div>}
                </div>
              </div>
            )}

            {memories.length > 0 && (
              <div className="stage done">
                <h4>2 · Prior cases recalled (H-MEM)</h4>
                {memories.map((m) => (
                  <div className="memchip" key={m.id}>
                    <span className="src">{m.provenance?.label} · confidence {m.confidence}</span>
                    {m.content.length > 260 ? m.content.slice(0, 260) + "..." : m.content}
                  </div>
                ))}
              </div>
            )}

            {(chunks.length > 0 || running && scout?.contract) && (
              <div className={`stage ${stageState(2)}`}>
                <h4>3 · Markovian investigation</h4>
                <div className="body">Bounded chunks; each step sees only the goal and a compressed state, never the growing history.</div>
                {chunks.map((c) => (
                  <div className="chunk" key={c.id}>
                    <div className="meta"><span>chunk {c.id}</span><span>{c.tokens} tok</span></div>
                    <pre>{c.preview}</pre>
                  </div>
                ))}
                {tools.map((t, i) => (
                  <div className={`toolcall ${t.error ? "err" : ""}`} key={i}>
                    <div className="meta">{t.kind === "sql" ? "Zetaris Lightning SQL" : "Synthetic bureau function"} {t.id ? `· evidence ${t.id}` : ""} {t.rowCount != null ? `· ${t.rowCount} rows` : ""}</div>
                    <pre>{t.sql ? t.sql : t.error ? t.error : JSON.stringify(t.sample, null, 1)}</pre>
                  </div>
                ))}
              </div>
            )}

            {report && (
              <div className={`stage ${stageState(3)}`}>
                <h4>4 · Cited answer</h4>
              </div>
            )}
            {report && <div className="report" dangerouslySetInnerHTML={{ __html: "<p>" + mdLite(report) + "</p>" }} />}

            {action && (
              <div className="action-card">
                <h4>Human approval required - high-risk action under contract {action.contract?.traceId}</h4>
                <div className="body" style={{ fontSize: 12.5, color: "var(--dim)" }}>Scout issued a high-risk contract. The draft exists, but this is a simulation only: approval writes no borrower file and sends nothing.</div>
                <pre>{action.draft}</pre>
                <div className="btns">
                  <button className="yes" onClick={() => decideAction(true)}>Acknowledge demo draft</button>
                  <button className="no" onClick={() => decideAction(false)}>Reject</button>
                </div>
              </div>
            )}
            {actionResult && <div className="action-card" style={{ borderColor: "var(--accent)" }}><h4 style={{ color: "var(--accent)" }}>Action resolved</h4><div style={{ fontSize: 13 }}>{actionResult}</div></div>}

            {!scout && !running && !refusal && <div className="body" style={{ padding: "18px", color: "var(--faint)", fontSize: 13 }}>The trace appears here: contract, recalled cases, chunks, tool calls, cited answer.</div>}
          </div>

          {stats && (
            <div className="panel" style={{ marginTop: 16 }}>
              <h3>Markovian run</h3>
              <div className="stats">
                <span><b>{stats.chunks?.length}</b>chunks</span>
                <span><b>{stats.totalTokensUsed}</b>estimated tokens</span>
                <span><b>{stats.totalTokensSaved}</b>estimated savings vs full-history baseline</span>
                <span><b>{stats.efficiencyPercent}%</b>estimated reduction</span>
                <span><b>{(stats.durationMs / 1000).toFixed(1)}s</b>duration</span>
                <span><b>{stats.status}</b>status</span>
              </div>
            </div>
          )}
        </div>

        <div className="panel" style={{ maxHeight: 640, overflow: "auto" }}>
          <h3>Evidence ledger</h3>
          {evidence.length === 0 && <div className="body" style={{ padding: "14px 18px", color: "var(--faint)", fontSize: 13 }}>Every SQL result, bureau pull and recalled case lands here with an id the answer cites.</div>}
          {evidence.map((e) => (
            <div className="ev-item" key={e.id}>
              <span className="ev-id">{e.id}</span><span className="ev-kind">{e.kind}</span>
              <div style={{ marginTop: 3, color: "var(--ink)" }}>{e.label}</div>
              <pre>{e.detail}{e.rows ? "\n" + JSON.stringify(e.rows, null, 1)?.slice(0, 700) : ""}</pre>
            </div>
          ))}
        </div>
      </div>

      <footer>
        Synthetic data only. No credit decision, borrower communication or persistent case file is produced. The configured provider is not verified merely because a key exists. Tool evidence may still be incomplete or mistaken. Source: <a href="https://github.com/Aditya2375/sift-evidence-agent">GitHub</a>. Technical support: <a href="mailto:adityakulkarnicoding@gmail.com">adityakulkarnicoding@gmail.com</a>.
      </footer>
    </div>
  );
}
