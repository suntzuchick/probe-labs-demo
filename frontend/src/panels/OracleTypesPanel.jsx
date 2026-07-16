import React, { useEffect, useState } from "react";
import { C } from "../tokens.js";
import { api } from "../api/client.js";

const LIVE_TYPE = "background_rate";

export default function OracleTypesPanel() {
  const [types, setTypes] = useState(null);

  useEffect(() => { api.oracleTypes().then(res => setTypes(res.types || {})); }, []);

  if (!types) return <div style={{ padding: 20, color: C.muted2 }}>Loading…</div>;

  return (
    <div style={{ padding: "18px 20px" }}>
      <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, marginBottom: 16 }}>
        Six oracle types ship in the registry. Each is a function of population — this build fully
        resolves <b>background_rate</b> live (open it from any ◆ citation in a narrative). The other
        five are listed here as flat entries — population-scoped resolution for them is a documented
        simplification, not wired in this build.
      </div>
      {Object.entries(types).map(([key, t]) => {
        const isLive = key === LIVE_TYPE;
        return (
          <div key={key} style={{ border: `1px solid ${isLive ? C.pinkPale : C.line}`, borderLeft: `3px solid ${isLive ? C.pink : C.line3}`,
            borderRadius: "0 11px 11px 0", padding: "12px 14px", marginBottom: 8, opacity: isLive ? 1 : .72 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontFamily: C.mono, fontSize: 13, fontWeight: 700, color: isLive ? C.pink : C.muted }}>oracle.{key}</span>
              {isLive
                ? <span style={{ fontFamily: C.mono, fontSize: 9, color: C.pink, background: C.pinkBg, borderRadius: 10, padding: "2px 7px" }}>◆ LIVE</span>
                : <span style={{ fontFamily: C.mono, fontSize: 9, color: C.faint, background: C.soft2, borderRadius: 10, padding: "2px 7px" }}>FLAT ENTRY</span>}
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.ink, marginTop: 4 }}>{t.label}</div>
            <div style={{ fontSize: 12, color: C.muted2, marginTop: 2 }}>population args: {t.population_schema.join(", ")}</div>
          </div>
        );
      })}
    </div>
  );
}
