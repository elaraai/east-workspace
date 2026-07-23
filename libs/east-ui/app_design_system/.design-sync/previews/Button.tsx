import React from 'react';
import { Button } from '@elaraai/east-app-design-system';

// Variant sweep — one primary per surface, right-aligned in real use.
export const Variants = () => (
  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
    <Button variant="primary">Apply</Button>
    <Button>Discard</Button>
    <Button variant="ghost">Edit</Button>
    <Button variant="danger">Remove</Button>
  </div>
);

// Commit bar — mono uppercase `commit` reserved for state-changing commits.
export const CommitActions = () => (
  <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
    <Button variant="ghost">Review 4 changes</Button>
    <Button>Discard all</Button>
    <Button variant="commit">Commit changes</Button>
  </div>
);

// Dense contexts — toolbars, table rows.
export const Compact = () => (
  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
    <Button compact>Rerun</Button>
    <Button compact variant="ghost">Export csv</Button>
    <Button compact variant="primary">Accept plan</Button>
  </div>
);

export const Disabled = () => (
  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
    <Button disabled>Apply</Button>
    <Button variant="primary" disabled>Commit changes</Button>
  </div>
);
