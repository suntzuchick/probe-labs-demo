import React from "react";
import { C, ST } from "../../tokens.js";

export default function CorpusList({ narratives, setRoute }) {
  if (narratives.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "70px 20px", color: C.faint }}>
        <div style={{ fontSize: 30, marginBottom: 12, opacity: .5 }}>○</div>
        <div style={{ fontFamily: C.disp, fontSize: 19, fontWeight: 600, color: C.muted, marginBottom: 6 }}>No narratives match</div>
        <div style={{ fontSize: 14, lineHeight: 1.6, maxWidth: "40ch", margin: "0 auto" }}>
          Try a broader filter — or this may be a story the corpus <b style={{ color: C.muted2 }}>can't tell yet</b>. Check the blocked narratives for what data would unlock it.
        </div>
      </div>
    );
  }
  return (
    <>
      <div style={{ fontFamily: C.mono, fontSize: 11.5, color: C.faint, marginBottom: 10 }}>{narratives.length} matching</div>
      <div style={{ display: "grid", gap: 7 }}>
        {narratives.slice(0, 200).map(n => {
          const s = ST[n.status] || ST.review;
          return (
            <div key={n.narrative_id} className="row" onClick={() => !n.is_synthetic && setRoute({ v: "narrative", id: n.narrative_id, title: n.thesis })}
              style={{ display: "flex", alignItems: "center", gap: 11, background: "#fff", border: `1px solid ${C.line}`, borderLeft: `3px solid ${s.c}`,
                borderRadius: "0 11px 11px 0", padding: "12px 15px", cursor: n.is_synthetic ? "default" : "pointer", opacity: n.is_synthetic ? .78 : 1 }}>
              <span style={{ fontSize: 14.5, fontWeight: n.is_synthetic ? 500 : 600, flex: 1, minWidth: 0, color: n.status === "blocked" ? C.muted2 : C.ink }}>{n.thesis}</span>
              {!n.is_synthetic && <span style={{ fontFamily: C.mono, fontSize: 9, color: C.green, background: C.greenBg, borderRadius: 10, padding: "2px 6px" }}>OPEN →</span>}
              {n.is_synthetic && <span style={{ fontFamily: C.mono, fontSize: 9, color: C.faint, background: C.soft2, borderRadius: 10, padding: "2px 6px" }}>PREVIEW</span>}
              {!n.is_synthetic && <span style={{ fontFamily: C.mono, fontSize: 9, color: C.pink, background: C.pinkBg, borderRadius: 10, padding: "2px 6px" }}>◆ AGENT</span>}
              {n.need ? <span style={{ fontSize: 12, color: C.faint, fontFamily: C.mono }}>needs {n.need}</span>
                : <span style={{ fontFamily: C.mono, fontSize: 11.5, color: C.faint }}>{(n.dashboards || []).length} dashboard{(n.dashboards || []).length === 1 ? "" : "s"}</span>}
              <span style={{ fontFamily: C.mono, fontSize: 12, fontWeight: 700, color: s.c, width: 24, textAlign: "right" }}>{n.score}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}
