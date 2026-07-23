import React from 'react';
const css = `
.east-status { font-family: var(--font-mono); font-size: 11px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-3); display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
.east-status .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--ink-4); flex: none; }
.east-status .dot.ok { background: var(--pos); }
.east-status .dot.warn, .east-status .dot.mid { background: var(--warn); }
.east-status .dot.error, .east-status .dot.high { background: var(--neg); }
.east-status .dot.brand { background: var(--brand); }
.east-status .dot.ring { background: transparent; box-shadow: inset 0 0 0 1.5px var(--ink-4); }
.east-status .dot.live { background: var(--brand); box-shadow: 0 0 0 3px color-mix(in oklch, var(--brand) 18%, transparent); animation: east-pulse 2.4s ease-in-out infinite; }
.east-status .dot.run { background: var(--brand); animation: east-pulse 1.6s ease-in-out infinite; }
@keyframes east-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
`;
if (typeof document !== 'undefined' && !document.getElementById('east-css-status')) {
  const s = document.createElement('style'); s.id = 'east-css-status'; s.textContent = css; document.head.appendChild(s);
}
export function Status({ level = 'low', children, style }) {
  return (
    <span className="east-status" style={style}>
      <span className={'dot ' + level}></span>
      {children}
    </span>
  );
}
