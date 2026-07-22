import React from 'react';
import { Chip } from '@elaraai/east-app-design-system';

// brand = selected/active (the one legal tinted bg); dashed = ephemeral/draft.
export const Variants = () => (
  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
    <Chip>Geelong</Chip>
    <Chip variant="brand">Week 3</Chip>
    <Chip variant="dashed">Draft scenario</Chip>
  </div>
);

// Filter rail — dismissible chips with a caret'd scope picker.
export const FilterRail = () => (
  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
    <Chip caret>All sites</Chip>
    <Chip onDismiss={() => {}}>Line 2</Chip>
    <Chip onDismiss={() => {}}>Night shift</Chip>
    <Chip variant="brand" onDismiss={() => {}}>Overtime only</Chip>
  </div>
);

export const Compact = () => (
  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
    <Chip compact>FY26</Chip>
    <Chip compact variant="brand">Q2</Chip>
    <Chip compact variant="dashed">unsaved</Chip>
  </div>
);
