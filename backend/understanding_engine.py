"""
Stage 5 — Contextual understanding. The deterministic card (indexer.py's
classify_dataset: dataset_type, entities, metrics, risks) is a fast, free,
auditable classification — but it's still just a card. This module adds a
real gen-AI pass on top of it: an agent that looks at the actual schema and
asks its OWN questions about what the data is, how trustworthy it is, and
(when there are multiple trials) how comparable they really are — then
answers each one in prose. Distinct from:
  - Notebook's Hypothesis Agent: statistical questions computed FROM the data.
  - Analysis's Synthesis Agent: questions that connect several Notebook results.
  - This module: questions about the data's own nature/provenance/comparability,
    answered from schema facts alone (dtypes, missingness, cardinality,
    examples, per-trial N) — never a statistic that would require running code.
"""

import llm_client

MAX_SCHEMA_VARS_FOR_CONTEXT = 30


def _schema_context(understanding: dict, schema_index: dict) -> str:
    lines = []
    if understanding.get("trials"):
        lines.append(f"Multi-trial dataset — {len(understanding['trials'])} trial(s):")
        for key, u in understanding["trials"].items():
            lines.append(
                f"  Trial {key.upper()} ({u.get('label', key)}): dataset_type={u.get('dataset_type')}, "
                f"entities={', '.join(u.get('entities', []))}, metrics={', '.join(u.get('available_metrics', []))}"
                + (f", risks: {'; '.join(u['risks'])}" if u.get("risks") else "")
            )
    else:
        lines.append(f"Dataset type: {understanding.get('dataset_type')}")
        lines.append(f"Entities: {', '.join(understanding.get('entities', []))}")
        lines.append(f"Available metrics: {', '.join(understanding.get('available_metrics', []))}")
        if understanding.get("risks"):
            lines.append("Known risks: " + "; ".join(understanding["risks"]))

    lines.append("")
    lines.append("Schema (table.column: dtype, missing%, cardinality, examples):")
    for var, cols in list(schema_index.items())[:MAX_SCHEMA_VARS_FOR_CONTEXT]:
        lines.append(f"  {var}:")
        for col, meta in cols.items():
            examples = ", ".join(repr(e) for e in meta.get("examples", [])[:3])
            lines.append(f"    {col} ({meta['dtype']}, missing={meta['missing_pct']}%, card={meta['cardinality']}) — e.g. [{examples}]")
    return "\n".join(lines)


UNDERSTANDING_HYPOTHESIS_SYSTEM = """You are the Data Understanding Agent. You do not compute statistics
and you do not analyze results — a schema and per-column facts (dtype, missingness, cardinality, example
values) is ALL you have. Your job is to ask and answer questions about the DATA ITSELF: what kind of
dataset this really is, what's unusual or risky about its structure or provenance, what a downstream
analyst should know before trusting it — and, when there are multiple trials/tables of the same shape,
how genuinely comparable they are (same population type? same measurement conventions? confounds from
different N, different site counts, different eras?).

Rules:
- Respond with ONLY a JSON array. No prose, no markdown fences needed but allowed.
- Each item: {"question": str, "rationale": str}
- Propose 3-5 questions. Never a statistical question ("what is the difference in X") — those require
  actually running code, which you cannot do. Ask about structure, provenance, comparability, quality,
  and risk instead.
- If there is only one trial/dataset, focus on its own structure/quality/risk — comparability questions
  don't apply.
- The dataset can be from any domain — clinical, commercial, operational, scientific, or otherwise.
""" + llm_client.NO_DASH_STYLE


def generate_understanding_questions(understanding: dict, schema_index: dict, n: int = 5) -> dict:
    client, err = llm_client.client()
    if err:
        return {"status": "error", "error": err}

    context = _schema_context(understanding, schema_index)
    try:
        text = llm_client.call(
            client, UNDERSTANDING_HYPOTHESIS_SYSTEM,
            [{"role": "user", "content": context + f"\n\nPropose up to {n} questions about this data's nature. "
                                                     "Keep each question under 30 words and each rationale under 15 words."}],
            max_tokens=1536,
        )
    except Exception as e:
        return {"status": "error", "error": f"Data Understanding Agent call failed: {e}"}

    questions = llm_client.extract_json_list(text)
    if questions is None:
        return {"status": "error", "error": "Data Understanding Agent's response didn't parse as expected. Try again."}

    out = []
    for q in questions:
        if not isinstance(q, dict) or "question" not in q:
            continue
        q["question"] = llm_client.dedash(q["question"])
        if q.get("rationale"):
            q["rationale"] = llm_client.dedash(q["rationale"])
        out.append(q)
    return {"status": "ok", "questions": out}


UNDERSTANDING_ANSWER_SYSTEM = """You answer one question about a dataset's nature/provenance/comparability,
using ONLY the schema facts given (dtypes, missingness, cardinality, examples, per-trial counts) — never
invent a number or fact not present in what's given. If the schema doesn't contain enough to answer
confidently, say so plainly rather than guessing.

This is QUALITATIVE analysis, not a statistic — everything downstream (the questions the data can even
support, the narratives eventually written about it) starts from the judgment you make here. Don't just
restate the schema facts back — interpret them: what do this shape, this missingness pattern, this
cardinality actually suggest about how the data was collected or what it's fit to answer? What should a
downstream analyst be cautious about? Where are you inferring versus where are you certain?

Respond with ONLY a JSON object:
{"claim": "<one-sentence takeaway>", "narrative": "<2-3 paragraph qualitative interpretation, plain text, no markdown>"}""" + llm_client.NO_DASH_STYLE


def answer_understanding_question(question: str, understanding: dict, schema_index: dict) -> dict:
    client, err = llm_client.client()
    if err:
        return {"status": "error", "error": err}

    context = _schema_context(understanding, schema_index)
    try:
        text = llm_client.call(client, UNDERSTANDING_ANSWER_SYSTEM,
                                [{"role": "user", "content": context + f"\n\nQuestion: {question}"}],
                                max_tokens=700)
    except Exception as e:
        return {"status": "error", "error": f"Data Understanding Agent call failed: {e}"}

    payload = llm_client.extract_json(text)
    if not isinstance(payload, dict) or "narrative" not in payload:
        print(f"[understanding_engine] unparseable answer for {question!r}: {text[:2000]}")
        return {"status": "error", "error": "Data Understanding Agent's response didn't parse as expected. Try again."}

    return {
        "status": "ok", "question": question,
        "claim": llm_client.dedash(payload.get("claim")) or question,
        "narrative": llm_client.dedash(payload["narrative"]),
    }
