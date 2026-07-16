import re

TARGET_VARIABLES = {
    "USUBJID": {"desc": "unique subject identifier patient id", "synonyms": ["usubjid", "subject_id", "patient_id", "subjid", "pt_id"]},
    "AGE": {"desc": "subject age years", "synonyms": ["age", "age_yrs", "patient_age"]},
    "SEX": {"desc": "subject sex gender male female", "synonyms": ["sex", "gender"]},
    "RACE": {"desc": "subject race ethnicity", "synonyms": ["race", "ethnicity"]},
    "ARMCD": {"desc": "treatment arm code randomization group", "synonyms": ["armcd", "arm_code", "treatment_group", "cohort"]},
    "KRASMUT": {"desc": "kras mutation subtype biomarker genotype", "synonyms": ["krasmut", "kras_mutation", "mutation_subtype", "genotype", "biomarker_status"]},
    "ECOGBL": {"desc": "ecog performance status baseline", "synonyms": ["ecogbl", "ecog", "performance_status", "ecog_ps"]},

    "EXSTDTC": {"desc": "exposure start date treatment first dose iso8601", "synonyms": ["exstdtc", "trt_start", "first_dose_date", "dose_start", "treatment_start_date"]},
    "EXENDTC": {"desc": "exposure end date treatment last dose iso8601", "synonyms": ["exendtc", "trt_end", "last_dose_date", "dose_end", "treatment_end_date"]},
    "EXTRT": {"desc": "treatment name description drug compound", "synonyms": ["extrt", "treatment_name", "drug_name", "study_drug", "compound"]},
    "EXDOSE": {"desc": "exposure dose amount administered", "synonyms": ["exdose", "dose", "dose_mg", "dose_amount"]},

    "AETERM": {"desc": "adverse event verbatim term reported", "synonyms": ["aeterm", "ae_term", "event_term", "reported_term"]},
    "AEDECOD": {"desc": "adverse event decoded preferred term meddra", "synonyms": ["aedecod", "pt", "preferred_term", "ae_term_decoded"]},
    "AEBODSYS": {"desc": "adverse event body system organ class meddra soc", "synonyms": ["aebodsys", "soc", "system_organ_class", "bodysystem"]},
    "AETOXGR": {"desc": "adverse event toxicity grade ctcae severity", "synonyms": ["aetoxgr", "ae_grade", "toxgrade", "severity_grade", "ctcaegrade"]},
    "AESER": {"desc": "serious adverse event indicator flag", "synonyms": ["aeser", "serious", "is_serious", "sae_flag"]},

    "RSORRES": {"desc": "tumor response result original recist complete partial stable progressive", "synonyms": ["tumresponse", "tumorresponse", "response", "rsorres", "best_response", "orr_result"]},
    "RSEVAL": {"desc": "response evaluator investigator assessment", "synonyms": ["rseval", "evaluator", "assessed_by"]},

    "DSDECOD": {"desc": "disposition decoded reason discontinuation death status", "synonyms": ["dsdecod", "disposition_reason", "discontinuation_reason", "status"]},
    "DSDTC": {"desc": "disposition date", "synonyms": ["dsdtc", "disposition_date", "status_date"]},

    "DVTERM": {"desc": "protocol deviation verbatim term reported", "synonyms": ["dvterm", "deviation_term", "pd_term", "deviation_description"]},
    "DVDECOD": {"desc": "protocol deviation decoded category reason", "synonyms": ["dvdecod", "deviation_reason", "deviation_category", "pd_reason"]},
    "DVCAT": {"desc": "protocol deviation major minor classification severity", "synonyms": ["dvcat", "deviation_class", "deviation_severity", "major_minor"]},
    "DVDTC": {"desc": "protocol deviation date", "synonyms": ["dvdtc", "deviation_date", "pd_date"]},

    "LBTEST": {"desc": "laboratory test name analyte measured", "synonyms": ["lbtest", "test_name", "analyte", "assay_name"]},
    "LBORRES": {"desc": "laboratory result original value measured", "synonyms": ["lborres", "result", "value", "measured_value", "raw_result"]},
    "LBORRESU": {"desc": "laboratory result unit of measure", "synonyms": ["lborresu", "unit", "units", "uom"]},
    "LBSTNRLO": {"desc": "laboratory reference range lower limit normal", "synonyms": ["lbstnrlo", "ref_range_low", "lower_limit", "normal_low"]},
    "LBSTNRHI": {"desc": "laboratory reference range upper limit normal", "synonyms": ["lbstnrhi", "ref_range_high", "upper_limit", "normal_high"]},

    "WELLID": {"desc": "well position plate coordinate row column", "synonyms": ["well", "wellid", "well_position", "well_id", "plate_well"]},
    "PLATEID": {"desc": "plate identifier barcode batch", "synonyms": ["plateid", "plate_id", "plate_barcode", "plate_number"]},
    "SAMPLEID": {"desc": "sample identifier specimen barcode", "synonyms": ["sampleid", "sample_id", "specimen_id", "sample_barcode"]},
    "CONCENTRATION": {"desc": "compound concentration dose titration", "synonyms": ["conc", "concentration", "dose_uм", "compound_conc"]},
    "READOUT": {"desc": "assay readout signal measurement luminescence absorbance", "synonyms": ["readout", "signal", "od", "rlu", "fluorescence", "absorbance"]},
}

