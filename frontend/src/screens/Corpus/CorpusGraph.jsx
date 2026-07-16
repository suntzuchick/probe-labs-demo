import React, { useEffect, useMemo, useRef, useState } from "react";
import { C, ST } from "../../tokens.js";

const rng = (s) => () => (s = (s * 9301 + 49297) % 233280) / 233280;

export default function CorpusGraph({ narratives, setRoute }) {
  const [hov, setHov] = useState(null);
  const [t, setT] = useState(0);
  const raf = useRef();

  useEffect(() => {
    let start = performance.now();
    const loop = (n) => { setT((n - start) / 1000); raf.current = requestAnimationFrame(loop); };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
  }, []);

  const groups = useMemo(() => {
    const byGroup = {};
    narratives.forEach(n => {
      const g = n.is_synthetic ? (n.program || "other") : "your data";
      (byGroup[g] = byGroup[g] || []).push(n);
    });
    const keys = Object.keys(byGroup);
    const cols = Math.ceil(Math.sqrt(keys.length || 1));
    return keys.map((k, i) => ({
      key: k, items: byGroup[k],
      cx: 180 + (i % cols) * (900 / cols),
      cy: 150 + Math.floor(i / cols) * (560 / Math.max(1, Math.ceil(keys.length / cols))),
    }));
  }, [narratives]);

  const positioned = useMemo(() => {
    return groups.flatMap(g => {
      const r = rng(g.key.charCodeAt(0) * 7 + g.items.length);
      return g.items.map((n, i) => {
        const a = (i / Math.max(g.items.length, 1)) * Math.PI * 2 + r() * 0.6;
        const rad = 26 + r() * 95;
        return { ...n, gx: g.cx, gy: g.cy, a, rad, jitter: r() };
      });
    });
  }, [groups]);

  return (
    <div style={{ flex: 1, position: "relative", background: C.canvas, overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(880px 600px at 52% 45%, #FEF3FB 0%, #F8F2FF 46%, #FEFCFE 82%)" }} />
      <svg viewBox="0 0 1080 700" style={{ width: "100%", height: "100%", position: "relative" }}>
        {groups.map(g => (
          <text key={g.key} x={g.cx} y={g.cy - 130} textAnchor="middle" style={{ fontFamily: C.mono, fontSize: 11, fill: C.faint, letterSpacing: ".08em" }}>{g.key.toUpperCase()}</text>
        ))}
        {positioned.map((n, i) => {
          const cx = n.gx + Math.cos(n.a + t * (0.03 + n.jitter * 0.02)) * n.rad;
          const cy = n.gy + Math.sin(n.a + t * (0.03 + n.jitter * 0.02)) * n.rad;
          const s = ST[n.status] || ST.review;
          const r = 4 + (n.score / 100) * 8;
          const bl = n.status === "blocked";
          const dim = hov && hov !== n.narrative_id;
          return (
            <g key={n.narrative_id} opacity={dim ? 0.15 : 1} style={{ transition: "opacity .3s", cursor: n.is_synthetic ? "default" : "pointer" }}
              onMouseEnter={() => setHov(n.narrative_id)} onMouseLeave={() => setHov(null)}
              onClick={() => !n.is_synthetic && setRoute({ v: "narrative", id: n.narrative_id, title: n.thesis })}>
              <circle cx={cx} cy={cy} r={r} fill={bl ? "#fff" : s.c} stroke={bl ? C.line3 : "none"} strokeWidth={bl ? 1.2 : 0} strokeDasharray={bl ? "2 2" : "none"} opacity={n.is_synthetic ? 0.55 : 1} />
              {!n.is_synthetic && <circle cx={cx + r * 0.75} cy={cy - r * 0.75} r={2.4} fill={C.pink} />}
              {hov === n.narrative_id && (
                <text x={cx} y={cy + r + 14} textAnchor="middle" style={{ fontFamily: C.sans, fontSize: 11.5, fontWeight: 600, fill: C.ink, pointerEvents: "none" }}>
                  {n.thesis.length > 46 ? n.thesis.slice(0, 44) + "…" : n.thesis}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div style={{ position: "absolute", bottom: 20, left: 24, fontSize: 13, color: C.muted }}>
        Size = confidence · <span style={{ color: C.pink }}>◆ pink dot = agent-generated (real)</span> · faded = preview · hollow = blocked
      </div>
    </div>
  );
}
