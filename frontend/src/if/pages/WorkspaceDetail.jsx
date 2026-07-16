import React, { useEffect, useState } from "react";
import { api } from "../../api/client.js";
import { Ic, PATHS } from "../Icons.jsx";

const STATE_LABELS = { draft: "Draft", analysis_ready: "Analysis ready", analysis_reviewed: "Analysis reviewed",
  narrative_ready: "Narrative ready", scientific_review: "Scientific review", approved: "Approved",
  published: "Published", superseded: "Superseded" };
const NEXT_STATES = { draft: ["analysis_ready"], analysis_ready: ["analysis_reviewed", "draft"],
  analysis_reviewed: ["narrative_ready", "analysis_ready"], narrative_ready: ["scientific_review", "analysis_reviewed"],
  scientific_review: ["approved", "narrative_ready"], approved: ["published", "scientific_review"], published: ["superseded"], superseded: [] };
const STATE_CHIP = (s) => s === "published" ? "green" : s === "superseded" ? "gray" : ["approved", "scientific_review"].includes(s) ? "violet" : ["narrative_ready", "analysis_reviewed"].includes(s) ? "blue" : "amber";

function EvidencePicker({ sid, workspace, onAdd, onClose }) {
  const [rows, setRows] = useState(null);
  useEffect(() => { api.evidenceList(sid).then(r => { if (r.status === "ok") setRows(r.evidence); }); }, [sid]);
  const attached = new Set(workspace.evidence_ids);
  const avail = (rows || []).filter(r => !attached.has(r.id));
  return (
    <div className="panel" style={{ padding: 10, marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>Add evidence</span>
        <button className="icon-btn" style={{ marginLeft: "auto", width: 22, height: 22 }} onClick={onClose}><Ic d={PATHS.close} size={12} sw={2} /></button>
      </div>
      {rows === null && <div style={{ fontSize: 12, color: "var(--ink-3)" }}>Loading…</div>}
      {rows !== null && avail.length === 0 && <div style={{ fontSize: 12, color: "var(--ink-3)" }}>No more unattached evidence in this workspace.</div>}
      {avail.map(r => (
        <div key={r.id} className="row" style={{ padding: "7px 0" }}>
          <span style={{ flex: 1, fontSize: 12.5 }}>{r.claim.slice(0, 90)}</span>
          <span className="chip blue">{r.kind}</span>
          <button className="btn" style={{ height: 24, padding: "0 8px", fontSize: 11 }} onClick={() => onAdd(r.id)}>+ add</button>
        </div>
      ))}
    </div>
  );
}

function BlockEditor({ blocks, onChange }) {
  const TYPES = ["title", "thesis", "text", "evidence", "counterevidence", "limitations", "next_analysis", "conclusion"];
  const update = (i, f, v) => onChange(blocks.map((b, j) => j === i ? { ...b, [f]: v } : b));
  const remove = (i) => onChange(blocks.filter((_, j) => j !== i));
  return (
    <div>
      {blocks.map((b, i) => (
        <div key={i} className="panel" style={{ padding: 9, marginBottom: 6 }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 5 }}>
            <select value={b.type} onChange={e => update(i, "type", e.target.value)} style={{ fontFamily: "var(--mono)", fontSize: 10.5, border: "1px solid var(--line-2)", borderRadius: 6, padding: "3px 6px" }}>
              {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <button style={{ marginLeft: "auto", color: "var(--ink-3)" }} onClick={() => remove(i)}><Ic d={PATHS.close} size={13} sw={2} /></button>
          </div>
          <textarea value={b.text || ""} onChange={e => update(i, "text", e.target.value)} rows={2}
                    style={{ width: "100%", border: "1px solid var(--line)", borderRadius: 6, padding: 7, fontSize: 13 }} />
        </div>
      ))}
      <button style={{ width: "100%", border: "1px dashed var(--line-2)", borderRadius: 8, padding: "8px 0", fontSize: 12.5, color: "var(--ink-3)" }}
              onClick={() => onChange([...blocks, { type: "text", text: "" }])}>+ add block</button>
    </div>
  );
}

function Comments({ wid, track, label, toast }) {
  const [comments, setComments] = useState([]);
  const [text, setText] = useState("");
  const load = () => api.workspaceComments(wid, track).then(r => { if (r.status === "ok") setComments(r.comments); });
  useEffect(() => { load(); }, [wid]);
  const add = async () => { if (!text.trim()) return; await api.workspaceAddComment(wid, track, "reviewer", text); setText(""); load(); };
  const resolve = async (cid) => { await api.commentResolve(cid); load(); };
  const open = comments.filter(c => c.status === "open").length;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-2)", marginBottom: 6 }}>{label} {open > 0 && <span style={{ color: "var(--amber)" }}>({open} open)</span>}</div>
      {comments.map(c => (
        <div key={c.id} style={{ display: "flex", gap: 8, padding: "5px 0", borderBottom: "1px solid var(--line-2)" }}>
          <span style={{ fontSize: 12, flex: 1, textDecoration: c.status === "resolved" ? "line-through" : "none", color: c.status === "resolved" ? "var(--ink-3)" : "var(--ink)" }}>{c.comment}</span>
          {c.status === "open" && <button className="btn" style={{ height: 22, padding: "0 7px", fontSize: 10.5 }} onClick={() => resolve(c.id)}>resolve</button>}
        </div>
      ))}
      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        <input className="formf" style={{ marginBottom: 0, flex: 1 }} value={text} onChange={e => setText(e.target.value)} placeholder={`Add ${label.toLowerCase()} comment…`} onKeyDown={e => e.key === "Enter" && add()} />
        <button className="btn" onClick={add}>Add</button>
      </div>
    </div>
  );
}

