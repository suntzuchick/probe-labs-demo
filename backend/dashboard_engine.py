"""
Stage 7 — Dashboards. Fully agentic: every dashboard is proposed, planned, coded,
narrated, and gated by real LLM calls grounded against the live schema — nothing
here is a fixed template. Mirrors the spec's agent roster:

  Hypothesis Agent   -> over-generates grounded questions from DatasetUnderstanding + schema
  Planner+CodeBuilder-> writes pandas per question, runs in the Stage 6 sandbox, reads errors
                        and self-repairs (capped retries)
  Narrative Agent    -> writes prose constrained to the actual extracted stats
  Evaluator          -> a fresh, separate call (no shared history) gates publish/caveats/review/reject

Caveats (small-N, non-significance, missingness) are computed deterministically from the
executed stats — the LLM cannot omit them, per the spec's "Stats Oracle" rule.

Rendering — the reason this file exists in its current form: a dashboard is not a screenshot
of a notebook cell. The Code Builder never draws a chart; it returns a tidy result table plus
a declared `chart_type` + `encoding` (which columns are x/y/color/tooltip). A deterministic
renderer (vega_builder.py) turns that into a Vega-Lite spec, rendered client-side via
vega-embed — which gives hover tooltips, zoom/pan, and click-to-select for free. The frontend
uses the click selection plus the full row-level `data` returned alongside the spec to let you
drill into exactly which rows produced a given bar/point, and to show/sort the underlying table.
That's the thing a static matplotlib PNG structurally cannot do.

Scope decisions, stated plainly:
  - Evaluator: same model family, a structurally separate call with no shared conversation
    history ("fresh context"), not a second provider — avoids a second API dependency.
  - Generation modes: Copilot (one question -> one dashboard) and Autopilot (hypothesis-driven
    pack, bounded to `limit`). Factory (100+ fan-out with a job queue) and the Add-source /
    reconciliation pipeline are out of scope for this pass.
  - This requires ANTHROPIC_API_KEY. There is no deterministic fallback that quietly stands in
    for the agents — without a key, generation returns a clear error instead of fake dashboards.
"""

import hashlib
import json
import re
import time

import codegen
import db
import model_router
import notebook_engine
import vega_builder
import llm_client

MAX_REPAIR_ATTEMPTS = 2
DEFAULT_AUTOPILOT_LIMIT = 6
MAX_DATA_ROWS = 1000


def _client():
    return llm_client.client()


def _call(client, system: str, messages: list, max_tokens: int = 2048) -> str:
    return llm_client.call(client, system, messages, max_tokens=max_tokens)


def _extract_json(text: str):
    return llm_client.extract_json(text)


def _extract_json_list(text: str):
    """Like _extract_json, but tolerates the model wrapping the array in an object,
    e.g. {"hypotheses": [...]} despite being told to return a bare array."""
    return llm_client.extract_json_list(text)


def _schema_context(understanding: dict, schema_index: dict) -> str:
    lines = [
        f"Dataset type: {understanding.get('dataset_type')}",
        f"Entities: {', '.join(understanding.get('entities', []))}",
        f"Available metrics: {', '.join(understanding.get('available_metrics', []))}",
        f"Supported analysis families: {', '.join(understanding.get('supported_analyses', []))}",
        f"Unsupported (do not propose): {', '.join(understanding.get('unsupported_analyses', []))}",
    ]
    if understanding.get("risks"):
        lines.append("Known risks: " + "; ".join(understanding["risks"]))
    lines.append("")
    lines.append("Schema (variable.column: dtype, missing%, cardinality, examples):")
    for var, cols in schema_index.items():
        lines.append(f"  {var}:")
        for col, meta in cols.items():
            examples = ", ".join(repr(e) for e in meta.get("examples", [])[:3])
            lines.append(f"    {col} ({meta['dtype']}, missing={meta['missing_pct']}%, card={meta['cardinality']}) — e.g. [{examples}]")
    return "\n".join(lines)


