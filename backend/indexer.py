"""
Stage 5 — Build indexes.

Turns derived datasets into the memory that Stage 7 (dashboards) reads from:
one DatasetUnderstanding object plus the schema / entity / metric / cohort
indexes described in the platform spec.

Implementation note (scope decision): dataset-capability classification is
fully determined by which derived tables and columns exist, so it is done
here with a deterministic rule-based classifier rather than an LLM call —
there is nothing for a model to "reason" about that isn't already mechanical.
This keeps Stage 5 free, instant, and fully auditable. The Dataset Cognition
"agent" in the spec is implemented as this deterministic classifier; it can
be swapped for an LLM-backed version later without changing its output shape.
"""

import pandas as pd


CLINICAL_TABLES = {"adsl", "adae", "adtte"}
PLATE_TABLES = {"plate_assay", "plate_qc", "dose_response"}
LAB_TABLES = {"lb_summary", "lb_flags", "lb_shifts"}


def _missing_pct(s: pd.Series) -> float:
    return round(float(s.isna().mean() * 100), 1)


def _col_meta(df: pd.DataFrame, col: str) -> dict:
    s = df[col]
    meta = {
        "dtype": str(s.dtype),
        "cardinality": int(s.nunique(dropna=True)),
        "missing_pct": _missing_pct(s),
    }
    examples = s.dropna().astype(str).unique()[:3].tolist()
    meta["examples"] = examples
    return meta


def _schema_index(dfs: dict) -> dict:
    """what does each column mean? — relational, per spec 5.3"""
    schema = {}
    for var, df in dfs.items():
        schema[var] = {col: _col_meta(df, col) for col in df.columns}
    return schema


