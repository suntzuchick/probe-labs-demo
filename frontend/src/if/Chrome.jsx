import React, { useEffect, useRef, useState } from "react";
import { api } from "../api/client.js";
import { Ic, Spark, PATHS } from "./Icons.jsx";

export const NAV = [["workspaces", "Workspaces"], ["datasets", "Datasets"], ["narratives", "Narratives"],
  ["oracles", "Oracles"], ["reviews", "Reviews"], ["reports", "Reports"]];
export const MENU = [["overview", "Overview", PATHS.overview], ["narratives", "Narratives", PATHS.narratives],
  ["evidence", "Evidence", PATHS.evidence], ["analyses", "Analyses", PATHS.analyses],
  ["datasets", "Datasets", PATHS.datasets], ["oracles", "Oracles", PATHS.oracles],
  ["ide", "Code IDE", PATHS.ide], ["reviews", "Reviews", PATHS.reviews]];

export function useToast() {
  const [msg, setMsg] = useState(null);
  const timer = useRef(null);
  const toast = (m) => {
    setMsg(m);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 2600);
  };
  return [msg, toast];
}

export function Toast({ msg }) {
  return (
    <div className={"toast" + (msg ? " on" : "")}>
      {msg && <><Ic d={PATHS.check} size={14} sw={2} /> {msg}</>}
    </div>
  );
}

