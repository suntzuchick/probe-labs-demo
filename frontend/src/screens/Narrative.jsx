import React, { useEffect, useMemo, useRef, useState } from "react";
import { C } from "../tokens.js";
import { api } from "../api/client.js";
import BlockEditor from "../panels/BlockEditor.jsx";

function CodeView({ narrative }) {
  const chartPanels = narrative.dashboards.flatMap(d => d.panels.filter(p => p.type === "chart" && p.code));
  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "30px 26px 90px" }}>
      <p style={{ fontSize: 14, color: C.muted, marginBottom: 18 }}>The same narrative, as code — the exact pandas the Code Builder ran for each panel.</p>
      {chartPanels.length === 0 && <div style={{ color: C.faint, fontSize: 14 }}>No code-backed panels in this narrative.</div>}
      {chartPanels.map(p => (
        <div key={p.panel_id} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.plum, marginBottom: 6 }}>{p.title}</div>
          <pre style={{ background: C.term, color: "#DCEBFF", borderRadius: 12, padding: "16px 18px", fontFamily: C.mono, fontSize: 12.5, lineHeight: 1.7, overflowX: "auto", whiteSpace: "pre-wrap" }}>{p.code}</pre>
        </div>
      ))}
    </div>
  );
}

function computeExcess(trialValue, consensus) {
  const value = +(trialValue - consensus.value).toFixed(2);
  const ci_low = +(trialValue - consensus.ci_high).toFixed(2);
  const ci_high = +(trialValue - consensus.ci_low).toFixed(2);
  return { value, ci_low, ci_high, attributable: ci_low > 0 };
}

function VegaChart({ spec }) {
  // vega-lite's "width":"container" autosize measures clientWidth on
  // vega-embed's own wrapper div, which vega-embed renders as
  // display:inline-block — that never gets a real width from vega's own
  // measurement (it stays 0 forever; the chart "renders", a real
  // <svg width="0"> lands in the DOM, no console error, just invisible).
  // Fix: measure this div's own width ourselves (reliable — it's a plain
  // block div, not vega-embed's wrapper) and pass a concrete pixel value
  // instead of "container". Measured once at mount, not on an observer —
  // re-measuring after vega-embed has already inserted content is circular
  // (the mount point's own shrink-to-fit width reflects its content's
  // width, so "did it resize" and "did we just resize it" become the same
  // question, and any grid/flex min-width:auto ancestor amplifies it into
  // unbounded growth instead of converging).
  const ref = useRef(null);
  const [state, setState] = useState("loading"); // loading | ok | error
  const [errMsg, setErrMsg] = useState("");

  useEffect(() => {
    if (!spec) { setState("error"); setErrMsg("No chart spec was returned for this panel."); return; }
    if (!ref.current) return;
    if (!window.vegaEmbed) {
      setState("error");
      setErrMsg("Chart library (vega-embed) hasn't loaded — check your connection and reload.");
      return;
    }
    const measuredWidth = ref.current.clientWidth;
    const resolvedSpec = spec.width === "container" && measuredWidth > 0
      ? { ...spec, width: measuredWidth }
      : spec;
    setState("loading");
    window.vegaEmbed(ref.current, resolvedSpec, { actions: false, renderer: "svg" })
      .then(() => setState("ok"))
      .catch(e => { setState("error"); setErrMsg(e?.message || "Chart failed to render."); });
  }, [JSON.stringify(spec)]);

  return (
    <div style={{ minHeight: 170 }}>
      <div ref={ref} />
      {state === "loading" && <div style={{ fontSize: 11.5, color: C.faint, padding: "60px 0", textAlign: "center" }}>Rendering chart…</div>}
      {state === "error" && (
        <div style={{ fontSize: 11.5, color: C.red, background: C.redBg, borderRadius: 8, padding: "10px 12px", lineHeight: 1.5 }}>
          ⚠ Chart failed to render — {errMsg}
        </div>
      )}
    </div>
  );
}

