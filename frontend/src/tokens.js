// Design tokens — ported from the Probe reference UI (rebranded from the
// original "Helix" prototype; no "Helix" naming anywhere in this app).
export const C = {
  bg: "#FDFAFC", cream: "#FDF9F0", canvas: "#FEFCFE", ink: "#1A1520", plum: "#4E0C70",
  muted: "#4A424F", muted2: "#7A6A78", faint: "#A594A2",
  line: "#F1E4EF", line2: "#F0DCEC", line3: "#C9B3C6",
  pink: "#FF75D7", pinkPale: "#F5C4E6", pinkBg: "#FEF0FA",
  blue: "#2289FA", blueBg: "#EAF2FE", violet: "#7C4DFF", violetSoft: "#C6B6FF", violetBg: "#F2ECFF",
  orange: "#FF541C", sand: "#F9BB6E", green: "#1B7A45", greenBg: "#E7F5EC",
  amber: "#9A6410", amberBg: "#FDF1E3", red: "#B3261E", redBg: "#FDECEA",
  soft: "#FBF1F8", soft2: "#FDF7FC", term: "#0A1420",
  grad: "linear-gradient(90deg,#FF75D7,#4E0C70)",
  sans: "'Hanken Grotesk',sans-serif", disp: "'Space Grotesk',sans-serif",
  serif: "'Spectral',Georgia,serif", mono: "'JetBrains Mono',monospace",
};

export const ax = { tick: { fill: C.muted2, fontSize: 10, fontFamily: C.mono }, stroke: C.line2, tickLine: false };
export const tp = { contentStyle: { background: "#fff", border: `1px solid ${C.line}`, borderRadius: 9, fontFamily: C.mono, fontSize: 11 } };

// Agent roster — spec §4.1, fixed set of six.
export const AGENTS = {
  extract: { n: "Extraction agent", c: C.blue, d: "reads files, maps columns to canonical schema" },
  quality: { n: "Conformance agent", c: C.orange, d: "checks codelists, proposes fixes" },
  index: { n: "Cognition agent", c: C.violet, d: "builds indexes, classifies what the data can answer" },
  hypo: { n: "Hypothesis agent", c: C.pink, d: "generates candidate narratives, ranked" },
  narr: { n: "Narrative agent", c: C.plum, d: "composes dashboards + prose from evidence" },
  oracle: { n: "Oracle agent", c: C.pink, d: "fetches external truth, reconciles sources" },
};

export const ST = {
  published: { c: C.green, bg: C.greenBg, l: "Published" },
  review: { c: C.amber, bg: C.amberBg, l: "Review" },
  contradicted: { c: C.red, bg: C.redBg, l: "Contradicted" },
  blocked: { c: C.line3, bg: C.soft2, l: "Blocked" },
};

export const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&family=Spectral:ital,wght@0,400;0,500;1,400&family=JetBrains+Mono:wght@400;500&display=swap');
*{box-sizing:border-box}body{margin:0}
@keyframes fade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@keyframes slide{from{transform:translateX(24px);opacity:0}to{transform:none;opacity:1}}
@keyframes shatter{from{opacity:0;transform:scale(.4)}to{opacity:1}}
@keyframes pulse{0%,100%{opacity:.35}50%{opacity:1}}
@keyframes flash{0%,100%{background:transparent}50%{background:#FDF1E3}}
@keyframes alarm{0%,100%{box-shadow:0 0 0 0 rgba(154,100,16,.35)}50%{box-shadow:0 0 0 7px rgba(154,100,16,0)}}
@keyframes arrive{from{opacity:0;transform:translateY(-6px) scale(.94)}to{opacity:1;transform:none}}
@keyframes shimmer{0%{background-position:-380px 0}100%{background-position:380px 0}}
.recomputing{position:relative;overflow:hidden}
.recomputing::after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,117,215,.14),transparent);background-size:380px 100%;animation:shimmer 1.1s infinite;pointer-events:none}
.row:hover{background:${C.soft2}} .nav:hover{background:${C.soft}}
textarea{border:none;outline:none;resize:none;width:100%;background:transparent}
::-webkit-scrollbar{width:9px}::-webkit-scrollbar-thumb{background:${C.line2};border-radius:6px}
`;