def _fields_present(fields: list, dfs: dict) -> bool:
    for ref in fields:
        if "." not in ref:
            if ref not in dfs:
                return False
            continue
        var, col = ref.split(".", 1)
        if var not in dfs or col not in dfs[var].columns:
            return False
    return True


HYPOTHESIS_SYSTEM = """You are the Hypothesis Agent in a data-analysis dashboard pipeline. The
dataset below can be from any domain — clinical, commercial, operational, scientific, financial,
or otherwise. Ground every question strictly in the "Dataset type", "Entities", "Available
metrics", and "Supported analysis families" given below — never assume clinical/trial framing
(arms, subjects, adverse events, survival) unless the dataset's own profile actually says so.

Given a dataset's capability profile and exact schema, propose dashboard-worthy analysis questions.

Rules:
- Respond with ONLY a JSON array. No prose, no markdown fences needed but allowed.
- Each item: {"question": str, "required_fields": ["var.COLUMN", ...], "chart_type": str, "rationale": str}
- chart_type is one of: line, step, bar, grouped_bar, scatter, histogram, table, forest, waterfall
- required_fields MUST reference only variables and columns that literally appear in the schema given.
- Only propose questions from the "Supported analysis families" list — never from "Unsupported".
- Propose 10-14 diverse, decision-relevant questions. Avoid near-duplicates (e.g. don't propose
  both "rate by group" and "frequency by group" phrased two ways).
- Favor questions where drilling into individual rows behind a bar or point would be genuinely
  useful — this dashboard system supports click-to-drilldown into row-level data.
""" + llm_client.NO_DASH_STYLE


COMPARE_HYPOTHESIS_SYSTEM = """You are the Hypothesis Agent in a data-analysis dashboard pipeline,
working on a MULTI-TRIAL / multi-table dataset — the same shape of tables repeated once per trial,
distinguished by a suffix on each table name (e.g. adsl_a, adsl_b, adsl_c are the SAME table for three
different trials). Your job here is specifically CROSS-TRIAL comparison — every question must reference
tables from at least two different trial suffixes and compare them.

Rules:
- Respond with ONLY a JSON array. No prose, no markdown fences needed but allowed.
- Each item: {"question": str, "required_fields": ["var.COLUMN", ...], "chart_type": str, "rationale": str}
- chart_type is one of: line, step, bar, grouped_bar, scatter, histogram, table, forest, waterfall
- required_fields MUST reference only variables and columns that literally appear in the schema given,
  and MUST include fields from at least two different trial suffixes.
- Only propose questions from the "Supported analysis families" list — never from "Unsupported".
- Propose 8-12 diverse cross-trial questions: does an effect replicate across trials, is a rate
  consistent or does it vary, how do populations/subgroups differ between trials, etc. Never propose a
  question that only needs one trial's data — that belongs to a different, single-trial pass.
""" + llm_client.NO_DASH_STYLE


FOLLOWUP_SYSTEM = """You are the Hypothesis Agent, drilling deeper. A question below has already been
answered — you're given the question and the real stats that were actually computed. Your job is to
propose 1-3 genuine follow-up questions: things a human analyst would naturally ask NEXT after seeing
this specific result — a subgroup breakdown, a plausible confound, a related endpoint, a check on
whether an effect holds within a slice of the data. Never repeat the parent question or a trivial
rephrasing of it.

Rules:
- Respond with ONLY a JSON array (possibly empty if there's genuinely nothing more to ask). No prose.
- Each item: {"question": str, "required_fields": ["var.COLUMN", ...], "chart_type": str, "rationale": str}
- chart_type is one of: line, step, bar, grouped_bar, scatter, histogram, table, forest, waterfall
- required_fields MUST reference only variables and columns that literally appear in the schema given.
- Ground each follow-up in the PARENT RESULT given, not just the schema in the abstract — e.g. if the
  parent found an effect overall, a good follow-up checks whether it holds within a specific subgroup
  the schema actually supports; if the parent flagged a caveat (small N, non-significance), a good
  follow-up investigates that caveat directly.
""" + llm_client.NO_DASH_STYLE


