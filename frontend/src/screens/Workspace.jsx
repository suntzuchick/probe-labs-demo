import React, { useEffect, useState } from "react";
import { C } from "../tokens.js";
import { api } from "../api/client.js";

const STATE_LABELS = {
  draft: "Draft", analysis_ready: "Analysis ready", analysis_reviewed: "Analysis reviewed",
  narrative_ready: "Narrative ready", scientific_review: "Scientific review",
  approved: "Approved", published: "Published", superseded: "Superseded",
};
const NEXT_STATES = {
  draft: ["analysis_ready"], analysis_ready: ["analysis_reviewed", "draft"],
  analysis_reviewed: ["narrative_ready", "analysis_ready"], narrative_ready: ["scientific_review", "analysis_reviewed"],
  scientific_review: ["approved", "narrative_ready"], approved: ["published", "scientific_review"],
  published: ["superseded"], superseded: [],
};
const STATE_COLOR = (s) => (
  s === "published" ? C.green : s === "superseded" ? C.faint :
  s === "approved" || s === "scientific_review" ? C.violet :
  s === "narrative_ready" || s === "analysis_reviewed" ? C.blue : C.amber
);

function Badge({ children, c, bg }) {
  return <span style={{ fontFamily: C.mono, fontSize: 10, fontWeight: 700, color: c, background: bg, borderRadius: 8, padding: "3px 8px" }}>{children}</span>;
}

function WorkspaceList({ sid, setRoute }) {
  const [workspaces, setWorkspaces] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: "", thesis: "", audience: "scientist", lens: "efficacy" });

  const load = () => api.workspaceList(sid).then(r => { if (r.status === "ok") setWorkspaces(r.workspaces); });
  useEffect(() => { load(); }, [sid]);

  const create = async () => {
    if (!form.title.trim()) return;
    const r = await api.workspaceCreate({ session_id: sid, ...form });
    if (r.status === "ok") { setCreating(false); setForm({ title: "", thesis: "", audience: "scientist", lens: "efficacy" }); load(); }
  };

  if (workspaces === null) return <div style={{ padding: 40, color: C.muted2 }}>Loading workspaces…</div>;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "30px 24px 90px" }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ fontFamily: C.disp, fontSize: 26, fontWeight: 600, margin: 0 }}>Narrative workspaces</h1>
        <button onClick={() => setCreating(c => !c)} style={{ marginLeft: "auto", border: "none", background: C.grad, color: "#fff", borderRadius: 9, padding: "9px 16px", fontSize: 13.5, fontWeight: 600, cursor: "pointer", fontFamily: C.sans }}>
          + New workspace
        </button>
      </div>

      {creating && (
        <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: 16, marginBottom: 20, background: "#fff" }}>
          <input placeholder="Title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
                 style={{ width: "100%", border: `1px solid ${C.line2}`, borderRadius: 8, padding: "8px 10px", fontSize: 14, marginBottom: 8, fontFamily: C.sans }} />
          <input placeholder="Thesis" value={form.thesis} onChange={e => setForm({ ...form, thesis: e.target.value })}
                 style={{ width: "100%", border: `1px solid ${C.line2}`, borderRadius: 8, padding: "8px 10px", fontSize: 14, marginBottom: 8, fontFamily: C.sans }} />
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <select value={form.audience} onChange={e => setForm({ ...form, audience: e.target.value })} style={{ flex: 1, padding: "7px 8px", borderRadius: 8, border: `1px solid ${C.line2}`, fontFamily: C.sans }}>
              {["scientist", "clinical_operations", "executive", "investor", "regulatory", "data_science"].map(a => <option key={a} value={a}>{a}</option>)}
            </select>
            <select value={form.lens} onChange={e => setForm({ ...form, lens: e.target.value })} style={{ flex: 1, padding: "7px 8px", borderRadius: 8, border: `1px solid ${C.line2}`, fontFamily: C.sans }}>
              {["efficacy", "safety", "mechanism", "quality", "operations", "uncertainty", "anomaly", "comparison"].map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <button onClick={create} style={{ border: "none", background: C.plum, color: "#fff", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: C.sans }}>Create</button>
        </div>
      )}

      {workspaces.length === 0 && !creating && <div style={{ color: C.faint, fontSize: 14 }}>No workspaces yet — narratives generated on the Corpus screen don't create one automatically; start one here to draft, review, and branch by hand.</div>}

      {workspaces.map(w => (
        <div key={w.id} className="row" onClick={() => setRoute({ v: "workspaces", id: w.id })}
             style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: "13px 16px", marginBottom: 10, cursor: "pointer", background: "#fff", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14.5, fontWeight: 600 }}>{w.title}</div>
            <div style={{ fontSize: 12, color: C.muted2, marginTop: 2 }}>{w.thesis || "—"}</div>
          </div>
          <Badge c={C.violet} bg={C.violetBg}>{w.audience}</Badge>
          <Badge c={C.pink} bg={C.pinkBg}>{w.lens}</Badge>
          {w.parent_workspace_id && <Badge c={C.faint} bg={C.soft2}>branch</Badge>}
          <Badge c={STATE_COLOR(w.status)} bg={C.soft2}>{STATE_LABELS[w.status]}</Badge>
        </div>
      ))}
    </div>
  );
}

