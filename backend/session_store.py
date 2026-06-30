import threading
import time
import uuid

_sessions = {}
_lock = threading.Lock()

CLINICAL_DOMAINS = ["DM", "EX", "AE", "RS", "DS"]


def new_session() -> str:
    sid = uuid.uuid4().hex[:12]
    with _lock:
        _sessions[sid] = {
            "created_at": time.time(),
            "user_info": {},
            "files": {},
            "domain_data": {},
            "domain_source": {},
            "derivation_meta": {},
            "canvas_cells": [],
        }
    return sid


def get_session(sid: str) -> dict:
    with _lock:
        return _sessions.get(sid)


def session_exists(sid: str) -> bool:
    with _lock:
        return sid in _sessions


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
