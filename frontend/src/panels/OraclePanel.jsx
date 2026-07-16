import React, { useEffect } from "react";
import { C } from "../tokens.js";

export default function OraclePanelBody({ panel, oracles, loadOracle, pinOracle, driftOracle, resetOracle }) {
  const oid = panel.id;
  const inst = oracles[oid];

  useEffect(() => { if (oid && !inst) loadOracle(oid); }, [oid]);

  if (!inst) return <div style={{ fontSize: 13, color: C.muted2 }}>Loading oracle…</div>;

  const { consensus, sources, oracle_type, drifted, pinned } = inst;

  return (
    <>
      <div style={{ fontFamily: C.mono, fontSize: 13.5, fontWeight: 600, color: C.plum, marginBottom: 4 }}>oracle.{oracle_type}</div>
      <div style={{ fontSize: 11, color: C.faint, marginBottom: 10 }}>population: {Object.values(inst.population_args).filter(Boolean).join(" · ")}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
        <span style={{ fontFamily: C.disp, fontSize: 32, fontWeight: 700, color: C.pink }}>{consensus.value}%</span>
        <span style={{ fontFamily: C.mono, fontSize: 12.5, color: C.amber }}>[{consensus.ci_low}–{consensus.ci_high}]</span>
      </div>
      <div style={{ background: C.amberBg, borderRadius: 8, padding: "8px 11px", fontSize: 11.5, color: C.amber, marginBottom: 14, lineHeight: 1.5 }}>
        <b>Claude-recalled</b> — these are known-published-estimate recalls, not a live database query. Verify before real use.
      </div>

      {sources.map((f, i) => (
        <div key={i} style={{ padding: "9px 0", borderBottom: `1px solid ${C.line}` }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>{f.source}</span>
            {f.fresh && <span style={{ fontFamily: C.mono, fontSize: 8.5, color: "#fff", background: C.orange, borderRadius: 9, padding: "2px 6px" }}>NEW</span>}
            <span style={{ marginLeft: "auto", fontFamily: C.mono, fontSize: 12.5, fontWeight: 700, color: C.plum }}>{f.value}%</span>
          </div>
          <div style={{ fontFamily: C.mono, fontSize: 10.5, color: C.faint, marginTop: 2 }}>
            [{f.ci_low}–{f.ci_high}] · n={f.n} · {f.pub_year} · weight {f.weight ?? "—"}
          </div>
        </div>
      ))}

      <div style={{ marginTop: 13, background: C.amberBg, borderRadius: 10, padding: "12px 14px", fontSize: 12.5, color: C.amber, lineHeight: 1.6 }}>
        The oracle never picks one source. It publishes the consensus <b>and the spread</b> ({consensus.method}) — the spread becomes uncertainty in your finding.
      </div>

      {!drifted ? (
        <button onClick={() => driftOracle(oid)} style={{ width: "100%", marginTop: 14, border: "none", background: C.grad, color: "#fff", borderRadius: 9, padding: "10px 0", fontSize: 13.5, fontWeight: 600, cursor: "pointer", fontFamily: C.sans }}>
          ⚡ Simulate: a new registry publishes
        </button>
      ) : (
        <div style={{ marginTop: 14, background: C.amberBg, borderRadius: 10, padding: "13px 15px", fontSize: 13, color: C.amber, lineHeight: 1.6 }}>
          <b>Your data never moved. Your conclusion did.</b> Dependent dashboards re-ran.
          <button onClick={() => resetOracle(oid)} style={{ display: "block", marginTop: 9, border: `1px solid ${C.amber}`, background: "transparent", color: C.amber, borderRadius: 8, padding: "6px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: C.sans }}>↺ Reset</button>
        </div>
      )}
      {!pinned && (
        <button onClick={() => pinOracle(oid)} style={{ width: "100%", marginTop: 8, border: `1px solid ${C.line2}`, background: "#fff", color: C.muted, borderRadius: 9, padding: "8px 0", fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: C.sans }}>
          Pin this value
        </button>
      )}
    </>
  );
}
