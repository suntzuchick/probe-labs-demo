"""
Corpus store — real narratives (from narrative_engine, grounded in actual
data) plus clearly-labeled synthetic filler so the corpus explorer has
browsable density even after a session has only generated one or two real
narratives (spec §7, decision: real + labeled filler).

Filler is cheap and deterministic (no LLM): templated title strings built
from whatever real metrics/entities the session's DatasetUnderstanding
exposes, so filler at least stays topically plausible for THIS dataset —
but every filler row carries is_synthetic=True and a filler_reason, and
always renders as an inert PREVIEW row in the UI (spec §7.2), never a
clickable hero. Filler never gets real panels/evidence attached.
"""

import random
import time

import db

VERBS = ["Exposure predicts", "Dose shapes", "Cohort size constrains", "Variability limits",
         "Missingness confounds", "Baseline status stratifies", "Time-on-study modifies"]
CONDITIONS = ["in the derived cohort", "across observed arms", "after quality fixes",
              "in the biomarker-positive subgroup", "at higher exposure", "over the follow-up window"]
FALLBACK_METRICS = ["response rate", "event rate", "time to event", "discontinuation", "grade 3+ toxicity"]
FALLBACK_ENTITIES = ["subject", "arm", "event"]

STATUS_WEIGHTS = [("published", 0.45), ("review", 0.25), ("contradicted", 0.10), ("blocked", 0.20)]
BLOCKED_NEEDS = ["a comparator arm", "longer follow-up", "a second timepoint", "an external control", "biomarker status"]


def _weighted_status(rng: random.Random) -> str:
    r, cum = rng.random(), 0.0
    for status, w in STATUS_WEIGHTS:
        cum += w
        if r <= cum:
            return status
    return "review"


def _score_for(status: str, rng: random.Random) -> int:
    if status == "published":
        return 76 + int(rng.random() * 22)
    if status == "review":
        return 60 + int(rng.random() * 15)
    if status == "contradicted":
        return 30 + int(rng.random() * 25)
    return 15 + int(rng.random() * 30)


def generate_filler(n: int, understanding: dict | None = None, seed: int = 0) -> list:
    metrics = (understanding or {}).get("available_metrics") or FALLBACK_METRICS
    entities = (understanding or {}).get("entities") or FALLBACK_ENTITIES
    rng = random.Random(seed or time.time())

    rows = []
    for i in range(n):
        verb = rng.choice(VERBS)
        metric = rng.choice(metrics + FALLBACK_METRICS)
        cond = rng.choice(CONDITIONS)
        status = _weighted_status(rng)
        thesis = f"{verb} {metric} {cond}"
        rows.append({
            "narrative_id": db.new_id("filler"),
            "thesis": thesis,
            "status": status,
            "is_synthetic": True,
            "filler_reason": "corpus density demo — not backed by computed evidence",
            "score": _score_for(status, rng),
            "program": rng.choice(entities) if entities else None,
            "need": rng.choice(BLOCKED_NEEDS) if status == "blocked" else None,
            "dashboards": [],
            "created_at": time.time(),
        })
    return rows


def ensure_filler(sid: str, understanding: dict | None = None, n: int = 40):
    existing = db.list_narratives(sid, include_synthetic=True)
    if any(row.get("is_synthetic") for row in existing):
        return
    for row in generate_filler(n, understanding=understanding):
        db.save_narrative(sid, row)


_REAL_STATUS_SCORE = {"publish": 92, "published": 92, "caveats": 78, "review": 62, "contradicted": 25, "reject": 15}


def list_corpus(sid: str, status: str | None = None, q: str | None = None) -> list:
    rows = db.list_narratives(sid, include_synthetic=True)
    for r in rows:
        if "score" not in r or r["score"] is None:
            r["score"] = _REAL_STATUS_SCORE.get(r.get("status"), 60)
        # normalize status labels used by the corpus UI's fixed taxonomy (spec §7.3)
        if r.get("status") in ("publish", "caveats"):
            r["status"] = "published"
    if status and status != "all":
        rows = [r for r in rows if r.get("status") == status]
    if q:
        ql = q.lower()
        rows = [r for r in rows if ql in (r.get("thesis") or "").lower()]
    return sorted(rows, key=lambda r: r["score"], reverse=True)
