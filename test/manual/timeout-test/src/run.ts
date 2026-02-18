/**
 * Manual timeout test for Fargate and serverless compute.
 *
 * Tests that tasks exceeding their configured timeout are properly terminated
 * and reported as failed. Uses a 1-minute timeout with a task that runs an
 * infinite loop (while(true)), ensuring it will be killed by the timeout.
 *
 * Usage:
 *   AWS_PROFILE=elaraai-dev-elara-e3 npx tsx src/run.ts
 *   AWS_PROFILE=elaraai-dev-elara-e3 npx tsx src/run.ts --compute serverless
 *   AWS_PROFILE=elaraai-dev-elara-e3 npx tsx src/run.ts --compute small
 *   AWS_PROFILE=elaraai-dev-elara-e3 npx tsx src/run.ts --compute both
 *
 * Expected wall time: ~2 min (serverless), ~4 min (small, includes cold start).
 */

import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseArgs } from 'node:util';
import { variant } from '@elaraai/east';
import { BooleanType, IntegerType, East } from '@elaraai/east';
import e3 from '@elaraai/e3';
import {
  repoCreate,
  repoRemove,
  packageImport,
  workspaceCreate,
  workspaceDeploy,
  dataflowExecuteLaunch,
  dataflowExecutePoll,
} from '@elaraai/e3-api-client';
import {
  setCompute,
  setTimeout as setTaskTimeout,
} from '@elaraai/e3-admin-client';
import { getToken } from './credentials.js';

const SERVER = 'https://dev.e3.elaraai.com';
const TIMEOUT_MINUTES = 1n;

type ComputeTier = 'serverless' | 'small';

function sleep(ms: number): Promise<void> {
  return new Promise(r => global.setTimeout(r, ms));
}

/**
 * Create a package with a task that runs an infinite loop.
 * The while(true) loop will spin forever until the timeout kills the process.
 */
async function createSlowPackage(tempDir: string): Promise<string> {
  const input = e3.input('value', IntegerType, 42n);
  const task = e3.task(
    'slow',
    [input],
    East.function([IntegerType], IntegerType, ($, x) => {
      $.while(true, () => {
        // Infinite loop — will be killed by timeout
      });
      return x;
    })
  );
  const pkg = e3.package('timeout-pkg', '1.0.0', task);

  const zipPath = join(tempDir, 'timeout-pkg-1.0.0.zip');
  await e3.export(pkg, zipPath);
  return zipPath;
}

/**
 * Run a single timeout test scenario.
 */
