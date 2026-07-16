"""
Narrative workspace — the human + AI authoring environment for constructing
narratives from evidence, with git-like branching and a two-track review
workflow (analysis review, narrative review).

A workspace freezes the dataset version and norm versions it was built
against (spec: "the workspace freezes the versions it used so the narrative
remains reproducible"), holds an ordered list of canvas blocks, and moves
through a real state machine — the gates below aren't decorative, they
block a transition (e.g. no reaching "published" with an unresolved
narrative-review comment).
"""

import db

_VALID_TRANSITIONS = {
    "draft": {"analysis_ready"},
    "analysis_ready": {"analysis_reviewed", "draft"},
    "analysis_reviewed": {"narrative_ready", "analysis_ready"},
    "narrative_ready": {"scientific_review", "analysis_reviewed"},
    "scientific_review": {"approved", "narrative_ready"},
    "approved": {"published", "scientific_review"},
    "published": {"superseded"},
    "superseded": set(),
}


def create(sid: str, title: str, thesis: str, audience: str, lens: str, dataset_version_id: str | None,
           evidence_ids: list | None = None, blocks: list | None = None, norm_version_ids: list | None = None) -> dict:
    return db.create_workspace(sid, title, thesis, audience, lens, dataset_version_id,
                                norm_version_ids=norm_version_ids, evidence_ids=evidence_ids, blocks=blocks)


def get(wid: str):
    return db.get_workspace(wid)


def list_for_session(sid: str) -> list:
    return db.list_workspaces(sid)


def update_blocks(wid: str, blocks: list) -> dict:
    return db.update_workspace(wid, blocks=blocks)


def update_meta(wid: str, **fields) -> dict:
    allowed = {"title", "thesis", "audience", "lens"}
    return db.update_workspace(wid, **{k: v for k, v in fields.items() if k in allowed})


def add_evidence(wid: str, eid: str) -> dict:
    ws = db.get_workspace(wid)
    if eid not in ws["evidence_ids"]:
        return db.update_workspace(wid, evidence_ids=ws["evidence_ids"] + [eid])
    return ws


def remove_evidence(wid: str, eid: str) -> dict:
    ws = db.get_workspace(wid)
    return db.update_workspace(wid, evidence_ids=[e for e in ws["evidence_ids"] if e != eid])


def transition(wid: str, new_status: str) -> dict:
    ws = db.get_workspace(wid)
    if ws is None:
        return {"status": "error", "error": "unknown workspace"}
    allowed = _VALID_TRANSITIONS.get(ws["status"], set())
    if new_status not in allowed:
        return {"status": "error",
                "error": f"cannot move from '{ws['status']}' to '{new_status}' (allowed: {sorted(allowed)})"}

    if new_status == "narrative_ready" and not ws["evidence_ids"]:
        return {"status": "error", "error": "workspace has no evidence attached — cannot mark narrative-ready"}

    if new_status in ("scientific_review", "approved", "published"):
        open_analysis = [c for c in db.list_review_comments(wid) if c["track"] == "analysis" and c["status"] == "open"]
        if open_analysis:
            return {"status": "error",
                    "error": f"{len(open_analysis)} unresolved analysis-review comment(s) must be resolved first"}

    if new_status == "published":
        open_narrative = [c for c in db.list_review_comments(wid) if c["track"] == "narrative" and c["status"] == "open"]
        if open_narrative:
            return {"status": "error",
                    "error": f"{len(open_narrative)} unresolved narrative-review comment(s) must be resolved first"}

    updated = db.update_workspace(wid, status=new_status)
    return {"status": "ok", "workspace": updated}


def branch(wid: str, title: str, audience: str, lens: str):
    """Fork a workspace into a new one for a different audience/lens — e.g.
    "Investor framing" branched off "Scientific narrative", same evidence to
    start. Copy-based, not a true content-addressed diff store (that's a
    materially larger undertaking than this pass covers) — but it gives real
    branch lineage (parent_workspace_id) and a real compare() view, which is
    the part an author actually interacts with day to day."""
    parent = db.get_workspace(wid)
    if parent is None:
        return None
    return db.create_workspace(
        parent["sid"], title, parent["thesis"], audience, lens, parent["dataset_version_id"],
        parent_workspace_id=wid, norm_version_ids=parent["norm_version_ids"],
        evidence_ids=list(parent["evidence_ids"]), blocks=list(parent["blocks"]),
    )


def list_branches(wid: str) -> list:
    return db.list_workspace_branches(wid)


def compare(wid_a: str, wid_b: str):
    a, b = db.get_workspace(wid_a), db.get_workspace(wid_b)
    if a is None or b is None:
        return None
    ea, eb = set(a["evidence_ids"]), set(b["evidence_ids"])
    return {
        "shared_evidence": sorted(ea & eb),
        "unique_to_a": sorted(ea - eb),
        "unique_to_b": sorted(eb - ea),
        "audience_changed": a["audience"] != b["audience"],
        "lens_changed": a["lens"] != b["lens"],
        "thesis_changed": a["thesis"] != b["thesis"],
        "block_count_a": len(a["blocks"]),
        "block_count_b": len(b["blocks"]),
    }


def add_comment(wid: str, track: str, author: str, comment: str, block_index: int | None = None) -> dict:
    if track not in ("analysis", "narrative"):
        return {"status": "error", "error": "track must be 'analysis' or 'narrative'"}
    return {"status": "ok", "comment": db.add_review_comment(wid, track, author, comment, block_index)}


def resolve_comment(cid: str):
    db.resolve_review_comment(cid)


def list_comments(wid: str, track: str | None = None) -> list:
    rows = db.list_review_comments(wid)
    return [r for r in rows if track is None or r["track"] == track]
