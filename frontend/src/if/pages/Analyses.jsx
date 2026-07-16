import React, { useEffect, useState } from "react";
import { api } from "../../api/client.js";

const STATUS_CHIP = { publish: ["green", "Complete"], caveats: ["amber", "Caveats"], review: ["amber", "Review"],
  contradicted: ["red", "Contradicted"], reject: ["red", "Rejected"] };

export default function Analyses({ sid, goto, toast }) {
  const [rows, setRows] = useState(null);
  const [running, setRunning] = useState(false);
  const [question, setQuestion] = useState("");
  const [showNew, setShowNew] = useState(false);

  const load = () => api.dashboardsList(sid).then(r => { if (r.dashboards) setRows(r.dashboards.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))); });
  useEffect(() => { load(); }, [sid]);

  const run = async () => {
    if (!question.trim()) return;
    setRunning(true);
    const r = await api.dashboardsGenerate(sid, "copilot", question);
    setRunning(false);
    if (r.status === "ok") { toast("Analysis complete" + (r.dashboard.cache_hit ? " (cached)" : "")); setQuestion(""); setShowNew(false); load(); }
    else toast(r.error || "Analysis failed");
  };

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Analyses</h1><p>Every run here executed real pandas against your data in an isolated container. Completed runs become evidence.</p></div>
        <div className="acts">
          <button className="btn" onClick={() => goto({ v: "ide" })}>Open Code IDE</button>
          <button className="btn primary" onClick={() => setShowNew(s => !s)}>New analysis</button>
        </div>
      </div>

      {showNew && (
        <div className="panel" style={{ padding: 14 }}>
          <input className="formf" placeholder="Ask a question about your data (e.g. What is the response rate by treatment arm?)"
                 value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={e => e.key === "Enter" && run()} />
          <button className="btn primary" disabled={running} onClick={run}>{running ? "Running… (~20-30s)" : "Run"}</button>
        </div>
      )}

      {rows === null && <div className="panel"><div className="empty">Loading…</div></div>}
      {rows !== null && rows.length === 0 && <div className="panel"><div className="empty">No analyses run yet.</div></div>}
      {rows && rows.length > 0 && (
        <div className="cards">
          {rows.map(a => {
            const [c, l] = STATUS_CHIP[a.status] || ["gray", a.status];
            return (
              <div className="card" key={a.dashboard_id}>
                <div className="ch">
                  <span className={`chip ${c}`}>{l}</span>
                  <span className={`agent-tag`} style={{ color: a.source === "copilot" ? "var(--ink-3)" : "var(--ai)" }}>
                    {a.source === "copilot" ? "Manual" : a.source === "autopilot" || a.source === "narrative" ? "Auto" : a.source}
                  </span>
                  {a.cache_hit && <span className="pill" style={{ marginLeft: "auto" }}>cached</span>}
                </div>
                <div className="cn">{a.title}</div>
                <div className="cd" style={{ marginTop: 5 }}>{a.question}</div>
                <div className="cf">
                  <span>{a.chart_type}</span><span>&middot;</span><span>{new Date((a.created_at || 0) * 1000).toLocaleDateString()}</span>
                  {a.evidence_id && (
                    <span className="chip violet" style={{ marginLeft: "auto", cursor: "pointer" }}
                      onClick={() => goto({ v: "evidence", id: a.evidence_id })}>&rarr; evidence</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
