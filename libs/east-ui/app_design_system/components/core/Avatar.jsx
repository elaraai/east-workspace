import React from 'react';
const css = `
.east-avatar { display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; background: var(--paper-3); border: 1px solid var(--rule); font-family: var(--font-mono); font-weight: 600; color: var(--ink-2); letter-spacing: 0; flex: none; }
.east-avatar.filled { background: var(--brand-d); color: var(--paper); border-color: var(--brand-d); font-weight: 700; letter-spacing: 0.05em; }
`;
if (typeof document !== 'undefined' && !document.getElementById('east-css-avatar')) {
  const s = document.createElement('style'); s.id = 'east-css-avatar'; s.textContent = css; document.head.appendChild(s);
}
export function Avatar({ initials, size = 22, filled = false, style }) {
  return (
    <span className={'east-avatar' + (filled ? ' filled' : '')}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42), ...style }}>
      {initials}
    </span>
  );
}
