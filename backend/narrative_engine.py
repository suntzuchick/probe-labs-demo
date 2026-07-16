"""
Narrative engine — one narrative = prose + 2-3 escalating dashboards
(OBSERVATION -> THE TURN -> VERDICT), spec §5.

Doesn't touch dashboard_engine.py's single-dashboard primitives
(generate_hypotheses/generate_copilot/build_and_run) — it orchestrates them:

  OBSERVATION - up to 2 real Copilot-generated panels from the strongest
                grounded hypotheses. Inside-the-trial only; never touches
                an oracle.
  THE TURN    - an Oracle Agent resolution (spec's population-scoped
                external ground truth) rendered as a forest-plot panel,
                plus a deterministic excess-risk panel (trial stat minus
                oracle consensus, with the propagated CI) - no LLM call,
                pure arithmetic over numbers already computed.
  VERDICT     - one more real Copilot panel framed against the dataset's
                known risks/confounders when a further grounded hypothesis
                exists, plus a deterministic attribution verdict panel that
                always renders (CI excludes zero -> attributable) so a
                narrative never dead-ends for a thin dataset.

Every external number traces to an oracle_instance_id; every internal number
traces to the dashboard-1 stat it came from - no orphan numbers (spec §5.2).
"""

import re
import time

import db
import dashboard_engine
import oracle_engine
import evidence
import llm_client
import hypothesis_registry

# Unambiguous rate/percentage signals in a key name.
STRONG_RATE_HINTS = ("rate", "pct", "percent", "proportion", "prevalence", "incidence")
# "grade" alone is a weak signal — a real Code Builder response typically has
# BOTH "N_grade3plus_CHEMO" (a count) and "pct_grade3plus_CHEMO" (the actual
# percentage) in the same stats dict, and "grade" matches both. Only fall
# back to this tier if no strong-hint key exists, and even then exclude
# count-shaped keys.
WEAK_RATE_HINTS = ("grade",)
# Underscore-separated tokens that mark a key as a COUNT, not a rate, even
# when it also contains a rate hint (e.g. "N_grade3plus_CHEMO").
COUNT_KEY_TOKENS = {"n", "count", "counts", "events", "total", "subjects", "wells"}
# Words a real question about a rate is likely to use — gates the active
# fallback hypothesis search in generate_narrative below, separate from the
# stat-key hints above.
RATE_QUESTION_HINTS = ("rate", "%", "grade", "toxicity", "response", "incidence", "adverse", "discontinu")


def _is_count_key(key: str) -> bool:
    return bool(set(key.lower().split("_")) & COUNT_KEY_TOKENS)


def _pick_rate_stat(stats: dict):
    """Only a stat whose KEY unambiguously reads as a rate/percentage — no
    blind numeric-range fallback (a real Code Builder response mixes in
    plenty of other 0-100-range numbers that aren't rates: event counts out
    of ~100 subjects, hazard ratios, months-to-event, small p-values)."""
    for k, v in stats.items():
        if isinstance(v, (int, float)) and any(h in k.lower() for h in STRONG_RATE_HINTS) and not _is_count_key(k) and 0 <= v <= 100:
            return k, float(v)
    for k, v in stats.items():
        if isinstance(v, (int, float)) and any(h in k.lower() for h in WEAK_RATE_HINTS) and not _is_count_key(k) and 0 <= v <= 100:
            return k, float(v)
    return None, None


def _population_hint(understanding: dict) -> tuple[str, str]:
    """Returns (condition, population) as plain natural-language phrases.

    Empirically confirmed (not just a guess): passing internal ARM codes and
    SDTM/ADaM technical labels (e.g. "treatment arms: CHEMO, DARA; study
    type: clinical_trial_adam") to the Oracle Agent reliably produces a
    decline — published literature isn't indexed by trial-internal jargon,
    so it reads as an unanswerable, overly-specific population rather than a
    real one. A plain phrase like "patients in a cancer clinical trial"
    succeeds where the jargon-heavy version doesn't."""
    entities = set(understanding.get("entities", []))
    if {"response", "biomarker", "adverse_event"} & entities:
        return "oncology", "patients in a cancer clinical trial"
    if str(understanding.get("dataset_type", "")).startswith("clinical_trial"):
        return "the relevant condition", "patients in a clinical trial"
    return "the relevant condition", "the population studied in this dataset"


