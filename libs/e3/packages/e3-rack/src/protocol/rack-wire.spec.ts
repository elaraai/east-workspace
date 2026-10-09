/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { it } from 'node:test';
import assert from 'node:assert/strict';
import { wireSamples } from './wire-samples.js';
import { wireGolden } from './wire-golden.js';

for (const sample of wireSamples) {
  it(`encodes ${sample.name} identically to pinned e3-cloud main`, () => {
    assert.equal(Buffer.from(sample.encode()).toString('hex'), wireGolden[sample.name]);
  });
}
