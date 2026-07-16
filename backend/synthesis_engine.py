"""
Stage 7 — Analysis. Where the Notebook stage (Stage 6) runs a wide, mostly
statistical pass over the data — one question, one stat, one chart — this
stage asks fewer, deeper questions that only make sense by weighing several
of those notebook results *together*: does a survival benefit come with an
acceptable safety tradeoff, is an effect driven by one subgroup or general,
that kind of thing. Never a single-stat question — that's the Notebook's job.

Mirrors dashboard_engine.py's shape (Hypothesis Agent -> per-item answer,
real LLM calls, no template fallback) but the "answer" here is a written
synthesis over already-computed evidence, not a fresh Code Builder run — the
numbers already exist; the job is judgment about what they mean together.
"""

import json
import time

import db
import evidence
import llm_client

MAX_NOTEBOOK_RESULTS_FOR_CONTEXT = 40


def _client():
    return llm_client.client()


def _notebook_context(notebook_results: list) -> str:
    lines = []
    for i, d in enumerate(notebook_results[:MAX_NOTEBOOK_RESULTS_FOR_CONTEXT]):
        stats = d.get("stats") or {}
        stat_bits = ", ".join(f"{k}={v}" for k, v in list(stats.items())[:6])
        lines.append(
            f"[{i}] {d.get('title')} — {d.get('chart_type')}\n"
            f"    question: {d.get('question')}\n"
            f"    stats: {stat_bits}\n"
            f"    finding: {d.get('narrative', '')}"
            + (f"\n    caveats: {'; '.join(d['caveats'])}" if d.get("caveats") else "")
        )
    return "\n".join(lines)


SYNTHESIS_HYPOTHESIS_SYSTEM = """You are the Synthesis Agent in a data-analysis pipeline. You do not run
new statistical tests — a separate Notebook stage already did that, and you're given its full list of
computed results below. Your job is to find the handful of questions that only make sense by weighing
SEVERAL of those results together — never a question a single one of them already answers on its own.

Rules:
- Respond with ONLY a JSON array. No prose, no markdown fences needed but allowed.
- Each item: {"question": str, "relevant_result_indices": [int, ...], "rationale": str}
- "relevant_result_indices" MUST list at least 2 indices from the numbered results given, and every
  index must actually appear in that list.
- Propose 3-6 questions. Each must require connecting/weighing multiple findings — e.g. does a benefit
  shown in one result hold up against a risk shown in another; is an effect in one result consistent
  with, or contradicted by, another; what does the overall picture across several results add up to.
- Reject the temptation to just restate one notebook result as a question — if only one index would be
  relevant, don't propose it.
- The dataset can be from any domain — clinical, commercial, operational, scientific, or otherwise.
  Ground every question in what the results actually show, not assumptions about the domain.
""" + llm_client.NO_DASH_STYLE


def generate_synthesis_questions(understanding: dict, notebook_results: list, n: int = 6) -> dict:
    if not notebook_results:
        return {"status": "error", "error": "No notebook results yet — run the Notebook stage's analysis pass first."}

    client, err = _client()
    if err:
        return {"status": "error", "error": err}

    context = (
        f"Dataset type: {understanding.get('dataset_type')}\n"
        f"Entities: {', '.join(understanding.get('entities', []))}\n\n"
        f"Numbered notebook results ({len(notebook_results)} total):\n" + _notebook_context(notebook_results)
    )
    try:
        text = llm_client.call(
            client, SYNTHESIS_HYPOTHESIS_SYSTEM,
            [{"role": "user", "content": context + f"\n\nPropose up to {n} synthesis questions."}],
            max_tokens=2048,
        )
    except Exception as e:
        return {"status": "error", "error": f"Synthesis Agent call failed: {e}"}

    questions = llm_client.extract_json_list(text)
    if questions is None:
        print(f"[synthesis_engine] unparseable questions response: {text[:2000]}")
        return {"status": "error", "error": "Synthesis Agent's response didn't parse as expected. Try again."}

    out = []
    n_results = len(notebook_results)
    for q in questions:
        if not isinstance(q, dict) or "question" not in q:
            continue
        q["question"] = llm_client.dedash(q["question"])
        if q.get("rationale"):
            q["rationale"] = llm_client.dedash(q["rationale"])
        idxs = [i for i in (q.get("relevant_result_indices") or []) if isinstance(i, int) and 0 <= i < n_results]
        q["relevant_result_indices"] = idxs
        q["grounded"] = len(idxs) >= 2
        out.append(q)
    return {"status": "ok", "questions": out}


SYNTHESIS_ANSWER_SYSTEM = """You write the analytical synthesis for one question in a data-analysis
report, given several already-computed notebook results as your only source of numbers. You are
weighing/connecting these results, not computing anything new — never invent a number that isn't in
the results given.

Respond with ONLY a JSON object:
{"claim": "<one-sentence conclusion, like a section headline>",
 "narrative": "<2-4 paragraph analytical synthesis, plain text, no markdown>",
 "confidence": <float 0-1, your honest assessment given how directly the cited results answer the question>}

The narrative must explicitly reference which cited result(s) it draws each point from by title.""" + llm_client.NO_DASH_STYLE


def answer_synthesis_question(sid: str, dataset_version_id: str | None, question: str,
                               notebook_results: list, relevant_indices: list, understanding: dict) -> dict:
    client, err = _client()
    if err:
        return {"status": "error", "error": err}

    relevant = [notebook_results[i] for i in relevant_indices if 0 <= i < len(notebook_results)]
    if len(relevant) < 2:
        return {"status": "error", "error": "Fewer than 2 relevant notebook results — not a genuine synthesis question."}

    context = (
        f"Dataset type: {understanding.get('dataset_type')}\n\n"
        f"Question: {question}\n\n"
        f"Cited notebook results:\n" + _notebook_context(relevant)
    )
    try:
        text = llm_client.call(client, SYNTHESIS_ANSWER_SYSTEM,
                                [{"role": "user", "content": context}], max_tokens=1024)
    except Exception as e:
        return {"status": "error", "error": f"Synthesis Agent call failed: {e}"}

    payload = llm_client.extract_json(text)
    if not isinstance(payload, dict) or "narrative" not in payload:
        print(f"[synthesis_engine] unparseable synthesis for {question!r}: {text[:2000]}")
        return {"status": "error", "error": "Synthesis Agent's response didn't parse as expected. Try again."}

    claim = llm_client.dedash(payload.get("claim")) or question
    narrative = llm_client.dedash(payload["narrative"])
    confidence = payload.get("confidence")
    try:
        confidence = max(0.0, min(1.0, float(confidence)))
    except (TypeError, ValueError):
        confidence = 0.6

    source_evidence_ids = [d.get("evidence_id") for d in relevant if d.get("evidence_id")]
    ev = evidence.from_synthesis(sid, dataset_version_id, claim, narrative, source_evidence_ids, confidence)

    return {
        "status": "ok", "question": question, "claim": claim, "narrative": narrative,
        "confidence": confidence, "evidence_id": ev["id"],
        "cited_results": [{"dashboard_id": d.get("dashboard_id"), "title": d.get("title")} for d in relevant],
        "created_at": time.time(),
    }
