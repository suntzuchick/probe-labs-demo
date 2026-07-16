import React, { useEffect, useState } from "react";
import { api } from "../../api/client.js";
import { Ic, PATHS } from "../Icons.jsx";

const STATUS_CHIP = { publish: ["green", "Published"], published: ["green", "Published"], caveats: ["amber", "Caveats"],
  review: ["amber", "Review"], contradicted: ["red", "Contradicted"], blocked: ["gray", "Blocked"] };
function Chip({ status }) {
  const [c, l] = STATUS_CHIP[status] || ["gray", status];
  return <span className={`chip ${c}`}>{l}</span>;
}

export default function Narratives({ sid, goto, q, toast }) {
  const [rows, setRows] = useState(null);
  const [generating, setGenerating] = useState(false);

  const load = () => api.corpusList(sid).then(r => { if (r.status === "ok") setRows(r.narratives.filter(n => !n.is_synthetic)); });
  useEffect(() => { load(); }, [sid]);

  const generate = async () => {
    setGenerating(true);
    toast("Generating a narrative from real computed evidence — this runs live analysis, may take a minute…");
    const r = await api.narrativesGenerate(sid);
    setGenerating(false);
    if (r.status === "ok") { toast("Narrative published"); load(); goto({ v: "narrative", id: r.narrative.narrative_id }); }
    else toast(r.error || "Generation failed");
  };

  const filtered = (rows || []).filter(n => !q || n.thesis.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Narratives</h1><p>AI-written arguments, each grounded in evidence you can open and code you can inspect.</p></div>
        <div className="acts">
          <button className="btn ai" disabled={generating} onClick={generate}>
            <Ic d="M12 2l2.2 6.1L20 10l-5.8 1.9L12 18l-2.2-6.1L4 10l5.8-1.9z" size={13} fill="currentColor" sw={0} />
            {generating ? "Generating…" : "New narrative"}
          </button>
        </div>
      </div>
      <div className="panel">
        {rows === null && <div className="empty">Loading…</div>}
        {rows !== null && filtered.length === 0 && (
          <div className="empty">
            {rows.length === 0 ? "No narratives generated yet in this session — click New narrative to run the full agent pipeline against your current data." : `Nothing matches "${q}".`}
          </div>
        )}
        {filtered.map(n => (
          <button className="row" key={n.narrative_id} onClick={() => goto({ v: "narrative", id: n.narrative_id })}>
            <span style={{ flex: 1 }}>
              <span className="nar-t">{n.thesis}</span>
              <span className="nar-m">
                <Chip status={n.status} />
                <span>{(n.dashboards || []).length} dashboards</span>
                <span>&middot;</span>
                <span>score {n.score ?? "—"}</span>
              </span>
            </span>
            <Ic d={PATHS.chevRight} size={15} stroke="#c5c5cf" sw={2} style={{ marginTop: 6 }} />
          </button>
        ))}
      </div>
    </div>
  );
}
