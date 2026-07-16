import React, { useEffect, useState } from "react";
import { api } from "../../api/client.js";
import { Ic, PATHS } from "../Icons.jsx";
import ProvenanceGraph from "../ProvenanceGraph.jsx";

const STATUS_CHIP = { publish: ["green", "Published"], published: ["green", "Published"], caveats: ["amber", "Caveats"],
  review: ["amber", "Review"], contradicted: ["red", "Contradicted"], blocked: ["gray", "Blocked"] };

function Chip({ status }) {
  const [c, l] = STATUS_CHIP[status] || ["gray", status];
  return <span className={`chip ${c}`}>{l}</span>;
}
function timeAgo(ts) {
  if (!ts) return "";
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function Overview({ sid, goto, agent, toast }) {
  const [stats, setStats] = useState(null);
  const [narratives, setNarratives] = useState([]);
  const [activity, setActivity] = useState([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [corpusRes, evRes, dashRes, reviewRes] = await Promise.all([
        api.corpusList(sid), api.evidenceList(sid), api.dashboardsList(sid), api.reviewsList(sid),
      ]);
      if (!alive) return;
      const real = corpusRes.status === "ok" ? corpusRes.narratives.filter(n => !n.is_synthetic) : [];
      const evidence = evRes.status === "ok" ? evRes.evidence : [];
      const dashboards = dashRes.dashboards || [];
      setStats({
        narratives: real.length,
        readyForReview: real.filter(n => n.status === "review").length,
        evidence: evidence.length,
        agentGenerated: evidence.filter(e => e.created_by === "agent").length,
        analyses: dashboards.length,
        openReviews: reviewRes.status === "ok" ? reviewRes.open_count : 0,
      });
      setNarratives(real.slice(0, 6));
      const feed = [
        ...evidence.slice(0, 5).map(e => ({ k: "ai", t: `Evidence generated: ${e.claim.slice(0, 60)}`, m: timeAgo(e.created_at) })),
        ...dashboards.slice(0, 5).map(d => ({ k: "data", t: `${d.title}`, m: `${d.source} · ${timeAgo(d.created_at)}` })),
      ].sort(() => 0).slice(0, 6);
      setActivity(feed);
    })();
    return () => { alive = false; };
  }, [sid]);

  if (!stats) return <div className="empty">Loading overview…</div>;

  const cards = [
    ["Narratives", stats.narratives, stats.readyForReview ? <span style={{ color: "var(--green)" }}>{stats.readyForReview} ready for review</span> : null],
    ["Evidence items", stats.evidence, <span style={{ color: "var(--ai)" }}>{stats.agentGenerated} agent-generated</span>],
    ["Analyses", stats.analyses, null],
    ["Open reviews", stats.openReviews, stats.openReviews ? <span style={{ color: "var(--red)" }}>needs attention</span> : <span style={{ color: "var(--green)" }}>all clear</span>],
  ];

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Overview</h1><p>Everything this session's agents and reviewers have produced, and how it's connected.</p></div>
        <div className="acts">
          <button className="btn" onClick={() => goto({ v: "datasets" })}>Add data</button>
          <button className="btn ai" onClick={() => goto({ v: "narratives" })}>Draft narrative</button>
        </div>
      </div>

      <div className="stats">
        {cards.map(([k, v, d]) => <div className="stat" key={k}><div className="k">{k}</div><div className="v">{v}</div><div className="d">{d}</div></div>)}
      </div>

      <div className="panel">
        <div className="panel-h">
          <span className="t">How narratives get built</span>
          <span className="s">Tables → analyses → evidence → narratives</span>
          <span className="r"><button className="btn" onClick={() => goto({ v: "evidence" })}>Audit evidence</button></span>
        </div>
        <ProvenanceGraph sid={sid} goto={goto} />
      </div>

      <div className="ov">
        <div className="panel">
          <div className="panel-h"><span className="t">Real narratives</span><span className="r"><button className="btn" onClick={() => goto({ v: "narratives" })}>See all</button></span></div>
          {narratives.length === 0 && <div className="empty">No real narratives generated yet.</div>}
          {narratives.map(n => (
            <button className="row" key={n.narrative_id} onClick={() => goto({ v: "narrative", id: n.narrative_id })}>
              <span style={{ flex: 1 }}>
                <span className="nar-t">{n.thesis}</span>
                <span className="nar-m"><Chip status={n.status} /><span>{timeAgo(n.created_at)}</span></span>
              </span>
              <Ic d={PATHS.chevRight} size={15} stroke="#c5c5cf" sw={2} style={{ marginTop: 4 }} />
            </button>
          ))}
        </div>
        <div className="panel">
          <div className="panel-h"><span className="t">Activity</span></div>
          {activity.length === 0 && <div className="empty">No activity yet.</div>}
          {activity.map((f, i) => (
            <div className="feed" key={i}>
              <span className="fi" style={{ background: f.k === "ai" ? "#f4f1ff" : "#eaf1fd", color: f.k === "ai" ? "#7c5cf5" : "#2f6fe4" }}>
                <Ic d={f.k === "ai" ? "M12 2l2.2 6.1L20 10l-5.8 1.9L12 18l-2.2-6.1L4 10l5.8-1.9z" : "M4 6h16v12H4z M4 11h16"} size={13} fill={f.k === "ai" ? "currentColor" : "none"} sw={2} />
              </span>
              <span><span>{f.t}</span><span className="fm">{f.m}</span></span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
