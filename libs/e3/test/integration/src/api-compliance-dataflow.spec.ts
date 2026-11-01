/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * API Compliance Tests: dataflow, records and record deploys — one part of
 * the shared e3-api-tests suites against the local server
 * (`compliance-parts.ts`).
 */

import { COMPLIANCE_PARTS, compliancePart, registerSuites } from './compliance-parts.js';

compliancePart('API compliance: dataflow, records and record deploys', { givenFetch: true }, ({ setup }) => {
  registerSuites(COMPLIANCE_PARTS.dataflow, setup);
});
