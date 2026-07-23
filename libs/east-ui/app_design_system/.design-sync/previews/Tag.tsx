import React from 'react';
import { Tag } from '@elaraai/east-app-design-system';

// Key/value facts — mono key uppercase, mono tabular value.
export const Facts = () => (
  <div style={{ display: 'flex', gap: 20, alignItems: 'baseline' }}>
    <Tag k="site" v="Geelong" />
    <Tag k="horizon" v="14d" />
    <Tag k="cover" v="96.5%" />
    <Tag k="run" v="#4 812" />
  </div>
);

// Meta line under a frame title — facts separated by spacing alone.
export const MetaLine = () => (
  <div style={{ width: 480 }}>
    <div style={{ fontFamily: 'var(--font-brand)', fontSize: 20, fontWeight: 600, letterSpacing: '-0.01em' }}>
      Roster plan — week 3
    </div>
    <div style={{ display: 'flex', gap: 18, alignItems: 'baseline', marginTop: 6 }}>
      <Tag k="solver" v="MADS" />
      <Tag k="updated" v="07:42" />
      <Tag k="vs plan" v="+1.8%" />
    </div>
  </div>
);