def generate_followups(understanding: dict, schema_index: dict, dfs: dict, parent_question: str,
                        parent_stats: dict, parent_chart_type: str, n: int = 3) -> dict:
    """Tree-shaped investigation, one branch at a time: given a question that's
    already been answered and what was actually found, propose the next
    question(s) a human analyst would ask — grounded in the parent's real
    result, not a blind re-scan of the schema. This is what replaces a static,
    pre-baked "try asking" suggestion list: every suggestion downstream of the
    first pass is conditioned on a real, already-computed finding."""
    client, err = _client()
    if err:
        return {"status": "error", "error": err}

    context = _schema_context(understanding, schema_index)
    user_msg = (
        f"{context}\n\nParent question already answered: {parent_question}\n"
        f"Parent chart type: {parent_chart_type}\nParent stats actually computed: {json.dumps(parent_stats)}\n\n"
        f"Propose up to {n} follow-up questions. Keep each rationale under 15 words."
    )
    try:
        text = _call(client, FOLLOWUP_SYSTEM, [{"role": "user", "content": user_msg}], max_tokens=1536)
    except Exception as e:
        return {"status": "error", "error": f"Hypothesis Agent follow-up call failed: {e}"}

    followups = _extract_json_list(text)
    if followups is None:
        print(f"[dashboard_engine] unparseable followups response: {text[:2000]}")
        return {"status": "error", "error": "Hypothesis Agent's follow-up response didn't parse as expected."}

    out = []
    for h in followups:
        if not isinstance(h, dict) or "question" not in h or "required_fields" not in h:
            continue
        h["question"] = llm_client.dedash(h["question"])
        if h.get("rationale"):
            h["rationale"] = llm_client.dedash(h["rationale"])
        h["grounded"] = _fields_present(h["required_fields"], dfs)
        out.append(h)
    return {"status": "ok", "followups": out}


def generate_hypotheses(understanding: dict, schema_index: dict, dfs: dict, n: int = 14, compare_mode: bool = False) -> dict:
    client, err = _client()
    if err:
        return {"status": "error", "error": err}

    context = _schema_context(understanding, schema_index)
    system = COMPARE_HYPOTHESIS_SYSTEM if compare_mode else HYPOTHESIS_SYSTEM
    try:
        text = _call(client, system,
                     [{"role": "user", "content": context + f"\n\nPropose up to {n} questions. Keep each rationale under 15 words."}],
                     max_tokens=4096)
    except Exception as e:
        return {"status": "error", "error": f"Hypothesis Agent call failed: {e}"}

    hypotheses = _extract_json_list(text)
    if hypotheses is None:
        print(f"[dashboard_engine] unparseable hypotheses response: {text[:2000]}")
        return {"status": "error", "error": "Hypothesis Agent's response didn't parse as expected. Try again."}

    out = []
    for h in hypotheses:
        if not isinstance(h, dict) or "question" not in h or "required_fields" not in h:
            continue
        h["question"] = llm_client.dedash(h["question"])
        if h.get("rationale"):
            h["rationale"] = llm_client.dedash(h["rationale"])
        h["grounded"] = _fields_present(h["required_fields"], dfs)
        out.append(h)
    return {"status": "ok", "hypotheses": out}