function EvidencePicker({ sid, workspace, onAdd, onClose }) {
  const [rows, setRows] = useState(null);
  useEffect(() => { api.evidenceList(sid).then(r => { if (r.status === "ok") setRows(r.evidence); }); }, [sid]);
  const attached = new Set(workspace.evidence_ids);
  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 10, padding: 12, background: C.soft2, marginTop: 8 }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: C.muted }}>Add evidence to this workspace</div>
        <button onClick={onClose} style={{ marginLeft: "auto", border: "none", background: "transparent", color: C.faint, cursor: "pointer" }}>×</button>
      </div>
      {rows === null && <div style={{ fontSize: 12, color: C.faint }}>Loading…</div>}
      {rows && rows.filter(r => !attached.has(r.id)).length === 0 && <div style={{ fontSize: 12, color: C.faint }}>No more unattached evidence in this session.</div>}
      {rows && rows.filter(r => !attached.has(r.id)).map(r => (
        <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: `1px solid ${C.line}` }}>
          <div style={{ flex: 1, fontSize: 12.5 }}>{r.claim.slice(0, 90)}</div>
          <Badge c={C.blue} bg={C.blueBg}>{r.kind}</Badge>
          <button onClick={() => onAdd(r.id)} style={{ border: `1px solid ${C.line2}`, background: "#fff", borderRadius: 6, padding: "3px 9px", fontSize: 11, cursor: "pointer", fontFamily: C.sans }}>+ add</button>
        </div>
      ))}
    </div>
  );
}

function EvidenceCard({ ev, onRemove }) {
  if (!ev) return null;
  const revColor = ev.review_status === "approved" ? C.green : ev.review_status === "rejected" ? C.red : C.faint;
  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 9, padding: "9px 11px", marginBottom: 6, background: "#fff" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1, fontSize: 12.5, lineHeight: 1.5 }}>{ev.claim}</div>
        <button onClick={onRemove} style={{ border: "none", background: "transparent", color: C.faint, cursor: "pointer", fontSize: 13 }}>×</button>
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "center" }}>
        <Badge c={C.blue} bg={C.blueBg}>{ev.kind}</Badge>
        {ev.confidence != null && <span style={{ fontFamily: C.mono, fontSize: 10, color: C.muted2 }}>conf {ev.confidence}</span>}
        <span style={{ fontFamily: C.mono, fontSize: 10, color: revColor, marginLeft: "auto" }}>{ev.review_status}</span>
      </div>
      {ev.limitations?.length > 0 && (
        <div style={{ marginTop: 6 }}>
          {ev.limitations.map((l, i) => <div key={i} style={{ fontSize: 10.5, color: C.amber, background: C.amberBg, borderRadius: 6, padding: "3px 7px", marginTop: 3 }}>⚠ {l}</div>)}
        </div>
      )}
    </div>
  );
}

