import React, { useEffect, useState } from "react";
import { api } from "../../api/client.js";
import { Ic, PATHS } from "../Icons.jsx";

export default function Workspaces({ sid, q, toast, goto, onSwitch }) {
  const [rows, setRows] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");

  const load = () => api.sessionList(sid).then(r => { if (r.status === "ok") setRows(r.workspaces); });
  useEffect(() => { load(); }, [sid]);

  const createNew = async () => {
    const r = await api.createSession();
    if (r.session_id) { toast("New workspace created"); onSwitch(r.session_id); }
  };
  const rename = async () => {
    if (!name.trim()) return;
    await api.sessionInfo(sid, { project: name });
    setRenaming(false);
    toast("Workspace renamed");
    load();
  };

  const filtered = (rows || []).filter(w => !q || w.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Workspaces</h1><p>Each workspace is its own session — its own tables, narratives, and evidence.</p></div>
        <div className="acts">
          <button className="btn" onClick={() => setRenaming(r => !r)}>Rename current</button>
          <button className="btn primary" onClick={createNew}>New workspace</button>
        </div>
      </div>
      {renaming && (
        <div className="panel" style={{ padding: 14 }}>
          <input className="formf" placeholder="Workspace name" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === "Enter" && rename()} />
          <button className="btn primary" onClick={rename}>Save</button>
        </div>
      )}
      {rows === null && <div className="panel"><div className="empty">Loading…</div></div>}
      {rows !== null && filtered.length === 0 && <div className="panel"><div className="empty">No workspaces match.</div></div>}
      {filtered.length > 0 && (
        <div className="cards">
          {filtered.map(w => (
            <button className="card tap" key={w.sid} onClick={() => w.current ? goto({ v: "overview" }) : onSwitch(w.sid)}>
              <span className="ch">
                <span className="ws-mark" style={{ width: 26, height: 26, borderRadius: 7 }}><Ic d={PATHS.circleDot} size={13} sw={2} /></span>
                <span className="cn">{w.name}</span>
                {w.current && <span className="chip green" style={{ marginLeft: "auto" }}>Current</span>}
              </span>
              <span className="cd" style={{ display: "block" }}>{w.narratives} narratives &middot; {w.datasets} tables &middot; {w.evidence} evidence</span>
              <span className="cf">{w.updated_at ? new Date(w.updated_at * 1000).toLocaleDateString() : "—"}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
