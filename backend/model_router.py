"""
Model routing layer — the tiered dispatch described in the architecture doc:

    deterministic -> embedding -> small open model -> large open model -> frontier

Only the last three tiers involve an LLM call at all; "deterministic" and
"embedding" tasks never reach this module (they're plain code elsewhere).
decide_tier() is a fixed lookup table, not an LLM call itself — the routing
decision is deterministic and auditable, same principle as the rest of this
app's "code decides, models fill slots" design.

Wiring: TOGETHER_API_KEY present -> "small"/"large" tier tasks call Together
AI's OpenAI-compatible endpoint with a real Qwen model. Without that key,
every tier transparently falls back to Claude (via llm_client) — the routing
architecture is real and complete either way, but cost separation only
kicks in once a Together key exists. Every response reports which
provider/model actually served it (`meta["provider"]`, `meta["model"]`) so
routing is auditable, not guessed at from the outside.

The Together model slugs below are current as of this module's authorship —
Together's catalog changes; override via TOGETHER_SMALL_MODEL /
TOGETHER_LARGE_MODEL env vars if a slug goes stale.
"""

import json
import os

import httpx

import llm_client

TOGETHER_BASE_URL = "https://api.together.xyz/v1/chat/completions"
DEFAULT_SMALL_MODEL = "Qwen/Qwen2.5-7B-Instruct-Turbo"
DEFAULT_LARGE_MODEL = "Qwen/Qwen2.5-72B-Instruct-Turbo"

# Fixed, deterministic routing table — not model-decided. Extend this as more
# call sites migrate off a hardcoded Claude call; see dashboard_engine.py's
# _narrative() for the first real example.
TASK_TIERS = {
    "chart_title": "small",
    "narrative_caption": "small",
    "dashboard_description": "small",
    "claim_classification": "small",
    "rewrite_for_audience": "large",
    "section_prose": "large",
    "code_generation": "frontier",
    "evaluation": "frontier",
    "hypothesis_generation": "frontier",
    "narrative_architecture": "frontier",
    "contradiction_resolution": "frontier",
    "oracle_resolution": "frontier",
}


def decide_tier(task: str) -> str:
    return TASK_TIERS.get(task, "frontier")


def together_available() -> bool:
    return bool(os.environ.get("TOGETHER_API_KEY"))


def _call_together(model: str, system: str, messages: list, max_tokens: int) -> str:
    api_key = os.environ["TOGETHER_API_KEY"]
    payload_messages = [{"role": "system", "content": system}] + messages
    resp = httpx.post(
        TOGETHER_BASE_URL,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={"model": model, "messages": payload_messages, "max_tokens": max_tokens},
        timeout=60,
    )
    resp.raise_for_status()
    data = resp.json()
    return data["choices"][0]["message"]["content"]


def call(task: str, system: str, messages: list, max_tokens: int = 1024) -> tuple[str, dict]:
    """Returns (text, meta). meta = {"tier", "provider", "model", "fell_back"}.

    `task` is a fixed key from TASK_TIERS (or any string — unrecognized tasks
    route to "frontier" as the safe default, same as the doc's guidance that
    ambiguous/high-stakes work should escalate rather than guess cheap).
    """
    tier = decide_tier(task)

    if tier in ("small", "large") and together_available():
        model = os.environ.get(
            "TOGETHER_SMALL_MODEL" if tier == "small" else "TOGETHER_LARGE_MODEL",
            DEFAULT_SMALL_MODEL if tier == "small" else DEFAULT_LARGE_MODEL,
        )
        try:
            text = _call_together(model, system, messages, max_tokens)
            return text, {"tier": tier, "provider": "together", "model": model, "fell_back": False}
        except Exception as e:
            # Fail open to Claude rather than fail the whole request — a
            # routing-tier outage shouldn't take down dashboard generation.
            pass

    clnt, err = llm_client.client()
    if err:
        raise RuntimeError(err)
    text = llm_client.call(clnt, system, messages, max_tokens=max_tokens)
    fell_back = tier in ("small", "large")  # only "frontier" tasks are meant to land here
    return text, {"tier": tier, "provider": "anthropic", "model": llm_client.MODEL, "fell_back": fell_back}
