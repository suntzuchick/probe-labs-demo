import React, { useEffect, useRef, useState } from "react";
import vegaEmbed from "vega-embed";

// vega-lite's "width":"container" autosize measures clientWidth on
// vega-embed's own wrapper div, which vega-embed renders display:inline-block
// — that never resolves to a real width on its own (verified empirically: a
// real <svg width="0"> lands in the DOM, no console error, just invisible).
// Fix: measure this div's own width ourselves and pass a concrete pixel
// value instead of "container". Measured once at mount — re-measuring after
// vega-embed has already inserted content is circular and, inside a CSS
// grid/flex ancestor with default min-width:auto, can runaway-grow.
export default function VegaChart({ spec }) {
  const ref = useRef(null);
  const [state, setState] = useState("loading");
  const [errMsg, setErrMsg] = useState("");

  useEffect(() => {
    if (!spec) { setState("error"); setErrMsg("No chart spec was returned for this panel."); return; }
    if (!ref.current) return;
    const measuredWidth = ref.current.clientWidth;
    const resolvedSpec = spec.width === "container" && measuredWidth > 0 ? { ...spec, width: measuredWidth } : spec;
    setState("loading");
    vegaEmbed(ref.current, resolvedSpec, { actions: false, renderer: "svg" })
      .then(() => setState("ok"))
      .catch(e => { setState("error"); setErrMsg(e?.message || "Chart failed to render."); });
  }, [JSON.stringify(spec)]);

  return (
    <div style={{ minHeight: 220, minWidth: 0 }}>
      <div ref={ref} />
      {state === "loading" && <div style={{ fontSize: 11.5, color: "var(--ink-3)", padding: "70px 0", textAlign: "center" }}>Rendering chart…</div>}
      {state === "error" && <div style={{ fontSize: 11.5, color: "var(--red)", background: "#fdeceb", borderRadius: 8, padding: "10px 12px" }}>&#9888; Chart failed to render — {errMsg}</div>}
    </div>
  );
}
