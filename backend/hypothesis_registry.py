"""
Hypothesis registry — the append-only ledger of claims (spec §8), separate
from the narrative corpus. A registry that only shows wins is a
publication-bias demo, not an anti-p-hacking one — seeding always includes
at least one null-q_value row and one blocked/no-DAG causal row so that
isn't this demo.

The gate is real, not cosmetic: a causal claim published without a DAG is
force-downgraded to status="blocked" and the publish call returns 422 —
narrative_engine.py never emits a causal claim with a DAG attached (no DAG
authoring tool exists in this build), so every narrative-derived registry
row is intentionally associational.
"""

import db

CAUSAL_VERBS = ["drives", "causes", "leads to", "results in", "improves", "increases",
                "decreases", "reduces", "improved", "increased", "decreased", "reduced"]
ASSOCIATIONAL_VERBS = ["is associated with", "correlates with", "predicts", "tracks with",
                       "shapes", "constrains", "limits", "modifies", "stratifies"]


def detect_verb(claim: str) -> tuple[str, str]:
    """Returns (verb_found, claim_class)."""
    low = claim.lower()
    for v in CAUSAL_VERBS:
        if v in low:
            return v, "causal"
    for v in ASSOCIATIONAL_VERBS:
        if v in low:
            return v, "associational"
    return "—", "associational"


def validate_for_publish(claim_class: str, dag: dict | None) -> tuple[bool, str | None]:
    """Real gate: a causal claim without a DAG cannot publish — it's forced
    to blocked, not merely flagged. Returns (ok, reason_if_not_ok)."""
    if claim_class == "causal" and dag is None:
        return False, "Causal claims require a DAG before they can publish — none was supplied."
    return True, None


def publish(sid: str, claim: str, narrative_id: str | None = None, dag: dict | None = None,
            q_value: float | None = None, is_synthetic: bool = False) -> dict:
    verb, claim_class = detect_verb(claim)
    ok, reason = validate_for_publish(claim_class, dag)
    status = "published" if ok else "blocked"
    row = db.insert_registry_row(sid, narrative_id, claim, claim_class, verb, dag, q_value, status, is_synthetic)
    if not ok:
        return {"status": "error", "http_status": 422, "error": reason, "row": row}
    return {"status": "ok", "http_status": 200, "row": row}


FILLER_CLAIMS = [
    ("Higher exposure drives response", None, None),                 # causal, no DAG -> guaranteed blocked row
    ("Baseline biomarker status is associated with response", None, 0.041),
    ("Dose is associated with grade 3+ toxicity", None, None),        # guaranteed null-q row
    ("Time on study correlates with cumulative AE burden", None, 0.18),
    ("Arm assignment predicts discontinuation", None, 0.62),
]


def ensure_seed(sid: str):
    existing = db.list_registry(sid)
    if any(r.get("is_synthetic") for r in existing):
        return
    for claim, dag, q in FILLER_CLAIMS:
        publish(sid, claim, dag=dag, q_value=q, is_synthetic=True)


def list_for_session(sid: str) -> list:
    ensure_seed(sid)
    return db.list_registry(sid)