_word_re = re.compile(r"[a-z]+")


def _tokens(s: str) -> set:
    return set(_word_re.findall(s.lower().replace("_", " ").replace("-", " ")))


def map_variable(source_label: str, source_values_sample: list = None) -> dict:
    label_tokens = _tokens(source_label)
    label_lower = re.sub(r"[^a-z0-9]", "", source_label.lower())

    scores = {}
    for var, meta in TARGET_VARIABLES.items():
        desc_tokens = _tokens(meta["desc"])
        overlap = len(label_tokens & desc_tokens)
        union = len(label_tokens | desc_tokens) or 1
        desc_score = overlap / union * 2.2

        syn_score = 0.0
        for syn in meta["synonyms"]:
            syn_clean = re.sub(r"[^a-z0-9]", "", syn.lower())
            if label_lower == syn_clean:
                syn_score = 1.0
                break
            elif syn_clean in label_lower or label_lower in syn_clean:
                syn_score = max(syn_score, 0.78)

        score = min(1.0, max(desc_score, syn_score))
        scores[var] = round(score, 3)

    top3 = sorted(scores.items(), key=lambda x: x[1], reverse=True)[:3]
    best_var, best_score = top3[0]

    if best_score >= 0.85:
        action = "AUTO_MAP"
    elif best_score >= 0.55:
        action = "SURFACE_TO_USER"
    else:
        action = "REJECT"

    return {
        "source_label": source_label,
        "action": action,
        "top_match": best_var,
        "confidence": best_score,
        "candidates": [{"var": v, "score": s} for v, s in top3],
        "examples": source_values_sample or [],
    }


def map_columns(columns: list, examples_map: dict | None = None) -> list:
    """examples_map: optional {column_name: [example values]} — lets a
    REJECT (no vocabulary match) still carry real values instead of just a
    bare "no match" verdict, so the trace stays informative for columns
    that were never going to be clinical/lab vocabulary in the first place."""
    return [map_variable(c, source_values_sample=(examples_map or {}).get(c)) for c in columns]


def is_plate_layout(columns: list, first_col_values: list) -> bool:
    row_letters = {"A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P"}
    col_is_numeric_sequence = all(
        re.fullmatch(r"\d{1,2}", str(c).strip()) for c in columns[1:]
    ) if len(columns) > 1 else False
    first_col_is_row_letters = all(
        str(v).strip().upper() in row_letters for v in first_col_values if str(v).strip()
    )
    return col_is_numeric_sequence and first_col_is_row_letters


if __name__ == "__main__":
    import json as _json
    tests = ["TUMRESPONSE", "AE_GRADE", "WELL", "PLATE_BARCODE", "OD450", "Sample ID", "Concentration (uM)"]
    for t in tests:
        print(_json.dumps(map_variable(t), indent=2))
