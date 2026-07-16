import React, { useEffect, useMemo, useState } from "react";
import { C, ST } from "../../tokens.js";
import { api } from "../../api/client.js";
import CorpusGraph from "./CorpusGraph.jsx";
import CorpusList from "./CorpusList.jsx";

export default function Corpus({ sid, setRoute }) {
  const [all, setAll] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | ok | error
  const [mode, setMode] = useState("graph");
  const [q, setQ] = useState("");
  const [fs, setFs] = useState("all");

  useEffect(() => {
    let alive = true;
    api.corpusList(sid).then(res => { if (alive) { setAll(res.narratives || []); setStatus("ok"); } })
      .catch(() => alive && setStatus("error"));
    return () => { alive = false; };
  }, [sid]);

  const filtered = useMemo(() => all
    .filter(n => (fs === "all" || n.status === fs) && (!q || n.thesis.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => b.score - a.score), [all, fs, q]);

  const tot = all.reduce((acc, n) => (acc[n.status] = (acc[n.status] || 0) + 1, acc), {});
  const agentCount = all.filter(n => !n.is_synthetic).length;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ flexShrink: 0, padding: "14px 24px", display: "flex", alignItems: "center", gap: 11, borderBottom: `1px solid ${C.line}`, background: "#fff", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, flex: 1, minWidth: 220, maxWidth: 380, background: C.soft2, border: `1px solid ${C.line2}`, borderRadius: 10, padding: "8px 12px" }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={C.faint} strokeWidth="2"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.5" y2="16.5" /></svg>
          <input value={q} onChange={e => { setQ(e.target.value); if (e.target.value) setMode("list"); }} placeholder={`Search ${all.length} narratives…`}
            style={{ border: "none", outline: "none", background: "transparent", fontSize: 14, fontFamily: C.sans, flex: 1, color: C.ink }} />
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {[["all", "All", all.length, C.line3], ...Object.entries(ST).map(([k, s]) => [k, s.l, tot[k] || 0, s.c])].map(([k, l, n, c]) => (
            <button key={k} onClick={() => { setFs(k); if (k !== "all") setMode("list"); }}
              style={{ display: "flex", alignItems: "center", gap: 5, border: `1px solid ${fs === k ? c : C.line}`, background: fs === k ? c + "12" : "#fff", color: fs === k ? c : C.muted2,
                borderRadius: 18, padding: "6px 10px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: C.sans }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: c }} />{l}<span style={{ fontFamily: C.mono, fontSize: 10, opacity: .7 }}>{n}</span>
            </button>
          ))}
        </div>
        <span style={{ fontFamily: C.mono, fontSize: 11, color: C.pink, background: C.pinkBg, borderRadius: 12, padding: "5px 10px" }}>◆ {agentCount} agent-generated</span>
        <div style={{ marginLeft: "auto", display: "flex", background: C.soft2, borderRadius: 8, padding: 3, gap: 2 }}>
          {[["graph", "◎"], ["list", "☰"]].map(([k, i]) => (
            <button key={k} onClick={() => setMode(k)} style={{ border: "none", background: mode === k ? "#fff" : "transparent", color: mode === k ? C.plum : C.muted2, borderRadius: 6, padding: "6px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{i}</button>
          ))}
        </div>
      </div>

      {status === "loading" && <div style={{ padding: 40, color: C.muted2 }}>Loading corpus…</div>}
      {status === "ok" && all.length === 0 && (
        <div style={{ textAlign: "center", padding: "90px 20px", color: C.faint }}>
          <div style={{ fontSize: 30, marginBottom: 12, opacity: .5 }}>○</div>
          <div style={{ fontFamily: C.disp, fontSize: 19, fontWeight: 600, color: C.muted, marginBottom: 6 }}>No narratives yet</div>
          <div style={{ fontSize: 14, lineHeight: 1.6, maxWidth: "40ch", margin: "0 auto 18px" }}>
            This may be a story the corpus <b style={{ color: C.muted2 }}>can't tell yet</b> — ingest data and generate a narrative first.
          </div>
          <button onClick={() => setRoute({ v: "ingest" })} style={{ border: "none", background: C.grad, color: "#fff", borderRadius: 9, padding: "10px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: C.sans }}>＋ Add data</button>
        </div>
      )}
      {status === "ok" && all.length > 0 && (
        mode === "graph" ? <CorpusGraph narratives={filtered} setRoute={setRoute} /> : (
          <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px" }}><CorpusList narratives={filtered} setRoute={setRoute} /></div>
        )
      )}
    </div>
  );
}
