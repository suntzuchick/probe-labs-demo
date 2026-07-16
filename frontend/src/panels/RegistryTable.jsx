import React, { useEffect, useState } from "react";
import { C } from "../tokens.js";
import { api } from "../api/client.js";

const STATUS_COLOR = { published: C.green, review: C.amber, blocked: C.line3, stale: C.amber, finding: C.green, null: C.faint };

export default function RegistryTable({ sid }) {
  const [rows, setRows] = useState(null);

  useEffect(() => { api.registryList(sid).then(res => setRows(res.rows || [])); }, [sid]);

  if (rows === null) return <div style={{ padding: 24, color: C.muted2 }}>Loading registry…</div>;

  return (
    <div style={{ padding: "18px 20px" }}>
      <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, marginBottom: 14 }}>
        Append-only ledger of every claim — including null results and claims blocked for lacking a DAG. A registry that only shows wins is a publication-bias demo.
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.line2}`, textAlign: "left" }}>
              {["Claim", "Class", "Verb", "DAG", "q", "Status"].map(h => (
                <th key={h} style={{ padding: "6px 8px", fontFamily: C.mono, fontSize: 10.5, color: C.faint, letterSpacing: ".05em" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} style={{ borderBottom: `1px solid ${C.line}`, opacity: r.is_synthetic ? .7 : 1 }}>
                <td style={{ padding: "8px", maxWidth: 220 }}>{r.claim}</td>
                <td style={{ padding: "8px", fontFamily: C.mono, color: r.claim_class === "causal" ? C.red : C.muted2 }}>{r.claim_class}</td>
                <td style={{ padding: "8px", fontFamily: C.mono, color: C.muted2 }}>{r.verb}</td>
                <td style={{ padding: "8px", textAlign: "center" }}>{r.dag ? "✓" : "✕"}</td>
                <td style={{ padding: "8px", fontFamily: C.mono }}>{r.q_value == null ? <span style={{ color: C.faint }}>null</span> : r.q_value}</td>
                <td style={{ padding: "8px" }}>
                  <span style={{ fontFamily: C.mono, fontSize: 10.5, color: STATUS_COLOR[r.status] || C.muted2, background: (STATUS_COLOR[r.status] || C.muted2) + "18", borderRadius: 8, padding: "2px 7px" }}>{r.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
