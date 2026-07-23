import React from 'react';
import { Avatar } from '@elaraai/east-app-design-system';

export const SizesAndFill = () => (
  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
    <Avatar initials="EF" size={18} />
    <Avatar initials="EF" size={22} />
    <Avatar initials="EF" size={28} />
    <Avatar initials="EF" size={28} filled />
  </div>
);

// Assignment row — avatar + name + status word, the roster idiom.
export const InRoster = () => (
  <div style={{ display: 'grid', width: 340 }}>
    {[
      ['JM', 'J. Marsh', 'confirmed'],
      ['AO', 'A. Okafor', 'pending'],
      ['LT', 'L. Tran', 'leave'],
    ].map(([ini, name, note], i) => (
      <div key={ini} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--rule)' }}>
        <Avatar initials={ini} filled={i === 0} />
        <span style={{ fontSize: 13 }}>{name}</span>
        <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>{note}</span>
      </div>
    ))}
  </div>
);
