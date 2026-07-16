import React, { useEffect, useState } from "react";
import { api } from "../../api/client.js";

export default function Reports({ sid, q, toast }) {
  const [rows, setRows] = useState(null);
  const load = () => api.reportsList(sid).then(r => { if (r.status === "ok") setRows(r.reports); });
  useEffect(() => { load(); }, [sid]);

  const rebuild = async (r) => {
    const res = await api.reportsGenerate(sid, r.source_type, r.source_id);
    if (res.status === "ok") { toast("Report rebuilt"); load(); }
    else toast(res.error || "Rebuild failed");
  };

  const filtered = (rows || []).filter(r => !q || r.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Reports</h1><p>PDF exports built from narratives and drafting workspaces. A report goes stale when its source evidence changes after it was built.</p></div>
        <div className="acts"><a className="btn primary" href={api.exportUrl(sid)}>Export all tables (Excel)</a></div>
      </div>
      <div className="panel">
        {rows === null && <div className="empty">Loading…</div>}
        {rows !== null && filtered.length === 0 && <div className="empty">No reports built yet — build one from a narrative or drafting workspace.</div>}
        {filtered.length > 0 && (
          <table>
            <thead><tr><th>Report</th><th>Format</th><th>Source</th><th>Built</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id}>
                  <td><span className="strong">{r.name}</span></td>
                  <td>{r.format.toUpperCase()}</td>
                  <td style={{ color: "var(--ink-3)" }}>{r.source_type}</td>
                  <td>{new Date(r.built_at * 1000).toLocaleDateString()}</td>
                  <td>{r.stale ? <span className="chip amber">Stale — source changed</span> : <span className="chip green">Current</span>}</td>
                  <td style={{ textAlign: "right" }}>
                    {r.stale
                      ? <button style={{ fontSize: 12, fontWeight: 600, color: "var(--blue)" }} onClick={() => rebuild(r)}>Rebuild</button>
                      : <a style={{ fontSize: 12, fontWeight: 600, color: "var(--blue)" }} href={api.reportDownloadUrl(r.id)}>Download</a>}
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
