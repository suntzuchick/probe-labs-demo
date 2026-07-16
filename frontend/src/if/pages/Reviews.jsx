import React, { useEffect, useState } from "react";
import { api } from "../../api/client.js";

export default function Reviews({ sid, q, toast, goto }) {
  const [rows, setRows] = useState(null);
  const load = () => api.reviewsList(sid).then(r => { if (r.status === "ok") setRows(r.reviews); });
  useEffect(() => { load(); }, [sid]);

  const resolve = async (id) => { await api.commentResolve(id); toast("Marked resolved"); load(); };

  const filtered = (rows || []).filter(r => !q || r.target.toLowerCase().includes(q.toLowerCase()) || r.note.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Reviews</h1><p>Nothing is published until a human signs off. Every open item here is a real comment on a real drafting workspace.</p></div>
      </div>
      <div className="panel">
        {rows === null && <div className="empty">Loading…</div>}
        {rows !== null && filtered.length === 0 && <div className="empty">No review comments yet — add one from a drafting workspace.</div>}
        {filtered.map(r => (
          <div className="row" key={r.id}>
            <span style={{ flex: 1 }}>
              <button onClick={() => goto({ v: "workspace", id: r.target_id })} style={{ font: "inherit", textAlign: "left" }}>
                <span style={{ fontSize: 14, fontWeight: 600, display: "block", color: "var(--ink)" }}>{r.target}</span>
              </button>
              <span className="nar-d">{r.note}</span>
              <span className="nar-m">
                <span className={`chip ${r.status === "open" ? "amber" : "green"}`}>{r.status === "open" ? "Open" : "Resolved"}</span>
                <span>{r.track} review</span><span>&middot;</span><span>{r.author}</span>
              </span>
            </span>
            {r.status === "open" && <button className="btn" onClick={() => resolve(r.id)}>Resolve</button>}
          </div>
        ))}
      </div>
    </div>
  );
}
