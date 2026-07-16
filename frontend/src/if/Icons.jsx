import React from "react";

// Generic stroke-path icon — mirrors the mockup's inline SVGs without
// repeating the same five attributes on every call site.
export function Ic({ d, size = 15, fill = "none", stroke = "currentColor", sw = 1.8, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" {...rest}>
      <path d={d} />
    </svg>
  );
}

export const SPARK = "M12 2l2.2 6.1L20 10l-5.8 1.9L12 18l-2.2-6.1L4 10l5.8-1.9z";

export function Spark({ size = 20, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" {...rest}>
      <path d={SPARK} />
    </svg>
  );
}

export const PATHS = {
  overview: "M4 11l8-6 8 6v8a1 1 0 01-1 1h-5v-6h-4v6H5a1 1 0 01-1-1z",
  narratives: "M4 5h16v14H4z M8 5v14",
  evidence: "M4 5h16v14H4z M4 10h16",
  analyses: "M4 5h16v14H4z M8 15v-4 M12 15V9 M16 15v-2",
  datasets: "M4 5h16v14H4z M4 10h16 M10 10v9",
  oracles: "M12 4a8 8 0 100 16 8 8 0 000-16z M12 10.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3z",
  ide: "M9 8l-4 4 4 4 M15 8l4 4-4 4",
  reviews: "M4 5h16v14H4z M8 12l2.5 2.5L16 9",
  chevDown: "M6 9l6 6 6-6",
  search: "M20 20l-3.5-3.5",
  back: "M19 12H5M11 6l-6 6 6 6",
  close: "M6 6l12 12M18 6L6 18",
  check: "M20 6L9 17l-5-5",
  arrowRight: "M5 12h14M13 6l6 6-6 6",
  chevRight: "M9 6l6 6-6 6",
  circleDot: "M12 4a8 8 0 100 16 8 8 0 000-16z M12 12a1.5 1.5 0 100 3 1.5 1.5 0 000-3z",
  reportsIcon: "M4 5h16v11H4z M9 20h6",
};
