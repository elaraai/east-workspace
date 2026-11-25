/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { it } from 'node:test';
import assert from 'node:assert/strict';
import { policyFlagRefusal } from './rack.js';

it('refuses a policy flag its verb would leave unread, naming where it belongs, and takes those it reads', () => {
  // The policy's own, given a rule
  assert.match(policyFlagRefusal('set', { spill: false }) ?? '', /^--spill\/--no-spill is the policy's, not a rule's: use e3 rack policy defaults --spill$/);
  assert.match(policyFlagRefusal('set', { claimTimeout: '30' }) ?? '', /is the policy's/);
  // A rule's own, given the defaults
  assert.match(policyFlagRefusal('defaults', { gpu: true }) ?? '', /^--gpu is a rule's: use e3 rack policy set <pattern> rack --gpu$/);
  assert.match(policyFlagRefusal('defaults', { memoryLimit: '8G' }) ?? '', /is a rule's/);
  // Either's, given a verb that reads none
  assert.match(policyFlagRefusal('enable', { size: 'large' }) ?? '', /^--size is taken by e3 rack policy set or defaults, not enable$/);
  assert.match(policyFlagRefusal('show', { spill: true }) ?? '', /is the policy's/);
  assert.match(policyFlagRefusal('reset', { size: 'large' }) ?? '', /not reset/);
  // What each verb reads
  assert.equal(policyFlagRefusal('set', { size: 'large', timeout: '60', allowHostAccess: true, memoryLimit: '8G', gpu: true }), undefined);
  assert.equal(policyFlagRefusal('defaults', { size: 'large', timeout: '60', claimTimeout: '30', spill: false, retryTaskFailuresLocally: true }), undefined);
  assert.equal(policyFlagRefusal('show', {}), undefined);
});

it('refuses each flag an earlier release took, with any verb, saying it was removed and why, never ignoring it', () => {
  for (const action of ['set', 'defaults', 'show', 'enable']) {
    assert.match(policyFlagRefusal(action, { weighFetch: true }) ?? '', /^--weigh-fetch\/--no-weigh-fetch was removed: work is no longer weighed for what it would fetch/);
    assert.match(policyFlagRefusal(action, { weighFetch: false }) ?? '', /^--weigh-fetch\/--no-weigh-fetch was removed/, '--no-weigh-fetch too');
    assert.match(policyFlagRefusal(action, { merges: 'local' }) ?? '', /^--merges was removed: a split task's merges run where its pieces run$/);
    assert.match(policyFlagRefusal(action, { keep: 'session' }) ?? '', /^--keep was removed: a rack keeps what your hub's tasks read and write for as long as the hub runs/);
  }
  // Beside flags the verb takes, the removed one is still refused
  assert.match(policyFlagRefusal('defaults', { spill: false, keep: 'split' }) ?? '', /^--keep was removed/);
});
