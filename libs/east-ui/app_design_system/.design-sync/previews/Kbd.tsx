import React from 'react';
import { Kbd } from '@elaraai/east-app-design-system';

export const Keys = () => (
  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
    <Kbd>⌘K</Kbd>
    <Kbd>⏎</Kbd>
    <Kbd>Esc</Kbd>
    <Kbd>Shift</Kbd>
  </div>
);

// Inline in running copy — shortcut hints stay in the text line.
export const InCopy = () => (
  <div style={{ fontSize: 13, color: 'var(--ink-3)', width: 420 }}>
    Press <Kbd>⌘K</Kbd> to open the command palette, <Kbd>⏎</Kbd> to apply the
    selected recommendation, <Kbd>Esc</Kbd> to dismiss.
  </div>
);
