"""
Deterministic renderer for Stage 7 dashboards.

The Code Builder (LLM) never emits chart code or pixels — only a tidy result
table plus a declaration of which columns play which visual role ("encoding").
This module turns {chart_type, encoding, data} into a real Vega-Lite spec.
Vega-Lite is rendered client-side via vega-embed, which gives hover tooltips,
click selections, and zoom/pan for free — the interactivity is a property of
the renderer, not something the LLM has to get right.
"""

CHART_TYPES = {"line", "step", "bar", "grouped_bar", "scatter", "histogram", "table", "forest", "waterfall"}

_REQUIRED_FIELDS = {
    "line": ["x", "y"],
    "step": ["x", "y"],
    "bar": ["x", "y"],
    "grouped_bar": ["x", "y", "color"],
    "scatter": ["x", "y"],
    "histogram": ["x"],
    "forest": ["x", "y", "x_low", "x_high"],
    "waterfall": ["x", "y"],
}

_FOREST_DEFAULTS = {"x": "estimate", "y": "label", "x_low": "ci_low", "x_high": "ci_high"}


def validate_encoding(chart_type: str, encoding: dict, data: list) -> str | None:
    """Returns an error message if the encoding can't actually be rendered against the given
    data, else None. This is what turns a silently-broken chart into a self-repair retry."""
    if chart_type not in _REQUIRED_FIELDS:
        return None
    encoding = encoding or {}
    row_keys = set(data[0].keys()) if data else None
    for role in _REQUIRED_FIELDS[chart_type]:
        val = encoding.get(role)
        if not val and chart_type == "forest":
            val = _FOREST_DEFAULTS.get(role)
        if not val or not isinstance(val, str):
            return f"encoding.{role} is missing for chart_type={chart_type!r} (got {val!r})"
        if row_keys is not None and val not in row_keys:
            return (f"encoding.{role}={val!r} does not match any column in the returned data "
                    f"(columns present: {sorted(row_keys)})")
    return None


# Mirrors frontend/src/insightforge.css's :root palette exactly — charts are
# rendered client-side by vega-embed from this spec, so this is the only
# place that can make a chart's colors match the rest of the app instead of
# falling back to Vega-Lite's own default categorical scheme (blue/orange
# tableau10), which doesn't match the site at all.
BLUE = "#2f6fe4"
PINK = "#e8508d"
GREEN = "#22b07d"
AMBER = "#f0a92c"
VIOLET = "#7c5cf5"   # --ai
ACCENT = "#e8842b"
RED = "#e0524a"
GRAY = "#8a8a95"      # --ink-3
CATEGORY_RANGE = [BLUE, PINK, GREEN, AMBER, VIOLET, ACCENT, RED, GRAY]

_BASE = {
    "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
    "width": "container",
    "height": 320,
    "background": "transparent",
    "config": {
        "font": "Inter",
        "axis": {"labelFont": "Inter", "titleFont": "Inter", "labelColor": GRAY, "titleColor": "#4a4a52",
                  "gridColor": "#ebebef", "domainColor": "#ebebef", "tickColor": "#ebebef"},
        "legend": {"labelFont": "Inter", "titleFont": "Inter", "labelColor": "#4a4a52", "titleColor": "#4a4a52"},
        "title": {"font": "Inter", "color": "#1a1a1c", "fontWeight": 600},
        "view": {"stroke": None},
        "range": {"category": CATEGORY_RANGE, "ordinal": CATEGORY_RANGE},
        "bar": {"color": BLUE},
        "point": {"color": BLUE},
        "line": {"color": BLUE},
        "circle": {"color": BLUE},
        "rule": {"color": GRAY},
    },
}


def _tooltip_fields(encoding: dict, data: list) -> list:
    fields = encoding.get("tooltip")
    if isinstance(fields, list) and fields:
        return [{"field": f} for f in fields if data and isinstance(f, str) and f in data[0]]
    if not data:
        return []
    return [{"field": k} for k in data[0].keys()]


def _line_or_step(chart_type: str, encoding: dict, data: list, title: str) -> dict:
    x, y, color = encoding.get("x"), encoding.get("y"), encoding.get("color")
    enc = {
        "x": {"field": x, "type": "quantitative", "title": x},
        "y": {"field": y, "type": "quantitative", "title": y},
        "tooltip": _tooltip_fields(encoding, data),
    }
    if color:
        enc["color"] = {"field": color, "type": "nominal", "title": color}
    mark = {"type": "line", "point": True, "interpolate": "step-after" if chart_type == "step" else "linear"}
    spec = {**_BASE, "title": title, "data": {"values": data}, "mark": mark, "encoding": enc}
    return spec


