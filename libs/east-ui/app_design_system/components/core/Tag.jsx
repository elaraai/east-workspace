import React from 'react';
const css = `
.east-tag { display: inline-flex; gap: 6px; align-items: baseline; font-family: var(--font-mono); font-size: 11.5px; font-weight: 500; color: var(--ink-3); white-space: nowrap; }
.east-tag .k { color: var(--ink-4); letter-spacing: 0.1em; text-transform: uppercase; font-size: 10px; font-weight: 600; }
.east-tag .v { color: var(--ink); font-weight: 600; font-feature-settings: "tnum" 1; }
`;
if (typeof document !== 'undefined' && !document.getElementById('east-css-tag')) {
  const s = document.createElement('style'); s.id = 'east-css-tag'; s.textContent = css; document.head.appendChild(s);
}
export function Tag({ k, v, style }) {
  return (
    <span className="east-tag" style={style}>
      <span className="k">{k}</span>
      <span className="v">{v}</span>
    </span>
  );
}
