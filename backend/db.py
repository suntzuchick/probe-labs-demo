"""
Lightweight SQLite persistence.

session_store.py stays the hot in-memory path for the ingest pipeline
(unchanged). This module is a write-through store for the objects that need
to survive a backend restart during a demo: narratives, their dashboards and
panels, the oracle registry (instances + attested sources), and the
hypothesis registry. Nothing here replaces session_store — it's called
alongside it at the same points that already produce these objects.

Everything is stored as JSON blobs next to a handful of indexed columns
(ids, foreign keys, status) so filtering/joins stay simple while the payload
shape can keep evolving without a migration.
"""

import json
import os
import sqlite3
import threading
import time
import uuid

DB_PATH = os.path.join(os.path.dirname(__file__), "probe.db")

_local = threading.local()
_lock = threading.Lock()


def _conn() -> sqlite3.Connection:
    conn = getattr(_local, "conn", None)
    if conn is None:
        conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        _local.conn = conn
    return conn


SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    created_at REAL,
    payload_json TEXT
);

CREATE TABLE IF NOT EXISTS narratives (
    id TEXT PRIMARY KEY,
    sid TEXT,
    thesis TEXT,
    status TEXT,
    is_synthetic INTEGER DEFAULT 0,
    program TEXT,
    score INTEGER,
    payload_json TEXT,
    created_at REAL
);

CREATE TABLE IF NOT EXISTS dashboards (
    id TEXT PRIMARY KEY,
    narrative_id TEXT,
    stage TEXT,
    order_idx INTEGER,
    payload_json TEXT,
    created_at REAL
);

CREATE TABLE IF NOT EXISTS panels (
    id TEXT PRIMARY KEY,
    dashboard_id TEXT,
    order_idx INTEGER,
    payload_json TEXT,
    oracle_citations_json TEXT,
    index_citations_json TEXT
);

CREATE TABLE IF NOT EXISTS oracle_instances (
    id TEXT PRIMARY KEY,
    oracle_type TEXT,
    population_args_json TEXT,
    sources_json TEXT,
    consensus_json TEXT,
    pinned_json TEXT,
    provenance TEXT,
    resolved_at REAL,
    drifted INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS hypothesis_registry (
    id TEXT PRIMARY KEY,
    sid TEXT,
    narrative_id TEXT,
    claim TEXT,
    claim_class TEXT,
    verb TEXT,
    dag_json TEXT,
    q_value REAL,
    status TEXT,
    is_synthetic INTEGER DEFAULT 0,
    created_at REAL
);

CREATE TABLE IF NOT EXISTS evidence (
    id TEXT PRIMARY KEY,
    sid TEXT,
    dataset_version_id TEXT,
    claim TEXT,
    kind TEXT,
    source_code TEXT,
    values_json TEXT,
    reference_norm_id TEXT,
    confidence REAL,
    limitations_json TEXT,
    review_status TEXT,
    created_by TEXT,
    origin_panel_id TEXT,
    created_at REAL
);
CREATE INDEX IF NOT EXISTS idx_evidence_sid ON evidence(sid);

CREATE TABLE IF NOT EXISTS norms (
    id TEXT PRIMARY KEY,
    norm_key TEXT,
    metric TEXT,
    population_json TEXT,
    version INTEGER,
    expected_distribution_json TEXT,
    comparison_rules_json TEXT,
    source_ids_json TEXT,
    confidence REAL,
    confidence_components_json TEXT,
    valid_from REAL,
    valid_until REAL,
    approval_status TEXT,
    superseded_by TEXT,
    created_at REAL
);
CREATE INDEX IF NOT EXISTS idx_norms_key ON norms(norm_key);

CREATE TABLE IF NOT EXISTS narrative_workspaces (
    id TEXT PRIMARY KEY,
    sid TEXT,
    title TEXT,
    thesis TEXT,
    audience TEXT,
    lens TEXT,
    parent_workspace_id TEXT,
    dataset_version_id TEXT,
    norm_version_ids_json TEXT,
    evidence_ids_json TEXT,
    blocks_json TEXT,
    status TEXT,
    created_at REAL,
    updated_at REAL
);
CREATE INDEX IF NOT EXISTS idx_workspaces_sid ON narrative_workspaces(sid);
CREATE INDEX IF NOT EXISTS idx_workspaces_parent ON narrative_workspaces(parent_workspace_id);

CREATE TABLE IF NOT EXISTS narrative_review_comments (
    id TEXT PRIMARY KEY,
    workspace_id TEXT,
    track TEXT,
    block_index INTEGER,
    author TEXT,
    comment TEXT,
    status TEXT,
    created_at REAL
);
CREATE INDEX IF NOT EXISTS idx_review_workspace ON narrative_review_comments(workspace_id);

CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    sid TEXT,
    name TEXT,
    format TEXT,
    source_type TEXT,
    source_id TEXT,
    source_snapshot_json TEXT,
    file_path TEXT,
    built_at REAL
);
CREATE INDEX IF NOT EXISTS idx_reports_sid ON reports(sid);