# Short, canonical phrases for common clinical rate concepts — checked
# before falling back to a stripped-down version of the full question.
# Confirmed empirically: a clean 2-4 word phrase like "grade 3 or higher
# adverse events" resolves; a long compound clause built by naively
# stripping the leading question word (e.g. "proportion of subjects per arm
# experienced Grade 3+ adverse events") reads as too specific/ungrammatical
# and reliably declines, even though it says the same thing.
_CANONICAL_METRIC_PHRASES = (
    (("grade", "adverse"), "grade 3 or higher adverse events"),
    (("serious", "adverse"), "serious adverse events"),
    (("discontinu",), "treatment discontinuation"),
    (("response",), "objective tumor response"),
    (("adverse",), "adverse events"),
)


def _clean_metric_phrase(question: str) -> str:
    """Natural-language metric phrase for the Oracle Agent, derived from the
    hypothesis's own question text (already natural language) rather than
    the stats key (which carries jargon like a trailing arm-code token)."""
    ql = question.lower()
    for words, phrase in _CANONICAL_METRIC_PHRASES:
        if all(w in ql for w in words):
            return phrase
    q = re.sub(r"^(what|how|which|is|are|does|do)\b\s*", "", question.strip(), flags=re.IGNORECASE)
    return q.rstrip("?").strip() or question


def resolve_evidence_benchmark(sid: str, dataset_version_id: str | None, question: str, stats: dict,
                                understanding: dict, oracle_type: str = "background_rate") -> dict:
    """Given one already-computed analysis's stats, find a rate-like metric,
    ask the Oracle Agent for outside published sources, compute the excess
    between the trial value and the outside consensus, and record the result
    as a formal, independently-reviewable evidence row (kind=norm_comparison).

    This is the same arithmetic as generate_narrative's internal "Turn"
    section, exposed standalone so the Evidence stage can run it per-analysis
    on demand instead of only ever seeing it bundled inside a full narrative.
    Never raises — every path returns a status the caller can log."""
    metric_key, trial_value = _pick_rate_stat(stats)
    if metric_key is None:
        return {"status": "no_metric", "question": question}

    condition_hint, population_hint = _population_hint(understanding)
    population_args = {
        "condition": condition_hint, "population": population_hint,
        "metric": _clean_metric_phrase(question),
    }
    oracle_res = oracle_engine.resolve_oracle(oracle_type, population_args)
    if oracle_res["status"] != "ok":
        return {
            "status": "declined", "question": question, "metric": metric_key,
            "reason": oracle_res.get("error", "no confident external sources found."),
        }

    inst = oracle_res["instance"]
    consensus = inst["consensus"]
    excess_val = round(trial_value - consensus["value"], 2)
    excess_lo = round(trial_value - consensus["ci_high"], 2)
    excess_hi = round(trial_value - consensus["ci_low"], 2)
    excess = {"value": excess_val, "ci_low": excess_lo, "ci_high": excess_hi, "attributable": excess_lo > 0}

    claim = (
        f"{metric_key} in this dataset ({trial_value}) vs. {len(inst['sources'])} outside source(s) "
        f"({consensus['value']} [{consensus['ci_low']}, {consensus['ci_high']}]): " + (
            f"excess of {excess_val:+.1f} pts is attributable beyond outside baseline."
            if excess["attributable"] else
            f"excess interval [{excess_lo}, {excess_hi}] spans zero — not attributable."
        )
    )
    limitations = [] if excess["attributable"] else ["Excess interval spans zero — cannot claim attribution beyond chance."]
    ev = evidence.from_norm_comparison(
        sid, dataset_version_id, claim,
        values={"trial_metric": metric_key, "trial_value": trial_value, "oracle_consensus": consensus, "excess": excess},
        reference_norm_id=inst["id"],
        confidence=0.75 if excess["attributable"] else 0.4,
        limitations=limitations,
    )
    return {
        "status": "ok", "question": question, "metric": metric_key, "trial_value": trial_value,
        "oracle_instance_id": inst["id"], "source_count": len(inst["sources"]), "sources": inst["sources"],
        "consensus": consensus, "excess": excess, "evidence_id": ev["id"], "claim": claim,
    }


