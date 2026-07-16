// Thin fetch wrapper — mirrors the token handling in the legacy vanilla-JS
// frontend (frontend/legacy/app.js): a magic-link token is picked up from
// ?probe_token=, stored in localStorage, and attached to every /api/* call
// except /api/auth/*. A 401 clears the token so the caller can re-show auth.

const API = window.location.protocol === "file:" ? "http://localhost:5050" : "";

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

function readToken() {
  const params = new URLSearchParams(window.location.search);
  const urlToken = params.get("probe_token");
  if (urlToken) {
    localStorage.setItem("probe_token", urlToken);
    window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);
  }
  return localStorage.getItem("probe_token");
}

let token = readToken();

async function req(path, opts = {}) {
  const isAuthRoute = path.startsWith("/api/auth/");
  const headers = Object.assign({}, opts.headers || {});
  if (!isAuthRoute && token) headers["X-Probe-Token"] = token;
  const res = await fetch(API + path, { ...opts, headers });
  if (res.status === 401 && !isAuthRoute) {
    token = null;
    localStorage.removeItem("probe_token");
    onUnauthorized();
  }
  return res;
}

// Every caller in this app checks res.status === "ok" — never let a network
// failure, a non-JSON error page, or an unexpected HTTP status become an
// uncaught exception that leaves a screen stuck on "loading" forever. Always
// resolve to a {status:"error", error} shape instead.
async function safeJSON(resPromise) {
  let res;
  try {
    res = await resPromise;
  } catch (e) {
    console.error("[api] network error:", e);
    return { status: "error", error: `Network error: ${e.message}` };
  }
  let body;
  try {
    body = await res.json();
  } catch {
    console.error(`[api] ${res.url} returned ${res.status} ${res.statusText} with a non-JSON body`);
    return { status: "error", error: `Server returned ${res.status} ${res.statusText} (non-JSON response)` };
  }
  if (!res.ok && !body.status) {
    console.error(`[api] ${res.url} -> ${res.status}`, body);
    return { status: "error", error: body.error || `HTTP ${res.status}`, ...body };
  }
  if (body.status === "error") console.error(`[api] ${res.url} ->`, body.error);
  return body;
}

async function getJSON(path) {
  return safeJSON(req(path));
}

async function postJSON(path, body) {
  return safeJSON(req(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  }));
}

async function postForm(path, formData) {
  return safeJSON(req(path, { method: "POST", body: formData }));
}

async function delJSON(path) {
  return safeJSON(req(path, { method: "DELETE" }));
}

