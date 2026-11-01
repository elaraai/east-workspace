/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * API Compliance Tests: repositories, packages, workspaces, datasets and
 * functions — one part of the shared e3-api-tests suites against the local
 * server (`compliance-parts.ts`), and the check that the parts run every
 * suite of `apiTestSuites` once.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { apiTestSuites } from '@elaraai/e3-api-tests';

import { COMPLIANCE_PARTS, compliancePart, registerSuites } from './compliance-parts.js';

describe('API compliance, in parts', () => {
  it('runs every suite of apiTestSuites in one part', () => {
    const named = Object.values(COMPLIANCE_PARTS).flat();
    assert.deepEqual([...named].sort(), Object.keys(apiTestSuites).sort());
  });
});

compliancePart('API compliance: repositories, packages, workspaces, datasets and functions', { givenFetch: true }, ({ setup }) => {
  registerSuites(COMPLIANCE_PARTS.rest, setup);
});
