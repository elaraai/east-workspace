import React from 'react';
import { Banner, Button } from '@elaraai/east-app-design-system';

// Guardrail breach — the warn wash never exceeds 8%.
export const Guard = () => (
  <div style={{ width: 560 }}>
    <Banner kind="guard" title="Outside guardrail." actions={<Button compact>Review</Button>}>
      Utilisation exceeds 92% in week 3; plan allows 88%.
    </Banner>
  </div>
);

// Dashed border = stale / ephemeral, per the dashed-is-ephemeral convention.
export const StaleAndPartial = () => (
  <div style={{ width: 560, display: 'grid', gap: 10 }}>
    <Banner kind="stale" title="Stale.">
      Demand feed last updated 26h ago; figures below may lag actuals.
    </Banner>
    <Banner kind="partial" title="Partial.">
      3 of 12 sites reporting. Totals exclude Geelong, Mackay, Whyalla.
    </Banner>
  </div>
);

// Pending change — brand tint marks dirty state until committed.
export const Change = () => (
  <div style={{ width: 560 }}>
    <Banner
      kind="change"
      title="4 edits pending."
      actions={<><Button compact>Discard</Button><Button compact variant="commit">Commit</Button></>}
    >
      Roster changes apply to next 14 days on commit.
    </Banner>
  </div>
);

export const Error = () => (
  <div style={{ width: 560 }}>
    <Banner kind="error" title="Solver failed." actions={<Button compact>Retry</Button>}>
      Infeasible after 214s: demand cover constraint conflicts with leave lock.
    </Banner>
  </div>
);
