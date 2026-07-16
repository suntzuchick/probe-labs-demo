"""
Oracle layer — external ground truth, plural and typed, population-scoped.

Core distinction the whole UI has to honor (spec §3.1):
  Index  = from inside the corpus. Exact, recomputes when new trials land.
  Oracle = from outside the trial. Attested, disagreeing, must be pinned.

An oracle TYPE (background_rate, standard_of_care, ...) is a function of a
population (indication, line, age_band, ...). Resolving an INSTANCE of a type
for a given population asks Claude for known published estimates — this is
"Claude-recalled" knowledge, not a live database query, and every resolved
value is tagged provenance="claude_recalled" so the UI can render the
"verify before real use" notice the spec requires (§3.3, non-negotiable).

The oracle never collapses to one number without showing its parts: every
resolved instance keeps its individual sources (name, pub date, N, value, CI,
weight) alongside the consensus.
"""

import time

import db
import llm_client

ORACLE_TYPES = {
    "background_rate": {
        "label": "Background rate",
        "unit": "%",
        "population_schema": ["condition", "population", "metric"],
        "prompt": (
            "known published incidence/background rates of {metric} in {population}, from real "
            "registries, cohort studies, industry benchmarks, or other named published sources in "
            "whatever domain {metric} and {population} actually describe"
        ),
    },
    "standard_of_care": {
        "label": "Standard of care / established baseline",
        "unit": "months",
        "population_schema": ["condition", "population", "metric"],
        "prompt": (
            "published standard-of-care or established-baseline outcomes for {metric} in "
            "{population} with {condition}, from published studies, meta-analyses, or industry "
            "reports in whatever domain this describes"
        ),
    },
    "population_norms": {
        "label": "Population norms",
        "unit": "",
        "population_schema": ["metric", "population"],
        "prompt": (
            "reference range / normal or typical population values for {metric} in {population}, "
            "from standard reference sources appropriate to this domain (e.g. clinical reference "
            "ranges if this is biomedical, industry benchmark reports if this is commercial/operational)"
        ),
    },
    "reference_annotation": {
        "label": "Reference annotation",
        "unit": "",
        "population_schema": ["entity", "metric"],
        "prompt": (
            "canonical reference annotation for {entity} ({metric}), from standard reference "
            "databases or authoritative catalogs appropriate to whatever kind of entity this is"
        ),
    },
    "regulatory_precedent": {
        "label": "Regulatory / policy precedent",
        "unit": "",
        "population_schema": ["condition", "metric"],
        "prompt": (
            "regulatory or policy precedent/threshold for {metric} relevant to {condition}, from "
            "public regulatory decisions, guidance, or governing-body rulings in whatever domain "
            "this actually falls under"
        ),
    },
    "prior_art": {
        "label": "Prior art / precedent",
        "unit": "",
        "population_schema": ["condition", "metric"],
        "prompt": (
            "prior art / approaches already tried for {metric} in {condition}, from public "
            "registries, case studies, or published precedent in whatever domain this describes"
        ),
    },
}

RESOLVE_SYSTEM = """You are the Oracle Agent. You recall known PUBLISHED estimates relevant to a
requested population/metric — you are not querying a live database, you are recalling what you
know from training data about real published sources.

The topic below can be from ANY domain — clinical/biomedical, commercial, financial, operational,
academic, or otherwise. Infer the domain from the topic text itself and recall real named sources
that actually belong to THAT domain (e.g. a clinical topic calls for registries/cohort studies/
trials; a retail or product topic calls for industry benchmark reports, published surveys, or
named studies from that industry) — never default to clinical/biomedical sources for a non-clinical
topic just because that's a common shape for this kind of request.

Respond with ONLY a JSON array of 2-4 sources, each:
{"source": "<short name of a real, named source appropriate to this topic's domain>",
 "pub_year": <int>, "n": <int, approx sample/cohort size>,
 "value": <float>, "ci_low": <float>, "ci_high": <float>}

Rules:
- Only include sources you actually have some basis for recalling as real (named registries,
  named studies, named industry reports, named databases). Do not invent implausible names.
- "value", "ci_low", "ci_high" MUST be on a 0-100 PERCENTAGE scale (e.g. 22.4 for 22.4%),
  never a 0-1 proportion (never 0.224).
- Values must be internally consistent (ci_low <= value <= ci_high).
- An approximate/general published estimate for a broader but clearly related population is a
  GOOD answer — real published sources are never an exact population match, and reporting the
  closest real one you know of (with its own real N and CI) is the honest answer, not a decline.
- Only return an empty array [] if you cannot recall ANY real source in the general topic area at
  all — reserve this for genuinely obscure or fabricated-sounding requests, not merely inexact ones.
- No prose outside the JSON array.
- Never use an em dash, en dash, or double hyphen in the "source" name; use a comma or parentheses instead."""