CODE_BUILDER_SYSTEM = """You are the Planner + Code Builder for an interactive dashboard pipeline.
You receive a question and the exact schema of available pandas DataFrames. You compute the
analysis, but you NEVER draw a chart — you hand back a tidy result table and a description of how
to plot it, and a separate deterministic renderer builds the actual interactive chart. This means
your job is to get the DATA right (aggregated/tidy, one row per mark that should appear on the
chart), not to produce pixels.

If the schema shows the same table name repeated with different suffixes (e.g. adsl_a, adsl_b,
adsl_c — the same table for different trials/datasets), the question is a CROSS-TRIAL comparison —
your result MUST break the data down per trial suffix (one row/mark per trial, or per trial×group),
never pool them into a single combined total that hides which trial each number came from.

Rules:
1. Respond with ONLY a single Python code block. No prose outside it.
2. Use only variables/columns that appear in the schema given. Never invent columns.
3. Do NOT import or use matplotlib. No plt, no plt.show(), no chart drawing of any kind.
4. Never read/write files, never make network calls, never use os / sys / subprocess / open() / exec() / eval().
5. You may `import json` — pandas, numpy, lifelines, scipy, statsmodels, sklearn are pre-loaded globals.
6. End the code with exactly one line of the form:
   print("__DASHBOARD__", json.dumps({
       "title": "<short declarative NOUN PHRASE naming what this shows, e.g. 'Overall Survival by Treatment Arm' — NEVER phrased as a question>",
       "chart_type": "<one of: line, step, bar, grouped_bar, scatter, histogram, table, forest, waterfall>",
       "encoding": {"x": "<col>", "y": "<col>", "color": "<col or null>", "tooltip": ["<col>", ...], "id": "<col or null>"},
       "data": <list of records — chart_result_df.to_dict(orient="records")>,
       "stats": {"N": <int>, ...other relevant numbers actually computed for THIS question — p-values, rates, medians, whatever applies}
   }))
   "title" is what a person browsing a library of dashboards sees — it names the DATA, like a chart
   caption or a spreadsheet tab name, not the English question you were asked. "Response rate by
   KRAS mutation status" is right; "What is the response rate by KRAS mutation status?" is wrong.
   "data" must be a TIDY table: one row per mark (one row per KM time point per arm, one row per
   subject for a waterfall, one row per SOC x arm for a grouped bar, etc.) — never a wide/pivoted
   table. Prefer including an identifying column (e.g. USUBJID) in "data" even if not the id/x/y
   field, so a person looking at the chart can trace a mark back to a subject or record.
   "stats" must contain only numbers you actually computed — never fabricate one.
7. Worked shapes per chart_type — these illustrate JSON SHAPE only. Field names below (arm, DARA,
   KRAS, USUBJID, SOC, ...) are examples from one past dataset; substitute the real column and
   value names from the actual schema given, whatever domain this dataset is from:
   - step (survival/cumulative curves): data = [{"time": 0, "survival": 1.0, "arm": "DARA"}, ...] one row per
     event time per arm (e.g. from lifelines KaplanMeierFitter().survival_function_.reset_index()).
     encoding = {"x": "time", "y": "survival", "color": "arm", "tooltip": ["time","survival","arm"]}
   - forest (hazard ratio / effect size): data = [{"label": "DARA vs CHEMO", "estimate": 1.04,
     "ci_low": 0.63, "ci_high": 1.72}]. encoding = {"x": "estimate", "y": "label",
     "x_low": "ci_low", "x_high": "ci_high", "tooltip": ["label","estimate","ci_low","ci_high"]}
   - grouped_bar: data long-form, one row per (category, group): [{"soc": "...", "arm": "DARA",
     "pct": 12.3}, ...]. encoding = {"x": "soc", "y": "pct", "color": "arm", "tooltip": [...]}
   - bar: one row per category: [{"category": "...", "value": ...}]. encoding = {"x": "category", "y": "value"}
   - waterfall: one row per subject: [{"USUBJID": "...", "value": ..., "category": "PR"}].
     encoding = {"x": "USUBJID", "y": "value", "color": "category", "id": "USUBJID", "tooltip": [...]}
   - histogram: raw per-row values, not pre-binned: [{"value": ..., "group": "DARA"}, ...].
     encoding = {"x": "value", "color": "group"}
   - scatter: [{"x_val": ..., "y_val": ..., "USUBJID": "..."}]. encoding = {"x": "x_val", "y": "y_val", "id": "USUBJID"}
   - table: data is just the rows to display as-is; encoding can be {}.
8. If the question truly cannot be answered with the given schema, still print the __DASHBOARD__
   line with "chart_type": "table", "data": [], and "stats": {"error": "<what's missing>"}.
9. The "title" string must never use an em dash, en dash, or double hyphen — use a colon or "vs" instead.
"""

_REQUIRED_DASHBOARD_KEYS = {"chart_type", "encoding", "data", "stats"}


