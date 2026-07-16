import React, { useEffect, useRef, useState } from "react";
import { api } from "../../api/client.js";

export default function Datasets({ sid, q, toast, onDataChanged }) {
  const [tables, setTables] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const load = () => api.datasetTables(sid).then(r => { if (r.status === "ok") setTables(r.tables); });
  useEffect(() => { load(); }, [sid]);

  const loadSample = async () => {
    setBusy(true);
    toast("Loading sample dataset…");
    await api.loadSample(sid);
    await api.derive(sid);
    await api.indexBuild(sid);
    setBusy(false);
    toast("Sample data loaded and derived");
    load();
    onDataChanged?.();
  };

  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    toast(`Uploading ${file.name}…`);
    const r = await api.upload(sid, file);
    setBusy(false);
    if (r.status === "error") { toast(r.error); return; }
    toast(`${file.name} uploaded — run Derive from here once all files are in`);
  };

  const deriveAndIndex = async () => {
    setBusy(true);
    await api.derive(sid);
    await api.indexBuild(sid);
    setBusy(false);
    toast("Derivation complete");
    load();
    onDataChanged?.();
  };

  const filtered = (tables || []).filter(t => !q || t.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Datasets</h1><p>Every table currently available in this session, with its schema quality.</p></div>
        <div className="acts">
          <input ref={fileRef} type="file" style={{ display: "none" }} onChange={e => upload(e.target.files[0])} />
          <button className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>Upload</button>
          <button className="btn" disabled={busy} onClick={deriveAndIndex}>Derive + index</button>
          <button className="btn primary" disabled={busy} onClick={loadSample}>Load sample dataset</button>
        </div>
      </div>
      <div className="panel">
        <div className="panel-h"><span className="t">Session tables</span><span className="s">{(tables || []).length} tables</span></div>
        {tables === null && <div className="empty">Loading…</div>}
        {tables !== null && filtered.length === 0 && <div className="empty">No derived tables yet — upload files or load the sample dataset, then Derive + index.</div>}
        {filtered.length > 0 && (
          <table>
            <thead><tr><th>Table</th><th>Rows</th><th>Columns</th><th>Version</th><th>Quality</th></tr></thead>
            <tbody>
              {filtered.map(t => {
                const [c, l] = t.quality;
                return (
                  <tr key={t.name}>
                    <td><span className="strong mono">{t.name}</span></td>
                    <td className="mono">{t.rows}</td>
                    <td className="mono">{t.cols}</td>
                    <td><span className="pill">v{t.dataset_version}</span></td>
                    <td><span className={`chip ${c}`}>{l}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
