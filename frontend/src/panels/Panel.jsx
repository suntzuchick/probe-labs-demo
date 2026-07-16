import React from "react";
import { C, AGENTS } from "../tokens.js";
import OraclePanelBody from "./OraclePanel.jsx";
import OracleTypesPanel from "./OracleTypesPanel.jsx";
import RegistryTable from "./RegistryTable.jsx";

export default function Panel({ panel, setPanel, sid, ...rest }) {
  const isO = panel.k === "oracle", isA = panel.k === "agents", isR = panel.k === "registry", isOT = panel.k === "oracle_types";
  const wide = isR;
  return (
    <aside style={{ width: wide ? 560 : 370, flexShrink: 0, background: "#fff", borderLeft: `1px solid ${C.line}`, overflowY: "auto", animation: "slide .22s ease" }}>
      <div style={{ padding: "17px 20px", borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "center", position: "sticky", top: 0, background: "#fff", zIndex: 5 }}>
        <span style={{ fontFamily: C.mono, fontSize: 10, fontWeight: 700, letterSpacing: ".07em", color: (isO || isOT) ? C.pink : isA ? C.violet : isR ? C.plum : C.blue }}>
          {isO ? "◆ ORACLE · EXTERNAL" : isOT ? "◆ ORACLE REGISTRY · 6 TYPES" : isA ? "◇ AGENTS" : isR ? "☰ HYPOTHESIS REGISTRY" : "▦ INDEX · INTERNAL"}
        </span>
        <button onClick={() => setPanel(null)} style={{ marginLeft: "auto", border: "none", background: "transparent", color: C.faint, fontSize: 16, cursor: "pointer" }}>×</button>
      </div>
      {isR ? <RegistryTable sid={sid} /> : isOT ? <OracleTypesPanel /> : (
        <div style={{ padding: "18px 20px" }}>
          {isA && (
            <>
              <div style={{ fontSize: 14, color: C.muted, lineHeight: 1.6, marginBottom: 16 }}>
                Six agents work the corpus. They <b>propose</b> — deterministic services execute and validate.
              </div>
              {Object.entries(AGENTS).map(([k, a]) => (
                <div key={k} style={{ border: `1px solid ${C.line}`, borderLeft: `3px solid ${a.c}`, borderRadius: "0 11px 11px 0", padding: "12px 14px", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: a.c }} />
                    <span style={{ fontSize: 14, fontWeight: 600, color: a.c }}>{a.n}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>{a.d}</div>
                </div>
              ))}
              <div style={{ marginTop: 12, background: C.violetBg, borderRadius: 10, padding: "12px 14px", fontSize: 12.5, color: C.plum, lineHeight: 1.6 }}>
                <b>Agents never mutate the corpus.</b> They emit typed proposals — a column mapping, a hypothesis, a dashboard plan — that deterministic code executes, validates, and pins. No agent output reaches a published artifact without passing a non-agent gate.
              </div>
              <button onClick={() => setPanel({ k: "registry" })} style={{ width: "100%", marginTop: 12, border: `1px solid ${C.line2}`, background: "#fff", color: C.plum, borderRadius: 9, padding: "9px 0", fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: C.sans }}>
                ☰ View hypothesis registry →
              </button>
              <button onClick={() => setPanel({ k: "oracle_types" })} style={{ width: "100%", marginTop: 8, border: `1px solid ${C.line2}`, background: "#fff", color: C.pink, borderRadius: 9, padding: "9px 0", fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: C.sans }}>
                ◆ View oracle registry (6 types) →
              </button>
            </>
          )}
          {isO && <OraclePanelBody panel={panel} {...rest} />}
          {!isO && !isA && (
            <div style={{ fontSize: 13, color: C.muted2 }}>No index selected.</div>
          )}
        </div>
      )}
    </aside>
  );
}
