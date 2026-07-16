import React, { useEffect, useState } from "react";
import "./insightforge.css";
import { api, setUnauthorizedHandler } from "./api/client.js";
import AuthGate from "./screens/AuthGate.jsx";
import { TopBar, Rail, AgentDock, Toast, useToast, useAgent } from "./if/Chrome.jsx";
import Overview from "./if/pages/Overview.jsx";
import Narratives from "./if/pages/Narratives.jsx";
import NarrativeDetail from "./if/pages/NarrativeDetail.jsx";
import Evidence from "./if/pages/Evidence.jsx";
import Analyses from "./if/pages/Analyses.jsx";
import Datasets from "./if/pages/Datasets.jsx";
import Oracles from "./if/pages/Oracles.jsx";
import IDE from "./if/pages/IDE.jsx";
import Reviews from "./if/pages/Reviews.jsx";
import Reports from "./if/pages/Reports.jsx";
import Workspaces from "./if/pages/Workspaces.jsx";
import WorkspaceDetail from "./if/pages/WorkspaceDetail.jsx";

export default function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [authed, setAuthed] = useState(true);
  const [sid, setSid] = useState(null);
  const [route, setRoute] = useState({ v: "overview" });
  const [q, setQ] = useState("");
  const [dockOpen, setDockOpen] = useState(false);
  const [workspaceMeta, setWorkspaceMeta] = useState(null);
  const [dataChangeKey, setDataChangeKey] = useState(0);
  const [toastMsg, toast] = useToast();

  const checkAuth = async () => {
    const status = await api.authStatus();
    setAuthed(!status.auth_enabled || status.authenticated);
    setAuthChecked(true);
  };
  useEffect(() => { setUnauthorizedHandler(() => setAuthed(false)); checkAuth(); }, []);

  // Session bootstrap: without persistence, every page load (including a
  // plain reload) minted a brand-new, empty session — nothing generated in
  // a prior visit was ever seen again. Fixed by reusing whatever's saved in
  // this browser (session_store.py rehydrates from the sqlite write-through
  // even across a backend restart, so this holds up there too).
  //
  // Deliberately does NOT fall back to "whichever session has the most
  // data" when nothing is saved — a session is supposed to reflect exactly
  // what you've imported into it, nothing more. A silent redirect to an
  // older, richer session on a fresh visit means new imports look like
  // they vanished into old data. A genuinely first-ever visit gets a real
  // empty session, same as importing fresh always has. Existing sessions
  // with real content (e.g. the sample "KRAS Program Analysis" walkthrough)
  // stay reachable by name from Workspaces — never auto-forced.
  useEffect(() => {
    if (!authChecked || !authed || sid) return;
    (async () => {
      const saved = localStorage.getItem("if_sid");
      if (saved) {
        const status = await api.sessionStatus(saved);
        if (!status.error) { setSid(saved); return; }
      }
      const chosen = (await api.createSession()).session_id;
      localStorage.setItem("if_sid", chosen);
      setSid(chosen);
    })();
  }, [authChecked, authed, sid]);

  const goto = (r) => { setRoute(r); setQ(""); window.scrollTo({ top: 0 }); };
  const switchSession = (newSid) => { localStorage.setItem("if_sid", newSid); setSid(newSid); goto({ v: "overview" }); };

  const agent = useAgent(sid, dataChangeKey);
  const [autonomy, setAutonomy] = useState("Supervised");
  const onDataChanged = () => setDataChangeKey(k => k + 1);

  useEffect(() => {
    if (!sid) return;
    let alive = true;
    (async () => {
      const [sessRes, tablesRes] = await Promise.all([api.sessionList(sid), api.datasetTables(sid)]);
      if (!alive) return;
      const mine = sessRes.status === "ok" ? sessRes.workspaces.find(w => w.sid === sid) : null;
      setWorkspaceMeta({
        name: mine?.name || "This session",
        narratives: mine?.narratives ?? 0,
        datasets: tablesRes.status === "ok" ? tablesRes.tables.length : 0,
        datasetVersion: tablesRes.status === "ok" ? tablesRes.dataset_version : null,
      });
    })();
    return () => { alive = false; };
  }, [sid, dataChangeKey, route.v]);

  const reviewEvidence = async (eid, decision) => { await api.evidenceReview(eid, decision); onDataChanged(); toast(`Evidence ${decision}`); };

  if (!authChecked) return null;
  if (!authed) return <AuthGate onAuthed={checkAuth} />;
  if (!sid) return null;

  const P = { sid, goto, q, toast, onDataChanged };

  return (
    <div className="if">
      <TopBar route={route} goto={goto} q={q} setQ={setQ} agent={agent} dockOpen={dockOpen} setDockOpen={setDockOpen} sid={sid} />
      <div className={"shell"}>
        <Rail route={route} goto={goto} sid={sid} workspace={workspaceMeta} oracles={null} />
        <div>
          {route.v === "overview" && <Overview {...P} agent={agent} />}
          {route.v === "narratives" && <Narratives {...P} />}
          {route.v === "narrative" && <NarrativeDetail {...P} id={route.id} />}
          {route.v === "evidence" && <Evidence {...P} highlightId={route.id} />}
          {route.v === "analyses" && <Analyses {...P} />}
          {route.v === "datasets" && <Datasets {...P} />}
          {route.v === "oracles" && <Oracles {...P} />}
          {route.v === "ide" && <IDE {...P} />}
          {route.v === "reviews" && <Reviews {...P} />}
          {route.v === "reports" && <Reports {...P} />}
          {route.v === "workspaces" && <Workspaces {...P} onSwitch={switchSession} />}
          {(route.v === "workspace" || route.v === "workspace_new") && (
            <WorkspaceDetailGate {...P} routeId={route.v === "workspace_new" ? null : route.id} />
          )}
        </div>
      </div>
      <AgentDock open={dockOpen} onClose={() => setDockOpen(false)} sid={sid} agent={agent} onReview={reviewEvidence}
                 autonomy={autonomy} setAutonomy={setAutonomy} goto={goto} />
      <Toast msg={toastMsg} />
    </div>
  );
}

// Creates a fresh drafting workspace on demand ("New drafting workspace" in
// the rail doesn't ask for details up front — it opens straight into one).
function WorkspaceDetailGate({ sid, routeId, goto, toast, q, onDataChanged }) {
  const [id, setId] = useState(routeId);
  useEffect(() => {
    if (routeId) { setId(routeId); return; }
    api.workspaceCreate({ session_id: sid, title: "Untitled draft", thesis: "", audience: "scientist", lens: "efficacy" })
      .then(r => { if (r.status === "ok") { setId(r.workspace.id); goto({ v: "workspace", id: r.workspace.id }); } });
  }, [routeId, sid]);
  if (!id) return <div className="page"><div className="empty">Creating drafting workspace…</div></div>;
  return <WorkspaceDetail sid={sid} id={id} goto={goto} toast={toast} />;
}
