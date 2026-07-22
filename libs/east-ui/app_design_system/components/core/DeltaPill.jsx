import React from 'react';
const css = `
.east-delta { font-family: var(--font-mono); font-size: 11.5px; font-weight: 600; letter-spacing: 0.02em; padding: 2px 8px; border-radius: 3px; display: inline-flex; align-items: center; gap: 4px; background: var(--paper-3); color: var(--ink); border: 1px solid transparent; }
.east-delta.up { color: var(--pos); }
.east-delta.down { color: var(--neg); }
.east-delta.flat { color: var(--ink-4); }
.east-delta.brand { color: var(--brand-d); }
.east-delta.outlined { background: var(--paper-2); border-color: var(--rule-strong); border-radius: 3px; padding: 3px 8px; }
.east-delta.outlined.up { background: color-mix(in oklch, var(--pos) 6%, transparent); border-color: var(--pos); }
.east-delta.outlined.down { background: color-mix(in oklch, var(--neg) 6%, transparent); border-color: var(--neg); }
`;
if (typeof document !== 'undefined' && !document.getElementById('east-css-delta')) {
  const s = document.createElement('style'); s.id = 'east-css-delta'; s.textContent = css; document.head.appendChild(s);
}
const ARROWS = { up: '▲', down: '▼', flat: '—' };
export function DeltaPill({ dir = 'flat', outlined = false, arrow = true, children, style }) {
  const cls = ['east-delta', dir, outlined ? 'outlined' : ''].filter(Boolean).join(' ');
  return (
    <span className={cls} style={style}>
      {arrow && ARROWS[dir] && <span aria-hidden="true" style={{ fontSize: '9px' }}>{ARROWS[dir]}</span>}
      {children}
    </span>
  );
}