export default function WorkspaceDetail({ sid, id, goto, toast }) {
  const [ws, setWs] = useState(null);
  const [evMap, setEvMap] = useState({});
  const [branches, setBranches] = useState([]);
  const [showPicker, setShowPicker] = useState(false);
  const [branching, setBranching] = useState(false);
  const [transitionError, setTransitionError] = useState(null);

  const load = () => {
    api.workspaceGet(id).then(r => { if (r.status === "ok") setWs(r.workspace); });
    api.workspaceBranches(id).then(r => { if (r.status === "ok") setBranches(r.branches); });
  };
  useEffect(() => { load(); }, [id]);
  useEffect(() => {
    if (ws?.evidence_ids?.length) api.evidenceBulk(ws.evidence_ids).then(r => { if (r.status === "ok") setEvMap(Object.fromEntries(r.evidence.map(e => [e.id, e]))); });
  }, [ws?.evidence_ids?.join(",")]);

  if (!ws) return <div className="page"><div className="empty">Loading drafting workspace…</div></div>;

  const doTransition = async (status) => {
    setTransitionError(null);
    const r = await api.workspaceTransition(id, status);
    if (r.status !== "ok") setTransitionError(r.error); else toast(`Moved to ${STATE_LABELS[status]}`);
    load();
  };
  const doBranch = async (title, audience, lens) => {
    const r = await api.workspaceBranch(id, title, audience, lens);
    if (r.status === "ok") { setBranching(false); goto({ v: "workspace", id: r.workspace.id }); }
  };

  return (
    <div className="page" style={{ maxWidth: 1000 }}>
      <button className="back" onClick={() => goto({ v: "reviews" })} style={{ marginBottom: 12 }}><Ic d={PATHS.back} size={14} sw={2} /> Back</button>
      <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
        <span className="chip violet">{ws.audience}</span><span className="chip blue">{ws.lens}</span>
        <span className={`chip ${STATE_CHIP(ws.status)}`}>{STATE_LABELS[ws.status]}</span>
      </div>
      <h1 style={{ fontFamily: "var(--serif)", fontSize: 26, fontWeight: 600, margin: "6px 0 4px" }}>{ws.title}</h1>
      <div style={{ fontSize: 14, color: "var(--ink-2)", marginBottom: 4 }}>{ws.thesis}</div>
      <div style={{ fontSize: 11, color: "var(--ink-3)", marginBottom: 16 }}>dataset version: {ws.dataset_version_id || "—"}</div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        {NEXT_STATES[ws.status].map(s => <button key={s} className="btn" onClick={() => doTransition(s)}>&rarr; {STATE_LABELS[s]}</button>)}
        <button className="btn" style={{ marginLeft: "auto" }} onClick={() => setBranching(b => !b)}>&#8942; Branch</button>
      </div>
      {transitionError && <div className="chip red" style={{ display: "block", marginBottom: 10, padding: "8px 10px", height: "auto" }}>{transitionError}</div>}

      {branching && <BranchForm onCreate={doBranch} onCancel={() => setBranching(false)} />}
      {branches.length > 0 && (
        <div style={{ marginBottom: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {branches.map(b => <button key={b.id} className="pill" style={{ padding: "5px 10px" }} onClick={() => goto({ v: "workspace", id: b.id })}>{b.title} ({b.audience})</button>)}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Canvas</div>
          <BlockEditor blocks={ws.blocks} onChange={(blocks) => api.workspaceUpdateBlocks(id, blocks).then(load)} />
        </div>
        <div>
          <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Evidence ({ws.evidence_ids.length})</div>
            <button style={{ marginLeft: "auto", color: "var(--blue)", fontSize: 12, fontWeight: 600 }} onClick={() => setShowPicker(s => !s)}>+ add</button>
          </div>
          {ws.evidence_ids.map(eid => {
            const ev = evMap[eid];
            if (!ev) return null;
            return (
              <div key={eid} className="panel" style={{ padding: 9, marginBottom: 6 }}>
                <div style={{ display: "flex", gap: 8 }}>
                  <span style={{ flex: 1, fontSize: 12.5 }}>{ev.claim}</span>
                  <button style={{ color: "var(--ink-3)" }} onClick={() => api.workspaceRemoveEvidence(id, eid).then(load)}><Ic d={PATHS.close} size={12} sw={2} /></button>
                </div>
                <span className="chip blue" style={{ marginTop: 6 }}>{ev.kind}</span>
              </div>
            );
          })}
          {showPicker && <EvidencePicker sid={sid} workspace={ws} onAdd={(eid) => { api.workspaceAddEvidence(id, eid).then(load); }} onClose={() => setShowPicker(false)} />}
          <div style={{ marginTop: 16 }}>
            <Comments wid={id} track="analysis" label="Analysis review" toast={toast} />
            <Comments wid={id} track="narrative" label="Narrative review" toast={toast} />
          </div>
        </div>
      </div>
    </div>
  );
}

function BranchForm({ onCreate, onCancel }) {
  const [title, setTitle] = useState(""); const [audience, setAudience] = useState("investor"); const [lens, setLens] = useState("efficacy");
  return (
    <div className="panel" style={{ padding: 12, marginBottom: 14 }}>
      <input className="formf" placeholder="Branch title" value={title} onChange={e => setTitle(e.target.value)} />
      <div style={{ display: "flex", gap: 8 }}>
        <select className="formf" value={audience} onChange={e => setAudience(e.target.value)}>
          {["scientist", "clinical_operations", "executive", "investor", "regulatory", "data_science"].map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select className="formf" value={lens} onChange={e => setLens(e.target.value)}>
          {["efficacy", "safety", "mechanism", "quality", "operations", "uncertainty", "anomaly", "comparison"].map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <button className="btn primary" onClick={() => onCreate(title, audience, lens)}>Create</button>
        <button className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