def _bar(encoding: dict, data: list, title: str) -> dict:
    x, y = encoding.get("x"), encoding.get("y")
    enc = {
        "x": {"field": x, "type": "nominal", "title": x, "sort": "-y"},
        "y": {"field": y, "type": "quantitative", "title": y},
        "tooltip": _tooltip_fields(encoding, data),
    }
    spec = {**_BASE, "title": title, "data": {"values": data}, "mark": "bar", "encoding": enc}
    return spec


def _grouped_bar(encoding: dict, data: list, title: str) -> dict:
    x, y, color = encoding.get("x"), encoding.get("y"), encoding.get("color")
    enc = {
        "x": {"field": x, "type": "nominal", "title": x},
        "y": {"field": y, "type": "quantitative", "title": y},
        "xOffset": {"field": color},
        "color": {"field": color, "type": "nominal", "title": color},
        "tooltip": _tooltip_fields(encoding, data),
    }
    spec = {**_BASE, "title": title, "data": {"values": data}, "mark": "bar", "encoding": enc}
    return spec


def _scatter(encoding: dict, data: list, title: str) -> dict:
    x, y, color = encoding.get("x"), encoding.get("y"), encoding.get("color")
    enc = {
        "x": {"field": x, "type": "quantitative", "title": x},
        "y": {"field": y, "type": "quantitative", "title": y},
        "tooltip": _tooltip_fields(encoding, data),
    }
    if color:
        enc["color"] = {"field": color, "type": "nominal", "title": color}
    spec = {**_BASE, "title": title, "data": {"values": data}, "mark": {"type": "point", "filled": True, "size": 80}, "encoding": enc}
    return spec


def _histogram(encoding: dict, data: list, title: str) -> dict:
    x, color = encoding.get("x"), encoding.get("color")
    enc = {
        "x": {"field": x, "type": "quantitative", "bin": True, "title": x},
        "y": {"aggregate": "count", "title": "count"},
        "tooltip": [{"field": x, "bin": True}, {"aggregate": "count", "title": "count"}],
    }
    if color:
        enc["color"] = {"field": color, "type": "nominal", "title": color}
    spec = {**_BASE, "title": title, "data": {"values": data}, "mark": "bar", "encoding": enc}
    return spec


def _forest(encoding: dict, data: list, title: str) -> dict:
    y = encoding.get("y", "label")
    x = encoding.get("x", "estimate")
    x_low = encoding.get("x_low", "ci_low")
    x_high = encoding.get("x_high", "ci_high")
    tooltip = _tooltip_fields(encoding, data)
    rule = {
        "mark": "rule",
        "encoding": {
            "y": {"field": y, "type": "nominal", "title": None},
            "x": {"field": x_low, "type": "quantitative", "title": x},
            "x2": {"field": x_high},
        },
    }
    point = {
        "mark": {"type": "point", "filled": True, "size": 120},
        "encoding": {
            "y": {"field": y, "type": "nominal"},
            "x": {"field": x, "type": "quantitative"},
            "tooltip": tooltip,
        },
    }
    ref_line = {
        "data": {"values": [{"ref": 1}]},
        "mark": {"type": "rule", "strokeDash": [4, 4], "color": GRAY},
        "encoding": {"x": {"field": "ref", "type": "quantitative"}},
    }
    spec = {**_BASE, "title": title, "data": {"values": data}, "layer": [rule, point, ref_line]}
    return spec


def _waterfall(encoding: dict, data: list, title: str) -> dict:
    x, y, color = encoding.get("x"), encoding.get("y"), encoding.get("color")
    enc = {
        "x": {"field": x, "type": "ordinal", "title": x, "sort": {"field": y, "order": "descending"}, "axis": None},
        "y": {"field": y, "type": "quantitative", "title": y},
        "tooltip": _tooltip_fields(encoding, data),
    }
    if color:
        enc["color"] = {"field": color, "type": "nominal", "title": color}
    spec = {**_BASE, "title": title, "data": {"values": data}, "mark": "bar", "encoding": enc}
    return spec


def build_spec(chart_type: str, encoding: dict, data: list, title: str = "") -> dict:
    encoding = encoding or {}
    if validate_encoding(chart_type, encoding, data) is not None:
        return None
    if chart_type in ("line", "step"):
        return _line_or_step(chart_type, encoding, data, title)
    if chart_type == "bar":
        return _bar(encoding, data, title)
    if chart_type == "grouped_bar":
        return _grouped_bar(encoding, data, title)
    if chart_type == "scatter":
        return _scatter(encoding, data, title)
    if chart_type == "histogram":
        return _histogram(encoding, data, title)
    if chart_type == "forest":
        return _forest(encoding, data, title)
    if chart_type == "waterfall":
        return _waterfall(encoding, data, title)
    return None
