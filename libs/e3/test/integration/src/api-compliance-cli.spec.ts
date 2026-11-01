/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * API Compliance Tests: the CLI, transfers between repositories and workspace
 * bundles — the part of the shared e3-api-tests suites against the local
 * server (`compliance-parts.ts`) that are not `apiTestSuites`.
 */

import { cliTests, transferTests, workspaceBundleTests } from '@elaraai/e3-api-tests';

import { compliancePart } from './compliance-parts.js';

compliancePart('API compliance: the CLI, transfers and workspace bundles', ({ setup, credentialsEnv }) => {
  // The bundle routes, which the local server mounts
  workspaceBundleTests(setup);

  // The CLI suite, with the admin's credentials
  cliTests(setup, credentialsEnv);

  // Transfers between repositories
  transferTests(setup, credentialsEnv);
});
