import React, { useEffect, useState } from "react";
import { api } from "../../api/client.js";
import { Ic, PATHS } from "../Icons.jsx";
import VegaChart from "../VegaChart.jsx";

const STATUS_CONF = { publish: 5, published: 5, caveats: 4, review: 3, contradicted: 1, blocked: 1 };
const ACT_LABEL = { observation: "OBSERVATION", turn: "THE TURN", verdict: "VERDICT" };

function PanelFigure({ p }) {
  const [showCode, setShowCode] = useState(false);
  if (p.type === "oracle" || p.type === "excess" || p.type === "verdict") {
    return (
      <div className="figure">
        <div className="fig-lab">{p.title}</div>
        <div className="fig-sub">{p.sub}</div>
        {p.type !== "oracle" && p.excess && (
          <div style={{ marginTop: 10, padding: "12px 14px", background: p.excess.attributable ? "#eaf7f1" : "#fdeceb", borderRadius: 9, textAlign: "center" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: p.excess.attributable ? "#177a56" : "#b23a33" }}>EXCESS</div>
            <div style={{ fontFamily: "var(--serif)", fontSize: 19, fontWeight: 700, color: p.excess.attributable ? "#177a56" : "#b23a33" }}>
              {p.excess.value > 0 ? "+" : ""}{p.excess.value} pts
            </div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: p.excess.attributable ? "#177a56" : "#b23a33" }}>[{p.excess.ci_low}, {p.excess.ci_high}]</div>
          </div>
        )}
        {p.type === "oracle" && <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 8 }}>Trial value: {p.trial_value}% &middot; see Oracles for source spread</div>}
      </div>
    );
  }
  const hasEvidence = (p.index_citations || []).length > 0 || (p.oracle_citations || []).length > 0;
  return (
    <div className="figure">
      {p.vega_spec ? <VegaChart spec={p.vega_spec} /> : (p.data && p.data.length > 0) ? (
        <table>
          <tbody>{p.data.slice(0, 8).map((row, i) => <tr key={i}>{Object.values(row).map((v, j) => <td key={j} style={{ padding: "3px 8px" }}>{String(v)}</td>)}</tr>)}</tbody>
        </table>
      ) : <div style={{ fontSize: 11.5, color: "var(--ink-3)", padding: "24px 0", textAlign: "center" }}>No data returned for this panel.</div>}
      {(p.narrative || (p.caveats || []).length > 0) && (
        <div className="note">
          {p.narrative && <><span className="note-tag obs">&#9888; OBSERVATION</span><p>{p.narrative}</p></>}
          {(p.caveats || []).length > 0 && (
            <ul>{p.caveats.map((c, i) => <li key={i}>{c}</li>)}</ul>
          )}
        </div>
      )}
      {(p.code || hasEvidence) && (
        <div className="cap">
          <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {(p.index_citations || []).map((c, i) => <span key={i} className="ref" style={{ cursor: "default" }}>{c}</span>)}
            {p.evidence_id && <span className="ecode" title={p.evidence_id}>{p.evidence_id.slice(-4)}</span>}
          </span>
          {p.code && <button onClick={() => setShowCode(s => !s)}>{showCode ? "Hide code" : "Open in analysis"} <Ic d={PATHS.arrowRight} size={12} sw={2} /></button>}
        </div>
      )}
      {showCode && p.code && <pre style={{ background: "#1a1a1c", color: "#dcebff", borderRadius: 8, marginTop: 8 }}>{p.code}</pre>}
    </div>
  );
}

function DashboardSection({ d, n }) {
  return (
    <section>
      <h2 className="sec"><span className="num">{n}.</span> {d.title}</h2>
      <p className="p">{d.take}</p>
      <div style={{ display: "grid", gridTemplateColumns: d.panels.length > 1 ? "1fr 1fr" : "1fr", gap: 16 }}>
        {d.panels.map(p => <PanelFigure key={p.panel_id} p={p} />)}
      </div>
    </section>
  );
}

