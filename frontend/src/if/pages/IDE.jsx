import React, { useEffect, useRef, useState } from "react";
import { api } from "../../api/client.js";

function Cell({ cell, onPromote }) {
  const r = cell.result || {};
  return (
    <div className="cell">
      <div className="cell-h">In [{cell.id}] &middot; python3
        {r.figures?.length > 0 && <button onClick={() => onPromote(cell.id)}>Promote to dashboard</button>}
      </div>
      <pre>{cell.code}</pre>
      {(r.stdout || r.result_repr || r.error) && (
        <div className={"out" + (r.status === "error" ? " err" : "")}>
          {r.stdout}{r.result_repr ? `\n${r.result_repr}` : ""}{r.error ? `\n${r.error}` : ""}
        </div>
      )}
      {(r.figures || []).map((b64, i) => <img key={i} src={`data:image/png;base64,${b64}`} style={{ width: "100%", padding: "0 12px 12px" }} alt="" />)}
    </div>
  );
}

export default function IDE({ sid, toast, onDataChanged }) {
  const [cells, setCells] = useState([]);
  const [vars, setVars] = useState([]);
  const [code, setCode] = useState("");
  const [running, setRunning] = useState(false);
  const [nlText, setNlText] = useState("");
  const [nlBusy, setNlBusy] = useState(false);
  const bottomRef = useRef(null);

  const load = () => {
    api.notebookList(sid).then(r => { if (r.cells) setCells(r.cells); });
    api.notebookVars(sid).then(r => { if (r.status === "ok" || r.vars) setVars(r.vars || []); });
  };
  useEffect(() => { load(); }, [sid]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [cells.length]);

  const run = async () => {
    if (!code.trim()) return;
    setRunning(true);
    const r = await api.notebookRun(sid, code);
    setRunning(false);
    if (r.error && !r.result) { toast(r.error); return; }
    setCells(c => [...c, r]);
    setCode("");
    onDataChanged?.();
  };

  const runNL = async () => {
    if (!nlText.trim()) return;
    setNlBusy(true);
    const r = await api.notebookGenerate(sid, nlText);
    setNlBusy(false);
    if (r.error && !r.result) { toast(r.error); return; }
    setCells(c => [...c, r]);
    setNlText("");
    onDataChanged?.();
  };

  const promote = async (cellId) => {
    const r = await api.dashboardPromote(sid, cellId);
    if (r.status === "ok") toast("Promoted to Analyses (as a static snapshot)");
    else toast(r.error || "Promotion failed");
  };

  return (
    <div className="page" style={{ maxWidth: 1180 }}>
      <div className="page-head">
        <div><h1>Code IDE</h1><p>Runs against this session's real tables, inside an isolated sandbox container. Chart outputs can be promoted to Analyses.</p></div>
        <div className="acts"><button className="btn" onClick={load}>Refresh</button></div>
      </div>
      <div className="ide">
        <div className="tree">
          <div className="th2">Tables available</div>
          {vars.length === 0 && <div style={{ fontSize: 11, color: "var(--ink-3)", padding: "4px 6px" }}>No tables yet</div>}
          {vars.map(v => <div key={v} className="tf" style={{ cursor: "default" }}>{v}</div>)}
        </div>
        <div className="cells">
          {cells.length === 0 && <div style={{ fontSize: 12.5, color: "var(--ink-3)", padding: "8px 4px 16px" }}>No cells run yet in this session.</div>}
          {cells.map(c => <Cell key={c.id} cell={c} onPromote={promote} />)}
          <div ref={bottomRef} />

          <div className="cell">
            <div className="cell-h">Describe what you want (AI-generated code)</div>
            <div className="cellbox">
              <textarea rows={2} placeholder="e.g. plot the response rate by treatment arm as a bar chart" value={nlText} onChange={e => setNlText(e.target.value)} />
            </div>
            <div style={{ padding: "0 12px 12px" }}>
              <button className="btn ai" disabled={nlBusy} onClick={runNL}>{nlBusy ? "Generating… (~15-25s)" : "Generate + run"}</button>
            </div>
          </div>

          <div className="cell">
            <div className="cell-h">New cell &middot; python3</div>
            <div className="cellbox">
              <textarea rows={4} placeholder="adsl.groupby('ARM')['AGE'].mean()" value={code} onChange={e => setCode(e.target.value)}
                        onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") run(); }} />
            </div>
            <div style={{ padding: "0 12px 12px" }}>
              <button className="btn primary" disabled={running} onClick={run}>{running ? "Running…" : "Run (⌘⏎)"}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