def _parse_dashboard_payload(stdout: str) -> dict:
    for line in reversed(stdout.splitlines()):
        if "__DASHBOARD__" in line:
            try:
                payload = json.loads(line.split("__DASHBOARD__", 1)[1].strip())
            except Exception:
                return {}
            if not isinstance(payload, dict) or not _REQUIRED_DASHBOARD_KEYS.issubset(payload):
                return {}
            return payload
    return {}


def build_and_run(sdir: str, question: str, understanding: dict, schema_index: dict,
                   required_fields: list | None = None, chart_type: str | None = None) -> dict:
    client, err = _client()
    if err:
        return {"status": "error", "error": err}

    context = _schema_context(understanding, schema_index)
    user_msg = f"{context}\n\nQuestion: {question}"
    if required_fields:
        user_msg += f"\nUse these fields: {', '.join(required_fields)}"
    if chart_type:
        user_msg += f"\nSuggested chart type: {chart_type}"

    messages = [{"role": "user", "content": user_msg}]

    for attempt in range(MAX_REPAIR_ATTEMPTS + 1):
        try:
            text = _call(client, CODE_BUILDER_SYSTEM, messages, max_tokens=3072)
        except Exception as e:
            return {"status": "error", "error": f"Code Builder call failed: {e}"}

        code = codegen.extract_code_block(text)
        if code is None:
            return {"status": "error", "error": "Code Builder did not return a code block."}
        hits = codegen.forbidden_hits(code)
        if hits:
            return {"status": "error", "error": f"disallowed pattern(s): {hits}"}

        result = notebook_engine.run_cell(sdir, code)
        payload = _parse_dashboard_payload(result.get("stdout", "")) if result["status"] == "ok" else {}

        stats = payload.get("stats", {})
        data = payload.get("data", [])
        ctype = payload.get("chart_type")
        encoding_error = None
        if ctype == "table":
            valid_chart = True
        elif ctype in vega_builder.CHART_TYPES and data:
            encoding_error = vega_builder.validate_encoding(ctype, payload.get("encoding"), data)
            valid_chart = encoding_error is None
        else:
            valid_chart = False
            encoding_error = f"chart_type {ctype!r} is not one of {sorted(vega_builder.CHART_TYPES)}, or data was empty"

        succeeded = (result["status"] == "ok" and payload and "error" not in stats
                     and (data or ctype == "table") and valid_chart)

        if succeeded:
            return {"status": "ok", "code": code, "result": result, "payload": payload}

        if attempt == MAX_REPAIR_ATTEMPTS:
            reason = result.get("error") or stats.get("error") or encoding_error or "no valid __DASHBOARD__ payload produced"
            return {"status": "error", "error": f"self-repair exhausted: {reason}", "code": code}

        messages.append({"role": "assistant", "content": text})
        failure = result.get("error") or encoding_error or (
            f"Cell ran but the __DASHBOARD__ payload was missing/invalid "
            f"(chart_type={ctype!r}, rows={len(data)})."
        )
        messages.append({"role": "user", "content": f"That failed:\n{failure}\n\nReturn a corrected, complete code block."})

    return {"status": "error", "error": "unreachable"}


def _deterministic_caveats(stats: dict, threshold: int = 15) -> list:
    caveats = []
    for key, val in stats.items():
        klow = key.lower()
        if isinstance(val, (int, float)):
            if klow in ("n", "n_subjects", "n_wells", "n_total") and val < threshold:
                caveats.append(f"Small sample size ({key}={val}) — interpret with caution.")
            if klow in ("p", "p_value", "logrank_p", "pvalue") and val > 0.05:
                caveats.append(f"Not statistically significant (p={val}).")
        if isinstance(val, dict):
            for k2, v2 in val.items():
                if isinstance(v2, (int, float)) and "n" == k2.lower() and v2 < threshold:
                    caveats.append(f"Small sample size ({key}.{k2}={v2}) — interpret with caution.")
    return caveats


NARRATIVE_SYSTEM = """You write a 1-2 sentence caption for a data dashboard, whatever domain the
data is from. Use ONLY the numbers given in the stats and caveats — never invent a number that
isn't present. Be direct and quantitative. Respond with plain text only, no markdown, no quotes.""" + llm_client.NO_DASH_STYLE


