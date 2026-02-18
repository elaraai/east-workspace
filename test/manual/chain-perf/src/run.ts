/**
 * Chain performance benchmark runner.
 *
 * Executes chained dataflows and captures per-step timing from Step Functions history.
 *
 * Usage:
 *   npm run perf -- --chain 5 --compute serverless
 *   npm run perf -- --chain 3 --compute small
 *   npm run perf -- --all
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { variant } from '@elaraai/east';
import {
  dataflowExecuteLaunch,
  dataflowExecutePoll,
} from '@elaraai/e3-api-client';
import {
  setComputeBatch,
  removeCompute,
  listCompute,
  type ComputeSize,
} from '@elaraai/e3-admin-client';
import { SFNClient, ListExecutionsCommand } from '@aws-sdk/client-sfn';
import { getToken } from './credentials.js';
import { getExecutionTiming, formatTimingTable, type ExecutionTiming } from './sfn-timing.js';

const SERVER = 'https://dev.e3.elaraai.com';
const REPO_NAME = 'chain-perf-test';
const STATE_MACHINE_NAME = 'e3-dev-dataflow';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(__dirname, '..', '..', 'results');

const CHAIN_LENGTHS = [3, 5, 10];
const COMPUTE_TIERS = ['serverless', 'small', 'medium', 'large', 'xlarge'] as const;
type ComputeTier = typeof COMPUTE_TIERS[number];

const sfnClient = new SFNClient({});

function computeVariant(tier: ComputeTier): ComputeSize | null {
  if (tier === 'serverless') return null;
  return variant(tier, null);
}

/**
 * Resolve the state machine ARN from its name.
 */
async function getStateMachineArn(): Promise<string> {
  const { ListStateMachinesCommand } = await import('@aws-sdk/client-sfn');
  let nextToken: string | undefined;
  do {
    const result = await sfnClient.send(new ListStateMachinesCommand({
      maxResults: 100,
      nextToken,
    }));
    const match = result.stateMachines?.find(sm => sm.name === STATE_MACHINE_NAME);
    if (match) return match.stateMachineArn!;
    nextToken = result.nextToken;
  } while (nextToken);
  throw new Error(`State machine "${STATE_MACHINE_NAME}" not found`);
}

/**
 * Set compute tier for all tasks in a chain workspace.
 */
async function setChainCompute(workspace: string, chainLength: number, tier: ComputeTier, token: string): Promise<void> {
  const opts = { token };

  if (tier === 'serverless') {
    // Remove all compute configs to use default (serverless)
    const existing = await listCompute(SERVER, REPO_NAME, workspace, opts);
    for (const [taskName] of existing) {
      await removeCompute(SERVER, REPO_NAME, workspace, taskName, opts);
    }
    return;
  }

  const size = computeVariant(tier)!;
  const configs = new Map<string, ComputeSize>();
  for (let i = 0; i < chainLength; i++) {
    configs.set(`task-${i}`, size);
  }
  await setComputeBatch(SERVER, REPO_NAME, workspace, configs, opts);
}

/**
 * Find the SFN execution ARN for a dataflow execution that started after `afterTime`.
 */
async function findExecution(
  stateMachineArn: string,
  workspace: string,
  afterTime: Date,
): Promise<string> {
  const prefix = `dataflow-${REPO_NAME}-${workspace}-`;

  // Poll for the execution to appear (it may take a moment after launch)
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const result = await sfnClient.send(new ListExecutionsCommand({
      stateMachineArn,
      maxResults: 10,
    }));

    const match = result.executions?.find(e =>
      e.name?.startsWith(prefix) &&
      e.startDate && e.startDate >= afterTime
    );

    if (match?.executionArn) return match.executionArn;
    await sleep(1000);
  }

  throw new Error(`Could not find SFN execution for ${workspace} started after ${afterTime.toISOString()}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => global.setTimeout(r, ms));
}

/**
 * Run a single benchmark scenario.
 */
async function runScenario(
  chainLength: number,
  tier: ComputeTier,
  stateMachineArn: string,
): Promise<{ timing: ExecutionTiming; label: string }> {
  const workspace = `chain-${chainLength}`;
  const label = `Chain ${chainLength} / ${tier}`;
  const isFargate = tier !== 'serverless';
  const timeoutMs = isFargate ? chainLength * 600_000 : chainLength * 60_000;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Starting: ${label}`);
  console.log(`${'='.repeat(60)}`);

  // 1. Set compute tier
  let token = await getToken(SERVER);
  console.log(`Setting compute tier to '${tier}' for ${chainLength} tasks...`);
  await setChainCompute(workspace, chainLength, tier, token);

  // 2. Launch dataflow
  const launchTime = new Date();
  token = await getToken(SERVER);
  console.log('Launching dataflow (force=true)...');
  await dataflowExecuteLaunch(SERVER, REPO_NAME, workspace, { force: true }, { token });

  // 3. Poll until complete
  const startTime = Date.now();
  console.log('Polling for completion...');
  while (Date.now() - startTime < timeoutMs) {
    token = await getToken(SERVER);
    const state = await dataflowExecutePoll(SERVER, REPO_NAME, workspace, {}, { token });

    if (state.status.type === 'completed') {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`Dataflow completed in ${elapsed}s`);
      break;
    }
    if (state.status.type === 'failed' || state.status.type === 'aborted') {
      throw new Error(`Dataflow ${state.status.type}: ${JSON.stringify(state, (_k, v) => typeof v === 'bigint' ? v.toString() : v)}`);
    }

    // Log progress
    const events = (state as { events?: Array<{ type: string; value: Record<string, unknown> }> }).events;
    if (events && events.length > 0) {
      const completed = events.filter((e: { type: string }) => e.type === 'complete' || e.type === 'cached').length;
      process.stdout.write(`\r  Progress: ${completed}/${chainLength} tasks completed...`);
    }

    await sleep(2000);
  }

  if (Date.now() - startTime >= timeoutMs) {
    throw new Error(`Timeout after ${timeoutMs}ms`);
  }

  // 4. Find SFN execution and get timing
  console.log('Fetching Step Functions execution history...');
  const executionArn = await findExecution(stateMachineArn, workspace, launchTime);
  const timing = await getExecutionTiming(executionArn);

  // 5. Print results
  console.log(formatTimingTable(timing, label));

  return { timing, label };
}