def classify_dataset(dfs: dict, context: str) -> dict:
    """Dataset Cognition — deterministic capability classification (DatasetUnderstanding)."""
    names = set(dfs.keys())
    risks = []

    if context == "clinical_trial" and CLINICAL_TABLES & names:
        adsl = dfs.get("adsl")
        adae = dfs.get("adae")
        adtte = dfs.get("adtte")

        entities = ["subject"]
        metrics, supported, unsupported = [], [], []

        if adsl is not None:
            entities.append("arm")
            if "KRASMUT" in adsl.columns:
                entities.append("biomarker")
            n_subj = adsl["USUBJID"].nunique() if "USUBJID" in adsl.columns else len(adsl)
            for arm, grp in (adsl.groupby("ARMCD") if "ARMCD" in adsl.columns else []):
                if len(grp) < 10:
                    risks.append(f"Arm {arm} has small N ({len(grp)}) — subgroup results may be unstable")
            if "AGE" in adsl.columns and adsl["AGE"].isna().mean() > 0.1:
                risks.append(f"{round(adsl['AGE'].isna().mean()*100)}% of subjects missing baseline AGE")

        if adtte is not None and {"AVAL", "CNSR"}.issubset(adtte.columns):
            entities.append("time_to_event")
            metrics += ["OS"]
            supported += ["km_survival", "cox_ph", "logrank"]
        else:
            unsupported.append("survival_analysis")

        if adae is not None:
            entities.append("adverse_event")
            metrics += ["AE_rate"]
            if "AETOXGR" in adae.columns:
                metrics.append("grade3plus_rate")
                supported.append("ae_by_soc")
            if "TRTEMFL" in adae.columns:
                supported.append("teae_incidence")
        else:
            unsupported.append("ae_analysis")

        if adsl is not None and {"TRTSDT", "TRTEDTM"}.issubset(adsl.columns):
            metrics.append("exposure_duration")
            supported.append("exposure_duration")

        if "rs" in names and "RSORRES" in dfs["rs"].columns:
            entities.append("response")
            supported.append("waterfall")
        else:
            unsupported.append("response_waterfall")

        if adsl is not None and "ARMCD" in adsl.columns:
            supported.append("demographics_by_arm")

        unsupported += ["single_cell", "expression", "dose_response"]

        return {
            "dataset_type": "clinical_trial_adam",
            "entities": sorted(set(entities)),
            "available_metrics": sorted(set(metrics)),
            "supported_analyses": sorted(set(supported)),
            "unsupported_analyses": sorted(set(unsupported)),
            "risks": risks,
            "generated_by": "heuristic",
        }

    if context == "plate_assay" and PLATE_TABLES & names:
        plate = dfs.get("plate_assay")
        dose_response = dfs.get("dose_response")
        entities = ["well", "compound"]
        metrics = ["viability_pct"]
        supported = ["dose_response_curve", "plate_qc"]
        unsupported = ["km_survival", "cox_ph", "ae_by_soc", "single_cell", "expression"]

        if plate is not None and "CELL_LINE" in plate.columns:
            entities.append("cell_line")
        if dose_response is not None:
            metrics.append("IC50")
            supported.append("ic50_curve")
        if plate is not None and "CONTROL_TYPE" in plate.columns:
            for cl, grp in plate.groupby("CELL_LINE") if "CELL_LINE" in plate.columns else []:
                treated = grp[grp["CONTROL_TYPE"] == "treated"]
                if len(treated) < 6:
                    risks.append(f"Cell line {cl} has few treated wells ({len(treated)})")

        return {
            "dataset_type": "plate_assay",
            "entities": sorted(set(entities)),
            "available_metrics": sorted(set(metrics)),
            "supported_analyses": sorted(set(supported)),
            "unsupported_analyses": sorted(set(unsupported)),
            "risks": risks,
            "generated_by": "heuristic",
        }

    if context == "lab_assay" and LAB_TABLES & names:
        return {
            "dataset_type": "lab_assay",
            "entities": ["subject", "lab_parameter", "visit"],
            "available_metrics": ["abnormality_rate"],
            "supported_analyses": ["lab_summary_table", "abnormal_flags", "shift_table"],
            "unsupported_analyses": ["km_survival", "cox_ph", "dose_response", "single_cell"],
            "risks": risks,
            "generated_by": "heuristic",
        }

    if context == "time_series" and "trend_summary" in names:
        trend = dfs.get("trend_summary")
        variables = trend["variable"].tolist() if trend is not None and "variable" in trend.columns else []
        if trend is not None and "n_obs" in trend.columns and len(trend) and trend["n_obs"].min() < 5:
            risks.append("Some variables have fewer than 5 time-ordered observations — trend estimates are unstable")
        return {
            "dataset_type": "time_series",
            "entities": ["observation", "time_point"],
            "available_metrics": sorted(set(variables)),
            "supported_analyses": ["trend_line", "time_index_table"],
            "unsupported_analyses": ["km_survival", "cox_ph", "ae_by_soc", "dose_response", "single_cell"],
            "risks": risks,
            "generated_by": "heuristic",
        }

    if context == "expression_matrix" and "feature_variance" in names:
        sample_stats = dfs.get("sample_stats")
        n_samples = len(sample_stats) if sample_stats is not None else 0
        if n_samples and n_samples < 3:
            risks.append(f"Only {n_samples} sample column(s) detected — variance/CV% estimates are unstable")
        return {
            "dataset_type": "expression_matrix",
            "entities": ["feature", "sample"],
            "available_metrics": ["variance", "cv_pct", "mean"],
            "supported_analyses": ["feature_variance_ranking", "top_variable_features", "sample_detection_stats"],
            "unsupported_analyses": ["km_survival", "cox_ph", "ae_by_soc", "dose_response"],
            "risks": risks,
            "generated_by": "heuristic",
        }

    if context == "grouped_comparison" and "group_stats" in names:
        gs = dfs.get("group_stats")
        measurements = gs["measurement"].unique().tolist() if gs is not None and "measurement" in gs.columns else []
        if gs is not None and "N" in gs.columns and len(gs) and gs["N"].min() < 5:
            risks.append("Some group × measurement cells have fewer than 5 observations — effect sizes are unstable")
        return {
            "dataset_type": "grouped_comparison",
            "entities": ["group", "measurement"],
            "available_metrics": sorted(set(measurements)),
            "supported_analyses": ["group_comparison", "effect_size", "anova"],
            "unsupported_analyses": ["km_survival", "cox_ph", "ae_by_soc", "dose_response", "single_cell"],
            "risks": risks,
            "generated_by": "heuristic",
        }

    return _infer_generic_understanding(dfs, risks)