function BlockEditor({ blocks, onChange }) {
  const BLOCK_TYPES = ["title", "thesis", "text", "chart", "evidence", "counterevidence", "limitations", "next_analysis", "conclusion"];
  const update = (i, field, val) => onChange(blocks.map((b, j) => j === i ? { ...b, [field]: val } : b));
  const remove = (i) => onChange(blocks.filter((_, j) => j !== i));
  const add = () => onChange([...blocks, { type: "text", text: "" }]);
  return (
    <div>
      {blocks.map((b, i) => (
        <div key={i} style={{ border: `1px solid ${C.line}`, borderRadius: 9, padding: 9, marginBottom: 6, background: "#fff" }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 5 }}>
            <select value={b.type} onChange={e => update(i, "type", e.target.value)} style={{ fontFamily: C.mono, fontSize: 10.5, border: `1px solid ${C.line2}`, borderRadius: 6, padding: "3px 6px" }}>
              {BLOCK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <button onClick={() => remove(i)} style={{ marginLeft: "auto", border: "none", background: "transparent", color: C.faint, cursor: "pointer" }}>×</button>
          </div>
          <textarea value={b.text || ""} onChange={e => update(i, "text", e.target.value)} rows={2}
                    style={{ width: "100%", border: `1px solid ${C.line}`, borderRadius: 6, padding: 7, fontSize: 13, fontFamily: C.sans, resize: "vertical" }} />
        </div>
      ))}
      <button onClick={add} style={{ width: "100%", border: `1px dashed ${C.line2}`, background: "transparent", color: C.muted2, borderRadius: 8, padding: "8px 0", fontSize: 12.5, cursor: "pointer", fontFamily: C.sans }}>+ add block</button>
    </div>
  );
}

function CommentsPanel({ wid, track, label }) {
  const [comments, setComments] = useState([]);
  const [text, setText] = useState("");
  const load = () => api.workspaceComments(wid, track).then(r => { if (r.status === "ok") setComments(r.comments); });
  useEffect(() => { load(); }, [wid, track]);
  const add = async () => {
    if (!text.trim()) return;
    await api.workspaceAddComment(wid, track, "reviewer", text);
    setText(""); load();
  };
  const resolve = async (cid) => { await api.commentResolve(cid); load(); };
  const openCount = comments.filter(c => c.status === "open").length;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 6 }}>
        {label} {openCount > 0 && <span style={{ color: C.amber }}>({openCount} open)</span>}
      </div>
      {comments.map(c => (
        <div key={c.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "5px 0", borderBottom: `1px solid ${C.line}` }}>
          <span style={{ fontSize: 12, flex: 1, textDecoration: c.status === "resolved" ? "line-through" : "none", color: c.status === "resolved" ? C.faint : C.ink }}>{c.comment}</span>
          {c.status === "open" && <button onClick={() => resolve(c.id)} style={{ border: `1px solid ${C.line2}`, background: "#fff", borderRadius: 6, padding: "2px 8px", fontSize: 10.5, cursor: "pointer", fontFamily: C.sans }}>resolve</button>}
        </div>
      ))}
      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        <input value={text} onChange={e => setText(e.target.value)} placeholder={`Add ${label.toLowerCase()} comment…`}
               style={{ flex: 1, border: `1px solid ${C.line2}`, borderRadius: 7, padding: "6px 9px", fontSize: 12.5, fontFamily: C.sans }} />
        <button onClick={add} style={{ border: "none", background: C.soft2, color: C.plum, borderRadius: 7, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: C.sans }}>add</button>
      </div>
    </div>
  );
}