/**
 * Save results to JSON file.
 */
function saveResults(
  results: Array<{ timing: ExecutionTiming; label: string }>,
  suffix: string,
): string {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const filename = `chain-perf-${suffix}-${timestamp}.json`;
  const filepath = join(RESULTS_DIR, filename);

  const output = {
    timestamp: new Date().toISOString(),
    results: results.map(r => ({
      label: r.label,
      totalMs: r.timing.totalMs,
      startupMs: r.timing.startupMs,
      finalizeMs: r.timing.finalizeMs,
      iterations: r.timing.iterations.map(it => ({
        iteration: it.iteration,
        totalMs: it.totalMs,
        steps: it.steps,
      })),
    })),
  };

  writeFileSync(filepath, JSON.stringify(output, null, 2));
  return filepath;
}

async function main() {
  const { values } = parseArgs({
    options: {
      chain: { type: 'string' },
      compute: { type: 'string', default: 'serverless' },
      all: { type: 'boolean', default: false },
    },
    strict: true,
  });

  // Resolve state machine ARN
  console.log('Looking up state machine ARN...');
  const stateMachineArn = await getStateMachineArn();
  console.log(`  Found: ${stateMachineArn}`);

  const results: Array<{ timing: ExecutionTiming; label: string }> = [];

  if (values.all) {
    // Run all chain lengths on the specified compute tier (or serverless)
    const tier = (values.compute ?? 'serverless') as ComputeTier;
    if (!COMPUTE_TIERS.includes(tier)) {
      console.error(`Invalid compute tier: ${tier}. Must be one of: ${COMPUTE_TIERS.join(', ')}`);
      process.exit(1);
    }
    for (const length of CHAIN_LENGTHS) {
      const result = await runScenario(length, tier, stateMachineArn);
      results.push(result);
    }
  } else if (values.chain) {
    const length = parseInt(values.chain, 10);
    if (!CHAIN_LENGTHS.includes(length)) {
      console.error(`Invalid chain length: ${length}. Must be one of: ${CHAIN_LENGTHS.join(', ')}`);
      process.exit(1);
    }
    const tier = (values.compute ?? 'serverless') as ComputeTier;
    if (!COMPUTE_TIERS.includes(tier)) {
      console.error(`Invalid compute tier: ${tier}. Must be one of: ${COMPUTE_TIERS.join(', ')}`);
      process.exit(1);
    }
    const result = await runScenario(length, tier, stateMachineArn);
    results.push(result);
  } else {
    console.log('Usage:');
    console.log('  npm run perf -- --chain <3|5|10> --compute <serverless|small|medium|large|xlarge>');
    console.log('  npm run perf -- --all [--compute <tier>]');
    process.exit(0);
  }

  // Save results
  if (results.length > 0) {
    const suffix = values.all ? `all-${values.compute ?? 'serverless'}` : `${values.chain}-${values.compute ?? 'serverless'}`;
    const filepath = saveResults(results, suffix);
    console.log(`\nResults written to: ${filepath}`);
  }

  // Print summary
  if (results.length > 1) {
    console.log('\n=== Summary ===');
    for (const r of results) {
      const numIterations = r.timing.iterations.length;
      const loopAvg = numIterations > 1
        ? Math.round(r.timing.iterations.slice(1).reduce((s, it) => s + it.totalMs, 0) / (numIterations - 1))
        : r.timing.iterations[0]?.totalMs ?? 0;
      console.log(`  ${r.label.padEnd(30)} total=${r.timing.totalMs}ms  loop-avg=${loopAvg}ms`);
    }
  }
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
