import React from 'react';
import { DeltaPill } from '@elaraai/east-app-design-system';

// Valence never saturates — pos/neg text on paper-3, mono tabular numerals.
export const Directions = () => (
  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
    <DeltaPill dir="up">+4.2%</DeltaPill>
    <DeltaPill dir="down">−1.8%</DeltaPill>
    <DeltaPill dir="flat">0.0%</DeltaPill>
    <DeltaPill dir="brand" arrow={false}>vs plan</DeltaPill>
  </div>
);

// Outlined — the ≤8% valence wash variant for standalone emphasis.
export const Outlined = () => (
  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
    <DeltaPill dir="up" outlined>+12 shifts</DeltaPill>
    <DeltaPill dir="down" outlined>−$8 400</DeltaPill>
  </div>
);

// Beside a KPI number — the pill carries the change, the hero carries the level.
export const WithKpi = () => (
  <div style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
    <span style={{ fontFamily: 'var(--font-mono)', fontFeatureSettings: '"tnum" 1', fontSize: 32, fontWeight: 600 }}>
      92.4%
    </span>
    <DeltaPill dir="up">+1.6 pts</DeltaPill>
  </div>
);
