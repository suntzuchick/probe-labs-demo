import React, { useEffect, useRef, useState } from "react";
import { C, AGENTS } from "../../tokens.js";
import { api } from "../../api/client.js";

const STAGES = [
  { k: "ingest", n: "Ingest", agent: null },
  { k: "extract", n: "Extraction trace", agent: "extract" },
  { k: "quality", n: "Data quality", agent: "quality" },
  { k: "derive", n: "Derivation", agent: null },
  { k: "index", n: "Build indexes", agent: "index" },
];

const CONN = [
  { k: "upload", n: "Upload files", d: "CSV · XLSX · PDF · plate maps", ic: "↑", c: C.plum },
  { k: "sheets", n: "Google Sheets", d: "cohort lists, tracking tables (visual only — no OAuth wired)", ic: "▦", c: "#3B6D11" },
  { k: "benchling", n: "Benchling", d: "ELN · assay runs · registered entities (visual only)", ic: "🧪", c: C.green },
  { k: "redcap", n: "REDCap", d: "clinical data capture (visual only)", ic: "⌘", c: C.blue },
];

const DOMAIN_LABELS = { DM: "Demographics", EX: "Exposure", AE: "Adverse events", RS: "Tumor response", DS: "Disposition" };
const LEVEL_COLOR = { done: "#5DCAA5", match: "#5DCAA5", review: "#F0B44B", reject: "#9E99AE", error: "#E06666", info: "#85B7EB" };
const LEVEL_ICON = { done: "✓", match: "✓", review: "~", reject: "×", error: "!", info: "·" };

const SEVERITY_LABEL = { high: "HIGH", medium: "MEDIUM", low: "LOW" };
const ISSUE_TYPE_LABEL = {
  missing: "Missing values", duplicates: "Duplicate rows", outlier: "Outlier values", mixed_case: "Inconsistent casing",
  missing_required_field: "Missing required field", missing_required_value: "Missing required value",
  duplicate_key: "Duplicate key", ct_violation: "Controlled terminology violation",
  implausible_value: "Implausible value", date_order_violation: "Date ordering error",
  orphaned_subject: "Orphaned subject (referential integrity)",
};