THESIS_SYSTEM = """You write a single sharp thesis-question sentence (like a magazine headline
posed as a question, under 12 words) for a data narrative, given the analysis question and its
computed stats. Respond with plain text only, no quotes, no markdown.""" + llm_client.NO_DASH_STYLE


def _thesis(clnt, question: str, stats: dict) -> str:
    if clnt is None:
        return question
    try:
        text = llm_client.call(clnt, THESIS_SYSTEM,
                                [{"role": "user", "content": f"Question: {question}\nStats: {stats}"}],
                                max_tokens=60)
        return llm_client.dedash(text.strip().strip('"'))
    except Exception:
        return question


STORY_SYSTEM = """You are the Narrative Agent's storytelling voice — the piece that turns a stack of
computed panels into something a person actually wants to read. You are not writing another chart
caption; you are writing the feature-length version: 3-5 real paragraphs that a sharp analyst or a
science journalist would be proud of, built entirely from the numbers you're given below.

Ground rules:
- Every number, direction, and comparison you write must come from what's given below. Never invent
  a statistic, a source, or a value that isn't there.
- Open with the tension the data actually contains — the interesting question, the surprising result,
  the thing worth explaining — not a restatement of "we analyzed the following data."
- Weave in QUALITATIVE observations, not just numbers: what does this pattern suggest, what's
  plausible as an explanation, what should a reader be skeptical of, what would you want to know
  next. Number-crunching lives in the panels; meaning-making lives here.
- If outside sources were checked, treat that comparison as a real turn in the story — the moment
  the claim gets tested against the world outside this dataset, not just another paragraph.
- Land on the verdict honestly — what can and can't be claimed, stated plainly, no hedge-everything
  academic throat-clearing.
- Write like a person, not a report generator. Vary sentence length. Plain prose only, no bullet
  points, no headers, no markdown.
- Length: 3-5 paragraphs, roughly 250-450 words total. This is deliberately the longest, richest
  text in the whole product — earn the length.
""" + llm_client.NO_DASH_STYLE


def _story(clnt, thesis: str, obs_panels: list, turn_dashboard: dict | None,
           verdict_take: str, understanding: dict) -> str | None:
    if clnt is None:
        return None
    obs_summary = "\n".join(
        f"- {p['title']}: {p.get('sub', '')} — {p.get('narrative', '')}"
        for p in obs_panels
    )
    turn_summary = f"\nOutside-source comparison: {turn_dashboard['take']}" if turn_dashboard and turn_dashboard.get("take") else ""
    context = (
        f"Dataset type: {understanding.get('dataset_type')}\n"
        f"Thesis: {thesis}\n\n"
        f"Observation panels:\n{obs_summary}\n"
        f"{turn_summary}\n"
        f"\nVerdict: {verdict_take}"
    )
    try:
        text = llm_client.call(clnt, STORY_SYSTEM, [{"role": "user", "content": context}], max_tokens=900)
        return llm_client.dedash(text.strip())
    except Exception:
        return None


