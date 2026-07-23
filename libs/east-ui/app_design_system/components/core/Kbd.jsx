import React from 'react';
const css = `
.east-kbd { font-family: var(--font-mono); font-size: 10px; font-weight: 600; letter-spacing: 0.04em; background: var(--paper-3); border: 1px solid var(--rule-strong); color: var(--ink); padding: 2px 6px; border-radius: 3px; display: inline-block; line-height: 1.3; }
`;
if (typeof document !== 'undefined' && !document.getElementById('east-css-kbd')) {
  const s = document.createElement('style'); s.id = 'east-css-kbd'; s.textContent = css; document.head.appendChild(s);
}
export function Kbd({ children, style }) {
  return <kbd className="east-kbd" style={style}>{children}</kbd>;
}