export default function Ingest({ sid, setRoute }) {
  const [stage, setStage] = useState(0);
  const [connector, setConnector] = useState(null);
  const [busy, setBusy] = useState(false);
  const [noteVisual, setNoteVisual] = useState(false);
  const [traceFeed, setTraceFeed] = useState([]);
  const [domainsSeen, setDomainsSeen] = useState([]);
  const [quality, setQuality] = useState({ status: "idle", issues: [], selected: new Set() });
  const [derivePlan, setDerivePlan] = useState(null);
  const [deriveResult, setDeriveResult] = useState(null);
  const [indexResult, setIndexResult] = useState(null);
  const [built, setBuilt] = useState(0);
  const fileInputRef = useRef(null);
  const tm = useRef([]);

  useEffect(() => () => tm.current.forEach(clearTimeout), []);

  const feedTrace = (lines) => {
    tm.current.forEach(clearTimeout);
    tm.current = [];
    setTraceFeed([]);
    lines.forEach((l, i) => tm.current.push(setTimeout(() => setTraceFeed(f => [...f, l]), 140 * (i + 1))));
  };

  const afterLoad = (domains, traces) => {
    setDomainsSeen(domains);
    feedTrace(traces.flat());
    setStage(1);
  };

  const runLoadSample = async () => {
    setBusy(true);
    try {
      const res = await api.loadSample(sid);
      if (res.status === "ok") {
        const traces = res.traces.map(t => t.trace);
        afterLoad(Object.keys(res.loaded), traces);
      }
    } finally { setBusy(false); }
  };

  const pickConnector = (k) => {
    setConnector(k);
    if (k === "upload") {
      fileInputRef.current?.click();
      return;
    }
    setNoteVisual(true);
    runLoadSample();
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const res = await api.upload(sid, file);
      if (res.extraction) {
        const domain = res.extraction.detected_layout === "plate_map" ? "PLATE" : (res.extraction.filename || "file");
        afterLoad([domain], [res.trace || []]);
      }
    } finally { setBusy(false); }
  };

  const enterQuality = async () => {
    setStage(2);
    setQuality({ status: "loading", issues: [], selected: new Set() });
    const data = await api.qualityCheck(sid);
    const issues = data.issues || [];
    const selected = new Set(issues.map((iss, i) => (iss.severity === "high" && iss.fix_label ? i : null)).filter(i => i !== null));
    setQuality({ status: "ok", issues, selected });
  };

  const toggleFix = (i) => {
    setQuality(q => {
      const next = new Set(q.selected);
      next.has(i) ? next.delete(i) : next.add(i);
      return { ...q, selected: next };
    });
  };

  const applyQualityAndDerive = async () => {
    setBusy(true);
    try {
      const fixes = [...quality.selected].map(i => quality.issues[i]);
      if (fixes.length) await api.qualityApply(sid, fixes);
      const plan = await api.derivePlan(sid);
      setDerivePlan(plan);
      setStage(3);
      const result = await api.derive(sid);
      setDeriveResult(result);
    } finally { setBusy(false); }
  };

  const runIndexes = async () => {
    setStage(4);
    setBusy(true);
    try {
      const result = await api.indexBuild(sid);
      setIndexResult(result);
    } finally { setBusy(false); }
  };

  useEffect(() => {
    if (stage !== 4 || !indexResult) return;
    const t = setInterval(() => setBuilt(b => (b < 5 ? b + 1 : b)), 220);
    return () => clearInterval(t);
  }, [stage, indexResult]);

  const S = STAGES[stage];
  const ag = S.agent ? AGENTS[S.agent] : null;

  return (
    <div style={{ display: "flex", height: "100%", background: C.cream }}>
      <input ref={fileInputRef} type="file" style={{ display: "none" }} onChange={onFile} />

      <div style={{ width: 230, flexShrink: 0, borderRight: `1px solid ${C.line2}`, padding: "34px 26px" }}>
        <div style={{ fontFamily: C.mono, fontSize: 11, color: C.faint, letterSpacing: ".14em", marginBottom: 22 }}>STAGES</div>
        {STAGES.map((s, i) => (
          <div key={s.k} onClick={() => i <= stage && i < stage && setStage(i)} style={{ display: "grid", gridTemplateColumns: "30px 1fr", gap: "0 12px", cursor: i < stage ? "pointer" : "default" }}>
            <div style={{ gridRow: 1, width: 26, height: 26, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600, fontFamily: C.mono,
              background: i < stage ? C.blue : "#fff", border: `1.5px solid ${i <= stage ? C.blue : C.line3}`, color: i < stage ? "#fff" : i === stage ? C.blue : C.faint,
              boxShadow: i === stage ? `0 0 0 4px ${C.blueBg}` : "none" }}>{i < stage ? "✓" : i + 1}</div>
            <div style={{ gridColumn: 2, alignSelf: "center", fontFamily: C.serif, fontSize: 17, fontWeight: 500, color: i <= stage ? C.plum : C.faint }}>{s.n}</div>
            <div style={{ gridColumn: 2, fontFamily: C.mono, fontSize: 11, color: C.faint, paddingBottom: 16, marginTop: 2 }}>
              {i === 0 ? (connector ? `${domainsSeen.length} domain(s)` : "awaiting files") : i < stage ? "done" : i === stage ? "running" : "—"}
            </div>
            {i < 4 && <div style={{ gridColumn: 1, justifySelf: "center", width: 1.5, background: i < stage ? C.blue : C.line2, minHeight: 12 }} />}
          </div>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "36px 46px 70px" }}>
        <div style={{ fontFamily: C.mono, fontSize: 12, color: C.blue, letterSpacing: ".1em", marginBottom: 10 }}>STAGE {stage + 1} OF 5</div>
        <h1 style={{ fontFamily: C.serif, fontSize: 34, fontWeight: 500, color: C.plum, margin: "0 0 10px" }}>
          {["Ingest source files", "Extraction agent trace", "Data quality", "Derive analysis datasets", "Build indexes"][stage]}
        </h1>

        {ag && (
          <div style={{ display: "inline-flex", alignItems: "center", gap: 9, background: "#fff", border: `1px solid ${ag.c}40`, borderRadius: 20, padding: "6px 14px", marginBottom: 16 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: ag.c, animation: "pulse 1.4s infinite" }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: ag.c }}>{ag.n}</span>
            <span style={{ fontSize: 12.5, color: C.muted2 }}>{ag.d}</span>
          </div>
        )}

        {stage === 0 && (
          <>
            <p style={{ fontSize: 16, color: C.muted, lineHeight: 1.6, maxWidth: "62ch", marginBottom: 22 }}>
              Connect a source, or drop files. The probe detects format and reads the real content.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12, maxWidth: 620, marginBottom: 20 }}>
              {CONN.map(c => (
                <div key={c.k} onClick={() => !busy && pickConnector(c.k)} className="nav" style={{ display: "flex", alignItems: "center", gap: 13, background: "#fff", border: `1px solid ${C.line2}`, borderRadius: 13, padding: "16px 18px", cursor: busy ? "wait" : "pointer" }}>
                  <span style={{ width: 38, height: 38, borderRadius: 10, background: c.c + "16", color: c.c, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, flexShrink: 0 }}>{c.ic}</span>
                  <div><div style={{ fontSize: 15, fontWeight: 600, color: C.plum }}>{c.n}</div><div style={{ fontSize: 12.5, color: C.muted2 }}>{c.d}</div></div>
                </div>
              ))}
            </div>
            <button onClick={() => !busy && runLoadSample()} disabled={busy} style={{ background: "#fff", border: `1px solid ${C.line2}`, borderRadius: 12, padding: "15px 20px", fontSize: 15, color: C.plum, fontWeight: 600, cursor: busy ? "wait" : "pointer", fontFamily: C.sans, maxWidth: 620, width: "100%", textAlign: "left" }}>
              ▶ Load RASolute 302 (simulated) — 5 domains, 200 subjects
            </button>
            {noteVisual && (
              <div style={{ marginTop: 14, fontSize: 12.5, color: C.faint, maxWidth: 620 }}>
                {connector} isn't OAuth-wired in this build — loading the bundled sample dataset instead so the rest of the pipeline runs on real data.
              </div>
            )}
            {busy && <div style={{ marginTop: 14, fontSize: 13, color: C.muted2 }}>reading files…</div>}
          </>
        )}

        {stage === 1 && (
          <>
            <p style={{ fontSize: 16, color: C.muted, lineHeight: 1.6, maxWidth: "64ch", marginBottom: 18 }}>
              A live account of what the agent did to each file — format detection, and a confidence score for every column mapping, including rejections.
            </p>
            <div style={{ background: C.term, borderRadius: 13, padding: "20px 22px", fontFamily: C.mono, fontSize: 13, lineHeight: 2, maxWidth: 720, minHeight: 120 }}>
              {traceFeed.map((l, i) => <div key={i} style={{ color: LEVEL_COLOR[l.level] || "#ccc", animation: "fade .3s" }}>{LEVEL_ICON[l.level] || "·"} {l.text}</div>)}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 11, maxWidth: 720, marginTop: 18 }}>
              {Object.entries(DOMAIN_LABELS).map(([c, l]) => (
                <div key={c} style={{ background: "#fff", border: `1px solid ${domainsSeen.includes(c) ? C.blue : C.line2}`, borderRadius: 11, padding: "14px", textAlign: "center", opacity: domainsSeen.includes(c) ? 1 : .4 }}>
                  <div style={{ fontFamily: C.mono, fontSize: 15, fontWeight: 600, color: C.muted2 }}>{c}</div>
                  <div style={{ fontSize: 12, color: C.faint, marginTop: 3 }}>{l}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {stage === 2 && (
          <>
            {quality.status === "loading" && <p style={{ fontSize: 15, color: C.muted2 }}>Scanning variables…</p>}
            {quality.status === "ok" && quality.issues.length === 0 && (
              <div style={{ background: C.greenBg, borderRadius: 12, padding: "16px 20px", color: C.green, fontSize: 15, maxWidth: 720 }}>✓ No issues detected — all variables passed quality checks.</div>
            )}
            {quality.status === "ok" && quality.issues.length > 0 && (
              <>
                <p style={{ fontSize: 16, color: C.muted, marginBottom: 18 }}>{quality.issues.length} issue{quality.issues.length > 1 ? "s" : ""} detected. Select fixes to apply before derivation.</p>
                {quality.issues.map((iss, i) => (
                  <div key={i} style={{ background: "#fff", border: `1px solid ${C.line2}`, borderLeft: `4px solid ${iss.severity === "high" ? C.orange : iss.severity === "medium" ? C.amber : C.line3}`, borderRadius: "0 12px 12px 0", padding: "17px 19px", marginBottom: 13, maxWidth: 720 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 7 }}>
                      {iss.fix_label ? (
                        <input type="checkbox" checked={quality.selected.has(i)} onChange={() => toggleFix(i)} />
                      ) : <span style={{ width: 16 }} />}
                      <span style={{ fontSize: 15, fontWeight: 600, color: C.plum }}>{ISSUE_TYPE_LABEL[iss.type] || iss.type}</span>
                      <span style={{ marginLeft: "auto", fontFamily: C.mono, fontSize: 10, color: C.red, background: C.redBg, borderRadius: 6, padding: "3px 8px" }}>{SEVERITY_LABEL[iss.severity] || iss.severity}</span>
                    </div>
                    <div style={{ fontFamily: C.mono, fontSize: 12.5, color: C.muted2, marginBottom: 5 }}>{iss.var || iss.domain}{iss.col ? "." + iss.col : ""}</div>
                    <div style={{ fontSize: 14, color: C.ink, marginBottom: 9 }}>{iss.description}</div>
                    <div style={{ fontSize: 13.5 }}>
                      {iss.fix_label
                        ? <><b style={{ color: C.plum, fontWeight: 500 }}>Proposed fix:</b> <span style={{ fontFamily: C.mono, fontSize: 12.5, color: C.muted, background: C.soft2, borderRadius: 6, padding: "3px 8px" }}>{iss.fix_label}</span></>
                        : <><b style={{ color: C.plum, fontWeight: 500 }}>Action required:</b> <span style={{ fontSize: 12.5, color: C.red }}>Manual correction needed in source data</span></>}
                    </div>
                  </div>
                ))}
              </>
            )}
          </>
        )}

        {stage === 3 && (
          <>
            <div style={{ display: "inline-block", fontFamily: C.mono, fontSize: 12.5, color: C.blue, background: C.blueBg, borderRadius: 8, padding: "5px 12px", marginBottom: 14 }}>{derivePlan?.context_label || "…"}</div>
            <p style={{ fontSize: 16, color: C.muted, marginBottom: 20, maxWidth: "64ch" }}>{derivePlan?.description} <b style={{ color: C.plum }}>Pure pandas, no model involved</b> — derivation must be byte-reproducible.</p>
            {!deriveResult && <p style={{ fontSize: 14, color: C.muted2 }}>deriving…</p>}
            {deriveResult?.status === "ok" && Object.entries(deriveResult.datasets).map(([n, meta]) => (
              <div key={n} style={{ display: "flex", alignItems: "center", gap: 15, padding: "17px 0", borderTop: `1px solid ${C.line2}`, maxWidth: 720 }}>
                <span style={{ width: 32, height: 32, borderRadius: "50%", background: C.blue, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>✓</span>
                <div><div style={{ fontSize: 16, fontWeight: 600, color: C.plum }}>{n.toUpperCase()}</div>
                  <div style={{ fontFamily: C.mono, fontSize: 12.5, color: C.muted2, marginTop: 2 }}>{meta.rows} rows · {meta.columns.length} columns</div></div>
              </div>
            ))}
            {deriveResult && deriveResult.status !== "ok" && (
              <div style={{ background: C.redBg, color: C.red, borderRadius: 10, padding: "14px 18px", maxWidth: 720 }}>{deriveResult.error || JSON.stringify(deriveResult)}</div>
            )}
          </>
        )}

        {stage === 4 && (
          <>
            <p style={{ fontSize: 16, color: C.muted, marginBottom: 20, maxWidth: "66ch" }}>
              The derived data becomes the memory the agents read from — what the data can answer, and what it can't.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 11, maxWidth: 720, marginBottom: 20 }}>
              {[["Dataset", "what can it answer?"], ["Schema", "what does each column mean?"], ["Entity", "which subjects, arms, events?"], ["Metric", "what can we measure?"],
                ["Cohort", "what groups, at what N?"], ["Narrative", "what stories exist? (populates once generated)"], ["Finding", "what has already been concluded? (populates once generated)"]].map(([k, d], i) => (
                <div key={k} style={{ background: "#fff", border: `1px solid ${C.line2}`, borderRadius: 11, padding: "13px 15px", opacity: i < built ? 1 : .3, transition: "opacity .3s" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 14.5, fontWeight: 600, color: C.plum }}>{k}</span>
                    <span style={{ color: C.green, fontSize: 13 }}>{i < built ? "✓" : "…"}</span>
                  </div>
                  <div style={{ fontSize: 12, color: C.muted2, marginTop: 3 }}>{d}</div>
                </div>
              ))}
            </div>
            {indexResult?.status === "ok" && built >= 5 && (
              <div style={{ background: "#fff", border: `1px solid ${C.pinkPale}`, borderLeft: `3px solid ${C.pink}`, borderRadius: "0 13px 13px 0", padding: "18px 20px", maxWidth: 720, animation: "fade .4s" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.pink, animation: "pulse 1.4s infinite" }} />
                  <span style={{ fontFamily: C.mono, fontSize: 11, fontWeight: 700, color: C.pink, letterSpacing: ".06em" }}>DATASET UNDERSTANDING</span>
                </div>
                <div style={{ fontSize: 15, color: C.ink, lineHeight: 1.6, marginBottom: 12 }}>
                  <b>{indexResult.understanding.dataset_type}</b> · entities: {indexResult.understanding.entities.join(", ")} ·{" "}
                  {indexResult.understanding.supported_analyses.length} supported analyses, {indexResult.understanding.unsupported_analyses.length} unsupported.
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button onClick={() => setRoute({ v: "corpus" })} style={{ border: "none", background: C.grad, color: "#fff", borderRadius: 9, padding: "10px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: C.sans }}>
                    See the corpus →
                  </button>
                  <button onClick={() => setRoute({ v: "narrative", mode: "generate" })} style={{ border: `1px solid ${C.line2}`, background: "#fff", color: C.plum, borderRadius: 9, padding: "10px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: C.sans }}>
                    Generate a narrative →
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {stage === 1 && traceFeed.length > 0 && (
          <button onClick={enterQuality} style={{ marginTop: 26, border: "none", background: C.plum, color: "#fff", borderRadius: 10, padding: "13px 24px", fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: C.sans }}>Continue →</button>
        )}
        {stage === 2 && quality.status === "ok" && (
          <button onClick={applyQualityAndDerive} disabled={busy} style={{ marginTop: 26, border: "none", background: C.plum, color: "#fff", borderRadius: 10, padding: "13px 24px", fontSize: 15, fontWeight: 600, cursor: busy ? "wait" : "pointer", fontFamily: C.sans }}>Continue →</button>
        )}
        {stage === 3 && deriveResult?.status === "ok" && (
          <button onClick={runIndexes} style={{ marginTop: 26, border: "none", background: C.plum, color: "#fff", borderRadius: 10, padding: "13px 24px", fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: C.sans }}>Continue →</button>
        )}
      </div>
    </div>
  );
}