function ChartPanel({ p }) {
  const [showCode, setShowCode] = useState(false);
  const hasEvidence = (p.index_citations || []).length > 0 || (p.oracle_citations || []).length > 0;

  return (
    // minWidth: 0 overrides a CSS grid item's default min-width:auto — without
    // it, any wide intrinsic content in this column (the vega-embed mount
    // point included) can force the "1fr" grid track itself to grow past its
    // fair share, which is how a chart-sizing bug becomes a runaway layout.
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 13px", background: "#fff", minWidth: 0 }}>
      <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 1 }}>{p.title}</div>
      <div style={{ fontSize: 11.5, color: C.faint, marginBottom: 6 }}>{p.sub}</div>

      {p.vega_spec ? <VegaChart spec={p.vega_spec} /> : (p.data && p.data.length > 0) ? (
        <table style={{ width: "100%", fontSize: 11.5, fontFamily: C.mono, borderCollapse: "collapse" }}>
          <tbody>
            {p.data.slice(0, 8).map((row, i) => (
              <tr key={i}>{Object.values(row).map((v, j) => <td key={j} style={{ padding: "3px 6px", borderBottom: `1px solid ${C.line}` }}>{String(v)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div style={{ fontSize: 11.5, color: C.faint, padding: "24px 0", textAlign: "center" }}>No data returned for this panel.</div>
      )}

      {p.narrative && (
        <div style={{ fontSize: 12, color: C.muted2, lineHeight: 1.5, marginTop: 10 }}>{p.narrative}</div>
      )}

      {(p.caveats || []).length > 0 && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
          {p.caveats.map((c, i) => (
            <div key={i} style={{ fontSize: 10.5, color: C.amber, background: C.amberBg, borderRadius: 6, padding: "4px 8px", lineHeight: 1.4 }}>⚠ {c}</div>
          ))}
        </div>
      )}

      {(p.code || hasEvidence) && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.line}` }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {(p.index_citations || []).map((c, i) => (
              <span key={"i" + i} style={{ fontFamily: C.mono, fontSize: 9.5, color: C.blue, background: C.blueBg, borderRadius: 8, padding: "2px 6px" }}>▦ {c}</span>
            ))}
            {(p.oracle_citations || []).map((c, i) => (
              <span key={"o" + i} style={{ fontFamily: C.mono, fontSize: 9.5, color: C.pink, background: C.pinkBg, borderRadius: 8, padding: "2px 6px" }}>◆ oracle</span>
            ))}
            {p.code && (
              <button onClick={() => setShowCode(s => !s)} style={{ marginLeft: "auto", border: "none", background: "transparent", color: C.faint, fontSize: 10.5, fontWeight: 600, cursor: "pointer", fontFamily: C.sans }}>
                {showCode ? "hide code ▲" : "view code ▼"}
              </button>
            )}
          </div>
          {showCode && p.code && (
            <pre style={{ background: C.term, color: "#DCEBFF", borderRadius: 8, padding: "10px 12px", fontFamily: C.mono, fontSize: 10.5, lineHeight: 1.6, overflowX: "auto", whiteSpace: "pre-wrap", marginTop: 6 }}>{p.code}</pre>
          )}
        </div>
      )}
    </div>
  );
}

function OracleForestPanel({ p, oracle, setPanel }) {
  const sources = oracle?.sources || [];
  const lo = Math.min(...sources.map(s => s.ci_low), p.trial_value), hi = Math.max(...sources.map(s => s.ci_high), p.trial_value);
  const scale = v => ((v - lo) / Math.max(hi - lo, 1)) * 100;
  return (
    <div onClick={() => setPanel({ k: "oracle", id: p.oracle_instance_id })}
      style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 13px", cursor: "pointer", background: "#fff" }}>
      <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 1 }}>{p.title}</div>
      <div style={{ fontSize: 11.5, color: C.faint, marginBottom: 10 }}>{p.sub}</div>
      {sources.map((s, i) => (
        <div key={i} style={{ marginBottom: 9 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 2 }}>
            <span style={{ color: C.muted2 }}>{s.source}{s.fresh ? " •NEW" : ""}</span>
            <span style={{ fontFamily: C.mono, color: s.fresh ? C.orange : C.pink }}>{s.value}%</span>
          </div>
          <div style={{ position: "relative", height: 6, background: C.soft2, borderRadius: 3 }}>
            <div style={{ position: "absolute", left: `${scale(s.ci_low)}%`, width: `${scale(s.ci_high) - scale(s.ci_low)}%`, height: 6, background: s.fresh ? C.orange : C.pinkPale, borderRadius: 3 }} />
            <div style={{ position: "absolute", left: `${scale(s.value)}%`, top: -2, width: 2, height: 10, background: s.fresh ? C.orange : C.pink }} />
          </div>
        </div>
      ))}
      <div style={{ position: "relative", height: 1, background: C.line3, margin: "8px 0 4px" }}>
        <div style={{ position: "absolute", left: `${scale(p.trial_value)}%`, top: -5, width: 2, height: 11, background: C.blue }} />
      </div>
      <div style={{ fontSize: 10.5, color: C.faint }}>▦ blue line = trial value ({p.trial_value}%)</div>
    </div>
  );
}

function ExcessPanel({ p, oracle }) {
  const consensus = oracle?.consensus || { value: p.excess.value ? p.trial_value - p.excess.value : 0, ci_low: 0, ci_high: 0 };
  const excess = oracle ? computeExcess(p.trial_value, consensus) : p.excess;
  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 13px", background: "#fff" }}>
      <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 1 }}>{p.title}</div>
      <div style={{ fontSize: 11.5, color: C.faint, marginBottom: 10 }}>{p.sub}</div>
      {[["trial", p.trial_value, C.blue], ["oracle background", consensus.value, C.pink]].map(([l, v, c]) => (
        <div key={l} style={{ marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}><span style={{ color: C.muted2 }}>{l}</span><span style={{ fontFamily: C.mono, fontWeight: 700, color: c }}>{v}%</span></div>
          <div style={{ height: 12, background: C.soft2, borderRadius: 5 }}><div style={{ height: 12, width: `${Math.min(v * 2.4, 100)}%`, background: c, borderRadius: 5 }} /></div>
        </div>
      ))}
      <div style={{ marginTop: 6, padding: "10px 12px", background: excess.attributable ? C.greenBg : C.redBg, borderRadius: 9, textAlign: "center" }}>
        <div style={{ fontFamily: C.mono, fontSize: 9.5, color: excess.attributable ? C.green : C.red, marginBottom: 2 }}>EXCESS RISK</div>
        <div style={{ fontFamily: C.disp, fontSize: 19, fontWeight: 700, color: excess.attributable ? C.green : C.red }}>{excess.value > 0 ? "+" : ""}{excess.value} pts</div>
        <div style={{ fontFamily: C.mono, fontSize: 10.5, color: excess.attributable ? C.green : C.red }}>[{excess.ci_low} – {excess.ci_high}]</div>
      </div>
    </div>
  );
}

const NUMBER_RE = /([-+]?\d[\d,]*\.?\d*%?)/g;
const IS_NUMBER_RE = /^[-+]?\d[\d,]*\.?\d*%?$/;

function CiteText({ text, kind, onClick }) {
  const color = kind === "oracle" ? C.pink : C.blue;
  const bg = kind === "oracle" ? C.pinkBg : C.blueBg;
  const parts = text.split(NUMBER_RE);
  return (
    <>
      {parts.map((part, i) => IS_NUMBER_RE.test(part) ? (
        <span key={i} onClick={onClick} style={{ cursor: onClick ? "pointer" : "default", fontFamily: C.mono, fontWeight: 600, color, background: bg, borderRadius: 4, padding: "1px 4px", margin: "0 1px" }}>
          <span style={{ fontSize: ".8em", opacity: .7, marginRight: 2 }}>{kind === "oracle" ? "◆" : "▦"}</span>{part}
        </span>
      ) : part)}
    </>
  );
}

const PANEL_RENDERERS = {
  chart: ChartPanel,
  oracle: OracleForestPanel,
  excess: ExcessPanel,
  verdict: ExcessPanel,
};

const ACT = { observation: "OBSERVATION", turn: "THE TURN", verdict: "VERDICT" };

function DashboardCard({ d, oracle, setPanel, affected, unaffected, recomputing }) {
  const tone = d.stage === "verdict" ? (d.status === "contradicted" ? "bad" : "good") : d.stage === "turn" ? "warn" : "neutral";
  const tc = { good: C.green, warn: C.amber, bad: C.red, neutral: C.plum }[tone];
  const tbg = { good: C.greenBg, warn: C.amberBg, bad: C.redBg, neutral: C.soft }[tone];
  const isTurn = d.stage === "turn", isVerdict = d.stage === "verdict";
  return (
    <div className={recomputing ? "recomputing" : ""}
      style={{ margin: "34px 0",
        border: `1px solid ${affected ? "#F5DFC0" : isTurn ? C.pinkPale : isVerdict ? "#CDE9D8" : C.line}`,
        borderLeft: isVerdict ? `4px solid ${tc}` : isTurn ? `4px solid ${C.pink}` : `1px solid ${C.line}`,
        borderRadius: d.stage === "observation" ? 18 : "0 18px 18px 0",
        background: isTurn ? "linear-gradient(180deg,#FEF7FC,#fff)" : isVerdict ? "linear-gradient(180deg,#F6FBF8,#fff)" : "#fff",
        boxShadow: isTurn ? "0 6px 30px rgba(255,117,215,.10)" : isVerdict ? "0 6px 30px rgba(27,122,69,.07)" : "none",
        overflow: "hidden", transition: "all .4s" }}>
      <div style={{ padding: "18px 22px 0", borderBottom: `1px solid ${C.line}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 6, flexWrap: "wrap" }}>
          <span style={{ fontFamily: C.mono, fontSize: 9.5, fontWeight: 700, letterSpacing: ".09em", color: isTurn ? C.pink : isVerdict ? tc : C.faint, background: isTurn ? C.pinkBg : isVerdict ? tbg : C.soft2, borderRadius: 10, padding: "3px 9px" }}>{ACT[d.stage]}</span>
          <span style={{ fontFamily: C.mono, fontSize: 10.5, fontWeight: 700, color: C.faint, letterSpacing: ".06em" }}>{d.title.toUpperCase()}</span>
          {isTurn && <span style={{ fontFamily: C.mono, fontSize: 9, color: C.pink, background: "#fff", border: `1px solid ${C.pinkPale}`, borderRadius: 10, padding: "2px 7px" }}>◆ ORACLE-BACKED</span>}
          {recomputing && <span style={{ fontFamily: C.mono, fontSize: 9, color: C.amber, background: C.amberBg, borderRadius: 10, padding: "2px 7px" }}>⏳ RECOMPUTING…</span>}
          {affected && !recomputing && <span style={{ fontFamily: C.mono, fontSize: 9, color: C.amber, background: C.amberBg, borderRadius: 10, padding: "2px 7px" }}>⏳ RE-RAN</span>}
          {unaffected && <span style={{ fontFamily: C.mono, fontSize: 9, color: C.green, background: C.greenBg, borderRadius: 10, padding: "2px 7px" }}>✓ UNAFFECTED</span>}
          <span style={{ marginLeft: "auto", fontFamily: C.mono, fontSize: 10.5, color: C.faint }}>{d.panels.length} panels</span>
        </div>
        <div style={{ fontFamily: C.disp, fontSize: isVerdict ? 23 : 21, fontWeight: 600, marginBottom: 4 }}>{d.title}</div>
        <div style={{ fontSize: 14.5, color: C.muted2, marginBottom: 16 }}>{d.question}</div>
      </div>
      <div style={{ padding: "16px 18px", display: "grid", gridTemplateColumns: d.panels.length > 2 ? "1fr 1fr 1fr" : d.panels.length === 2 ? "1fr 1fr" : "1fr", gap: 12, opacity: recomputing ? .55 : 1, transition: "opacity .3s" }}>
        {d.panels.map(p => {
          const R = PANEL_RENDERERS[p.type] || ChartPanel;
          return <R key={p.panel_id} p={p} oracle={oracle} setPanel={setPanel} />;
        })}
      </div>
      <div style={{ margin: "0 18px 16px", background: affected ? C.redBg : tbg, borderRadius: 10, padding: "12px 15px", fontSize: isVerdict ? 14.5 : 13.5, color: affected ? C.red : tc, fontWeight: 500, lineHeight: 1.55 }}>
        <b>→ </b><CiteText text={d.take} kind={d.stage === "observation" ? "index" : "oracle"} onClick={d.stage !== "observation" ? () => setPanel({ k: "oracle", id: d.oracle_citations?.[0] }) : undefined} />
      </div>
    </div>
  );
}

export default function Narrative({ sid, route, setRoute, setPanel, oracles, loadOracle, driftOracle }) {
  const [narrative, setNarrative] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState(null);
  const [armed, setArmed] = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  const [mode, setMode] = useState("read");
  const timerRef = useRef(null);

  useEffect(() => {
    let alive = true;
    setStatus("loading"); setNarrative(null); setError(null);
    const load = async () => {
      if (route.mode === "generate") {
        const res = await api.narrativesGenerate(sid);
        if (!alive) return;
        if (res.status === "ok") { setNarrative(res.narrative); setStatus("ok"); }
        else { setError(res.error); setStatus("error"); }
      } else if (route.id) {
        const res = await api.narrativeGet(route.id);
        if (!alive) return;
        if (res.status === "ok") { setNarrative(res.narrative); setStatus("ok"); }
        else { setError(res.error); setStatus("error"); }
      }
    };
    load();
    return () => { alive = false; };
  }, [sid, route.mode, route.id]);

  const turnOid = useMemo(() => {
    const turn = narrative?.dashboards.find(d => d.stage === "turn");
    return turn?.oracle_citations?.[0] || null;
  }, [narrative]);

  useEffect(() => {
    if (turnOid) loadOracle(turnOid);
  }, [turnOid]);

  useEffect(() => {
    if (narrative && turnOid && !armed) setArmed(true);
  }, [narrative, turnOid, armed]);

  const oracle = turnOid ? oracles[turnOid] : null;

  const landDrift = () => {
    if (recomputing || oracle?.drifted) return;
    setRecomputing(true);
    driftOracle(turnOid).finally(() => setTimeout(() => setRecomputing(false), 1500));
  };

  useEffect(() => {
    if (!armed || !turnOid || oracle?.drifted) return;
    timerRef.current = setTimeout(landDrift, 20000);
    return () => clearTimeout(timerRef.current);
  }, [armed, turnOid, oracle?.drifted]);

  if (status === "loading") return <div style={{ padding: 40, color: C.muted2 }}>Generating narrative from real data — this runs live Claude calls, may take a minute…</div>;
  if (status === "error") return <div style={{ padding: 40, color: C.red }}>{error}</div>;
  if (!narrative) return null;

  const drifted = !!oracle?.drifted;

  return (
    <div>
      <div style={{ position: "sticky", top: 0, zIndex: 20, background: "rgba(255,255,255,.92)", backdropFilter: "blur(10px)", borderBottom: `1px solid ${C.line}`, padding: "9px 24px", display: "flex", alignItems: "center" }}>
        <button onClick={() => setRoute({ v: "corpus" })} style={{ border: "none", background: "transparent", color: C.blue, fontSize: 13.5, fontWeight: 600, cursor: "pointer", fontFamily: C.sans, padding: 0 }}>← Corpus</button>
        <div style={{ marginLeft: "auto", display: "flex", background: C.soft2, borderRadius: 8, padding: 3, gap: 2 }}>
          {[["read", "⤢ Read"], ["write", "✎ Write"], ["code", "⟨⟩ Code"]].map(([k, l]) => (
            <button key={k} onClick={() => setMode(k)} style={{ border: "none", background: mode === k ? "#fff" : "transparent", color: mode === k ? C.plum : C.muted2, borderRadius: 6, padding: "6px 13px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: C.sans }}>{l}</button>
          ))}
        </div>
      </div>

      {mode === "write" && <BlockEditor sid={sid} narrative={narrative} setPanel={setPanel} />}
      {mode === "code" && <CodeView narrative={narrative} />}
      {mode === "read" && drifted && (
        <div style={{ background: C.amberBg, borderBottom: "1px solid #F5DFC0", padding: "11px 24px" }}>
          <div style={{ maxWidth: 860, margin: "0 auto", display: "flex", alignItems: "center", gap: 12, fontSize: 13.5, color: C.amber }}>
            <span>⏳</span><span style={{ flex: 1 }}><b>The oracle updated.</b> Dependent dashboards re-ran. The conclusion may have flipped.</span>
          </div>
        </div>
      )}

      {mode === "read" && (
        <article style={{ maxWidth: 860, margin: "0 auto", padding: "40px 24px 90px" }}>
          <h1 style={{ fontFamily: C.disp, fontSize: 38, fontWeight: 600, lineHeight: 1.15, letterSpacing: "-1.1px", margin: "0 0 12px" }}>{narrative.thesis}</h1>
          <div style={{ fontSize: 13, color: C.muted2, marginBottom: 20 }}>◆ dashboards composed by the narrative agent from real computed stats</div>

          {narrative.dashboards.map(d => {
            const affected = drifted && d.oracle_citations?.includes(turnOid);
            const unaffected = drifted && !(d.oracle_citations?.length);
            return (
              <DashboardCard key={d.dashboard_id} d={d} oracle={oracle} setPanel={setPanel}
                affected={affected} unaffected={unaffected} recomputing={recomputing && d.oracle_citations?.includes(turnOid)} />
            );
          })}

          {turnOid && !drifted && !recomputing && (
            <div style={{ marginTop: 28, background: "#fff", border: `1px solid ${C.line}`, borderLeft: `3px solid ${C.green}`, borderRadius: "0 14px 14px 0", padding: "16px 20px", display: "flex", alignItems: "center", gap: 13 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.green, animation: "pulse 1.8s infinite", flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14.5, fontWeight: 600, color: C.green }}>The corpus is watching this finding.</div>
                <div style={{ fontSize: 13.5, color: C.muted2, lineHeight: 1.5, marginTop: 2 }}>If the oracle moves, dependent dashboards re-run and you'll be told which sentences stopped being true.</div>
              </div>
              <button onClick={landDrift} style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.faint, borderRadius: 8, padding: "6px 11px", fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: C.mono, flexShrink: 0 }}>skip wait</button>
            </div>
          )}
        </article>
      )}
    </div>
  );
}
