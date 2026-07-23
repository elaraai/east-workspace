import React from 'react';
const css = `
.east-chip { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-body); font-size: 12px; font-weight: 500; padding: 4px 10px; border-radius: 4px; background: var(--paper); border: 1px solid var(--rule-strong); color: var(--ink-2); white-space: nowrap; line-height: 1; }
.east-chip.brand { background: var(--brand-tint); border-color: var(--brand); color: var(--brand-dd); }
.east-chip.dashed { border-style: dashed; color: var(--ink-4); }
.east-chip.compact { padding: 3px 8px; font-size: 11.5px; }
.east-chip .x, .east-chip .caret { color: var(--ink-4); margin-left: 2px; cursor: pointer; background: none; border: none; padding: 0; font: inherit; line-height: 1; }
.east-chip .x:hover { color: var(--ink); }
`;
if (typeof document !== 'undefined' && !document.getElementById('east-css-chip')) {
  const s = document.createElement('style'); s.id = 'east-css-chip'; s.textContent = css; document.head.appendChild(s);
}
export function Chip({ variant = 'default', compact = false, onDismiss, caret = false, children, style }) {
  const cls = ['east-chip', variant !== 'default' ? variant : '', compact ? 'compact' : ''].filter(Boolean).join(' ');
  return (
    <span className={cls} style={style}>
      {children}
      {caret && <span className="caret">▾</span>}
      {onDismiss && <button type="button" className="x" onClick={onDismiss} aria-label="Remove">×</button>}
    </span>
  );
}