def resolve_oracle(oracle_type: str, population_args: dict, force: bool = False) -> dict:
    """Resolve (or return the cached instance for) an oracle type + population.

    Returns {status: "ok", instance: {...}} or {status: "error", error: str}.
    """
    if oracle_type not in ORACLE_TYPES:
        return {"status": "error", "error": f"unknown oracle_type {oracle_type!r}"}

    if not force:
        existing = db.find_oracle_instance(oracle_type, population_args)
        if existing:
            return {"status": "ok", "instance": existing}

    spec = ORACLE_TYPES[oracle_type]
    try:
        topic = spec["prompt"].format(**{k: population_args.get(k, "the relevant population") for k in spec["population_schema"]})
    except Exception:
        topic = spec["prompt"]

    clnt, err = llm_client.client()
    if err:
        return {"status": "error", "error": err}

    try:
        text = llm_client.call(
            clnt, RESOLVE_SYSTEM,
            [{"role": "user", "content": f"Topic: {topic}"}],
            max_tokens=1024,
        )
    except Exception as e:
        return {"status": "error", "error": f"Oracle Agent call failed: {e}"}

    sources = llm_client.extract_json_list(text)
    if sources is None:
        print(f"[oracle_engine] unparseable sources response: {text[:2000]}")
        return {"status": "error", "error": "Oracle Agent's response didn't parse as expected. Try again."}

    clean_sources = []
    for s in sources:
        if not isinstance(s, dict) or "source" not in s or "value" not in s:
            continue
        value = float(s["value"])
        ci_low = float(s.get("ci_low", s["value"]))
        ci_high = float(s.get("ci_high", s["value"]))
        # Belt-and-suspenders: the prompt requires a 0-100 scale, but models
        # don't always follow scale instructions exactly. A source whose
        # value and both CI bounds are all <= 1 is almost certainly a 0-1
        # proportion that slipped through — rescale rather than silently
        # mixing scales with sources that did come back as percentages.
        if value <= 1 and ci_low <= 1 and ci_high <= 1:
            value, ci_low, ci_high = value * 100, ci_low * 100, ci_high * 100
        clean_sources.append({
            "source": s["source"], "pub_year": s.get("pub_year"),
            "n": s.get("n", 0), "value": value, "ci_low": ci_low, "ci_high": ci_high,
        })

    if not clean_sources:
        return {"status": "error", "error": "Oracle Agent found no sources it was confident recalling for this population."}

    consensus = compute_consensus(clean_sources)
    instance = db.create_oracle_instance(oracle_type, population_args, clean_sources, consensus, provenance="claude_recalled")
    return {"status": "ok", "instance": instance}


def compute_consensus(sources: list) -> dict:
    """Deterministic — no LLM. Weighted mean by N; interval SPANS the union of
    source CIs (never shrinks them), so real cross-source disagreement stays visible."""
    total_n = sum(max(s.get("n", 0), 1) for s in sources)
    weighted_val = sum(s["value"] * max(s.get("n", 0), 1) for s in sources) / total_n
    lo = min(s["ci_low"] for s in sources)
    hi = max(s["ci_high"] for s in sources)
    for s in sources:
        s["weight"] = round(max(s.get("n", 0), 1) / total_n, 3)
    return {"value": round(weighted_val, 2), "ci_low": round(lo, 2), "ci_high": round(hi, 2), "method": "n-weighted mean; interval spans source CIs"}


