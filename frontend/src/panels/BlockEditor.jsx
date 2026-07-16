import React, { useEffect, useMemo, useState } from "react";
import { C } from "../tokens.js";
import { api } from "../api/client.js";

const NOTE_COLOR = { causal: C.amber, oracle: C.pink };

export default function BlockEditor({ sid, narrative, setPanel }) {
  const [doc, setDoc] = useState(() => [
    { id: 1, v: narrative?.thesis || "New finding" },
    { id: 2, v: "Write your claim here." },
  ]);
  const [notes, setNotes] = useState({});
  const [slash, setSlash] = useState(null);
  const [published, setPublished] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const lint = async (blocks) => {
    const res = await api.editorLint(blocks.map(b => ({ id: b.id, text: b.v, oracle_citations: b.oracleCitations || [] })));
    if (res.status === "ok") setNotes(res.notes);
  };

  useEffect(() => { lint(doc); }, []); // eslint-disable-line

  const openN = useMemo(() => Object.values(notes).flat().length, [notes]);

  const editBlock = (id, v) => setDoc(d => d.map(x => x.id === id ? { ...x, v } : x));
  const blur = () => lint(doc);

  const applyFix = (blockId, note) => {
    if (note.fix === "soften") {
      setDoc(d => d.map(x => x.id === blockId ? { ...x, v: x.v.replace(/\b(drives|causes|leads to|results in|improves|increases|decreases|reduces)\b/i, "is associated with") } : x));
    } else if (note.fix === "insert_oracle") {
      setDoc(d => d.map(x => x.id === blockId ? { ...x, v: x.v + " (◆ oracle.background_rate)", oracleCitations: [...(x.oracleCitations || []), "cited"] } : x));
    }
    setTimeout(() => lint(doc), 0);
  };

  const publish = async () => {
    setPublishing(true);
    try {
      for (const b of doc) {
        if (b.v.trim().length > 8) await api.registryPublish({ session_id: sid, claim: b.v, narrative_id: narrative?.narrative_id });
      }
      setPublished(true);
    } finally { setPublishing(false); }
  };

  const insertMenu = [
    ["◆", "oracle.background_rate", "external ground truth", C.pink, (id) => {
      setDoc(d => d.map(x => x.id === id ? { ...x, v: x.v + " (◆ oracle.background_rate)", oracleCitations: [...(x.oracleCitations || []), "cited"] } : x));
    }],
    ["▦", "index.cohort", "a live N", C.blue, (id) => setDoc(d => d.map(x => x.id === id ? { ...x, v: x.v + " (▦ index.cohort)" } : x))],
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 30, maxWidth: 1060, margin: "0 auto", padding: "34px 24px 90px" }}>
      <div style={{ maxWidth: 640 }}>
        <div style={{ display: "flex", marginBottom: 14 }}>
          <button disabled={openN > 0 || publishing} onClick={publish}
            style={{ marginLeft: "auto", border: "none", background: openN ? C.line : C.grad, color: openN ? C.faint : "#fff", borderRadius: 20, padding: "8px 20px", fontSize: 13.5, fontWeight: 600, cursor: openN ? "default" : "pointer", fontFamily: C.sans }}>
            {published ? "✓ Published" : openN ? `${openN} open note${openN > 1 ? "s" : ""}` : publishing ? "Publishing…" : "Publish"}
          </button>
        </div>
        {doc.map(b => (
          <div key={b.id} style={{ position: "relative", marginBottom: 16 }}>
            <button onClick={() => setSlash(slash === b.id ? null : b.id)} style={{ position: "absolute", left: -34, top: 4, width: 25, height: 25, borderRadius: "50%", border: `1px solid ${C.line2}`, background: "#fff", color: C.faint, cursor: "pointer" }}>+</button>
            <textarea value={b.v} onChange={e => editBlock(b.id, e.target.value)} onBlur={blur} rows={Math.max(2, Math.ceil(b.v.length / 56))}
              style={{ fontFamily: C.serif, fontSize: 19, lineHeight: 1.75, borderLeft: notes[b.id] ? `2px solid ${NOTE_COLOR[notes[b.id][0].k]}` : "2px solid transparent", paddingLeft: 12, marginLeft: -14 }} />
            {slash === b.id && (
              <div style={{ position: "absolute", left: -4, top: 34, width: 310, background: "#fff", border: `1px solid ${C.line}`, borderRadius: 13, boxShadow: "0 16px 40px rgba(120,30,110,.16)", zIndex: 20, overflow: "hidden" }}>
                <div style={{ padding: "9px 13px", borderBottom: `1px solid ${C.line}`, fontFamily: C.mono, fontSize: 10, color: C.faint, letterSpacing: ".08em" }}>INSERT</div>
                {insertMenu.map(([i, n, d, c, action]) => (
                  <div key={n} className="nav" onClick={() => { action(b.id); setSlash(null); setTimeout(blur, 0); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 13px", cursor: "pointer" }}>
                    <span style={{ width: 22, height: 22, borderRadius: 6, background: c + "18", color: c, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10 }}>{i}</span>
                    <div><div style={{ fontFamily: C.mono, fontSize: 12, fontWeight: 600 }}>{n}</div><div style={{ fontSize: 12, color: C.muted2 }}>{d}</div></div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        <button onClick={() => setDoc(d => [...d, { id: (d[d.length - 1]?.id || 0) + 1, v: "" }])} style={{ border: `1px dashed ${C.line2}`, background: "transparent", color: C.faint, borderRadius: 8, padding: "8px 14px", fontSize: 13, cursor: "pointer", fontFamily: C.sans }}>+ add block</button>
      </div>
      <div style={{ position: "sticky", top: 66, alignSelf: "start" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: openN ? C.amber : C.green }} />
          <span style={{ fontFamily: C.mono, fontSize: 10.5, color: C.faint, letterSpacing: ".08em" }}>THE CORPUS IS READING</span>
        </div>
        {Object.entries(notes).map(([id, ns]) => ns.map((n, i) => (
          <div key={id + i} style={{ background: "#fff", border: `1px solid ${C.line}`, borderLeft: `3px solid ${NOTE_COLOR[n.k]}`, borderRadius: "0 12px 12px 0", padding: "13px 15px", marginBottom: 8, animation: "fade .25s" }}>
            <div style={{ fontFamily: C.mono, fontSize: 9.5, color: NOTE_COLOR[n.k], fontWeight: 700, marginBottom: 5 }}>{n.k === "causal" ? "⚠ CAUSAL VERB" : "◆ ORACLE REQUIRED"}</div>
            <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 3 }}>{n.title}</div>
            <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.5 }}>{n.detail}</div>
            <button onClick={() => applyFix(+id, n)} style={{ marginTop: 8, border: `1px solid ${NOTE_COLOR[n.k]}`, background: "transparent", color: NOTE_COLOR[n.k], borderRadius: 7, padding: "5px 11px", fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: C.sans }}>{n.fix_label}</button>
          </div>
        )))}
        {openN === 0 && <div style={{ background: C.greenBg, borderRadius: 12, padding: "14px 16px", fontSize: 13, color: C.green, lineHeight: 1.6 }}><b>Clear to publish.</b></div>}
      </div>
    </div>
  );
}
