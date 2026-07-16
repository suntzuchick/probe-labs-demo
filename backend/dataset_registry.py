"""
Dataset version registry — the versioned "dataset library" every downstream
computation (indexer, dashboard_engine, narrative_engine) keys against.

A dataset here is the full set of pandas DataFrames living in a session's
sandbox dir (notebook_engine.py's *.pkl files) at a point in time. Before
this module existed, a re-upload or re-derive silently overwrote the pickles
in place with no history and — worse — left `sess["dataset_understanding"]`
stale forever, since app.py only (re)built it `if not sess.get(...)`
(app.py's `_ensure_indexes`). There was no signal anywhere that the
underlying data had actually changed.

register_version() is the fix: it fingerprints the current dataframes and
only writes a new immutable row when the content actually changed. Callers
use "did the fingerprint change" to decide whether to re-run the (cheap,
deterministic) indexer classification — and, one layer up, the fingerprint
is the join key for dashboard_engine's artifact_cache, so identical
(dataset, question) pairs never pay for a second LLM call.
"""

import hashlib

import pandas as pd

import db


def _df_fingerprint(df: pd.DataFrame) -> str:
    """Order-independent content hash: shape + dtypes + a hash of the actual
    values, so a no-op re-derive (same rows, maybe reordered write) still
    round-trips to the same fingerprint, but any real edit changes it."""
    try:
        content_hash = int(pd.util.hash_pandas_object(df, index=True).sum())
    except TypeError:
        # Columns holding unhashable objects (embedded lists/dicts) — string
        # repr is still deterministic for this app's data shapes.
        content_hash = hash(df.astype(str).to_csv())
    dtypes = ",".join(df.dtypes.astype(str))
    return f"{df.shape[0]}x{df.shape[1]}:{dtypes}:{content_hash}"


def fingerprint_dfs(dfs: dict) -> str:
    """Deterministic content hash over every dataframe currently in the
    session, independent of dict iteration order."""
    parts = [f"{name}={_df_fingerprint(df)}" for name, df in sorted(dfs.items())]
    return hashlib.sha256("|".join(parts).encode()).hexdigest()[:24]


def _manifest(dfs: dict) -> dict:
    return {
        name: {
            "rows": int(df.shape[0]), "cols": int(df.shape[1]),
            "dtypes": {c: str(t) for c, t in df.dtypes.items()},
        }
        for name, df in dfs.items()
    }


def register_version(sid: str, dfs: dict, canonical_vars: set | None = None,
                      understanding: dict | None = None) -> dict:
    """Idempotent: if the current dataframes hash the same as the session's
    latest version, returns that version unchanged (attaching `understanding`
    to it if it didn't have one yet). Otherwise writes and returns a new,
    immutable version row with version = previous + 1.

    Cheap to call on every request — it's a hash over in-memory dataframes,
    no LLM/network involved — so callers don't need to reason about when to
    call it; `changed` on the return tells them whether anything downstream
    (indexer classification, cached artifacts) needs to be treated as stale.

    Only fingerprints the CANONICAL variable set — the raw domain tables and
    derived tables (adsl/adae/adtte, etc), never dashboard/narrative scratch.
    Every Code Builder run re-pickles whatever intermediate DataFrames its
    generated pandas code happened to create (chart_result_df, cox_df,
    counts, ...) back into the same sandbox directory — without this
    restriction, `dfs` (== every *.pkl in the sandbox) grows and mutates on
    every single dashboard generated, so the fingerprint would never repeat
    and the artifact cache would never hit.

    `canonical_vars` should be the caller's live bookkeeping of real
    upload/derive variable names (app.py tracks this in
    sess["domain_source"]/sess["derived_vars"]) — the authoritative source
    when available. If omitted (e.g. bookkeeping predates this mechanism, or
    was lost with an in-memory session), falls back to the latest existing
    version's manifest keys, and only on a session's very first-ever call
    falls back further to whatever's currently in the sandbox.
    """
    latest = db.get_latest_dataset_version(sid)
    if canonical_vars:
        canonical_keys = set(canonical_vars) & set(dfs.keys())
    elif latest:
        canonical_keys = set(latest["manifest"].keys())
    else:
        canonical_keys = set(dfs.keys())
    scoped_dfs = {k: v for k, v in dfs.items() if k in canonical_keys}

    fp = fingerprint_dfs(scoped_dfs)
    existing = db.find_dataset_version_by_fingerprint(sid, fp)
    if existing:
        if understanding and not existing.get("understanding"):
            db.update_dataset_version_understanding(existing["id"], understanding)
            existing["understanding"] = understanding
        return {**existing, "changed": False}

    version = (latest["version"] + 1) if latest else 1
    row = db.create_dataset_version(sid, version, fp, _manifest(scoped_dfs), understanding)
    return {**row, "changed": True}


def get_current(sid: str) -> dict | None:
    return db.get_latest_dataset_version(sid)


def list_versions(sid: str) -> list:
    return db.list_dataset_versions(sid)
