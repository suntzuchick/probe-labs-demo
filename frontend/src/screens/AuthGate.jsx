import React, { useState } from "react";
import { C } from "../tokens.js";
import { api } from "../api/client.js";

export default function AuthGate({ onAuthed }) {
  const [email, setEmail] = useState("");
  const [link, setLink] = useState(null);
  const [notAllowed, setNotAllowed] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setNotAllowed(false); setBusy(true);
    try {
      const res = await api.authRequest(email.trim().toLowerCase());
      if (res.status === "not_allowed") setNotAllowed(true);
      else if (res.status === "sent") onAuthed();
      else if (res.link) setLink(res.link);
      else setError(res.error || "Something went wrong.");
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: C.bg, fontFamily: C.sans }}>
      <div style={{ width: 420, background: "#fff", border: `1px solid ${C.line}`, borderRadius: 18, padding: "34px 32px", boxShadow: "0 24px 60px rgba(78,12,112,.08)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 6 }}>
          <div style={{ width: 23, height: 23, borderRadius: "50%", background: "conic-gradient(from 220deg,#4E0C70 0deg 180deg,#FFE7F7 180deg 360deg)", border: `1px solid ${C.plum}` }} />
          <span style={{ fontFamily: C.disp, fontSize: 19, fontWeight: 600 }}>Probe</span>
        </div>
        <div style={{ fontSize: 13.5, color: C.muted2, marginBottom: 22 }}>Extraction · Quality · Derivation · Analysis</div>

        {!link ? (
          <form onSubmit={submit}>
            <p style={{ fontSize: 14, color: C.muted, marginBottom: 12 }}>Enter your email to receive an access link.</p>
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="your@institution.edu"
              style={{ width: "100%", border: `1px solid ${C.line2}`, borderRadius: 9, padding: "11px 13px", fontSize: 14, fontFamily: C.sans, marginBottom: 12 }} />
            {notAllowed && <div style={{ fontSize: 13, color: C.red, marginBottom: 10 }}>That email isn't on the access list. Contact <a href="mailto:sera@thingblinglabs.io">sera@thingblinglabs.io</a>.</div>}
            {error && <div style={{ fontSize: 13, color: C.red, marginBottom: 10 }}>{error}</div>}
            <button type="submit" disabled={busy} style={{ width: "100%", border: "none", background: C.grad, color: "#fff", borderRadius: 10, padding: "11px 0", fontSize: 14.5, fontWeight: 600, cursor: "pointer", fontFamily: C.sans }}>
              {busy ? "Sending…" : "Send access link →"}
            </button>
          </form>
        ) : (
          <div>
            <div style={{ fontSize: 22, color: C.green, marginBottom: 8 }}>✓</div>
            <p style={{ fontSize: 14, color: C.ink, marginBottom: 6 }}><b>Access link for {email}</b></p>
            <p style={{ fontSize: 12.5, color: C.muted2, marginBottom: 12 }}>Copy this link. It expires in 7 days and can only be used once.</p>
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              <input readOnly value={link} style={{ flex: 1, border: `1px solid ${C.line2}`, borderRadius: 8, padding: "8px 10px", fontFamily: C.mono, fontSize: 11.5 }} />
              <button onClick={() => navigator.clipboard.writeText(link)} style={{ border: `1px solid ${C.line2}`, background: "#fff", borderRadius: 8, padding: "8px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Copy</button>
            </div>
            <button onClick={() => setLink(null)} style={{ border: "none", background: "transparent", color: C.blue, fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 0 }}>Generate link for a different email</button>
          </div>
        )}
        <p style={{ fontSize: 11.5, color: C.faint, marginTop: 20 }}>Access is by invitation only.</p>
      </div>
    </div>
  );
}