def generate_narrative(sid: str, sess: dict, sdir: str, dfs: dict, understanding: dict, schema_index: dict,
                        dataset_fingerprint: str | None = None, dataset_version_id: str | None = None,
                        enable_oracles: bool = True) -> dict:
    hyp_result = dashboard_engine.generate_hypotheses(understanding, schema_index, dfs)
    if hyp_result["status"] != "ok":
        return {"status": "error", "error": hyp_result["error"]}

    grounded = [h for h in hyp_result["hypotheses"] if h.get("grounded")]
    if not grounded:
        return {"status": "error", "error": "Hypothesis Agent found no grounded questions for this dataset."}

    narrative_id = db.new_id("narr")
    dashboards = []
    used = []

    # ---- OBSERVATION -------------------------------------------------
    # Several panels, not one or two — a narrative citing a single graph
    # isn't really a narrative, it's a screenshot with a caption.
    obs_panels = []
    obs_stats_all = []  # every computed panel's stats, so oracle-grounding can scan all of them
    for h in grounded[:3]:
        res = dashboard_engine.get_or_build_artifact(sess, sdir, dataset_fingerprint, h["question"], understanding,
                                                       schema_index, required_fields=h.get("required_fields"),
                                                       chart_type=h.get("chart_type"), source="narrative",
                                                       sid=sid, dataset_version_id=dataset_version_id)
        if res["status"] != "ok":
            continue
        artifact = res["dashboard"]
        used.append(h)
        obs_panels.append({
            "panel_id": db.new_id("panel"), "type": "chart", "title": artifact["title"], "sub": f"N={artifact['stats'].get('N', '—')}",
            "chart_type": artifact["chart_type"], "encoding": artifact["encoding"], "vega_spec": artifact["vega_spec"],
            "data": artifact["data"], "stats": artifact["stats"], "code": artifact["code"],
            "narrative": artifact["narrative"], "caveats": artifact["caveats"], "evidence_id": artifact.get("evidence_id"),
            "oracle_citations": [], "index_citations": [f"schema.{f}" for f in h.get("required_fields", [])],
        })
        obs_stats_all.append((h["question"], artifact["stats"]))

    if not obs_panels:
        return {"status": "error", "error": "Could not compute any grounded panel for the observation dashboard."}

    obs_stats_for_oracle = obs_stats_all[0][1]
    clnt, _ = llm_client.client()
    thesis = _thesis(clnt, used[0]["question"], obs_stats_for_oracle)

    dashboards.append({
        "dashboard_id": db.new_id("dash"), "stage": "observation", "title": "Dashboard 1",
        "question": "What we observed", "panels": obs_panels, "oracle_citations": [],
        "status": "publish", "take": obs_panels[0]["title"] + " — computed directly from the trial data.",
    })

    # ---- THE TURN ------------------------------------------------------
    # Only runs when the session has oracles switched on (spec's outside-
    # research benchmark step is a later act of the demo, not universal —
    # a single-file/no-oracle session should never see external references
    # in its evidence, not even a "declined" placeholder dashboard).
    turn_dashboard = None
    excess = None
    metric_key = trial_value = None
    candidates = []

    if enable_oracles:
        # Collect every rate-like candidate across ALL observation panels (not
        # just the first) and try the Oracle Agent on each in turn — a single
        # decline (spec §3.3's honest refusal-on-low-confidence path) shouldn't
        # end the search when a second, more answerable metric exists.
        for question, stats in obs_stats_all:
            k, v = _pick_rate_stat(stats)
            if k is not None:
                candidates.append((question, k, v))

        # The top-2 hypotheses used for the observation dashboard aren't picked
        # for being rate-shaped — they're just the strongest grounded questions,
        # which might all be about survival, hazard ratios, etc. If none of them
        # produced a genuine rate stat, actively compute a few more hypotheses
        # that look rate-worthy by their own question text, purely to give the
        # Oracle Agent more than one real thing to try (a single decline is
        # expected sometimes — see _clean_metric_phrase — so more candidates
        # means more chances one is answerable).
        if not candidates:
            for h in grounded:
                if len(candidates) >= 3:
                    break
                if h in used or not any(w in h["question"].lower() for w in RATE_QUESTION_HINTS):
                    continue
                res = dashboard_engine.get_or_build_artifact(sess, sdir, dataset_fingerprint, h["question"], understanding,
                                                               schema_index, required_fields=h.get("required_fields"),
                                                               chart_type=h.get("chart_type"), source="narrative",
                                                               sid=sid, dataset_version_id=dataset_version_id)
                if res["status"] != "ok":
                    continue
                artifact = res["dashboard"]
                k, v = _pick_rate_stat(artifact["stats"])
                if k is not None:
                    candidates.append((h["question"], k, v))

        last_decline_reason = None
        condition_hint, population_hint = _population_hint(understanding)

        # Ground against every candidate that resolves, not just the first —
        # a narrative that only ever cites one outside source isn't really
        # checking itself against "the outside world", it's checking itself
        # against one paper. Capped at 3 so this doesn't turn into an
        # unbounded run of Oracle Agent calls.
        turn_panels = []
        all_oracle_ids = []
        resolved = []  # [(metric_key, trial_value, inst, excess)]
        for source_question, cand_metric, cand_value in candidates:
            if len(resolved) >= 3:
                break
            population_args = {
                "condition": condition_hint,
                "population": population_hint,
                "metric": _clean_metric_phrase(source_question),
            }
            oracle_res = oracle_engine.resolve_oracle("background_rate", population_args)
            if oracle_res["status"] != "ok":
                last_decline_reason = oracle_res.get("error", "no confident sources for this population.")
                continue

            inst = oracle_res["instance"]
            oid = inst["id"]
            consensus = inst["consensus"]
            excess_val = round(cand_value - consensus["value"], 2)
            excess_lo = round(cand_value - consensus["ci_high"], 2)
            excess_hi = round(cand_value - consensus["ci_low"], 2)
            excess = {"value": excess_val, "ci_low": excess_lo, "ci_high": excess_hi, "attributable": excess_lo > 0}
            resolved.append((cand_metric, cand_value, inst, excess))
            all_oracle_ids.append(oid)

            turn_panels.append(
                {"panel_id": db.new_id("panel"), "type": "oracle", "title": f"Oracle feed · {cand_metric}",
                 "sub": f"{len(inst['sources'])} attested sources", "oracle_instance_id": oid,
                 "trial_metric": cand_metric, "trial_value": cand_value,
                 "oracle_citations": [oid], "index_citations": []})
            turn_panels.append(
                {"panel_id": db.new_id("panel"), "type": "excess", "title": f"Excess after subtraction · {cand_metric}",
                 "sub": "trial vs oracle", "oracle_instance_id": oid, "trial_metric": cand_metric,
                 "trial_value": cand_value, "excess": excess,
                 "oracle_citations": [oid], "index_citations": []})

        if resolved:
            # The top-level "Attribution verdict" panel still needs one
            # headline metric — the first one resolved, which is the
            # strongest/first-ranked candidate — but every source found
            # along the way stays cited on the dashboard and in the verdict.
            metric_key, trial_value, primary_inst, excess = resolved[0]
            primary_consensus = primary_inst["consensus"]
            n_sources_total = sum(len(inst["sources"]) for _, _, inst, _ in resolved)
            turn_dashboard = {
                "dashboard_id": db.new_id("dash"), "stage": "turn", "title": "Dashboard 2",
                "question": f"What do outside sources say about {len(resolved)} metric(s) from this trial?",
                "panels": turn_panels, "oracle_citations": all_oracle_ids,
                "status": "review" if not excess["attributable"] else "publish",
                "take": (f"Checked {len(resolved)} metric(s) against {n_sources_total} outside source(s) total. "
                         f"Lead metric ({metric_key}): sources span {primary_consensus['ci_low']}, {primary_consensus['ci_high']}%. "
                         f"The disagreement is real uncertainty."),
            }
            dashboards.append(turn_dashboard)

        if turn_dashboard is None:
            # Either every candidate was declined, or no rate-like metric existed
            # at all — surfaced, not silent, so this is diagnosable instead of
            # the dashboard just vanishing without a trace.
            if candidates:
                take = f"Oracle Agent declined on all {len(candidates)} candidate metric(s): {last_decline_reason}"
            else:
                take = f"No rate-like metric was found in this narrative's computed stats to ground externally. Stats seen: {obs_stats_for_oracle}"
            dashboards.append({
                "dashboard_id": db.new_id("dash"), "stage": "turn", "title": "Dashboard 2",
                "question": "What is the background rate outside this trial?",
                "panels": [], "oracle_citations": [], "status": "review", "take": take,
            })

    # ---- VERDICT ---------------------------------------------------------
    verdict_panels = []
    remaining = [h for h in grounded if h not in used][:2]
    for h in remaining:
        risk_adjusted_question = (
            f"{h['question']} (adjusting for known risks: "
            f"{'; '.join(understanding.get('risks', [])) or 'none flagged'})"
        )
        res = dashboard_engine.get_or_build_artifact(sess, sdir, dataset_fingerprint, risk_adjusted_question,
                                                       understanding, schema_index, required_fields=h.get("required_fields"),
                                                       chart_type=h.get("chart_type"), source="narrative",
                                                       sid=sid, dataset_version_id=dataset_version_id)
        if res["status"] == "ok":
            artifact = res["dashboard"]
            verdict_panels.append({
                "panel_id": db.new_id("panel"), "type": "chart", "title": artifact["title"], "sub": f"N={artifact['stats'].get('N', '—')}",
                "chart_type": artifact["chart_type"], "encoding": artifact["encoding"], "vega_spec": artifact["vega_spec"],
                "data": artifact["data"], "stats": artifact["stats"], "code": artifact["code"],
                "narrative": artifact["narrative"], "caveats": artifact["caveats"], "evidence_id": artifact.get("evidence_id"),
                "oracle_citations": [], "index_citations": [f"schema.{f}" for f in h.get("required_fields", [])],
            })

    verdict_oracle_citations = turn_dashboard["oracle_citations"] if turn_dashboard else []
    if excess is not None:
        verdict_panels.append({
            "panel_id": db.new_id("panel"), "type": "verdict", "title": "Attribution verdict",
            "sub": f"{metric_key}: trial vs. oracle-adjusted background", "trial_metric": metric_key,
            "trial_value": trial_value, "excess": excess,
            "oracle_citations": verdict_oracle_citations, "index_citations": [],
        })
        verdict_take = (
            f"The excess is attributable — {excess['value']:+.1f} pts [{excess['ci_low']}, {excess['ci_high']}]."
            if excess["attributable"] else
            f"The excess interval straddles zero [{excess['ci_low']}, {excess['ci_high']}] — cannot claim attribution."
        )
        verdict_status = "publish" if excess["attributable"] else "contradicted"
    else:
        verdict_take = "No external oracle was available to ground this metric — verdict rests on internal evidence only."
        verdict_status = "review"

    dashboards.append({
        "dashboard_id": db.new_id("dash"), "stage": "verdict", "title": f"Dashboard {len(dashboards) + 1}",
        "question": "What we can and cannot claim", "panels": verdict_panels,
        "oracle_citations": verdict_oracle_citations, "status": verdict_status, "take": verdict_take,
    })

    overall_status = "contradicted" if verdict_status == "contradicted" else ("review" if any(d["status"] == "review" for d in dashboards) else "publish")

    story = _story(clnt, thesis, obs_panels, turn_dashboard, verdict_take, understanding)

    narrative = {
        "narrative_id": narrative_id, "sid": sid, "thesis": thesis, "story": story,
        "status": overall_status, "is_synthetic": False, "dashboards": dashboards,
        "created_at": time.time(),
    }

    db.save_narrative(sid, narrative)
    for dash in dashboards:
        for i, p in enumerate(dash["panels"]):
            db.save_panel(p["panel_id"], dash["dashboard_id"], i, p, p.get("oracle_citations", []), p.get("index_citations", []))

    # Every narrative's thesis is also a claim in the append-only hypothesis
    # registry (spec §8). No DAG-authoring tool exists in this build, so a
    # narrative never emits a causal claim — the verb detector keeps it
    # honestly associational, or the publish gate would block it.
    hypothesis_registry.publish(sid, thesis, narrative_id=narrative_id, dag=None, q_value=None, is_synthetic=False)

    return {"status": "ok", "narrative": narrative}
