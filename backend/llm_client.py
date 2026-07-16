"""
Shared Claude client bootstrap + call helper + JSON-extraction utilities.

Extracted from dashboard_engine.py so oracle_engine.py, narrative_engine.py,
and editor_lint.py don't each reimplement the API-key check, model name, and
error path. dashboard_engine.py keeps its own thin wrappers (_client/_call)
for backward compatibility but delegates to this module.
"""

import json
import os
import re
import time

MODEL = "claude-sonnet-4-6"

# Appended to every system prompt that produces user-facing prose (questions,
# rationale, claims, narratives, theses) — not the code-generation prompts,
# where a dash inside a string literal or comment is irrelevant.
NO_DASH_STYLE = "\n\nStyle: never use em dashes, en dashes, or double hyphens (--) as punctuation. Use a comma, period, parentheses, or \"and\"/\"but\" instead."

_DASH_RE = re.compile(r"\s*[–—]\s*|\s+--\s+")


def dedash(text: str) -> str:
    """Deterministic safety net for NO_DASH_STYLE — models don't always
    follow style instructions, so this catches what slips through by
    replacing any remaining em/en dash (or ' -- ') with a comma."""
    if not text:
        return text
    return _DASH_RE.sub(", ", text).strip().rstrip(",").strip()


def client():
    """Returns (client, error). error is a user-facing string if unset/missing."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return None, "ANTHROPIC_API_KEY is not set — this agent needs it to run."
    try:
        import anthropic
    except ImportError:
        return None, "'anthropic' package not installed. Run: pip install anthropic"
    # Explicit timeout — the SDK's own default has been observed dropping
    # long Code Builder calls (large schema context + max_tokens) with a
    # generic "Request timed out or interrupted" error well before anything
    # was actually wrong server-side. max_retries handles transient
    # connection drops on top of that.
    return anthropic.Anthropic(api_key=api_key, timeout=180.0, max_retries=2), None


def call(clnt, system: str, messages: list, max_tokens: int = 2048) -> str:
    """One extra manual retry beyond the SDK's own connection-level retries —
    covers the case where the whole request round-trip (not just a single
    socket-level attempt) times out, which max_retries alone doesn't catch."""
    last_err = None
    for attempt in range(2):
        try:
            response = clnt.messages.create(model=MODEL, max_tokens=max_tokens, system=system, messages=messages)
            return "".join(b.text for b in response.content if b.type == "text")
        except Exception as e:
            last_err = e
            if attempt == 0:
                time.sleep(2)
                continue
            raise
    raise last_err


def extract_json(text: str):
    match = re.search(r"```(?:json)?\s*\n(.*?)```", text, re.DOTALL)
    raw = match.group(1) if match else text
    try:
        return json.loads(raw.strip())
    except Exception:
        pass
    for opener, closer in (("[", "]"), ("{", "}")):
        s, e = raw.find(opener), raw.rfind(closer)
        if s != -1 and e != -1 and e > s:
            try:
                return json.loads(raw[s:e + 1])
            except Exception:
                continue
    return None


def extract_json_list(text: str):
    parsed = extract_json(text)
    if isinstance(parsed, list):
        return parsed
    if isinstance(parsed, dict):
        list_values = [v for v in parsed.values() if isinstance(v, list)]
        if len(list_values) == 1:
            return list_values[0]
    return None
