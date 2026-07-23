import React from 'react';
import { Status } from '@elaraai/east-app-design-system';

// Dot + uppercase mono word — never a tinted badge.
export const Levels = () => (
  <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
    <Status level="ok">Reconciled</Status>
    <Status level="warn">Drift 2.4%</Status>
    <Status level="error">Failed</Status>
    <Status>Idle</Status>
  </div>
);

// Animated dots: `live` (haloed pulse) for live feeds, `run` for running jobs;
// `ring` (hollow) for queued / not-started.
export const Activity = () => (
  <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
    <Status level="live">Live</Status>
    <Status level="run">Optimising</Status>
    <Status level="ring">Queued</Status>
    <Status level="brand">Selected</Status>
  </div>
);

// Row context — status cells in a monitor list.
export const InRows = () => (
  <div style={{ display: 'grid', gap: 0, width: 360 }}>
    {[
      ['Demand forecast', 'ok', 'Reconciled'],
      ['Roster feed', 'warn', 'Stale 2h'],
      ['Solver run', 'run', 'Running'],
    ].map(([name, level, word]) => (
      <div key={name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--rule)' }}>
        <span style={{ fontSize: 13 }}>{name}</span>
        <Status level={level as any}>{word}</Status>
      </div>
    ))}
  </div>
);