def get_instance(oid: str):
    return db.get_oracle_instance(oid)


def pin(oid: str) -> dict:
    inst = db.get_oracle_instance(oid)
    if inst is None:
        return {"status": "error", "error": "unknown oracle instance"}
    lockfile = {
        "oracle_instance_id": oid, "oracle_type": inst["oracle_type"],
        "value": inst["consensus"]["value"], "ci_low": inst["consensus"]["ci_low"],
        "ci_high": inst["consensus"]["ci_high"], "source_count": len(inst["sources"]),
        "pinned_at": time.time(),
    }
    db.update_oracle_instance(oid, pinned=lockfile)
    return {"status": "ok", "lockfile": lockfile}


def inject_drift_source(oid: str, source: dict | None = None) -> dict:
    """Demo hook: append a new (synthetic-labeled) source, recompute consensus,
    diff against the pin, and report which persisted panels/dashboards cited
    this instance so the frontend knows what to mark stale + re-run."""
    inst = db.get_oracle_instance(oid)
    if inst is None:
        return {"status": "error", "error": "unknown oracle instance"}

    if source is None:
        base = inst["consensus"]
        spread = max((base["ci_high"] - base["ci_low"]) * 0.35, 1.0)
        source = {
            "source": "new registry (simulated)", "pub_year": time.gmtime().tm_year,
            "n": int(max(s.get("n", 0) for s in inst["sources"]) * 1.4) if inst["sources"] else 1000,
            "value": round(base["value"] + spread, 2),
            "ci_low": round(base["value"] + spread * 0.6, 2),
            "ci_high": round(base["value"] + spread * 1.4, 2),
            "fresh": True,
        }
    sources = inst["sources"] + [source]
    new_consensus = compute_consensus(sources)
    db.update_oracle_instance(oid, sources=sources, consensus=new_consensus, drifted=True)

    old_val = (inst["pinned"] or inst["consensus"])["value"]
    affected = db.panels_citing_oracle(oid)
    return {
        "status": "ok",
        "instance": db.get_oracle_instance(oid),
        "delta": round(new_consensus["value"] - old_val, 2),
        "affected_panels": affected,
        "affected_dashboard_ids": sorted({p["dashboard_id"] for p in affected}),
    }


def reset(oid: str) -> dict:
    inst = db.get_oracle_instance(oid)
    if inst is None:
        return {"status": "error", "error": "unknown oracle instance"}
    if not inst["pinned"]:
        return {"status": "error", "error": "instance was never pinned"}
    original_sources = inst["sources"][:-1] if inst["drifted"] else inst["sources"]
    consensus = compute_consensus(original_sources) if original_sources else inst["consensus"]
    db.update_oracle_instance(oid, sources=original_sources, consensus=consensus, drifted=False)
    return {"status": "ok", "instance": db.get_oracle_instance(oid)}


def refusal_check(oracle_type: str, population_args: dict, requested_population: dict) -> dict | None:
    """Population-mismatch refusal (spec §3.3, stated even if not demoed live):
    if a caller asks for a population that doesn't match what the instance was
    resolved for, the oracle declines rather than silently answering wrong."""
    if oracle_type not in ORACLE_TYPES:
        return {"status": "error", "error": f"unknown oracle_type {oracle_type!r}"}
    schema = ORACLE_TYPES[oracle_type]["population_schema"]
    for key in schema:
        if requested_population.get(key) and population_args.get(key) and requested_population[key] != population_args[key]:
            return {
                "status": "declined",
                "error": f"population mismatch on {key!r}: instance resolved for "
                         f"{population_args.get(key)!r}, requested {requested_population.get(key)!r}. "
                         f"Oracle declines rather than answering for the wrong population.",
            }
    return None