CREATE TABLE IF NOT EXISTS dataset_versions (
    id TEXT PRIMARY KEY,
    sid TEXT,
    version INTEGER,
    fingerprint TEXT,
    manifest_json TEXT,
    understanding_json TEXT,
    created_at REAL
);
CREATE INDEX IF NOT EXISTS idx_dataset_versions_sid ON dataset_versions(sid);
CREATE INDEX IF NOT EXISTS idx_dataset_versions_fingerprint ON dataset_versions(sid, fingerprint);

CREATE TABLE IF NOT EXISTS artifact_cache (
    cache_key TEXT PRIMARY KEY,
    dataset_fingerprint TEXT,
    question TEXT,
    payload_json TEXT,
    hit_count INTEGER DEFAULT 0,
    created_at REAL,
    last_hit_at REAL
);
CREATE INDEX IF NOT EXISTS idx_artifact_cache_fingerprint ON artifact_cache(dataset_fingerprint);
"""


def init_db():
    with _lock:
        conn = _conn()
        conn.executescript(SCHEMA)
        conn.commit()


def new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}"


# ---- sessions ---------------------------------------------------------

def persist_session(sid: str, sess: dict):
    """Write-through snapshot of the JSON-safe subset of a session dict."""
    safe = {k: v for k, v in sess.items() if k not in ("canvas_cells",)}
    with _lock:
        conn = _conn()
        conn.execute(
            "INSERT INTO sessions (sid, created_at, payload_json) VALUES (?, ?, ?) "
            "ON CONFLICT(sid) DO UPDATE SET payload_json=excluded.payload_json",
            (sid, sess.get("created_at", time.time()), json.dumps(safe, default=str)),
        )
        conn.commit()


def list_sessions() -> list:
    """Every persisted session (write-through snapshots from persist_session,
    across process restarts) — the real backing for a workspace switcher."""
    conn = _conn()
    rows = conn.execute("SELECT sid, created_at, payload_json FROM sessions ORDER BY created_at DESC").fetchall()
    out = []
    for r in rows:
        payload = json.loads(r["payload_json"])
        out.append({"sid": r["sid"], "created_at": r["created_at"], **payload})
    return out


def load_session(sid: str):
    conn = _conn()
    row = conn.execute("SELECT payload_json FROM sessions WHERE sid=?", (sid,)).fetchone()
    return json.loads(row["payload_json"]) if row else None


# ---- narratives / dashboards / panels ----------------------------------

def save_narrative(sid: str, narrative: dict):
    with _lock:
        conn = _conn()
        conn.execute(
            "INSERT INTO narratives (id, sid, thesis, status, is_synthetic, program, score, payload_json, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET status=excluded.status, payload_json=excluded.payload_json",
            (
                narrative["narrative_id"], sid, narrative.get("thesis"),
                narrative.get("status", "review"), int(narrative.get("is_synthetic", False)),
                narrative.get("program"), narrative.get("score", 0),
                json.dumps(narrative, default=str), narrative.get("created_at", time.time()),
            ),
        )
        conn.commit()


def get_narrative(narrative_id: str):
    conn = _conn()
    row = conn.execute("SELECT payload_json FROM narratives WHERE id=?", (narrative_id,)).fetchone()
    return json.loads(row["payload_json"]) if row else None


def list_narratives(sid: str, include_synthetic: bool = True):
    conn = _conn()
    q = "SELECT payload_json FROM narratives WHERE sid=?"
    params = [sid]
    if not include_synthetic:
        q += " AND is_synthetic=0"
    rows = conn.execute(q, params).fetchall()
    return [json.loads(r["payload_json"]) for r in rows]


def bulk_save_narratives(sid: str, narratives: list):
    for n in narratives:
        save_narrative(sid, n)


# ---- oracle registry ----------------------------------------------------

def create_oracle_instance(oracle_type: str, population_args: dict, sources: list, consensus: dict, provenance: str) -> dict:
    oid = new_id("oracle")
    row = {
        "id": oid, "oracle_type": oracle_type, "population_args": population_args,
        "sources": sources, "consensus": consensus, "pinned": None,
        "provenance": provenance, "resolved_at": time.time(), "drifted": False,
    }
    with _lock:
        conn = _conn()
        conn.execute(
            "INSERT INTO oracle_instances (id, oracle_type, population_args_json, sources_json, "
            "consensus_json, pinned_json, provenance, resolved_at, drifted) VALUES (?,?,?,?,?,?,?,?,0)",
            (oid, oracle_type, json.dumps(population_args), json.dumps(sources),
             json.dumps(consensus), None, provenance, row["resolved_at"]),
        )
        conn.commit()
    return row


def _row_to_oracle(row) -> dict:
    return {
        "id": row["id"], "oracle_type": row["oracle_type"],
        "population_args": json.loads(row["population_args_json"]),
        "sources": json.loads(row["sources_json"]),
        "consensus": json.loads(row["consensus_json"]),
        "pinned": json.loads(row["pinned_json"]) if row["pinned_json"] else None,
        "provenance": row["provenance"], "resolved_at": row["resolved_at"],
        "drifted": bool(row["drifted"]),
    }


def get_oracle_instance(oid: str):
    conn = _conn()
    row = conn.execute("SELECT * FROM oracle_instances WHERE id=?", (oid,)).fetchone()
    return _row_to_oracle(row) if row else None


def find_oracle_instance(oracle_type: str, population_args: dict):
    conn = _conn()
    key = json.dumps(population_args, sort_keys=True)
    for row in conn.execute("SELECT * FROM oracle_instances WHERE oracle_type=?", (oracle_type,)).fetchall():
        if json.dumps(json.loads(row["population_args_json"]), sort_keys=True) == key:
            return _row_to_oracle(row)
    return None


def update_oracle_instance(oid: str, *, sources=None, consensus=None, pinned=None, drifted=None):
    fields, params = [], []
    if sources is not None:
        fields.append("sources_json=?"); params.append(json.dumps(sources))
    if consensus is not None:
        fields.append("consensus_json=?"); params.append(json.dumps(consensus))
    if pinned is not None:
        fields.append("pinned_json=?"); params.append(json.dumps(pinned))
    if drifted is not None:
        fields.append("drifted=?"); params.append(int(drifted))
    if not fields:
        return
    params.append(oid)
    with _lock:
        conn = _conn()
        conn.execute(f"UPDATE oracle_instances SET {', '.join(fields)} WHERE id=?", params)
        conn.commit()


def panels_citing_oracle(oracle_instance_id: str) -> list:
    """Cross-reference every persisted panel that cites this oracle instance."""
    conn = _conn()
    out = []
    for row in conn.execute("SELECT id, dashboard_id, oracle_citations_json FROM panels").fetchall():
        cites = json.loads(row["oracle_citations_json"] or "[]")
        if oracle_instance_id in cites:
            out.append({"panel_id": row["id"], "dashboard_id": row["dashboard_id"]})
    return out


def save_panel(panel_id: str, dashboard_id: str, order_idx: int, payload: dict, oracle_citations: list, index_citations: list):
    with _lock:
        conn = _conn()
        conn.execute(
            "INSERT INTO panels (id, dashboard_id, order_idx, payload_json, oracle_citations_json, index_citations_json) "
            "VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json",
            (panel_id, dashboard_id, order_idx, json.dumps(payload, default=str),
             json.dumps(oracle_citations), json.dumps(index_citations)),
        )
        conn.commit()


# ---- dataset version registry -------------------------------------------
#
# One immutable row per distinct fingerprint of a session's dataframes
# (dataset_registry.py computes the fingerprint). Re-deriving/re-uploading
# data that hashes the same as the latest version is a no-op — this table
# only grows when the data actually changed. artifact_cache below keys off
# this fingerprint, so it inherits the same "only new content is expensive"
# property.

def create_dataset_version(sid: str, version: int, fingerprint: str, manifest: dict,
                            understanding: dict | None = None) -> dict:
    vid = new_id("dsv")
    row = {
        "id": vid, "sid": sid, "version": version, "fingerprint": fingerprint,
        "manifest": manifest, "understanding": understanding, "created_at": time.time(),
    }
    with _lock:
        conn = _conn()
        conn.execute(
            "INSERT INTO dataset_versions (id, sid, version, fingerprint, manifest_json, "
            "understanding_json, created_at) VALUES (?,?,?,?,?,?,?)",
            (vid, sid, version, fingerprint, json.dumps(manifest),
             json.dumps(understanding) if understanding is not None else None, row["created_at"]),
        )
        conn.commit()
    return row


def _row_to_dataset_version(row) -> dict:
    return {
        "id": row["id"], "sid": row["sid"], "version": row["version"], "fingerprint": row["fingerprint"],
        "manifest": json.loads(row["manifest_json"]),
        "understanding": json.loads(row["understanding_json"]) if row["understanding_json"] else None,
        "created_at": row["created_at"],
    }


def get_latest_dataset_version(sid: str):
    conn = _conn()
    row = conn.execute(
        "SELECT * FROM dataset_versions WHERE sid=? ORDER BY version DESC LIMIT 1", (sid,)
    ).fetchone()
    return _row_to_dataset_version(row) if row else None


def find_dataset_version_by_fingerprint(sid: str, fingerprint: str):
    conn = _conn()
    row = conn.execute(
        "SELECT * FROM dataset_versions WHERE sid=? AND fingerprint=? LIMIT 1", (sid, fingerprint)
    ).fetchone()
    return _row_to_dataset_version(row) if row else None


def list_dataset_versions(sid: str) -> list:
    conn = _conn()
    rows = conn.execute(
        "SELECT * FROM dataset_versions WHERE sid=? ORDER BY version", (sid,)
    ).fetchall()
    return [_row_to_dataset_version(r) for r in rows]


def update_dataset_version_understanding(vid: str, understanding: dict):
    with _lock:
        conn = _conn()
        conn.execute("UPDATE dataset_versions SET understanding_json=? WHERE id=?",
                     (json.dumps(understanding), vid))
        conn.commit()


# ---- artifact cache -------------------------------------------------------
#
# Keyed on (dataset fingerprint, question, required fields, chart type) —
# see dashboard_engine._cache_key. A hit skips the Code Builder, Evaluator,
# and Narrative-caption LLM calls entirely; only per-render identity
# (dashboard_id, timestamps) is regenerated.

def get_cached_artifact(cache_key: str):
    conn = _conn()
    row = conn.execute("SELECT * FROM artifact_cache WHERE cache_key=?", (cache_key,)).fetchone()
    if row is None:
        return None
    with _lock:
        conn.execute(
            "UPDATE artifact_cache SET hit_count=hit_count+1, last_hit_at=? WHERE cache_key=?",
            (time.time(), cache_key),
        )
        conn.commit()
    return {
        "cache_key": row["cache_key"], "dataset_fingerprint": row["dataset_fingerprint"],
        "question": row["question"], "payload": json.loads(row["payload_json"]),
        "hit_count": row["hit_count"] + 1, "created_at": row["created_at"],
    }


def save_cached_artifact(cache_key: str, dataset_fingerprint: str, question: str, payload: dict):
    with _lock:
        conn = _conn()
        conn.execute(
            "INSERT INTO artifact_cache (cache_key, dataset_fingerprint, question, payload_json, "
            "hit_count, created_at, last_hit_at) VALUES (?,?,?,?,0,?,?) "
            "ON CONFLICT(cache_key) DO UPDATE SET payload_json=excluded.payload_json",
            (cache_key, dataset_fingerprint, question, json.dumps(payload, default=str),
             time.time(), time.time()),
        )
        conn.commit()


def cache_stats(dataset_fingerprint: str) -> dict:
    conn = _conn()
    row = conn.execute(
        "SELECT COUNT(*) AS n, COALESCE(SUM(hit_count),0) AS hits FROM artifact_cache WHERE dataset_fingerprint=?",
        (dataset_fingerprint,),
    ).fetchone()
    return {"cached_artifacts": row["n"], "cache_hits": row["hits"]}


# ---- hypothesis registry -------------------------------------------------

def insert_registry_row(sid: str, narrative_id, claim: str, claim_class: str, verb: str,
                         dag: dict | None, q_value: float | None, status: str, is_synthetic: bool = False) -> dict:
    rid = new_id("hyp")
    row = {
        "id": rid, "sid": sid, "narrative_id": narrative_id, "claim": claim,
        "claim_class": claim_class, "verb": verb, "dag": dag, "q_value": q_value,
        "status": status, "is_synthetic": is_synthetic, "created_at": time.time(),
    }
    with _lock:
        conn = _conn()
        conn.execute(
            "INSERT INTO hypothesis_registry (id, sid, narrative_id, claim, claim_class, verb, "
            "dag_json, q_value, status, is_synthetic, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (rid, sid, narrative_id, claim, claim_class, verb,
             json.dumps(dag) if dag is not None else None, q_value, status,
             int(is_synthetic), row["created_at"]),
        )
        conn.commit()
    return row


def update_registry_status(rid: str, status: str):
    with _lock:
        conn = _conn()
        conn.execute("UPDATE hypothesis_registry SET status=? WHERE id=?", (status, rid))
        conn.commit()


def get_registry_row(rid: str):
    conn = _conn()
    row = conn.execute("SELECT * FROM hypothesis_registry WHERE id=?", (rid,)).fetchone()
    return _row_to_registry(row) if row else None


def _row_to_registry(row) -> dict:
    return {
        "id": row["id"], "sid": row["sid"], "narrative_id": row["narrative_id"], "claim": row["claim"],
        "claim_class": row["claim_class"], "verb": row["verb"],
        "dag": json.loads(row["dag_json"]) if row["dag_json"] else None,
        "q_value": row["q_value"], "status": row["status"],
        "is_synthetic": bool(row["is_synthetic"]), "created_at": row["created_at"],
    }


def list_registry(sid: str) -> list:
    conn = _conn()
    rows = conn.execute("SELECT * FROM hypothesis_registry WHERE sid=? ORDER BY created_at", (sid,)).fetchall()
    return [_row_to_registry(r) for r in rows]


# ---- evidence objects -----------------------------------------------------
#
# The primitive connecting code to prose (spec: "narratives should cite
# evidence objects rather than raw cells"). Every real dashboard/narrative
# panel this app produces already IS evidence in substance (a claim, the
# code that computed it, the stats, the caveats) — create_evidence_from_panel
# below is the adapter that turns one into a first-class, independently
# citable/reviewable row instead of leaving it embedded only inside a panel.

def create_evidence(sid: str, *, dataset_version_id: str | None, claim: str, kind: str,
                     source_code: str | None, values: dict, reference_norm_id: str | None = None,
                     confidence: float | None, limitations: list | None = None,
                     created_by: str = "agent", origin_panel_id: str | None = None) -> dict:
    eid = new_id("evid")
    row = {
        "id": eid, "sid": sid, "dataset_version_id": dataset_version_id, "claim": claim, "kind": kind,
        "source_code": source_code, "values": values, "reference_norm_id": reference_norm_id,
        "confidence": confidence, "limitations": limitations or [], "review_status": "unreviewed",
        "created_by": created_by, "origin_panel_id": origin_panel_id, "created_at": time.time(),
    }
    with _lock:
        conn = _conn()
        conn.execute(
            "INSERT INTO evidence (id, sid, dataset_version_id, claim, kind, source_code, values_json, "
            "reference_norm_id, confidence, limitations_json, review_status, created_by, origin_panel_id, created_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (eid, sid, dataset_version_id, claim, kind, source_code, json.dumps(values, default=str),
             reference_norm_id, confidence, json.dumps(limitations or []), "unreviewed", created_by,
             origin_panel_id, row["created_at"]),
        )
        conn.commit()
    return row


def _row_to_evidence(row) -> dict:
    return {
        "id": row["id"], "sid": row["sid"], "dataset_version_id": row["dataset_version_id"],
        "claim": row["claim"], "kind": row["kind"], "source_code": row["source_code"],
        "values": json.loads(row["values_json"]) if row["values_json"] else {},
        "reference_norm_id": row["reference_norm_id"], "confidence": row["confidence"],
        "limitations": json.loads(row["limitations_json"]) if row["limitations_json"] else [],
        "review_status": row["review_status"], "created_by": row["created_by"],
        "origin_panel_id": row["origin_panel_id"], "created_at": row["created_at"],
    }


def get_evidence(eid: str):
    conn = _conn()
    row = conn.execute("SELECT * FROM evidence WHERE id=?", (eid,)).fetchone()
    return _row_to_evidence(row) if row else None


def get_evidence_bulk(eids: list) -> list:
    if not eids:
        return []
    conn = _conn()
    q = f"SELECT * FROM evidence WHERE id IN ({','.join('?' * len(eids))})"
    rows = conn.execute(q, eids).fetchall()
    by_id = {r["id"]: _row_to_evidence(r) for r in rows}
    return [by_id[e] for e in eids if e in by_id]


def list_evidence(sid: str, kind: str | None = None) -> list:
    conn = _conn()
    q = "SELECT * FROM evidence WHERE sid=?"
    params = [sid]
    if kind:
        q += " AND kind=?"
        params.append(kind)
    q += " ORDER BY created_at DESC"
    rows = conn.execute(q, params).fetchall()
    return [_row_to_evidence(r) for r in rows]


def update_evidence_review(eid: str, review_status: str):
    with _lock:
        conn = _conn()
        conn.execute("UPDATE evidence SET review_status=? WHERE id=?", (review_status, eid))
        conn.commit()


# ---- versioned norm registry -----------------------------------------------
#
# Never overwrite a norm — a revision inserts a new row with an incremented
# version and marks the old row's superseded_by, so any workspace/narrative
# that recorded which norm version it used stays reproducible even after the
# norm itself moves.

def _norm_key(metric: str, population: dict) -> str:
    return json.dumps({"metric": metric, "population": population}, sort_keys=True)


def create_norm_version(metric: str, population: dict, expected_distribution: dict,
                         comparison_rules: dict, source_ids: list, confidence: float,
                         confidence_components: dict, approval_status: str = "auto_published") -> dict:
    key = _norm_key(metric, population)
    with _lock:
        conn = _conn()
        prev = conn.execute(
            "SELECT * FROM norms WHERE norm_key=? AND valid_until IS NULL ORDER BY version DESC LIMIT 1", (key,)
        ).fetchone()
        version = (prev["version"] + 1) if prev else 1
        nid = new_id("norm")
        now = time.time()
        conn.execute(
            "INSERT INTO norms (id, norm_key, metric, population_json, version, expected_distribution_json, "
            "comparison_rules_json, source_ids_json, confidence, confidence_components_json, valid_from, "
            "valid_until, approval_status, superseded_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL,?,NULL,?)",
            (nid, key, metric, json.dumps(population), version, json.dumps(expected_distribution),
             json.dumps(comparison_rules), json.dumps(source_ids), confidence, json.dumps(confidence_components),
             now, approval_status, now),
        )
        if prev:
            conn.execute("UPDATE norms SET valid_until=?, superseded_by=? WHERE id=?", (now, nid, prev["id"]))
        conn.commit()
    return get_norm(nid)


def _row_to_norm(row) -> dict:
    return {
        "id": row["id"], "norm_key": row["norm_key"], "metric": row["metric"],
        "population": json.loads(row["population_json"]), "version": row["version"],
        "expected_distribution": json.loads(row["expected_distribution_json"]),
        "comparison_rules": json.loads(row["comparison_rules_json"]) if row["comparison_rules_json"] else {},
        "source_ids": json.loads(row["source_ids_json"]) if row["source_ids_json"] else [],
        "confidence": row["confidence"],
        "confidence_components": json.loads(row["confidence_components_json"]) if row["confidence_components_json"] else {},
        "valid_from": row["valid_from"], "valid_until": row["valid_until"],
        "approval_status": row["approval_status"], "superseded_by": row["superseded_by"],
        "created_at": row["created_at"],
    }


def get_norm(nid: str):
    conn = _conn()
    row = conn.execute("SELECT * FROM norms WHERE id=?", (nid,)).fetchone()
    return _row_to_norm(row) if row else None


def get_current_norm(metric: str, population: dict):
    key = _norm_key(metric, population)
    conn = _conn()
    row = conn.execute(
        "SELECT * FROM norms WHERE norm_key=? AND valid_until IS NULL ORDER BY version DESC LIMIT 1", (key,)
    ).fetchone()
    return _row_to_norm(row) if row else None


def list_norm_versions(metric: str, population: dict) -> list:
    key = _norm_key(metric, population)
    conn = _conn()
    rows = conn.execute("SELECT * FROM norms WHERE norm_key=? ORDER BY version", (key,)).fetchall()
    return [_row_to_norm(r) for r in rows]


def list_all_current_norms() -> list:
    """Every current norm across every metric/population — norms are shared
    institutional knowledge, not session-scoped, so this is a global list."""
    conn = _conn()
    rows = conn.execute("SELECT * FROM norms WHERE valid_until IS NULL ORDER BY created_at DESC").fetchall()
    return [_row_to_norm(r) for r in rows]


def list_norms_by_metric(metric: str) -> list:
    """All current (non-superseded) norm rows for a metric, across every
    population scope registered — the candidate set a hierarchical lookup
    picks the most specific match from."""
    conn = _conn()
    rows = conn.execute(
        "SELECT * FROM norms WHERE metric=? AND valid_until IS NULL ORDER BY version DESC", (metric,)
    ).fetchall()
    return [_row_to_norm(r) for r in rows]


def approve_norm(nid: str):
    with _lock:
        conn = _conn()
        conn.execute("UPDATE norms SET approval_status='approved' WHERE id=?", (nid,))
        conn.commit()


# ---- narrative workspace + branching + review ------------------------------

WORKSPACE_STATES = ["draft", "analysis_ready", "analysis_reviewed", "narrative_ready",
                     "scientific_review", "approved", "published", "superseded"]


def create_workspace(sid: str, title: str, thesis: str, audience: str, lens: str,
                      dataset_version_id: str | None, parent_workspace_id: str | None = None,
                      norm_version_ids: list | None = None, evidence_ids: list | None = None,
                      blocks: list | None = None) -> dict:
    wid = new_id("ws")
    now = time.time()
    row = {
        "id": wid, "sid": sid, "title": title, "thesis": thesis, "audience": audience, "lens": lens,
        "parent_workspace_id": parent_workspace_id, "dataset_version_id": dataset_version_id,
        "norm_version_ids": norm_version_ids or [], "evidence_ids": evidence_ids or [],
        "blocks": blocks or [], "status": "draft", "created_at": now, "updated_at": now,
    }
    with _lock:
        conn = _conn()
        conn.execute(
            "INSERT INTO narrative_workspaces (id, sid, title, thesis, audience, lens, parent_workspace_id, "
            "dataset_version_id, norm_version_ids_json, evidence_ids_json, blocks_json, status, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (wid, sid, title, thesis, audience, lens, parent_workspace_id, dataset_version_id,
             json.dumps(norm_version_ids or []), json.dumps(evidence_ids or []), json.dumps(blocks or []),
             "draft", now, now),
        )
        conn.commit()
    return row


def _row_to_workspace(row) -> dict:
    return {
        "id": row["id"], "sid": row["sid"], "title": row["title"], "thesis": row["thesis"],
        "audience": row["audience"], "lens": row["lens"], "parent_workspace_id": row["parent_workspace_id"],
        "dataset_version_id": row["dataset_version_id"],
        "norm_version_ids": json.loads(row["norm_version_ids_json"]) if row["norm_version_ids_json"] else [],
        "evidence_ids": json.loads(row["evidence_ids_json"]) if row["evidence_ids_json"] else [],
        "blocks": json.loads(row["blocks_json"]) if row["blocks_json"] else [],
        "status": row["status"], "created_at": row["created_at"], "updated_at": row["updated_at"],
    }


def get_workspace(wid: str):
    conn = _conn()
    row = conn.execute("SELECT * FROM narrative_workspaces WHERE id=?", (wid,)).fetchone()
    return _row_to_workspace(row) if row else None


def list_workspaces(sid: str) -> list:
    conn = _conn()
    rows = conn.execute("SELECT * FROM narrative_workspaces WHERE sid=? ORDER BY created_at DESC", (sid,)).fetchall()
    return [_row_to_workspace(r) for r in rows]


def list_workspace_branches(parent_workspace_id: str) -> list:
    conn = _conn()
    rows = conn.execute(
        "SELECT * FROM narrative_workspaces WHERE parent_workspace_id=? ORDER BY created_at", (parent_workspace_id,)
    ).fetchall()
    return [_row_to_workspace(r) for r in rows]


def update_workspace(wid: str, **fields):
    """fields may include: title, thesis, audience, lens, evidence_ids, blocks, status."""
    cols, params = [], []
    json_fields = {"evidence_ids": "evidence_ids_json", "blocks": "blocks_json", "norm_version_ids": "norm_version_ids_json"}
    for k, v in fields.items():
        col = json_fields.get(k, k)
        cols.append(f"{col}=?")
        params.append(json.dumps(v) if k in json_fields else v)
    if not cols:
        return get_workspace(wid)
    cols.append("updated_at=?")
    params.append(time.time())
    params.append(wid)
    with _lock:
        conn = _conn()
        conn.execute(f"UPDATE narrative_workspaces SET {', '.join(cols)} WHERE id=?", params)
        conn.commit()
    return get_workspace(wid)


def add_review_comment(workspace_id: str, track: str, author: str, comment: str, block_index: int | None = None) -> dict:
    cid = new_id("cmt")
    row = {"id": cid, "workspace_id": workspace_id, "track": track, "block_index": block_index,
           "author": author, "comment": comment, "status": "open", "created_at": time.time()}
    with _lock:
        conn = _conn()
        conn.execute(
            "INSERT INTO narrative_review_comments (id, workspace_id, track, block_index, author, comment, status, created_at) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (cid, workspace_id, track, block_index, author, comment, "open", row["created_at"]),
        )
        conn.commit()
    return row


def resolve_review_comment(cid: str):
    with _lock:
        conn = _conn()
        conn.execute("UPDATE narrative_review_comments SET status='resolved' WHERE id=?", (cid,))
        conn.commit()


def _row_to_comment(row) -> dict:
    return {"id": row["id"], "workspace_id": row["workspace_id"], "track": row["track"],
            "block_index": row["block_index"], "author": row["author"], "comment": row["comment"],
            "status": row["status"], "created_at": row["created_at"]}


def list_review_comments(workspace_id: str) -> list:
    conn = _conn()
    rows = conn.execute(
        "SELECT * FROM narrative_review_comments WHERE workspace_id=? ORDER BY created_at", (workspace_id,)
    ).fetchall()
    return [_row_to_comment(r) for r in rows]


# ---- reports ---------------------------------------------------------------

def create_report(sid: str, name: str, fmt: str, source_type: str, source_id: str,
                   source_snapshot: dict, file_path: str) -> dict:
    rid = new_id("rpt")
    row = {"id": rid, "sid": sid, "name": name, "format": fmt, "source_type": source_type,
           "source_id": source_id, "source_snapshot": source_snapshot, "file_path": file_path,
           "built_at": time.time()}
    with _lock:
        conn = _conn()
        conn.execute(
            "INSERT INTO reports (id, sid, name, format, source_type, source_id, source_snapshot_json, "
            "file_path, built_at) VALUES (?,?,?,?,?,?,?,?,?)",
            (rid, sid, name, fmt, source_type, source_id, json.dumps(source_snapshot), file_path, row["built_at"]),
        )
        conn.commit()
    return row


def _row_to_report(row) -> dict:
    return {"id": row["id"], "sid": row["sid"], "name": row["name"], "format": row["format"],
            "source_type": row["source_type"], "source_id": row["source_id"],
            "source_snapshot": json.loads(row["source_snapshot_json"]) if row["source_snapshot_json"] else {},
            "file_path": row["file_path"], "built_at": row["built_at"]}


def get_report(rid: str):
    conn = _conn()
    row = conn.execute("SELECT * FROM reports WHERE id=?", (rid,)).fetchone()
    return _row_to_report(row) if row else None


def list_reports(sid: str) -> list:
    conn = _conn()
    rows = conn.execute("SELECT * FROM reports WHERE sid=? ORDER BY built_at DESC", (sid,)).fetchall()
    return [_row_to_report(r) for r in rows]
