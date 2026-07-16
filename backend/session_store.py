import threading
import time
import uuid

import db

_sessions = {}
_lock = threading.Lock()

CLINICAL_DOMAINS = ["DM", "EX", "AE", "RS", "DS"]

_NEW_SESSION_DEFAULTS = {
    "user_info": {}, "files": {}, "domain_data": {}, "domain_source": {},
    "derivation_meta": {}, "canvas_cells": [], "dataset_understanding": None,
    "indexes": None, "dashboards": [], "dashboard_seq": 0,
    # Oracles are an opt-in later stage of the demo (single-file sessions
    # never see them; the triple-file "+ Oracles" act flips this on) — off
    # by default so Evidence/Narratives never cite outside benchmarks until
    # the session actually asked for that.
    "oracles_enabled": False,
    # 1 = single file, 2 = triple file, 3 = triple file + oracles — see the
    # 3-act demo structure. Governs whether Notebook's Hypothesis Agent asks
    # within-trial or cross-trial questions, and which understanding/schema
    # _ensure_indexes builds against.
    "act": 1,
}


def new_session() -> str:
    sid = uuid.uuid4().hex[:12]
    with _lock:
        _sessions[sid] = {"created_at": time.time(), **{k: (v.copy() if hasattr(v, "copy") else v) for k, v in _NEW_SESSION_DEFAULTS.items()}}
    return sid


def get_session(sid: str) -> dict:
    with _lock:
        sess = _sessions.get(sid)
    if sess is not None:
        return sess
    # Not resident in this process's memory — most likely this is a fresh
    # backend process (a restart wipes `_sessions`, it's never been
    # anything but in-memory) and the caller has a sid from before that
    # restart. The session's real data was write-through persisted to
    # sqlite by db.persist_session at the points that already call it
    # (index build, narrative generate) — rehydrate from there instead of
    # treating a perfectly good, data-bearing session as gone. Only
    # `canvas_cells` doesn't round-trip (persist_session deliberately
    # excludes it); every dashboard/evidence/dataset-version link does.
    loaded = db.load_session(sid)
    if loaded is None:
        return None
    for k, v in _NEW_SESSION_DEFAULTS.items():
        loaded.setdefault(k, v.copy() if hasattr(v, "copy") else v)
    with _lock:
        _sessions.setdefault(sid, loaded)
        sess = _sessions[sid]
    return sess


def session_exists(sid: str) -> bool:
    return get_session(sid) is not None


def update_session(sid: str, **kwargs):
    with _lock:
        if sid in _sessions:
            _sessions[sid].update(kwargs)


def missing_domains(sid: str) -> list:
    sess = get_session(sid)
    if not sess:
        return CLINICAL_DOMAINS[:]
    return [d for d in CLINICAL_DOMAINS if d not in sess["domain_data"]]


def has_any_data(sid: str) -> bool:
    sess = get_session(sid)
    if not sess:
        return False
    return bool(sess["domain_data"] or sess["files"])