# Mirrors derive_contextual._GENERIC_DERIVED_TABLES — a previous generic/
# time-series/expression/grouped derive pass's own output (profile,
# numeric_summary, group_stats, ...) must never get read back in as if it
# were more raw source data; that's how classification snowballs into
# nonsense on a second pass. Duplicated locally rather than imported since
# derive_contextual lives under extractors/, which isn't always on sys.path
# wherever indexer.py gets imported from.
_GENERIC_DERIVED_TABLE_NAMES = {
    "time_index", "trend_summary", "feature_variance", "sample_stats", "top_variable",
    "group_stats", "effect_sizes", "anova_summary", "profile", "numeric_summary",
}


def _infer_generic_understanding(dfs: dict, risks: list) -> dict:
    """Domain-agnostic fallback for anything that doesn't match a known
    clinical/plate/lab/derived shape. Reads the real columns instead of
    handing back the same empty-looking card for every unrecognized file —
    a retail CSV and a manufacturing-QA CSV should not classify identically
    just because neither looks like a clinical trial."""
    entities, metrics = [], []
    has_category = has_numeric = has_datetime = False

    for var, df in dfs.items():
        if var in _GENERIC_DERIVED_TABLE_NAMES:
            continue
        n_rows = len(df)
        if n_rows == 0:
            continue
        for col in df.columns:
            s = df[col]
            missing_pct = _missing_pct(s)
            if missing_pct >= 30:
                risks.append(f"{var}.{col} is {round(missing_pct)}% missing")

            # Extractors read tabular sources as dtype=str across the board
            # (tabular.py/excel.py), so dtype alone can't tell numeric/date
            # columns from text ones here — every column looks like object
            # dtype regardless of what it actually holds. Parse instead.
            non_null = s.dropna()
            if pd.api.types.is_numeric_dtype(s):
                is_numeric_col = True
            elif len(non_null):
                is_numeric_col = pd.to_numeric(non_null, errors="coerce").notna().mean() >= 0.8
            else:
                is_numeric_col = False

            if is_numeric_col:
                has_numeric = True
                metrics.append(col)
                continue

            if pd.api.types.is_datetime64_any_dtype(s):
                is_datetime_col = True
            elif len(non_null):
                is_datetime_col = pd.to_datetime(non_null, errors="coerce", format="mixed").notna().mean() >= 0.8
            else:
                is_datetime_col = False

            if is_datetime_col:
                has_datetime = True
                continue

            card = s.nunique(dropna=True)
            if 1 < card <= max(50, n_rows // 2):
                has_category = True
                entities.append(col)
        if n_rows < 10:
            risks.append(f"{var} has only {n_rows} row(s) — any summary here is low-confidence")

    supported = ["profile_table"]
    if has_numeric:
        supported.append("numeric_summary_table")
    if has_category and has_numeric:
        supported.append("grouped_comparison")
    if has_datetime and has_numeric:
        supported.append("trend_over_time")

    return {
        "dataset_type": "generic",
        "entities": sorted(set(entities)) or ["row"],
        "available_metrics": sorted(set(metrics)) or ["numeric_summary"],
        "supported_analyses": sorted(set(supported)),
        "unsupported_analyses": ["km_survival", "cox_ph", "dose_response", "ae_by_soc"],
        "risks": risks,
        "generated_by": "heuristic",
    }


def _entity_index(dfs: dict, understanding: dict) -> dict:
    """which subjects/arms/events exist? — exactness matters."""
    entity = {}
    adsl = dfs.get("adsl")
    if adsl is not None:
        if "USUBJID" in adsl.columns:
            entity["subject"] = {"n": int(adsl["USUBJID"].nunique())}
        if "ARMCD" in adsl.columns:
            entity["arm"] = {"values": sorted(adsl["ARMCD"].dropna().unique().tolist())}
    adae = dfs.get("adae")
    if adae is not None and "AEDECOD" in adae.columns:
        entity["adverse_event"] = {"n_terms": int(adae["AEDECOD"].nunique())}
    plate = dfs.get("plate_assay")
    if plate is not None:
        if "CELL_LINE" in plate.columns:
            entity["cell_line"] = {"values": sorted(plate["CELL_LINE"].dropna().unique().tolist())}
        if "COMPOUND" in plate.columns:
            entity["compound"] = {"values": sorted(plate["COMPOUND"].dropna().unique().tolist())}
    if not entity:
        for var, df in dfs.items():
            entity[var] = {"n_rows": len(df)}
    return entity


def _metric_index(understanding: dict) -> dict:
    """what can we measure/derive?"""
    return {m: {"available": True} for m in understanding.get("available_metrics", [])}


def _cohort_index(dfs: dict, context: str) -> dict:
    """what groups can we compare, at what N? — materialized views, N + missingness."""
    cohort = {}
    if context == "clinical_trial" and "adsl" in dfs and "ARMCD" in dfs["adsl"].columns:
        adsl = dfs["adsl"]
        rows = []
        for arm, grp in adsl.groupby("ARMCD"):
            rows.append({
                "group": arm,
                "n": int(len(grp)),
                "missing_age_pct": _missing_pct(grp["AGE"]) if "AGE" in grp.columns else None,
            })
        cohort["by_arm"] = rows
    elif context == "plate_assay" and "plate_assay" in dfs and "CELL_LINE" in dfs["plate_assay"].columns:
        plate = dfs["plate_assay"]
        rows = []
        for cl, grp in plate.groupby("CELL_LINE"):
            rows.append({"group": cl, "n": int(len(grp))})
        cohort["by_cell_line"] = rows
    else:
        for var, df in dfs.items():
            cohort[var] = {"n": len(df)}
    return cohort


def _narrative_index(sid: str | None) -> list:
    """what stories already exist in the corpus? — thin view over narrative_engine's output."""
    if not sid:
        return []
    import db
    return [
        {"narrative_id": n["narrative_id"], "thesis": n["thesis"], "status": n.get("status")}
        for n in db.list_narratives(sid, include_synthetic=False)
    ]


def _finding_index(sid: str | None) -> list:
    """what has already been concluded? — published/caveated narratives are Findings."""
    if not sid:
        return []
    import db
    return [
        {"narrative_id": n["narrative_id"], "thesis": n["thesis"]}
        for n in db.list_narratives(sid, include_synthetic=False)
        if n.get("status") in ("publish", "caveats", "published")
    ]


def build_indexes(dfs: dict, context: str, existing_dashboards: list | None = None, sid: str | None = None) -> dict:
    """Deterministic builders — populate the seven indexes from derived data."""
    understanding = classify_dataset(dfs, context)
    indexes = {
        "dataset": {
            "supported": understanding["supported_analyses"],
            "unsupported": understanding["unsupported_analyses"],
        },
        "schema": _schema_index(dfs),
        "entity": _entity_index(dfs, understanding),
        "metric": _metric_index(understanding),
        "cohort": _cohort_index(dfs, context),
        "dashboard": [
            {"dashboard_id": d["dashboard_id"], "question": d["question"]}
            for d in (existing_dashboards or [])
        ],
        "narrative": _narrative_index(sid),
        "finding": _finding_index(sid),
    }
    return {"understanding": understanding, "indexes": indexes}