export const api = {
  // auth
  authStatus: () => getJSON("/api/auth/status"),
  authRequest: (email) => postJSON("/api/auth/request", { email }),
  authLogout: () => postJSON("/api/auth/logout"),
  hasToken: () => !!token,

  // session
  createSession: () => postJSON("/api/session", {}),
  sessionInfo: (session_id, info) => postJSON("/api/session/info", { session_id, ...info }),
  sessionStatus: (sid) => getJSON(`/api/session/${encodeURIComponent(sid)}/status`),

  // ingest stage 1-2: connectors + extraction
  upload: (session_id, file) => {
    const fd = new FormData();
    fd.append("session_id", session_id);
    fd.append("file", file);
    return postForm("/api/upload", fd);
  },
  loadSample: (session_id) => postJSON("/api/load-sample", { session_id }),

  // ingest stage 3: quality
  qualityCheck: (sid) => getJSON(`/api/quality/check?session_id=${encodeURIComponent(sid)}`),
  qualityApply: (session_id, fixes) => postJSON("/api/quality/apply", { session_id, fixes }),

  // ingest stage 4: derivation
  derivePlan: (sid) => getJSON(`/api/derive/plan?session_id=${encodeURIComponent(sid)}`),
  derive: (session_id) => postJSON("/api/derive", { session_id }),

  // ingest stage 5: indexes
  indexBuild: (session_id) => postJSON("/api/index/build", { session_id }),
  indexUnderstanding: (sid) => getJSON(`/api/index/understanding?session_id=${encodeURIComponent(sid)}`),

  // narratives
  narrativesGenerate: (session_id) => postJSON("/api/narratives/generate", { session_id }),
  narrativeGet: (id) => getJSON(`/api/narratives/${encodeURIComponent(id)}`),

  // corpus
  corpusList: (sid, params = {}) => {
    const qs = new URLSearchParams({ session_id: sid, ...params }).toString();
    return getJSON(`/api/corpus?${qs}`);
  },

  // oracle
  oracleTypes: () => getJSON("/api/oracle/types"),
  oracleResolve: (oracle_type, population_args, force = false) => postJSON("/api/oracle/resolve", { oracle_type, population_args, force }),
  oracleGet: (id) => getJSON(`/api/oracle/${encodeURIComponent(id)}`),
  oraclePin: (id) => postJSON(`/api/oracle/${encodeURIComponent(id)}/pin`),
  oracleDrift: (id, source) => postJSON(`/api/oracle/${encodeURIComponent(id)}/drift`, { source }),
  oracleReset: (id) => postJSON(`/api/oracle/${encodeURIComponent(id)}/reset`),

  // registry
  registryList: (sid) => getJSON(`/api/registry?session_id=${encodeURIComponent(sid)}`),
  registryPublish: (row) => postJSON("/api/registry/publish", row),

  // editor
  editorLint: (blocks) => postJSON("/api/editor/lint", { blocks }),

  // evidence
  evidenceList: (sid, kind) => {
    const qs = new URLSearchParams({ session_id: sid, ...(kind ? { kind } : {}) }).toString();
    return getJSON(`/api/evidence?${qs}`);
  },
  evidenceGet: (id) => getJSON(`/api/evidence/${encodeURIComponent(id)}`),
  evidenceBulk: (ids) => postJSON("/api/evidence/bulk", { ids }),
  evidenceReview: (id, decision) => postJSON(`/api/evidence/${encodeURIComponent(id)}/review`, { decision }),
  evidenceAnnotate: (session_id, claim, values, limitations) =>
    postJSON("/api/evidence/annotate", { session_id, claim, values, limitations }),

  // norms
  normsList: () => getJSON("/api/norms"),
  normsResolve: (oracle_type, metric, population) => postJSON("/api/norms/resolve", { oracle_type, metric, population }),
  normsCompare: (metric, population, value, sample_size) =>
    postJSON("/api/norms/compare", { metric, population, value, sample_size }),
  normsHistory: (metric, population) => postJSON("/api/norms/history", { metric, population }),
  normsApprove: (nid) => postJSON(`/api/norms/${encodeURIComponent(nid)}/approve`),

  // narrative workspaces
  workspaceCreate: (body) => postJSON("/api/workspaces", body),
  workspaceList: (sid) => getJSON(`/api/workspaces?session_id=${encodeURIComponent(sid)}`),
  workspaceGet: (wid) => getJSON(`/api/workspaces/${encodeURIComponent(wid)}`),
  workspaceUpdateBlocks: (wid, blocks) => postJSON(`/api/workspaces/${encodeURIComponent(wid)}/blocks`, { blocks }),
  workspaceUpdateMeta: (wid, fields) => postJSON(`/api/workspaces/${encodeURIComponent(wid)}/meta`, fields),
  workspaceAddEvidence: (wid, evidence_id) => postJSON(`/api/workspaces/${encodeURIComponent(wid)}/evidence`, { evidence_id }),
  workspaceRemoveEvidence: (wid, eid) => delJSON(`/api/workspaces/${encodeURIComponent(wid)}/evidence/${encodeURIComponent(eid)}`),
  workspaceTransition: (wid, status) => postJSON(`/api/workspaces/${encodeURIComponent(wid)}/transition`, { status }),
  workspaceBranch: (wid, title, audience, lens) => postJSON(`/api/workspaces/${encodeURIComponent(wid)}/branch`, { title, audience, lens }),
  workspaceBranches: (wid) => getJSON(`/api/workspaces/${encodeURIComponent(wid)}/branches`),
  workspaceCompare: (a, b) => getJSON(`/api/workspaces/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`),
  workspaceComments: (wid, track) => {
    const qs = track ? `?track=${encodeURIComponent(track)}` : "";
    return getJSON(`/api/workspaces/${encodeURIComponent(wid)}/comments${qs}`);
  },
  workspaceAddComment: (wid, track, author, comment, block_index) =>
    postJSON(`/api/workspaces/${encodeURIComponent(wid)}/comments`, { track, author, comment, block_index }),
  commentResolve: (cid) => postJSON(`/api/comments/${encodeURIComponent(cid)}/resolve`),

  // datasets (real per-table catalog)
  datasetTables: (sid) => getJSON(`/api/datasets/${encodeURIComponent(sid)}/tables`),
  datasetVersions: (sid) => getJSON(`/api/datasets/${encodeURIComponent(sid)}/versions`),

  // sessions as "workspaces" (project switcher)
  sessionList: (currentSid) => getJSON(`/api/session/list?current_sid=${encodeURIComponent(currentSid || "")}`),

  // dashboards ("analyses")
  dashboardsList: (sid) => getJSON(`/api/dashboards?session_id=${encodeURIComponent(sid)}`),
  dashboardsGenerate: (session_id, mode, question) => postJSON("/api/dashboards/generate", { session_id, mode, question }),
  dashboardsCandidates: (sid) => getJSON(`/api/dashboards/candidates?session_id=${encodeURIComponent(sid)}`),

  // notebook / code IDE
  notebookRun: (session_id, code) => postJSON("/api/notebook/run", { session_id, code }),
  notebookGenerate: (session_id, text) => postJSON("/api/notebook/generate", { session_id, text }),
  notebookList: (sid) => getJSON(`/api/session/${encodeURIComponent(sid)}/notebook`),
  notebookVars: (sid) => getJSON(`/api/notebook/vars?session_id=${encodeURIComponent(sid)}`),
  dashboardPromote: (session_id, cell_id) => postJSON("/api/dashboards/promote", { session_id, cell_id }),

  // reviews (cross-workspace aggregation)
  reviewsList: (sid) => getJSON(`/api/reviews?session_id=${encodeURIComponent(sid)}`),

  // reports
  reportsList: (sid) => getJSON(`/api/reports?session_id=${encodeURIComponent(sid)}`),
  reportsGenerate: (session_id, source_type, source_id) => postJSON("/api/reports/generate", { session_id, source_type, source_id }),
  reportDownloadUrl: (rid) => `${API}/api/reports/${encodeURIComponent(rid)}/download`,
  exportUrl: (sid) => `${API}/api/export?session_id=${encodeURIComponent(sid)}`,
};