function WorkspaceDetail({ sid, wid, setRoute }) {
  const [ws, setWs] = useState(null);
  const [evMap, setEvMap] = useState({});
  const [branches, setBranches] = useState([]);
  const [showPicker, setShowPicker] = useState(false);
  const [transitionError, setTransitionError] = useState(null);
  const [branching, setBranching] = useState(false);
  const [compareTo, setCompareTo] = useState(null);
  const [comparison, setComparison] = useState(null);

  const load = () => {
    api.workspaceGet(wid).then(r => { if (r.status === "ok") setWs(r.workspace); });
    api.workspaceBranches(wid).then(r => { if (r.status === "ok") setBranches(r.branches); });
  };
  useEffect(() => { load(); }, [wid]);
  useEffect(() => {
    if (ws?.evidence_ids?.length) api.evidenceBulk(ws.evidence_ids).then(r => {
      if (r.status === "ok") setEvMap(Object.fromEntries(r.evidence.map(e => [e.id, e])));
    });
  }, [ws?.evidence_ids?.join(",")]);

  if (ws === null) return <div style={{ padding: 40, color: C.muted2 }}>Loading workspace…</div>;

  const doTransition = async (status) => {
    setTransitionError(null);
    const r = await api.workspaceTransition(wid, status);
    if (r.status !== "ok") setTransitionError(r.error);
    load();
  };
  const doBranch = async (title, audience, lens) => {
    const r = await api.workspaceBranch(wid, title, audience, lens);
    if (r.status === "ok") { setBranching(false); setRoute({ v: "workspaces", id: r.workspace.id }); }
  };
  const doCompare = async (otherId) => {
    setCompareTo(otherId);
    const r = await api.workspaceCompare(wid, otherId);
    if (r.status === "ok") setComparison(r.comparison);
  };

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "30px 24px 90px" }}>
      <button onClick={() => setRoute({ v: "workspaces" })} style={{ border: "none", background: "transparent", color: C.blue, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: C.sans, marginBottom: 14, padding: 0 }}>← All workspaces</button>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <Badge c={C.violet} bg={C.violetBg}>{ws.audience}</Badge>
        <Badge c={C.pink} bg={C.pinkBg}>{ws.lens}</Badge>
        <Badge c={STATE_COLOR(ws.status)} bg={C.soft2}>{STATE_LABELS[ws.status]}</Badge>
        {ws.parent_workspace_id && <Badge c={C.faint} bg={C.soft2}>branched from {ws.parent_workspace_id.slice(0, 10)}</Badge>}
      </div>
      <h1 style={{ fontFamily: C.disp, fontSize: 28, fontWeight: 600, margin: "8px 0 4px" }}>{ws.title}</h1>
      <div style={{ fontSize: 14.5, color: C.muted2, marginBottom: 6 }}>{ws.thesis}</div>
      <div style={{ fontSize: 11, color: C.faint, marginBottom: 18 }}>dataset version: {ws.dataset_version_id || "—"}</div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
        {NEXT_STATES[ws.status].map(s => (
          <button key={s} onClick={() => doTransition(s)} style={{ border: `1px solid ${C.line2}`, background: "#fff", color: C.plum, borderRadius: 8, padding: "7px 13px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: C.sans }}>
            → {STATE_LABELS[s]}
          </button>
        ))}
        <button onClick={() => setBranching(b => !b)} style={{ border: `1px solid ${C.line2}`, background: "#fff", color: C.muted, borderRadius: 8, padding: "7px 13px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: C.sans, marginLeft: "auto" }}>
          ⑂ Branch
        </button>
      </div>
      {transitionError && <div style={{ fontSize: 12, color: C.red, background: C.redBg, borderRadius: 7, padding: "7px 10px", marginBottom: 10 }}>{transitionError}</div>}

      {branching && <BranchForm onCreate={doBranch} onCancel={() => setBranching(false)} />}

      {branches.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 6 }}>Branches ({branches.length})</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {branches.map(b => (
              <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span className="row" onClick={() => setRoute({ v: "workspaces", id: b.id })} style={{ cursor: "pointer", fontSize: 12.5, border: `1px solid ${C.line}`, borderRadius: 8, padding: "5px 10px" }}>
                  {b.title} <span style={{ color: C.faint }}>({b.audience})</span>
                </span>
                <button onClick={() => doCompare(b.id)} style={{ border: "none", background: "transparent", color: C.blue, fontSize: 11, cursor: "pointer", fontFamily: C.sans }}>compare</button>
              </div>
            ))}
          </div>
          {comparison && (
            <div style={{ marginTop: 8, border: `1px solid ${C.line}`, borderRadius: 9, padding: 10, fontSize: 12, background: C.soft2 }}>
              <div>shared evidence: {comparison.shared_evidence.length}, unique here: {comparison.unique_to_a.length}, unique there: {comparison.unique_to_b.length}</div>
              <div>audience changed: {String(comparison.audience_changed)} · lens changed: {String(comparison.lens_changed)} · thesis changed: {String(comparison.thesis_changed)}</div>
            </div>
          )}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Canvas</div>
          <BlockEditor blocks={ws.blocks} onChange={(blocks) => api.workspaceUpdateBlocks(wid, blocks).then(load)} />
        </div>
        <div>
          <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Evidence ({ws.evidence_ids.length})</div>
            <button onClick={() => setShowPicker(s => !s)} style={{ marginLeft: "auto", border: "none", background: "transparent", color: C.blue, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: C.sans }}>+ add</button>
          </div>
          {ws.evidence_ids.map(eid => (
            <EvidenceCard key={eid} ev={evMap[eid]} onRemove={() => api.workspaceRemoveEvidence(wid, eid).then(load)} />
          ))}
          {showPicker && <EvidencePicker sid={sid} workspace={ws} onAdd={(eid) => { api.workspaceAddEvidence(wid, eid).then(load); }} onClose={() => setShowPicker(false)} />}

          <div style={{ marginTop: 18 }}>
            <CommentsPanel wid={wid} track="analysis" label="Analysis review" />
            <CommentsPanel wid={wid} track="narrative" label="Narrative review" />
          </div>
        </div>
      </div>
    </div>
  );
}

function BranchForm({ onCreate, onCancel }) {
  const [title, setTitle] = useState("");
  const [audience, setAudience] = useState("investor");
  const [lens, setLens] = useState("efficacy");
  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 10, padding: 12, background: C.soft2, marginBottom: 14 }}>
      <input placeholder="Branch title (e.g. Investor framing)" value={title} onChange={e => setTitle(e.target.value)}
             style={{ width: "100%", border: `1px solid ${C.line2}`, borderRadius: 8, padding: "7px 9px", fontSize: 13, marginBottom: 8, fontFamily: C.sans }} />
      <div style={{ display: "flex", gap: 8 }}>
        <select value={audience} onChange={e => setAudience(e.target.value)} style={{ flex: 1, padding: "6px 8px", borderRadius: 7, border: `1px solid ${C.line2}` }}>
          {["scientist", "clinical_operations", "executive", "investor", "regulatory", "data_science"].map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={lens} onChange={e => setLens(e.target.value)} style={{ flex: 1, padding: "6px 8px", borderRadius: 7, border: `1px solid ${C.line2}` }}>
          {["efficacy", "safety", "mechanism", "quality", "operations", "uncertainty", "anomaly", "comparison"].map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <button onClick={() => onCreate(title, audience, lens)} style={{ border: "none", background: C.plum, color: "#fff", borderRadius: 8, padding: "0 16px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: C.sans }}>Create branch</button>
        <button onClick={onCancel} style={{ border: `1px solid ${C.line2}`, background: "#fff", color: C.muted, borderRadius: 8, padding: "0 12px", fontSize: 12.5, cursor: "pointer", fontFamily: C.sans }}>Cancel</button>
      </div>
    </div>
  );
}

export default function Workspace({ sid, route, setRoute }) {
  return route.id
    ? <WorkspaceDetail sid={sid} wid={route.id} setRoute={setRoute} />
    : <WorkspaceList sid={sid} setRoute={setRoute} />;
}