export default function NarrativeDetail({ sid, id, goto, toast }) {
  const [narrative, setNarrative] = useState(null);
  const [eviHidden, setEviHidden] = useState(false);
  const [building, setBuilding] = useState(false);

  useEffect(() => { api.narrativeGet(id).then(r => { if (r.status === "ok") setNarrative(r.narrative); }); }, [id]);

  if (!narrative) return <div className="page"><div className="empty">Loading narrative…</div></div>;

  const evidenceIds = [...new Set(narrative.dashboards.flatMap(d => d.panels.map(p => p.evidence_id).filter(Boolean)))];
  const oracleCites = [...new Set(narrative.dashboards.flatMap(d => d.oracle_citations || []))];
  const allCaveats = narrative.dashboards.flatMap(d => d.panels.flatMap(p => p.caveats || []));
  const confidence = STATUS_CONF[narrative.status] || 3;

  const buildReport = async () => {
    setBuilding(true);
    const r = await api.reportsGenerate(sid, "narrative", narrative.narrative_id);
    setBuilding(false);
    if (r.status === "ok") { toast("PDF report built"); goto({ v: "reports" }); }
    else toast(r.error || "Report generation failed");
  };

  return (
    <div className="work">
      <div className={"evi-rail" + (eviHidden ? " mini" : "")}>
        {eviHidden ? (
          <button className="reopen" onClick={() => setEviHidden(false)} aria-label="Show evidence"><Ic d="M4 4h16v16H4z M8 9h8M8 13h5" size={15} sw={1.8} /></button>
        ) : (
          <>
            <button className="back" onClick={() => goto({ v: "narratives" })}><Ic d={PATHS.back} size={14} sw={2} /> All narratives</button>
            <div className="evi-panel">
              <div className="evi-head"><span className="t">Evidence <span>({evidenceIds.length})</span></span>
                <button className="icon-btn" style={{ width: 22, height: 22 }} onClick={() => setEviHidden(true)}><Ic d={PATHS.close} size={13} sw={2} /></button></div>
              <div className="evi-list">
                {evidenceIds.length === 0 && <div className="evi-empty">No evidence linked to this narrative.</div>}
                {evidenceIds.map(eid => (
                  <button className="evi" key={eid} onClick={() => document.getElementById("panel-for-" + eid)?.scrollIntoView({ behavior: "smooth", block: "center" })}>
                    <span className="ecode">{eid.slice(-4)}</span>
                    <span><span className="en">{eid}</span><span className="ed">Cited in this narrative</span></span>
                  </button>
                ))}
              </div>
              <button className="evi-all" onClick={() => goto({ v: "evidence" })}>View all evidence <Ic d={PATHS.arrowRight} size={13} sw={2} /></button>
            </div>
          </>
        )}
      </div>

      <main className="doc">
        <div className="doc-top">
          <span className="chip-ai">AI-GENERATED NARRATIVE</span>
          <span className="grounded">Grounded in
            <b><i className="g-dot" style={{ background: "var(--green)" }} />{evidenceIds.length} evidence items</b> &middot;
            <b><i className="g-dot" style={{ background: "var(--amber)" }} />{oracleCites.length} oracles</b> &middot;
            <b><i className="g-dot" style={{ background: "var(--blue)" }} />{narrative.dashboards.length} dashboards</b>
          </span>
        </div>
        <h1 className="title">{narrative.thesis}</h1>
        <div className="byline">
          <span className="by-mark"><Ic d="M12 2l2.2 6.1L20 10l-5.8 1.9L12 18l-2.2-6.1L4 10l5.8-1.9z" size={14} fill="currentColor" sw={0} /></span>
          <span><span className="by-n">Narrative agent</span><span className="by-m">{narrative.dashboards.length} sections</span></span>
          <span className="by-acts">
            <button onClick={buildReport} disabled={building}><Ic d={PATHS.reportsIcon} size={14} sw={1.8} /> {building ? "Building…" : "Build report"}</button>
          </span>
        </div>
        {narrative.dashboards.map((d, i) => <div id={`section-${d.dashboard_id}`} key={d.dashboard_id}><DashboardSection d={d} n={i + 1} /></div>)}
      </main>

      <aside className="aside">
        <div className="box thesis">
          <div className="box-h"><Ic d="M12 2l2.2 6.1L20 10l-5.8 1.9L12 18l-2.2-6.1L4 10l5.8-1.9z" size={12} fill="currentColor" sw={0} /> AI Thesis</div>
          <p>{narrative.thesis}</p>
          <div className="conf">Confidence <span className="dots">{[1, 2, 3, 4, 5].map(i => <i key={i} className={i <= confidence ? "on" : ""} />)}</span>
            <b>{confidence >= 4 ? "High" : confidence === 3 ? "Medium" : "Low"}</b></div>
        </div>
        {allCaveats.length > 0 && (
          <div className="box">
            <div className="box-h2"><Ic d="M12 8v4l3 2" size={12} sw={2} /> Caveats</div>
            <ul className="changes">{allCaveats.slice(0, 5).map((c, i) => <li key={i}>{c}</li>)}</ul>
          </div>
        )}
        <button className="action" onClick={() => goto({ v: "ide" })}>
          <span className="a-ic" style={{ background: "#eaf1fd", color: "#2f6fe4" }}><Ic d={PATHS.ide} size={14} sw={1.7} /></span>
          <span><span className="an">Open in Code IDE</span><span className="ad">Rerun or extend the underlying analysis</span></span>
          <Ic d={PATHS.arrowRight} size={14} sw={2} className="ar" />
        </button>
        <button className="action" onClick={buildReport}>
          <span className="a-ic" style={{ background: "#f0f7f3", color: "#22b07d" }}><Ic d={PATHS.reportsIcon} size={14} sw={1.7} /></span>
          <span><span className="an">{building ? "Building…" : "Build PDF report"}</span><span className="ad">Export this narrative as a document</span></span>
          <Ic d={PATHS.arrowRight} size={14} sw={2} className="ar" />
        </button>
        {oracleCites.length > 0 && (
          <div className="box">
            <div className="box-h2">Oracles consulted <span style={{ marginLeft: "auto", color: "var(--ink-3)" }}>{oracleCites.length}</span></div>
            <button className="link" style={{ marginTop: 10 }} onClick={() => goto({ v: "oracles" })}>View oracle details <Ic d={PATHS.arrowRight} size={12} sw={2} /></button>
          </div>
        )}
      </aside>
    </div>
  );
}
