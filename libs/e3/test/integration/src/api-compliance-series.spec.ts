/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * API Compliance Tests: records read in two dimensions, through their nested
 * series indexes, and where a narrowing's rows sit — one part of the shared
 * e3-api-tests suites against the local server (`compliance-parts.ts`).
 */

import { describe } from 'node:test';

import { COMPLIANCE_PART, COMPLIANCE_PARTS, compliancePart, registerSuites } from './compliance-parts.js';

describe('API compliance: records by series and by narrowing', COMPLIANCE_PART, () => {
  compliancePart({ givenFetch: true }, ({ setup }) => {
    registerSuites(COMPLIANCE_PARTS.series, setup);
  });
});
