/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { it } from 'node:test';
import assert from 'node:assert/strict';
import { policyFlagRefusal } from './rack.js';

it('refuses a policy flag its verb would leave unread, naming where it belongs, and takes those it reads', () => {
  // The policy's own, given a rule
  assert.match(policyFlagRefusal('set', { weighFetch: true }) ?? '', /^--weigh-fetch\/--no-weigh-fetch is the policy's, not a rule's: use e3 rack policy defaults --weigh-fetch$/);
  assert.match(policyFlagRefusal('set', { weighFetch: false }) ?? '', /is the policy's, not a rule's/, '--no-weigh-fetch too');
  assert.match(policyFlagRefusal('set', { keep: 'session' }) ?? '', /^--keep is the policy's, not a rule's: use e3 rack policy defaults --keep$/);
  assert.match(policyFlagRefusal('set', { spill: false }) ?? '', /is the policy's/);
  // A rule's own, given the defaults
  assert.match(policyFlagRefusal('defaults', { gpu: true }) ?? '', /^--gpu is a rule's: use e3 rack policy set <pattern> rack --gpu$/);
  assert.match(policyFlagRefusal('defaults', { memoryLimit: '8G' }) ?? '', /is a rule's/);
  // Either's, given a verb that reads none
  assert.match(policyFlagRefusal('enable', { merges: 'local' }) ?? '', /^--merges is taken by e3 rack policy set or defaults, not enable$/);
  assert.match(policyFlagRefusal('show', { weighFetch: true }) ?? '', /is the policy's/);
  assert.match(policyFlagRefusal('reset', { size: 'large' }) ?? '', /not reset/);
  // What each verb reads
  assert.equal(policyFlagRefusal('set', { size: 'large', timeout: '60', allowHostAccess: true, memoryLimit: '8G', gpu: true, merges: 'local' }), undefined);
  assert.equal(policyFlagRefusal('defaults', { size: 'large', timeout: '60', claimTimeout: '30', spill: false, retryTaskFailuresLocally: true,
    weighFetch: true, merges: 'local', keep: 'session' }), undefined);
  assert.equal(policyFlagRefusal('show', {}), undefined);
});
