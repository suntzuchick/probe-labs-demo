import React, { useEffect, useRef, useState } from "react";
import { api } from "../api/client.js";

// Real provenance graph: Sources -> Analyses -> Evidence -> Narratives,
// built from actual fetched data (tables, dashboards, evidence, and the
// evidence_id each narrative panel actually cites) — not the mockup's fixed
// 20-node fixture. Capped per column so it stays readable.
async function assembleGraph(sid) {
  const [tablesRes, dashRes, evRes, corpusRes] = await Promise.all([
    api.datasetTables(sid), api.dashboardsList(sid), api.evidenceList(sid), api.corpusList(sid),
  ]);
  const tables = (tablesRes.status === "ok" ? tablesRes.tables : []).slice(0, 5);
  const dashboards = (dashRes.dashboards || []).slice(0, 6);
  const evidence = (evRes.status === "ok" ? evRes.evidence : []).slice(0, 8);
  const realNarratives = (corpusRes.status === "ok" ? corpusRes.narratives : []).filter(n => !n.is_synthetic).slice(0, 2);

  const narrativeDetails = await Promise.all(realNarratives.map(n => api.narrativeGet(n.narrative_id)));

  const nodes = [
    ...tables.map(t => ({ id: "T:" + t.name, c: 0, t: t.name, k: "dataset" })),
    ...dashboards.map(d => ({ id: "A:" + d.dashboard_id, c: 1, t: d.title.slice(0, 26), k: "run" })),
    ...evidence.map(e => ({ id: "E:" + e.id, c: 2, t: e.claim.length > 15 ? e.claim.slice(0, 14) + "…" : e.claim, code: e.id.slice(-4), k: "evi", eid: e.id })),
    ...narrativeDetails.filter(r => r.status === "ok").map(r => ({ id: "N:" + r.narrative.narrative_id, c: 3, t: r.narrative.thesis.length > 30 ? r.narrative.thesis.slice(0, 29) + "…" : r.narrative.thesis, sub: `${r.narrative.dashboards.length} sections`, k: "nar", nid: r.narrative.narrative_id })),
  ];

  const edges = [];
  for (const e of evidence) {
    if (e.origin_panel_id && dashboards.some(d => d.dashboard_id === e.origin_panel_id)) {
      edges.push(["A:" + e.origin_panel_id, "E:" + e.id]);
    }
  }
  for (const r of narrativeDetails) {
    if (r.status !== "ok") continue;
    for (const d of r.narrative.dashboards) {
      for (const p of d.panels) {
        if (p.evidence_id && evidence.some(e => e.id === p.evidence_id)) {
          edges.push(["E:" + p.evidence_id, "N:" + r.narrative.narrative_id]);
        }
      }
    }
  }
  return { nodes, edges };
}

const COLS = [["Tables", 60, 158], ["Analyses", 300, 150], ["Evidence", 560, 150], ["Narratives", 810, 180]];
const ROW_H = { dataset: 26, run: 26, evi: 22, nar: 44 };

export default function ProvenanceGraph({ sid, goto }) {
  const [g, setG] = useState(null);
  const svgRef = useRef(null);
  useEffect(() => { let alive = true; assembleGraph(sid).then(r => { if (alive) setG(r); }); return () => { alive = false; }; }, [sid]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el || !g) return;
    const nodes = [...el.querySelectorAll(".g-node")], edges = [...el.querySelectorAll(".g-edge")];
    const wrap = el.closest(".graph");
    const clear = () => { wrap.classList.remove("hov"); nodes.forEach(n => n.classList.remove("lit")); edges.forEach(e => e.classList.remove("lit")); };
    const lightUp = (id) => {
      clear(); wrap.classList.add("hov");
      const near = new Set([id]);
      g.edges.forEach(([a, b]) => { if (a === id) near.add(b); if (b === id) near.add(a); });
      nodes.forEach(n => { if (near.has(n.dataset.id)) n.classList.add("lit"); });
      edges.forEach(e => { if (e.dataset.a === id || e.dataset.b === id) e.classList.add("lit"); });
    };
    nodes.forEach(n => {
      const id = n.dataset.id;
      n.addEventListener("mouseenter", () => lightUp(id));
      n.addEventListener("mouseleave", clear);
      n.addEventListener("click", () => {
        if (id.startsWith("N:")) goto({ v: "narrative", id: id.slice(2) });
        else if (id.startsWith("A:")) goto({ v: "analyses" });
        else if (id.startsWith("E:")) goto({ v: "evidence" });
        else goto({ v: "datasets" });
      });
    });
    return clear;
  }, [g]);

  if (!g) return <div className="graph"><div style={{ padding: "24px 15px", fontSize: 12.5, color: "var(--ink-3)" }}>Loading provenance…</div></div>;
  if (g.nodes.length === 0) return <div className="graph"><div style={{ padding: "24px 15px", fontSize: 12.5, color: "var(--ink-3)" }}>No tables, analyses, or evidence yet — generate a dashboard to populate this graph.</div></div>;

  const W = 1000, H = 340;
  const pos = {};
  COLS.forEach(([, x, w], ci) => {
    const ns = g.nodes.filter(n => n.c === ci);
    const gap = ci === 2 ? 12 : ci === 3 ? 10 : 20;
    const tot = ns.reduce((s, n) => s + ROW_H[n.k] + gap, -gap);
    let y = (H + 34 - tot) / 2;
    ns.forEach(n => { pos[n.id] = { x, y, w, h: ROW_H[n.k] }; y += ROW_H[n.k] + gap; });
  });

  const edge = ([a, b]) => {
    if (!pos[a] || !pos[b]) return null;
    const p = pos[a], q = pos[b], x1 = p.x + p.w, y1 = p.y + p.h / 2, x2 = q.x, y2 = q.y + q.h / 2, mx = (x1 + x2) / 2;
    return <path key={a + b} className="g-edge" data-a={a} data-b={b} d={`M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`} />;
  };
  const node = (n) => {
    const p = pos[n.id];
    const r = n.k === "run" ? 13 : n.k === "evi" ? 4 : 2;
    return (
      <g key={n.id} className="g-node" data-id={n.id}>
        <rect x={p.x} y={p.y} width={p.w} height={p.h} rx={r} />
        {n.k === "evi"
          ? <><text className="g-code" x={p.x + 9} y={p.y + 14}>{n.code}</text><text x={p.x + 30} y={p.y + 14.5} fontSize="10">{n.t}</text></>
          : <><text x={p.x + 11} y={n.sub ? p.y + 19 : p.y + 17} fontSize={n.k === "nar" ? 11.5 : 10.5} fontWeight={n.k === "nar" ? 600 : 500}>{n.t}</text>
            {n.sub && <text className="g-code" x={p.x + 11} y={p.y + 32}>{n.sub}</text>}</>}
      </g>
    );
  };

  return (
    <div className="graph">
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Provenance graph from tables through analyses and evidence to narratives">
        {COLS.map(([t, x]) => <text key={t} className="g-col" x={x} y="20">{t}</text>)}
        {g.edges.map(edge)}
        {g.nodes.map(node)}
      </svg>
      <div className="g-legend">
        <span><i /> Table</span><span><i className="r" /> Analysis run</span>
        <span style={{ marginLeft: "auto" }}>Hover a node to trace its path &middot; click to open it</span>
      </div>
    </div>
  );
}