def _narrative(question: str, stats: dict, caveats: list) -> tuple[str, dict | None]:
    """Routed through model_router as "narrative_caption" — exactly the
    high-volume, low-risk, constrained-slot task the architecture doc says
    belongs on the small/open-model tier, not the frontier model doing every
    dashboard's Code Builder work. Returns (text, routing_meta) so callers
    can record which model actually served it."""
    user_msg = f"Question: {question}\nStats: {json.dumps(stats)}\nCaveats: {caveats}"
    try:
        text, meta = model_router.call("narrative_caption", NARRATIVE_SYSTEM,
                                        [{"role": "user", "content": user_msg}], max_tokens=200)
        return llm_client.dedash(text.strip().strip('"')), meta
    except Exception:
        return question, None


EVALUATOR_SYSTEM = """You are the Evaluator for a dashboard-generation pipeline, reviewing work you
did not produce. Judge validity, statistical quality, clarity, and novelty, then decide whether the
dashboard should publish.

Respond with ONLY a JSON object:
{"validity": true|false, "statistical_quality": "high"|"medium"|"low", "clarity": "high"|"medium"|"low",
 "novelty": "high"|"medium"|"low", "publish_decision": "publish"|"caveats"|"review"|"reject",
 "reason": str}

Guidance: reject if validity is false or stats are missing/contradictory. review if N is very small
or the analysis is fragile. caveats if the result is valid but has a caveat (e.g. non-significant,
small subgroup). publish otherwise.""" + llm_client.NO_DASH_STYLE


def _evaluate(client, question: str, stats: dict, caveats: list, chart_type: str, risks: list) -> dict:
    if client is None:
        return {"publish_decision": "review", "reason": "Evaluator unavailable (no API key)."}
    user_msg = (
        f"Question: {question}\nChart type: {chart_type}\nStats: {json.dumps(stats)}\n"
        f"Caveats already attached: {caveats}\nDataset-level risks: {risks}"
    )
    try:
        text = _call(client, EVALUATOR_SYSTEM, [{"role": "user", "content": user_msg}], max_tokens=400)
        parsed = _extract_json(text)
        if isinstance(parsed, dict) and "publish_decision" in parsed:
            return parsed
    except Exception:
        pass
    return {"publish_decision": "review", "reason": "Evaluator call failed or returned unparseable output."}


def _fallback_title(question: str) -> str:
    """Best-effort noun-phrase fallback if the Code Builder omits "title" — strips a
    leading interrogative so the card doesn't read as a chatbot query."""
    q = re.sub(r"^(what is|what are|is there|are there|which|how (does|do|is|are)|does|do|is|are)\s+",
               "", question.strip(), flags=re.IGNORECASE)
    q = q.rstrip("?").strip()
    return (q[0].upper() + q[1:]) if q else question


def _make_artifact(sess: dict, question: str, run: dict, understanding: dict, source: str,
                    sid: str | None = None, dataset_version_id: str | None = None) -> dict:
    payload = run["payload"]
    chart_type = payload["chart_type"]
    encoding = payload.get("encoding") or {}
    data = payload.get("data", [])[:MAX_DATA_ROWS]
    stats = payload.get("stats", {})
    caveats = _deterministic_caveats(stats)

    title = payload.get("title") or _fallback_title(question)
    if len(title) > 70:
        title = title[:67] + "…"

    vega_spec = None if chart_type == "table" else vega_builder.build_spec(chart_type, encoding, data, title)

    client, _ = _client()
    narrative, routing_meta = _narrative(question, stats, caveats)
    evaluation = _evaluate(client, question, stats, caveats, chart_type, understanding.get("risks", []))

    status = evaluation.get("publish_decision", "review")
    if status not in ("publish", "caveats", "review", "reject"):
        status = "review"
    if evaluation.get("reason") and status != "publish":
        caveats.append(f"Evaluator: {evaluation['reason']}")

    sess["dashboard_seq"] += 1
    dashboard_id = f"dash-{sess['dashboard_seq']}"

    # A panel's own internal stats are NOT evidence on their own — evidence
    # only exists once a claim has been checked against something outside
    # the trial's own data. See narrative_engine.resolve_evidence_benchmark
    # (the Evidence stage's "check against outside sources" pass), which is
    # the only place evidence.from_norm_comparison gets called, and which
    # writes the resulting evidence_id back onto this dashboard afterward
    # (app.py's /api/evidence/benchmark route).
    evidence_id = None

    artifact = {
        "dashboard_id": dashboard_id,
        "title": title,
        "question": question,
        "chart_type": chart_type,
        "encoding": encoding,
        "vega_spec": vega_spec,
        "data": data,
        "stats": stats,
        "caveats": caveats,
        "narrative": narrative,
        "evaluation": evaluation,
        "code": run["code"],
        "status": status,
        "source": source,
        "created_at": time.time(),
        "evidence_id": evidence_id,
        "narrative_routing": routing_meta,
    }
    sess["dashboards"].append(artifact)
    return artifact