async function runScenario(tier: ComputeTier): Promise<void> {
  const label = `timeout-${tier}`;
  const repoName = `timeout-test-${tier}-${Date.now()}`;
  const workspace = 'timeout-ws';
  const taskName = 'slow';

  // Generous overall timeout: 1 min task timeout + cold start + polling overhead
  const pollTimeoutMs = 600_000; // 10 min

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Timeout Test: ${tier} compute`);
  console.log(`  Repo: ${repoName}`);
  console.log(`  Task timeout: ${TIMEOUT_MINUTES} minute(s)`);
  console.log(`  Task: infinite loop (should be killed by timeout)`);
  console.log(`${'='.repeat(60)}`);

  try {
    // 1. Create repo
    let token = await getToken(SERVER);
    console.log(`[${label}] Creating repo '${repoName}'...`);
    await repoCreate(SERVER, repoName, { token });

    // 2. Create and import slow package
    const tempDir = mkdtempSync(join(tmpdir(), 'e3-timeout-test-'));

    console.log(`[${label}] Creating slow package (infinite while loop)...`);
    const zipPath = await createSlowPackage(tempDir);

    token = await getToken(SERVER);
    const packageZip = readFileSync(zipPath);
    console.log(`[${label}] Importing package...`);
    await packageImport(SERVER, repoName, packageZip, { token });

    // 3. Create workspace and deploy
    token = await getToken(SERVER);
    console.log(`[${label}] Creating workspace '${workspace}'...`);
    await workspaceCreate(SERVER, repoName, workspace, { token });

    token = await getToken(SERVER);
    console.log(`[${label}] Deploying package...`);
    await workspaceDeploy(SERVER, repoName, workspace, 'timeout-pkg@1.0.0', { token });

    // 4. Set timeout (1 minute)
    token = await getToken(SERVER);
    console.log(`[${label}] Setting timeout to ${TIMEOUT_MINUTES} minute(s)...`);
    await setTaskTimeout(SERVER, repoName, workspace, taskName, { minutes: TIMEOUT_MINUTES }, { token });

    // 5. Set compute size (for Fargate tier)
    if (tier !== 'serverless') {
      token = await getToken(SERVER);
      console.log(`[${label}] Setting compute to '${tier}'...`);
      await setCompute(SERVER, repoName, workspace, taskName, variant(tier, null), { token });
    }

    // 6. Launch dataflow
    const startTime = Date.now();
    token = await getToken(SERVER);
    console.log(`[${label}] Launching dataflow (force=true)...`);
    await dataflowExecuteLaunch(SERVER, repoName, workspace, { force: true }, { token });

    // 7. Poll until completion
    console.log(`[${label}] Polling for completion (expecting timeout after ~${TIMEOUT_MINUTES} minute(s))...`);
    let finalState: unknown = null;
    while (Date.now() - startTime < pollTimeoutMs) {
      token = await getToken(SERVER);
      const state = await dataflowExecutePoll(SERVER, repoName, workspace, {}, { token });

      if (state.status.type === 'completed' || state.status.type === 'failed' || state.status.type === 'aborted') {
        finalState = state;
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`\n[${label}] Dataflow finished in ${elapsed}s with status: ${state.status.type}`);
        break;
      }

      // Log progress every poll
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      process.stdout.write(`\r[${label}] Waiting... ${elapsed}s elapsed`);
      await sleep(5000);
    }

    if (!finalState) {
      console.error(`\n[${label}] FAIL: Polling timed out after ${pollTimeoutMs}ms — task was not terminated by timeout`);
      return;
    }

    // 8. Verify results
    const state = finalState as { status: { type: string }; events: Array<{ type: string; value: Record<string, unknown> }> };
    console.log(`[${label}] Verifying results...`);

    const failEvent = state.events.find(
      (e: { type: string; value: Record<string, unknown> }) =>
        e.type === 'failed' && e.value.task === taskName
    );
    const errorEvent = state.events.find(
      (e: { type: string; value: Record<string, unknown> }) =>
        e.type === 'error' && e.value.task === taskName
    );

    if (failEvent) {
      console.log(`[${label}] PASS: Task '${taskName}' failed as expected (exitCode=${failEvent.value.exitCode})`);
    } else if (errorEvent) {
      console.log(`[${label}] PASS: Task '${taskName}' errored as expected (message=${errorEvent.value.message})`);
    } else {
      const taskEvents = state.events.filter(
        (e: { type: string; value: Record<string, unknown> }) => e.value.task === taskName
      );
      console.error(`[${label}] FAIL: Expected task to fail/error but got: ${JSON.stringify(taskEvents, (_k, v) => typeof v === 'bigint' ? v.toString() : v)}`);
    }

    const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[${label}] Total wall time: ${totalElapsed}s`);

  } finally {
    // 9. Cleanup
    try {
      const token = await getToken(SERVER);
      console.log(`[${label}] Cleaning up repo '${repoName}'...`);
      await repoRemove(SERVER, repoName, { token });
      console.log(`[${label}] Cleanup complete.`);
    } catch (err) {
      console.warn(`[${label}] Cleanup failed (non-fatal): ${err}`);
    }
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      compute: { type: 'string', default: 'both' },
    },
    strict: true,
  });

  const compute = values.compute ?? 'both';

  console.log('=== Timeout Test ===');
  console.log(`Compute tier: ${compute}`);
  console.log(`Timeout: ${TIMEOUT_MINUTES} minute(s)`);
  console.log('');

  if (compute === 'serverless' || compute === 'both') {
    await runScenario('serverless');
  }

  if (compute === 'small' || compute === 'both') {
    await runScenario('small');
  }

  if (compute !== 'serverless' && compute !== 'small' && compute !== 'both') {
    console.error(`Invalid compute tier: ${compute}. Must be: serverless, small, or both`);
    process.exit(1);
  }

  console.log('\n=== All timeout tests complete ===');
}

main().catch((err) => {
  console.error('Timeout test failed:', err);
  process.exit(1);
});
