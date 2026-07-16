import React, { useEffect, useState } from "react";
import { api } from "../../api/client.js";

function confColor(c) { return c >= 0.7 ? "#22b07d" : c >= 0.4 ? "#f0a92c" : "#e0524a"; }

function ResolveForm({ oracleTypes, onResolve, onCancel }) {
  const [oracleType, setOracleType] = useState(Object.keys(oracleTypes)[0] || "background_rate");
  const [metric, setMetric] = useState("");
  const [condition, setCondition] = useState("");
  const [population, setPopulation] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!metric.trim()) return;
    setBusy(true);
    await onResolve(oracleType, metric, { condition, population, metric });
    setBusy(false);
  };
  return (
    <div className="panel" style={{ padding: 14 }}>
      <select className="formf" value={oracleType} onChange={e => setOracleType(e.target.value)}>
        {Object.entries(oracleTypes).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
      </select>
      <input className="formf" placeholder="Metric (e.g. grade 3+ adverse events)" value={metric} onChange={e => setMetric(e.target.value)} />
      <input className="formf" placeholder="Condition (e.g. oncology)" value={condition} onChange={e => setCondition(e.target.value)} />
      <input className="formf" placeholder="Population (e.g. patients in a cancer clinical trial)" value={population} onChange={e => setPopulation(e.target.value)} />
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn primary" disabled={busy} onClick={submit}>{busy ? "Resolving… (~10-20s)" : "Resolve"}</button>
        <button className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export default function Oracles({ q, toast }) {
  const [norms, setNorms] = useState(null);
  const [oracleTypes, setOracleTypes] = useState({});
  const [showForm, setShowForm] = useState(false);

  const load = () => api.normsList().then(r => { if (r.status === "ok") { setNorms(r.norms); setOracleTypes(r.oracle_types); } });
  useEffect(() => { load(); }, []);

  const resolve = async (oracleType, metric, population) => {
    const r = await api.normsResolve(oracleType, metric, population);
    if (r.status === "ok") { toast(`Norm ${r.action}d for "${metric}"`); setShowForm(false); load(); }
    else toast(r.error || "Resolution failed");
  };

  const filtered = (norms || []).filter(n => !q || n.metric.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Oracles</h1><p>External knowledge the agent is allowed to reason from — versioned, confidence-scored, and never overwritten in place.</p></div>
        <div className="acts"><button className="btn primary" onClick={() => setShowForm(s => !s)}>Resolve a norm</button></div>
      </div>
      {showForm && <ResolveForm oracleTypes={oracleTypes} onResolve={resolve} onCancel={() => setShowForm(false)} />}
      {norms === null && <div className="panel"><div className="empty">Loading…</div></div>}
      {norms !== null && filtered.length === 0 && <div className="panel"><div className="empty">No norms resolved yet — use "Resolve a norm" to pull a published-literature benchmark for a metric.</div></div>}
      {filtered.length > 0 && (
        <div className="cards">
          {filtered.map(n => (
            <div className="card" key={n.id}>
              <div className="ch"><span className="cn">{n.metric}</span><span className="pill" style={{ marginLeft: "auto" }}>v{n.version}</span></div>
              <div className="cd">{Object.entries(n.population).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(" · ")}</div>
              <div className="meter"><i style={{ width: `${Math.round(n.confidence * 100)}%`, background: confColor(n.confidence) }} /></div>
              <div className="cf"><i className="dot" style={{ background: confColor(n.confidence) }} />{Math.round(n.confidence * 100)}/100 confidence &middot; {n.approval_status}</div>
              <div className="cf" style={{ borderTop: 0, marginTop: 0, paddingTop: 6 }}>
                median {n.expected_distribution.median} [{n.expected_distribution.ci_low}–{n.expected_distribution.ci_high}]
                <span style={{ marginLeft: "auto" }}>n={n.expected_distribution.sample_size}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