def list_candidates(dfs: dict, understanding: dict, schema_index: dict, compare_mode: bool = False) -> dict:
    return generate_hypotheses(understanding, schema_index, dfs, compare_mode=compare_mode)


# Fields worth memoizing — everything _make_artifact computed from real LLM/
# sandbox work. dashboard_id/question/source/created_at are per-render
# identity, not content, and are regenerated fresh on every cache hit so
# citations, drilldowns and timestamps stay correct even when the underlying
# computation was reused.
_CACHEABLE_ARTIFACT_FIELDS = (
    "title", "chart_type", "encoding", "vega_spec", "data", "stats",
    "caveats", "narrative", "evaluation", "code", "status", "evidence_id", "narrative_routing",
)


def _cache_key(dataset_fingerprint: str, question: str, required_fields: list | None, chart_type: str | None) -> str:
    raw = json.dumps({
        "fp": dataset_fingerprint,
        "q": question.strip().lower(),
        "fields": sorted(required_fields or []),
        "chart_type": chart_type,
    }, sort_keys=True)
    return hashlib.sha256(raw.encode()).hexdigest()[:32]


def get_or_build_artifact(sess: dict, sdir: str, dataset_fingerprint: str | None, question: str,
                           understanding: dict, schema_index: dict, required_fields: list | None = None,
                           chart_type: str | None = None, source: str = "copilot",
                           sid: str | None = None, dataset_version_id: str | None = None) -> dict:
    """The cost-control chokepoint: build_and_run + _make_artifact together are
    up to 4 LLM calls (Code Builder, self-repair retries, Evaluator, Narrative
    caption). Every caller that used to invoke them directly now comes
    through here instead, so the same (dataset, question, fields) combo never
    pays for that twice — a hit reuses the computed content and only
    regenerates per-render identity.

    The cache is keyed on dataset *content* (fingerprint), not on session —
    two different sessions that happen to load identical data (e.g. both
    loaded the same sample dataset) can legitimately share a cache entry.
    Evidence rows are session-scoped, though (evidence.list_for_session(sid)
    is how a workspace's evidence picker finds them), so a cache hit whose
    evidence_id belongs to a *different* session mints a fresh evidence row
    for the current session instead of reusing the foreign one — cheap (a
    local DB insert, no LLM call), and keeps every session's evidence pool
    correct without re-running anything expensive.

    Without a dataset_fingerprint (e.g. the dataset registry hasn't seen this
    session yet), caching is skipped rather than guessed at.
    """
    cache_key = _cache_key(dataset_fingerprint, question, required_fields, chart_type) if dataset_fingerprint else None
    cached = db.get_cached_artifact(cache_key) if cache_key else None
    if cached:
        sess["dashboard_seq"] += 1
        payload = dict(cached["payload"])
        # A cached evidence_id only carries over if it's an outside-comparison
        # row this exact session owns — reused compute, but evidence isn't
        # something this session gets to borrow from another one's oracle
        # check. Otherwise it stays unset until this session runs its own
        # "check against outside sources" pass.
        cached_evidence = db.get_evidence(payload["evidence_id"]) if payload.get("evidence_id") else None
        if not (sid and cached_evidence and cached_evidence["sid"] == sid):
            payload["evidence_id"] = None
        artifact = {
            **payload,
            "dashboard_id": f"dash-{sess['dashboard_seq']}",
            "question": question,
            "source": source,
            "created_at": time.time(),
            "cache_hit": True,
        }
        sess["dashboards"].append(artifact)
        return {"status": "ok", "dashboard": artifact}

    run = build_and_run(sdir, question, understanding, schema_index,
                         required_fields=required_fields, chart_type=chart_type)
    if run["status"] != "ok":
        return {"status": "error", "error": run["error"]}
    artifact = _make_artifact(sess, question, run, understanding, source=source,
                               sid=sid, dataset_version_id=dataset_version_id)
    if cache_key:
        db.save_cached_artifact(cache_key, dataset_fingerprint, question,
                                 {k: artifact[k] for k in _CACHEABLE_ARTIFACT_FIELDS})
    return {"status": "ok", "dashboard": artifact}