function timeAgo(ts) {
  if (!ts) return "";
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function useAgent(sid, refreshKey) {
  const [state, setState] = useState({ tasks: [], approvals: [], loading: true });
  const load = async () => {
    const [dashRes, evRes] = await Promise.all([api.dashboardsList(sid), api.evidenceList(sid)]);
    const dashboards = dashRes.dashboards || [];
    const evidence = evRes.status === "ok" ? evRes.evidence : [];
    const tasks = [...dashboards]
      .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
      .slice(0, 8)
      .map(d => ({ id: d.dashboard_id, title: d.title, sub: `${d.source} · ${timeAgo(d.created_at)}`, status: d.status }));
    const approvals = evidence.filter(e => e.review_status === "unreviewed").slice(0, 6);
    setState({ tasks, approvals, loading: false, doneToday: dashboards.filter(d => (Date.now() / 1000 - (d.created_at || 0)) < 86400).length });
  };
  useEffect(() => { if (sid) load(); }, [sid, refreshKey]);
  return { ...state, reload: load };
}

export function AgentChip({ open, onClick, agent }) {
  const n = agent.approvals.length;
  return (
    <button className={"agent-chip" + (open ? " on" : "")} onClick={onClick}>
      <i className={"live" + (n ? " wait" : agent.tasks.length ? "" : " idle")} />
      {n ? `${n} awaiting you` : "Agent activity"}
      {n > 0 && <span className="cnt">{n}</span>}
    </button>
  );
}

export function AgentDock({ open, onClose, sid, agent, onReview, autonomy, setAutonomy, goto }) {
  return (
    <aside className={"dock" + (open ? " open" : "")}>
      <div className="dock-h">
        <span className="by-mark"><Spark size={14} /></span>
        <span><span className="dt">Agent activity</span><span className="ds">{autonomy} &middot; {agent.doneToday || 0} run{agent.doneToday === 1 ? "" : "s"} today</span></span>
        <button className="icon-btn" style={{ marginLeft: "auto" }} onClick={onClose} aria-label="Close"><Ic d={PATHS.close} size={15} sw={2} /></button>
      </div>
      <div className="dock-b">
        <div className="dsec"><i className="live" /> Recent activity</div>
        {agent.tasks.length === 0 && <div style={{ fontSize: 12, color: "var(--ink-3)" }}>No dashboards generated yet in this workspace.</div>}
        {agent.tasks.map(t => (
          <div key={t.id} className="task" style={{ marginBottom: 8 }}>
            <div className="tt">{t.title}</div>
            <div className="ts">{t.sub}</div>
          </div>
        ))}

        {agent.approvals.length > 0 && (
          <>
            <div className="dsec">Awaiting your review ({agent.approvals.length})</div>
            {agent.approvals.map(e => (
              <div key={e.id} className="approve" style={{ marginBottom: 8 }}>
                <div className="at">{e.claim.slice(0, 90)}</div>
                <div className="ad2">{e.kind} &middot; confidence {e.confidence ?? "—"}</div>
                <div className="row2">
                  <button className="yes" onClick={() => onReview(e.id, "approved")}>Approve</button>
                  <button className="no" onClick={() => onReview(e.id, "rejected")}>Reject</button>
                </div>
              </div>
            ))}
          </>
        )}

        <div className="dsec">System status</div>
        <div className="src"><i className="dot" style={{ background: "var(--green)" }} /><span><span className="sn">Sandbox execution</span><span className="sd">Generated code runs in an isolated container</span></span></div>
        <div className="src"><i className="dot" style={{ background: "var(--blue)" }} /><span><span className="sn">Artifact cache</span><span className="sd">Identical questions reuse prior results</span></span></div>

        <div className="dsec">Autonomy</div>
        <div style={{ display: "flex", gap: 5, marginTop: 4 }}>
          {["Read only", "Supervised", "Full"].map(m => (
            <button key={m} onClick={() => setAutonomy(m)} style={{ flex: 1, height: 28, border: "1px solid var(--line)", borderRadius: 7, fontSize: 11.5, fontWeight: 600, color: autonomy === m ? "#fff" : "var(--ink-3)", background: autonomy === m ? "var(--ink)" : "transparent" }}>{m}</button>
          ))}
        </div>
        <div style={{ fontSize: 11, color: "var(--ink-3)", lineHeight: 1.5, marginTop: 8 }}>
          {autonomy === "Read only" ? "Dashboards and evidence are generated only when you explicitly ask."
            : autonomy === "Supervised" ? "Every generated evidence item still waits in this queue for your approval before it's marked reviewed."
              : "Same review queue applies — nothing in this build auto-publishes without your sign-off, regardless of this setting."}
        </div>
        <button className="link" style={{ marginTop: 10 }} onClick={() => goto({ v: "evidence" })}>Open evidence log <Ic d={PATHS.arrowRight} size={12} sw={2} /></button>
      </div>
    </aside>
  );
}

export function TopBar({ route, goto, q, setQ, agent, dockOpen, setDockOpen, sid }) {
  const isNav = (id) => route.v === id || (id === "narratives" && route.v === "narrative") ||
    (id === "workspaces" && (route.v === "workspace" || route.v === "workspace_new"));
  // (no special case for "reports" — it has no drill-in detail route distinct from the list route)
  return (
    <header className="topbar">
      <div className="brand" onClick={() => goto({ v: "overview" })} style={{ cursor: "pointer" }}>
        <Spark />InsightForge
      </div>
      <nav className="nav">
        {NAV.map(([id, n]) => <button key={id} className={isNav(id) ? "on" : ""} onClick={() => goto({ v: id })}>{n}</button>)}
      </nav>
      <div className="top-right">
        <label className="search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <input placeholder="Search narratives, evidence, metrics…" value={q} onChange={e => setQ(e.target.value)} id="if-search" />
          <kbd>⌘K</kbd>
        </label>
        <AgentChip open={dockOpen} onClick={() => setDockOpen(o => !o)} agent={agent} />
        <button className="ask" onClick={() => goto({ v: "ide" })}><Spark size={13} /> Code IDE</button>
      </div>
    </header>
  );
}

export function Rail({ route, goto, sid, oracles, workspace }) {
  return (
    <aside className="rail">
      <div className="ws" onClick={() => goto({ v: "workspaces" })} style={{ cursor: "pointer" }}>
        <div className="ws-mark"><Ic d={PATHS.circleDot} size={15} sw={2} /></div>
        <div className="ws-text">
          <div className="ws-name">{workspace?.name || "This session"}</div>
          <div className="ws-sub">{workspace ? `${workspace.narratives} narratives · ${workspace.datasets} tables` : "—"}</div>
        </div>
        <Ic d={PATHS.chevDown} size={13} stroke="#8a8a95" sw={2} style={{ marginLeft: "auto" }} />
      </div>
      <div>
        <h4 className="lbl">Main</h4>
        <div className="menu">
          {MENU.map(([id, n, d]) => (
            <button key={id} className={route.v === id ? "on" : ""} onClick={() => goto({ v: id })}>
              <Ic d={d} size={15} sw={1.7} /><span className="lbl">{n}</span>
            </button>
          ))}
        </div>
      </div>
      <div>
        <h4>Data context <button onClick={() => goto({ v: "datasets" })}>Edit</button></h4>
        <button className="card-mini" onClick={() => goto({ v: "datasets" })}>
          <span className="t">Current tables <span className="pill">v{workspace?.datasetVersion ?? "—"}</span></span>
          <span className="m" style={{ display: "block" }}>{workspace?.datasets ?? 0} tables in this session</span>
        </button>
      </div>
      {oracles && oracles.length > 0 && (
        <div>
          <h4>Norms &amp; oracles <button onClick={() => goto({ v: "oracles" })}>Manage</button></h4>
          {oracles.slice(0, 3).map(o => (
            <button key={o.id} className="oracle" onClick={() => goto({ v: "oracles" })}>
              <span className="n"><span>{o.metric}</span><span className="pill">v{o.version}</span></span>
              <span className="c"><i className="dot" style={{ background: o.confidence >= 0.7 ? "var(--green)" : o.confidence >= 0.4 ? "var(--amber)" : "var(--red)" }} />{Math.round(o.confidence * 100)}/100 confidence</span>
            </button>
          ))}
        </div>
      )}
      <div className="rail-foot">
        <button className="newver" onClick={() => goto({ v: "workspace_new" })}>
          <Ic d="M12 5v14M5 12h14" size={13} sw={2} /><span>New drafting workspace</span>
        </button>
      </div>
    </aside>
  );
}
