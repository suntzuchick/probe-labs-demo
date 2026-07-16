"""
Editor linting — spec §6. Two rules, both real gates on publish, not
suggestions:
  1. a causal verb in a block's text -> margin note, one-click soften.
  2. a safety/rate claim with no attached oracle citation -> margin note.

Deterministic word-list/regex matching (fast, called on block blur/save, not
on-type) reusing hypothesis_registry's verb lists so the editor and the
registry agree on what counts as a causal claim.
"""

import re

import hypothesis_registry

RATE_CLAIM_RE = re.compile(r"\b(rate|percent|toxicity|adverse|safety|incidence)\b|%", re.I)
BACKGROUND_MENTION_RE = re.compile(r"\bbackground\b", re.I)


def lint_block(text: str, oracle_citations: list | None = None) -> list:
    oracle_citations = oracle_citations or []
    notes = []

    verb, claim_class = hypothesis_registry.detect_verb(text)
    if claim_class == "causal":
        notes.append({
            "k": "causal", "title": f'Causal verb: "{verb}"',
            "detail": "A confound may not be adjusted for. Soften the claim, or attach a DAG in the registry.",
            "fix": "soften", "fix_label": 'soften to "is associated with"',
        })

    if RATE_CLAIM_RE.search(text) and not oracle_citations and not BACKGROUND_MENTION_RE.search(text):
        notes.append({
            "k": "oracle", "title": "Oracle required",
            "detail": "A safety/rate claim is uninterpretable without an external background rate.",
            "fix": "insert_oracle", "fix_label": "insert ◆ oracle.background_rate",
        })

    return notes


def lint_blocks(blocks: list) -> dict:
    """blocks: [{id, text, oracle_citations}] -> {id: [notes]}"""
    out = {}
    for b in blocks:
        notes = lint_block(b.get("text", ""), b.get("oracle_citations"))
        if notes:
            out[str(b["id"])] = notes
    return out
