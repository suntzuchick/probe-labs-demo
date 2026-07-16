import React, { useEffect, useState } from "react";
import { api } from "../../api/client.js";

const STATUS_DOT = { unreviewed: "#8a8a95", approved: "#22b07d", rejected: "#e0524a" };
const STATUS_LABEL = { unreviewed: "Unreviewed", approved: "Approved", rejected: "Rejected" };

export default function Evidence({ sid, q, toast, highlightId }) {
  const [rows, setRows] = useState(null);
  const load = () => api.evidenceList(sid).then(r => { if (r.status === "ok") setRows(r.evidence); });
  useEffect(() => { load(); }, [sid]);

  useEffect(() => {
    if (!highlightId || !rows) return;
    const row = document.getElementById(`evidence-row-${highlightId}`);
    if (row) row.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlightId, rows]);

  const review = async (id, decision) => {
    const r = await api.evidenceReview(id, decision);
    if (r.status === "ok") { toast(`Evidence ${decision}`); load(); }
  };

  const filtered = (rows || []).filter(e => !q || e.claim.toLowerCase().includes(q.toLowerCase()) || e.kind.includes(q.toLowerCase()));

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Evidence</h1><p>Most of these were computed by the agent, not uploaded. Every claim in a narrative points back to one of these rows.</p></div>
      </div>
      <div className="panel">
        <div className="panel-h"><span className="t">All evidence</span>
          <span className="s">{filtered.length} of {(rows || []).length} items &middot; {(rows || []).filter(e => e.created_by === "agent").length} agent-generated</span></div>
        {rows === null && <div className="empty">Loading…</div>}
        {rows !== null && filtered.length === 0 && <div className="empty">No evidence yet — evidence is created automatically whenever a dashboard is generated.</div>}
        {filtered.length > 0 && (
          <table>
            <thead><tr><th style={{ width: 90 }}>ID</th><th>Claim</th><th>Origin</th><th>Type</th><th>Confidence</th><th>Status</th><th>Review</th></tr></thead>
            <tbody>
              {filtered.map(e => (
                <tr key={e.id} id={`evidence-row-${e.id}`}
                  style={e.id === highlightId ? { background: "var(--violet-tint, #f3eeff)" } : undefined}>
                  <td><span className="ecode" style={{ width: "auto", padding: "2px 6px" }}>{e.id.slice(-6)}</span></td>
                  <td><span className="strong" style={{ fontWeight: 500 }}>{e.claim}</span>
                    {(e.limitations || []).length > 0 && <div style={{ fontSize: 11, color: "var(--amber)", marginTop: 3 }}>&#9888; {e.limitations[0]}</div>}
                  </td>
                  <td>{e.created_by === "agent"
                    ? <span className="agent-tag"><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.2 6.1L20 10l-5.8 1.9L12 18l-2.2-6.1L4 10l5.8-1.9z" /></svg> Agent-generated</span>
                    : <span style={{ color: "var(--ink-3)" }}>Human</span>}</td>
                  <td>{e.kind}</td>
                  <td className="mono">{e.confidence ?? "—"}</td>
                  <td><i className="dot" style={{ background: STATUS_DOT[e.review_status] }} /> {STATUS_LABEL[e.review_status]}</td>
                  <td>
                    {e.review_status === "unreviewed" ? (
                      <span style={{ display: "flex", gap: 6 }}>
                        <button className="btn" style={{ height: 26, padding: "0 8px", fontSize: 11.5 }} onClick={() => review(e.id, "approved")}>Approve</button>
                        <button className="btn" style={{ height: 26, padding: "0 8px", fontSize: 11.5 }} onClick={() => review(e.id, "rejected")}>Reject</button>
                      </span>
                    ) : <span style={{ color: "var(--ink-3)", fontSize: 11.5 }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
