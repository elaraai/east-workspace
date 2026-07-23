import React from 'react';
const css = `
.east-btn { font-family: var(--font-body); font-size: 12.5px; font-weight: 500; padding: 6px 12px; border-radius: 6px; border: 1px solid var(--rule-strong); background: var(--paper); color: var(--ink); cursor: pointer; line-height: 1.15; white-space: nowrap; display: inline-flex; align-items: center; justify-content: center; gap: 6px; vertical-align: middle; transition: border-color var(--dur-fast), background var(--dur-fast), color var(--dur-fast); }
.east-btn:hover { border-color: var(--ink-3); }
.east-btn:focus-visible { outline: none; box-shadow: var(--shadow-focus); }
.east-btn.primary { background: var(--brand-d); color: var(--paper); font-weight: 600; border-color: var(--brand-d); }
.east-btn.primary:hover { background: var(--brand-dd); border-color: var(--brand-dd); }
.east-btn.ghost { background: transparent; border-color: transparent; color: var(--ink-3); }
.east-btn.ghost:hover { color: var(--ink); background: var(--paper-3); border-color: transparent; }
.east-btn.danger { color: var(--neg); }
.east-btn.danger:hover { border-color: var(--neg); }
.east-btn.commit { font-family: var(--font-mono); font-size: 11.5px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; }
.east-btn.compact { padding: 4px 8px; font-size: 11.5px; }
.east-btn:disabled { background: var(--paper-3); color: var(--ink-5); border-color: var(--rule-strong); cursor: not-allowed; }
`;
if (typeof document !== 'undefined' && !document.getElementById('east-css-button')) {
  const s = document.createElement('style'); s.id = 'east-css-button'; s.textContent = css; document.head.appendChild(s);
}
export function Button({ variant = 'default', compact = false, disabled = false, onClick, children, style }) {
  const cls = ['east-btn', variant !== 'default' ? variant : '', compact ? 'compact' : ''].filter(Boolean).join(' ');
  return <button type="button" className={cls} disabled={disabled} onClick={onClick} style={style}>{children}</button>;
}
