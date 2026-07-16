"""
Versioned norm registry — norms/oracle-resolved external knowledge stored as
immutable, hierarchically-scoped, confidence-scored versions.

"Never overwrite a norm... use immutable versions... every dashboard
records which norm version it used." Builds on oracle_engine.py (which does
the actual "ask Claude for known published estimates" resolution) and
db.py's norms table (versioning + supersession). This module adds what
oracle_engine.py's flat instance cache didn't have:

  - explicit versioning with supersede-on-change, not overwrite-in-place
  - a decomposed, deterministic confidence score (never model-invented)
  - hierarchical population fallback (most-specific match with enough
    sample support wins; falls back to a broader population otherwise)
  - a create/revise/retain decision gated on materiality, so a value that
    moved within noise doesn't spawn a spurious new version
"""

import db
import oracle_engine

MIN_SAMPLE_SIZE = 20
MATERIALITY_THRESHOLD = 0.15  # relative change in median that counts as a real revision, not noise

# Population keys ordered most- to least-specific. Hierarchical fallback
# drops the leading (most specific) key first and walks toward the global
# scope — same shape as the doc's Global -> therapeutic area -> disease ->
# molecular subtype -> assay -> lab hierarchy, generalized to whichever of
# these keys a given oracle_type's population_args actually uses (a caller
# supplying only {"condition", "population", "metric"} just falls back
# through fewer levels — this list is a superset, not a required schema).
_SPECIFICITY_ORDER = ["lab", "assay", "molecular_subtype", "disease", "therapeutic_area",
                      "entity", "population", "condition"]


def _generalize(population: dict) -> list:
    """Every fallback level from most-specific (the exact population given)
    down to {} (global), most-specific first, de-duplicated."""
    levels = [dict(population)]
    remaining = dict(population)
    for key in _SPECIFICITY_ORDER:
        if key in remaining:
            remaining = {k: v for k, v in remaining.items() if k != key}
            levels.append(dict(remaining))
    if levels[-1] != {}:
        levels.append({})
    seen, out = set(), []
    for lvl in levels:
        key = tuple(sorted(lvl.items()))
        if key not in seen:
            seen.add(key)
            out.append(lvl)
    return out


def find_norm(metric: str, population: dict, min_sample_size: int = MIN_SAMPLE_SIZE):
    """Most-specific current norm for (metric, population) with adequate
    sample size, falling back to a broader population scope otherwise.
    Returns (norm, specificity_level) — level 0 is an exact match, higher
    levels are progressively broader fallbacks — or (None, None)."""
    levels = _generalize(population)
    for level_idx, level_population in enumerate(levels):
        norm = db.get_current_norm(metric, level_population)
        if norm and norm["expected_distribution"].get("sample_size", 0) >= min_sample_size:
            return norm, level_idx
    for level_idx, level_population in enumerate(levels):
        norm = db.get_current_norm(metric, level_population)
        if norm:
            return norm, level_idx
    return None, None


def _confidence_components(sample_size: int, source_count: int, specificity_level: int,
                            source_agreement: float, data_quality: float = 0.9) -> dict:
    """Deterministic decomposition — the model may explain a confidence
    score but must never invent one. Every component is a plain function of
    inputs already computed elsewhere (oracle consensus, sample counts)."""
    return {
        "sample_adequacy": round(min(sample_size / 200.0, 1.0), 2),
        "source_reliability": round(min(source_count / 4.0, 1.0), 2),
        "protocol_comparability": round(max(1.0 - 0.15 * specificity_level, 0.1), 2),
        "recency": 1.0,  # every norm here is freshly resolved; would decay with valid_from age otherwise
        "source_agreement": round(source_agreement, 2),
        "data_quality": round(data_quality, 2),
    }


def _overall_confidence(components: dict) -> float:
    # Geometric mean, not a straight product — one weak component (e.g. a
    # single small source) shouldn't crater confidence to near zero the way
    # multiplying six sub-1.0 factors together would.
    vals = list(components.values())
    product = 1.0
    for v in vals:
        product *= v
    return round(product ** (1.0 / len(vals)), 2)


def resolve_and_register(oracle_type: str, metric: str, population: dict) -> dict:
    """Full pipeline: resolve via the Oracle Agent (or reuse its cached
    instance), decompose confidence, and register/version the norm — create
    if none exists yet, revise if the value moved materially, retain (no
    new version written) if it's within noise of the current one."""
    oracle_res = oracle_engine.resolve_oracle(oracle_type, population)
    if oracle_res["status"] != "ok":
        return {"status": "error", "error": oracle_res.get("error", "oracle resolution failed")}

    inst = oracle_res["instance"]
    consensus = inst["consensus"]
    sources = inst["sources"]
    total_n = sum(max(s.get("n", 0), 1) for s in sources)

    spread = consensus["ci_high"] - consensus["ci_low"]
    source_agreement = min(max(1.0 - (spread / max(consensus["value"], 1e-6)), 0.0), 1.0) if consensus["value"] else 0.5

    distribution = {
        "median": consensus["value"], "ci_low": consensus["ci_low"], "ci_high": consensus["ci_high"],
        "sample_size": total_n, "method": consensus.get("method"),
    }
    components = _confidence_components(total_n, len(sources), 0, source_agreement)
    confidence = _overall_confidence(components)

    existing = db.get_current_norm(metric, population)
    if existing is None:
        action = "create"
    else:
        prev_median = existing["expected_distribution"].get("median") or 1e-9
        delta = abs(distribution["median"] - prev_median) / abs(prev_median)
        action = "revise" if delta >= MATERIALITY_THRESHOLD else "retain"

    if action == "retain":
        return {"status": "ok", "action": "retain", "norm": existing}

    norm = db.create_norm_version(
        metric, population, distribution,
        comparison_rules={"direction": "context_dependent"},
        source_ids=[inst["id"]], confidence=confidence, confidence_components=components,
        approval_status="auto_published" if confidence >= 0.6 else "pending_review",
    )
    return {"status": "ok", "action": action, "norm": norm}


def compare_to_norm(value: float, metric: str, population: dict, sample_size: int) -> dict:
    """Deterministic comparison of an observed value against the current
    (hierarchically-resolved) norm — the "what is normal / how far off are
    we" answer a dashboard or narrative actually needs."""
    norm, level = find_norm(metric, population)
    if norm is None:
        return {"status": "no_norm", "matched_norm": None}

    dist = norm["expected_distribution"]
    median = dist.get("median")
    absolute_delta = round(value - median, 3) if median is not None else None
    relative_delta = round(absolute_delta / median, 3) if median else None
    classification = "at_expected"
    if median is not None:
        if value > dist.get("p75", median * 1.25):
            classification = "above_expected"
        elif value < dist.get("p25", median * 0.75):
            classification = "below_expected"

    limitations = []
    if level and level > 0:
        limitations.append(f"Matched a broader population scope (fallback level {level}) — "
                            f"no norm existed for the exact requested population.")
    if sample_size < MIN_SAMPLE_SIZE:
        limitations.append(f"Observed sample size ({sample_size}) is small relative to the norm's reference population.")

    return {
        "status": "ok", "matched_norm": norm, "specificity_level": level,
        "comparison": {"absolute_delta": absolute_delta, "relative_delta": relative_delta, "classification": classification},
        "limitations": limitations,
    }


def approve(nid: str):
    db.approve_norm(nid)


def list_all_current() -> list:
    return db.list_all_current_norms()


def get_version_history(metric: str, population: dict) -> list:
    return db.list_norm_versions(metric, population)
