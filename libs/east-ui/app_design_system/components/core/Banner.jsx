import React from 'react';
const css = `
.east-banner { display: flex; gap: 10px; align-items: flex-start; padding: 10px 14px; border: 1px solid var(--rule-strong); border-radius: 4px; font-size: 13px; font-family: var(--font-body); color: var(--ink-2); background: var(--paper-2); }
.east-banner .b-glyph { font-family: var(--font-mono); font-weight: 700; flex: none; }
.east-banner .b-title { font-weight: 600; color: var(--ink); }
.east-banner .b-body { min-width: 0; line-height: 1.5; }
.east-banner .b-actions { margin-left: auto; display: flex; gap: 8px; flex: none; align-self: center; }
.east-banner.guard { background: color-mix(in oklch, var(--warn) 8%, transparent); border-color: var(--warn); }
.east-banner.guard .b-glyph { color: var(--warn); }
.east-banner.stale { border-style: dashed; color: var(--ink-3); }
.east-banner.stale .b-glyph { color: var(--ink-4); }
.east-banner.partial { color: var(--ink-3); }
.east-banner.partial .b-glyph { color: var(--ink-4); }
.east-banner.change { background: var(--brand-tint); border-color: var(--brand-d); color: var(--ink); }
.east-banner.change .b-glyph { color: var(--brand-d); }
.east-banner.error { background: color-mix(in oklch, var(--neg) 6%, transparent); border-color: var(--neg); }
.east-banner.error .b-glyph { color: var(--neg); }
`;
if (typeof document !== 'undefined' && !document.getElementById('east-css-banner')) {
  const s = document.createElement('style'); s.id = 'east-css-banner'; s.textContent = css; document.head.appendChild(s);
}
const GLYPHS = { guard: '!', stale: '~', partial: '…', change: '△', error: '✕' };
export function Banner({ kind = 'partial', glyph, title, actions, children, style }) {
  return (
    <div className={'east-banner ' + kind} style={style}>
      <span className="b-glyph" aria-hidden="true">{glyph ?? GLYPHS[kind] ?? '·'}</span>
      <div className="b-body">
        {title && <span className="b-title">{title} </span>}
        {children}
      </div>
      {actions && <div className="b-actions">{actions}</div>}
    </div>
  );
}
