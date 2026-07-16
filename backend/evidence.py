"""
Evidence objects — the primitive that connects executed code to prose.
Narratives/workspaces should cite evidence objects, not raw panel dicts, so a
claim keeps its source code, dataset version, and caveats even after the
panel that first produced it is gone or superseded.

A panel's own internal stats are never evidence by themselves — evidence
only exists once a claim has been checked against something outside the
trial's own data (from_norm_comparison), aggregated from rows that already
cleared that bar (from_synthesis), or entered directly by a human
(from_human_annotation).
"""

import db


def from_norm_comparison(sid: str, dataset_version_id: str | None, claim: str, values: dict,
                          reference_norm_id: str, confidence: float, limitations: list | None = None) -> dict:
    return db.create_evidence(
        sid, dataset_version_id=dataset_version_id, claim=claim, kind="norm_comparison", source_code=None,
        values=values, reference_norm_id=reference_norm_id, confidence=confidence,
        limitations=limitations or [], created_by="agent",
    )


def from_human_annotation(sid: str, dataset_version_id: str | None, claim: str,
                           values: dict | None = None, limitations: list | None = None) -> dict:
    return db.create_evidence(
        sid, dataset_version_id=dataset_version_id, claim=claim, kind="human_annotation", source_code=None,
        values=values or {}, confidence=None, limitations=limitations or [], created_by="human",
    )


def from_synthesis(sid: str, dataset_version_id: str | None, claim: str, narrative: str,
                    source_evidence_ids: list, confidence: float) -> dict:
    """The Analysis stage's own evidence kind — a claim that only exists by
    weighing several Notebook-stage evidence rows together, never a fresh
    computation of its own. source_evidence_ids keeps the citation trail
    (which notebook findings this synthesis actually drew on) alongside the
    written narrative, same spirit as from_panel's origin_panel_id."""
    return db.create_evidence(
        sid, dataset_version_id=dataset_version_id, claim=claim, kind="synthesis", source_code=None,
        values={"narrative": narrative, "source_evidence_ids": source_evidence_ids},
        confidence=confidence, limitations=[], created_by="agent",
    )


def approve(eid: str):
    db.update_evidence_review(eid, "approved")


def reject(eid: str):
    db.update_evidence_review(eid, "rejected")


def get(eid: str):
    return db.get_evidence(eid)


def get_bulk(eids: list) -> list:
    return db.get_evidence_bulk(eids)


def list_for_session(sid: str, kind: str | None = None) -> list:
    return db.list_evidence(sid, kind=kind)
