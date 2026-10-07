/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * e3 API Compliance Tests
 *
 * Shared test suites for verifying e3 API implementations.
 * Works with both local (e3-api-server) and cloud (e3-aws) deployments.
 *
 * @example
 * ```typescript
 * import { describe } from 'node:test';
 * import { createServer } from '@elaraai/e3-api-server';
 * import { allTests, createTestContext, type TestSetup, type TestContext } from '@elaraai/e3-api-tests';
 *
 * const setup: TestSetup<TestContext> = async (t) => {
 *   const ctx = await createTestContext({
 *     baseUrl: 'http://localhost:3000',
 *     getToken: async () => 'test-token',
 *     getReaderToken: async (repo) => readerTokenFor(repo),
 *     cleanup: true,
 *   });
 *   t.after(() => ctx.cleanup());
 *   return ctx;
 * };
 *
 * describe('API compliance', { concurrency: true }, () => {
 *   allTests(setup, () => ({ E3_CREDENTIALS_PATH: '/path/to/creds' }));
 * });
 * ```
 */

// Setup type
export { type TestSetup } from './setup.js';

// Context and configuration
export { createTestContext, type TestConfig, type TestContext } from './context.js';

// Fixture creation utilities
export {
  createPackageZip,
  createFunctionPackageZip,
  createMultiInputPackageZip,
  createStringPackageZip,
  createTablePackageZip,
  createDiamondPackageZip,
  createParallelMixedPackageZip,
  createFailingDiamondPackageZip,
  createWideParallelPackageZip,
  createSlowDiamondPackageZip,
} from './fixtures.js';

// CLI utilities
export {
  runE3Command,
  spawnE3Command,
  getE3CliPath,
  waitFor,
  type CliResult,
  type RunE3Options,
  type RunningCliProcess,
} from './cli.js';

// Diagnostic assertions
export { assertDataflowSucceeded, describeDataflowResult } from './assertions.js';

// Test suites
export { repositoryTests } from './suites/repository.js';
export { packageTests } from './suites/packages.js';
export { workspaceTests } from './suites/workspaces.js';
export { datasetTests } from './suites/datasets.js';
export { datasetPageTests } from './suites/dataset-pages.js';
export { datasetTransferTests } from './suites/dataset-transfer.js';
export { dataflowTests } from './suites/dataflow.js';
export { functionTests } from './suites/functions.js';
export { recordTests } from './suites/records.js';
export { keyedRecordTests } from './suites/records-keyed.js';
export { recordDeployTests } from './suites/record-deploy.js';
export { inputDeployTests } from './suites/input-deploy.js';
export { platformTests } from './suites/platform.js';
export { cliTests } from './suites/cli.js';
export { transferTests } from './suites/transfer.js';
export { packageTransferTests } from './suites/package-transfer.js';

import type { TestContext } from './context.js';
import type { TestSetup } from './setup.js';
import { repositoryTests } from './suites/repository.js';
import { packageTests } from './suites/packages.js';
import { workspaceTests } from './suites/workspaces.js';
import { datasetTests } from './suites/datasets.js';
import { datasetPageTests } from './suites/dataset-pages.js';
import { datasetTransferTests } from './suites/dataset-transfer.js';
import { dataflowTests } from './suites/dataflow.js';
import { functionTests } from './suites/functions.js';
import { recordTests } from './suites/records.js';
import { keyedRecordTests } from './suites/records-keyed.js';
import { recordDeployTests } from './suites/record-deploy.js';
import { inputDeployTests } from './suites/input-deploy.js';
import { platformTests } from './suites/platform.js';
import { cliTests } from './suites/cli.js';
import { transferTests } from './suites/transfer.js';
import { packageTransferTests } from './suites/package-transfer.js';

/**
 * Every API test suite (excluding CLI tests), by name, in the order
 * {@link allApiTests} registers them.
 *
 * @remarks
 * For a harness that runs the suites in parts — a test file each, to keep
 * each file's time well inside its limit — and checks that its parts name
 * every suite here once, so a suite added here is run there too.
 */
export const apiTestSuites: Readonly<Record<string, (setup: TestSetup<TestContext>) => void>> = {
  repository: repositoryTests,
  packages: packageTests,
  workspaces: workspaceTests,
  datasets: datasetTests,
  datasetPages: datasetPageTests,
  datasetTransfer: datasetTransferTests,
  dataflow: dataflowTests,
  functions: functionTests,
  records: recordTests,
  keyedRecords: keyedRecordTests,
  recordDeploy: recordDeployTests,
  inputDeploy: inputDeployTests,
  packageTransfer: packageTransferTests,
  platform: platformTests,
};

/**
 * Register all API test suites (excluding CLI tests): every suite of
 * {@link apiTestSuites}, in order.
 *
 * CLI tests require additional credentials setup and are registered separately.
 *
 * @param setup - Factory that creates a fresh test context per test
 */
export function allApiTests(setup: TestSetup<TestContext>): void {
  for (const register of Object.values(apiTestSuites)) register(setup);
}

/**
 * Register all test suites including CLI tests.
 *
 * @param setup - Factory that creates a fresh test context per test
 * @param getCredentialsEnv - Function that returns env vars for CLI auth
 */
export function allTests(
  setup: TestSetup<TestContext>,
  getCredentialsEnv: () => Record<string, string>
): void {
  allApiTests(setup);
  cliTests(setup, getCredentialsEnv);
  transferTests(setup, getCredentialsEnv);
}