def generate_copilot(sess: dict, sdir: str, understanding: dict, schema_index: dict, question: str,
                      dataset_fingerprint: str | None = None, sid: str | None = None,
                      dataset_version_id: str | None = None) -> dict:
    return get_or_build_artifact(sess, sdir, dataset_fingerprint, question, understanding, schema_index,
                                  source="copilot", sid=sid, dataset_version_id=dataset_version_id)


def generate_autopilot(sess: dict, sdir: str, dfs: dict, understanding: dict, schema_index: dict,
                       limit: int = DEFAULT_AUTOPILOT_LIMIT, dataset_fingerprint: str | None = None,
                       sid: str | None = None, dataset_version_id: str | None = None) -> dict:
    hyp_result = generate_hypotheses(understanding, schema_index, dfs)
    if hyp_result["status"] != "ok":
        return {"status": "error", "error": hyp_result["error"]}

    grounded = [h for h in hyp_result["hypotheses"] if h.get("grounded")]
    created, skipped = [], []
    for h in grounded[:limit]:
        res = get_or_build_artifact(sess, sdir, dataset_fingerprint, h["question"], understanding, schema_index,
                                     required_fields=h.get("required_fields"), chart_type=h.get("chart_type"),
                                     source="autopilot", sid=sid, dataset_version_id=dataset_version_id)
        if res["status"] != "ok":
            skipped.append({"question": h["question"], "error": res["error"]})
            continue
        created.append(res["dashboard"])

    return {"status": "ok", "dashboards": created, "skipped": skipped, "candidates_considered": len(grounded)}


def promote_cell(sess: dict, cell: dict) -> dict:
    """Copilot from notebook: wrap an already-executed notebook cell as a DashboardArtifact.

    Notebook cells still produce static matplotlib images (Stage 6 is unchanged), so a promoted
    cell is honestly a static snapshot, not an interactive dashboard chart — flagged as such.
    """
    result = cell.get("result", {})
    figures = result.get("figures", [])
    if not figures:
        return {"status": "error", "error": "cell has no chart output to promote"}

    sess["dashboard_seq"] += 1
    artifact = {
        "dashboard_id": f"dash-{sess['dashboard_seq']}",
        "title": (cell.get("generated_from") or cell.get("code", ""))[:60] or "Promoted analysis",
        "question": cell.get("generated_from") or "Promoted from notebook",
        "chart_type": "static_image",
        "encoding": {},
        "vega_spec": None,
        "chart_png": figures[0],
        "data": [],
        "stats": {},
        "caveats": ["Promoted from notebook — a static image, not an interactive/drillable chart, and not independently verified by the Evaluator."],
        "narrative": "Promoted directly from a notebook cell result.",
        "status": "review",
        "source": "promoted",
        "created_at": time.time(),
        "code": cell.get("code", ""),
    }
    sess["dashboards"].append(artifact)
    return {"status": "ok", "dashboard": artifact}
