/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DictType, East, IntegerType, SortedMap, StringType, compareFor, decodeBeast2For, encodeBeast2For, encodeEastIR, variant } from '@elaraai/east';
import e3, { type TaskDef } from '@elaraai/e3';
import { ExecutionAttempt } from './attempt.js';
import { Budget } from './budget.js';
import type { DetachedResult, DetachedSpec } from './interfaces.js';
import { LocalTaskRunner, type DetachedCallRequest, type ExecutionIds, type ExecutionResult, type TaskBodyExecutor, type TaskBodyRequest } from './LocalTaskRunner.js';
import { scratchRoot } from './scratch.js';
import { MockTaskRunner } from './MockTaskRunner.js';
import { readTestPieceBytesFrom } from './pieces.js';
import { LocalOrchestrator } from '../dataflow/orchestrator/LocalOrchestrator.js';
import { InMemoryStateStore } from '../dataflow/state-store/InMemoryStateStore.js';
import { inputsHash } from '../executions.js';
import { packageImport } from '../package-files.js';
import { packageRead } from '../packages.js';
import { LocalStorage } from '../storage/local/index.js';
import { createTestRepo, removeTestRepo } from '../test-helpers.js';
import { datasetWrite } from '../trees.js';
import { workspaceCreate, workspaceDeploy } from '../workspaces.js';

describe('task body executor', () => {
  let repo: string;
  let storage: LocalStorage;
  const double = East.function([IntegerType], IntegerType, ($, value) => value.multiply(2n));

  beforeEach(() => {
    repo = createTestRepo();
    storage = new LocalStorage();
    readTestPieceBytesFrom(() => '64');
  });
  afterEach(() => removeTestRepo(repo));

  async function deploy(task: TaskDef): Promise<string> {
    const zip = join(repo, 'test.zip');
    await e3.export(e3.package('body', '1.0.0', task), zip);
    await packageImport(storage, repo, zip);
    return (await packageRead(storage, repo, 'body', '1.0.0')).tasks.get(task.name)!;
  }

  async function plain(): Promise<{ hash: string; inputs: string[] }> {
    const input = e3.input('input', IntegerType, variant('value', 2n));
    return {
      hash: await deploy(e3.task('double', [input], double)),
      inputs: [await datasetWrite(storage, repo, 2n, IntegerType)],
    };
  }

  it('routes a cache miss once, preserves fallback identity and output, and ignores graph name in cache identity', async () => {
    const { hash, inputs } = await plain();
    const calls: TaskBodyRequest[] = [];
    const runner = new LocalTaskRunner(repo, undefined, { body: (request, local) => {
      calls.push(request);
      return local();
    } });
    const first = await runner.execute(storage, hash, inputs, { taskName: 'double' });
    assert.equal(first.state, 'success', first.error);
    assert.equal(calls.length, 1);
    const request = calls[0]!;
    assert.equal(request.role, 'task');
    assert.equal(request.unit, undefined);
    assert.equal(request.options.taskName, 'double');
    assert.equal(first.executionId, request.ids.executionId);
    const second = await runner.execute(storage, hash, inputs, { taskName: 'another_name' });
    assert.equal(second.cached, true);
    assert.equal(second.executionId, first.executionId);
    assert.equal(calls.length, 1);

    const local = await new LocalTaskRunner(repo).execute(storage, hash, inputs, { force: true });
    assert.equal(local.state, 'success', local.error);
    assert.equal(local.outputHash, first.outputHash);
    for (const stream of ['stdout', 'stderr'] as const) {
      const read = (id: string) => storage.logs.read(repo, hash, inputsHash(inputs), id, stream);
      assert.equal((await read(first.executionId)).data, (await read(local.executionId)).data);
    }
    const status = await storage.refs.executionGet(repo, hash, inputsHash(inputs), first.executionId);
    assert.equal(status?.type, 'success');
    assert.ok(status?.type === 'success' && !status.value.unit);
  });

  it('runs a replacement while the whole local budget is held, and caches its own record', async () => {
    const { hash, inputs } = await plain();
    const budget = new Budget({ cores: 1, memory: 1024 }, { sampler: null });
    const held = await budget.acquire();
    let called = 0;
    try {
      const runner = new LocalTaskRunner(repo, budget, { body: async (request) => {
        called++;
        const output = await datasetWrite(storage, repo, 4n, IntegerType);
        return new ExecutionAttempt(storage, repo, hash, inputs, request.ids, false).recordSuccess(output, 512);
      } });
      const first = await runner.execute(storage, hash, inputs);
      assert.equal(first.state, 'success');
      const latest = await storage.refs.executionGetLatest(repo, hash, inputsHash(inputs));
      assert.equal(latest?.value.executionId, first.executionId);
      assert.equal(latest?.type, 'success');
      const again = await runner.execute(storage, hash, inputs);
      assert.equal(again.cached, true);
      assert.equal(again.peakBytes, 512);
      assert.equal(called, 1);
    } finally {
      held.release();
    }
  });

  for (const kind of ['dict', 'fold'] as const) {
    it(`passes pieces and ${kind} merges with the complete unit, while the engine owns the logical record`, async () => {
      const type = DictType(IntegerType, IntegerType);
      const input = e3.input('rows', type);
      const task = kind === 'dict'
        ? e3.streamTask('counts', {
          inputs: [e3.partition(input)],
          output: e3.output.dict(IntegerType, IntegerType, { merge: (_$, _key, a, b) => a.add(b) }),
        }, ($, rows, emit) => { $.for(rows, ($, _value, _key) => { $(emit(0n, 1n)); }); })
        : e3.streamTask('total', {
          inputs: [e3.partition(input)],
          output: e3.output.fold(IntegerType, { zero: 0n, combine: (_$, a, b) => a.add(b) }),
        }, ($, rows, emit) => { $.for(rows, ($, _value, _key) => { $(emit(1n)); }); });
      const hash = await deploy(task);
      const rows = new SortedMap(Array.from({ length: 8000 }, (_, i) => [BigInt(i), BigInt(i)] as [bigint, bigint]), compareFor(IntegerType));
      const inputs = [await datasetWrite(storage, repo, rows, type)];
      const calls: TaskBodyRequest[] = [];
      const runner = new LocalTaskRunner(repo, undefined, { body: (request, local) => {
        calls.push(request);
        return local();
      } });
      const result = await runner.execute(storage, hash, inputs, { taskName: task.name });
      assert.equal(result.state, 'success', result.error);
      assert.ok(calls.filter((c) => c.unit?.merge === null).length > 1);
      assert.ok(calls.some((c) => c.unit?.merge !== null));
      for (const call of calls) {
        assert.equal(call.role, 'unit');
        assert.equal(call.logicalTaskHash, hash);
        assert.equal(call.options.taskName, task.name);
        assert.equal(call.unit?.own, false);
        assert.deepEqual(call.unit.inputs, call.inputHashes);
        assert.notEqual(call.ids.executionId, result.executionId);
      }
      const expected = kind === 'dict'
        ? await datasetWrite(storage, repo, new SortedMap([[0n, 8000n]], compareFor(IntegerType)), type)
        : await datasetWrite(storage, repo, 8000n, IntegerType);
      assert.equal(result.outputHash, expected);

      calls.length = 0;
      const small = [await datasetWrite(storage, repo, new SortedMap([[0n, 1n]], compareFor(IntegerType)), type)];
      const single = await runner.execute(storage, hash, small);
      assert.equal(single.state, 'success', single.error);
      assert.equal(calls.length, 1);
      assert.equal(calls[0]!.role, 'unit');
      assert.equal(calls[0]!.logicalTaskHash, hash);
      assert.equal(calls[0]!.unit?.own, true);
      assert.equal(calls[0]!.ids.executionId, single.executionId);
    });
  }

  it('carries the graph task name from the orchestrator to an injected runner', async () => {
    const { hash } = await plain();
    await workspaceCreate(storage, repo, 'dev');
    await workspaceDeploy(storage, repo, 'dev', 'body', '1.0.0');
    const runner = new MockTaskRunner();
    runner.setResult(hash, { state: 'success', cached: false, outputHash: await datasetWrite(storage, repo, 4n, IntegerType) });
    const orchestrator = new LocalOrchestrator(new InMemoryStateStore());
    await orchestrator.wait(await orchestrator.start(storage, repo, 'dev', { runner }));
    assert.deepEqual(runner.getCalls().map((call) => call.options?.taskName), ['double']);
  });
});

describe('detached call executor', () => {
  let repo: string;
  const encodeInt = encodeBeast2For(IntegerType);
  const limits = { timeoutMs: 60_000, maxResultBytes: 1024, maxLogBytes: 64 * 1024 };
  const stock = variant('east_node', { platforms: [] as string[], decode: variant('lazy', null) });
  const double = encodeEastIR(East.function([IntegerType], IntegerType, ($, value) => value.multiply(2n)).toIR());
  const call = (n: bigint, more: Partial<DetachedSpec> = {}): DetachedSpec => ({ bodyIr: double, args: [encodeInt(n)], runner: stock, limits, ...more });
  const valueOf = (result: DetachedResult): bigint => {
    assert.ok(result.kind === 'success', `the call ended ${result.kind}: ${result.stderr}`);
    return decodeBeast2For(IntegerType)(result.value);
  };
  /** Resolves once a call waits for one of the budget's cores. */
  const queued = (budget: Budget) => new Promise<void>((resolve) => {
    const poll = setInterval(() => { if (budget.queued === 1) { clearInterval(poll); resolve(); } }, 10);
  });

  beforeEach(() => { repo = createTestRepo(); });
  afterEach(() => removeTestRepo(repo));

  it('rejects, and never throws at its caller, when its hook throws before it waits on anything', async () => {
    const runner = new LocalTaskRunner(repo, undefined, { detached: () => { throw new Error('no rack session'); } });
    let pending: Promise<DetachedResult> | undefined;
    assert.doesNotThrow(() => { pending = runner.runDetached(call(2n)); });
    await assert.rejects(() => pending!, /no rack session/);
  });

  it('hands a call to its hook before anything of it runs here: no core, no environment, no scratch directory', async () => {
    const budget = new Budget({ cores: 1, memory: 1024 ** 3 }, { sampler: null });
    const held = await budget.acquire();
    const calls: DetachedCallRequest[] = [];
    try {
      const runner = new LocalTaskRunner(repo, budget, { detached: (request) => {
        calls.push(request);
        return Promise.resolve({ kind: 'success', value: encodeInt(9n), stdout: '', stderr: '', stdoutTruncated: false, stderrTruncated: false });
      } });
      // An environment no object of the repository is: installing it here would fail
      const spec = call(2n, { environment: '0'.repeat(64) });
      assert.equal(valueOf(await runner.runDetached(spec, { storage: new LocalStorage(), functionName: 'double' })), 9n);
      assert.equal(calls.length, 1);
      assert.equal(calls[0]!.repo, repo);
      assert.equal(calls[0]!.spec, spec);
      assert.equal(calls[0]!.options.functionName, 'double');
      assert.equal(calls[0]!.budget, budget);
      assert.deepEqual(calls[0]!.settings, {});
      assert.equal(budget.queued, 0, 'the call never waited for a core');
      assert.deepEqual(existsSync(scratchRoot(repo)) ? readdirSync(scratchRoot(repo)) : [], []);
    } finally {
      held.release();
    }
  });

  it('runs the call here when its hook calls local, taking a core from the runner\'s budget, or the call local is given in its place', async () => {
    const budget = new Budget({ cores: 1, memory: 1024 ** 3 }, { sampler: null });
    const runner = new LocalTaskRunner(repo, budget, { detached: (_request, local) => local() });
    assert.equal(valueOf(await runner.runDetached(call(2n))), 4n);
    const instead = new LocalTaskRunner(repo, budget, { detached: (request, local) => local({ ...request.spec, args: [encodeInt(5n)] }) });
    assert.equal(valueOf(await instead.runDetached(call(2n))), 10n);

    // Run here, it waits for a core another holds, as a call with no hook does
    const held = await budget.acquire();
    const waiting = runner.runDetached(call(3n));
    await queued(budget);
    held.release();
    assert.equal(valueOf(await waiting), 6n);
    assert.equal(budget.inFlight, 0);
  });

  it('runs the call its hook runs here from the runner\'s base environment', async () => {
    const env = { ...(process.platform === 'win32' && { SystemRoot: process.env.SystemRoot ?? 'C:\\Windows' }), E3_TEST_SECRET: 'the runner\'s' };
    const seen: DetachedCallRequest[] = [];
    const runner = new LocalTaskRunner(repo, undefined, { env, detached: (request, local) => { seen.push(request); return local(); } });
    const result = await runner.runDetached({
      bodyIr: new Uint8Array([1]),
      args: [encodeBeast2For(StringType)('the value')],
      runner: variant('custom', { command: [process.execPath, '-e',
        'process.stdout.write(process.env.E3_TEST_SECRET ?? "unset"); const a = process.argv; require("node:fs").copyFileSync(a[a.indexOf("-i") + 1], a[a.indexOf("-o") + 1])', '--'] }),
      limits: { timeoutMs: 30_000, maxResultBytes: 1024, maxLogBytes: 1024 },
    });
    assert.equal(result.kind, 'success', result.stderr);
    assert.equal(result.stdout, 'the runner\'s');
    assert.deepEqual(seen.map((request) => request.settings), [{ env }], 'the hook is told how the runner\'s processes run');
  });
});

describe('a task body that takes a split task whole', () => {
  let repo: string;
  let storage: LocalStorage;

  beforeEach(() => {
    repo = createTestRepo();
    storage = new LocalStorage();
    readTestPieceBytesFrom(() => '64');
  });
  afterEach(() => {
    readTestPieceBytesFrom(() => undefined);
    removeTestRepo(repo);
  });

  /** A fold over 8,000 rows, a piece a segment, and its rows. */
  async function deployTotal(): Promise<{ hash: string; inputs: string[]; expected: string }> {
    const type = DictType(IntegerType, IntegerType);
    const task = e3.streamTask('total', {
      inputs: [e3.partition(e3.input('rows', type))],
      output: e3.output.fold(IntegerType, { zero: 0n, combine: (_$, a, b) => a.add(b) }),
    }, ($, rows, emit) => { $.for(rows, ($, _value, _key) => { $(emit(1n)); }); });
    const zip = join(repo, 'whole.zip');
    await e3.export(e3.package('whole', '1.0.0', task), zip);
    await packageImport(storage, repo, zip);
    const hash = (await packageRead(storage, repo, 'whole', '1.0.0')).tasks.get('total')!;
    const rows = new SortedMap(Array.from({ length: 8000 }, (_, i) => [BigInt(i), BigInt(i)] as [bigint, bigint]), compareFor(IntegerType));
    return { hash, inputs: [await datasetWrite(storage, repo, rows, type)], expected: await datasetWrite(storage, repo, 8000n, IntegerType) };
  }

  it('is given the task once, as the task, and is never handed a unit', async () => {
    const { hash, inputs, expected } = await deployTotal();
    const calls: TaskBodyRequest[] = [];
    const body: TaskBodyExecutor = Object.assign((request: TaskBodyRequest): Promise<ExecutionResult> => {
      calls.push(request);
      return Promise.resolve({ inputsHash: request.ids.inHash, executionId: request.ids.executionId, cached: false, state: 'success',
        outputHash: expected, exitCode: 0, duration: 1, error: null, cancelled: false, durationMs: 4321 });
    }, { takesWhole: (taskHash: string) => taskHash === hash });
    const runner = new LocalTaskRunner(repo, undefined, { body });
    assert.equal(runner.takesWhole(hash, { taskName: 'total' }), true);
    const result = await runner.execute(storage, hash, inputs, { taskName: 'total' });
    assert.equal(result.state, 'success', result.error);
    assert.equal(result.outputHash, expected);
    assert.equal(result.durationMs, 4321, 'the duration the body measured travels with its result');
    assert.deepEqual(calls.map((call) => [call.role, call.unit, call.options.taskName]), [['task', undefined, 'total']]);
  });

  it('falls back by planning it here, each unit going through the body as usual', async () => {
    const { hash, inputs, expected } = await deployTotal();
    const calls: TaskBodyRequest[] = [];
    const body: TaskBodyExecutor = Object.assign((request: TaskBodyRequest, local: (ids?: ExecutionIds) => Promise<ExecutionResult>) => {
      calls.push(request);
      return local();
    }, { takesWhole: (taskHash: string) => taskHash === hash });
    const runner = new LocalTaskRunner(repo, undefined, { body });
    const result = await runner.execute(storage, hash, inputs, { taskName: 'total' });
    assert.equal(result.state, 'success', result.error);
    assert.equal(result.outputHash, expected);
    assert.equal(calls[0]!.role, 'task');
    assert.ok(calls.length > 2, `the units went through the body after it: ${calls.length} calls`);
    assert.ok(calls.slice(1).every((call) => call.role === 'unit' && call.logicalTaskHash === hash));
  });

  it('hands the task back when, planning it here, a unit of it is handed back: its stage kept', async () => {
    const { hash, inputs } = await deployTotal();
    let units = 0;
    const body: TaskBodyExecutor = Object.assign((request: TaskBodyRequest, local: (ids?: ExecutionIds) => Promise<ExecutionResult>) => {
      if (request.role === 'unit' && ++units === 2) {
        return Promise.resolve<ExecutionResult>({ inputsHash: request.ids.inHash, executionId: request.ids.executionId, cached: false, state: 'error',
          outputHash: null, exitCode: null, duration: 1, error: 'no room', cancelled: false, handedBack: 'no-room' });
      }
      return local();
    }, { takesWhole: (taskHash: string) => taskHash === hash });
    const runner = new LocalTaskRunner(repo, undefined, { body });
    const result = await runner.execute(storage, hash, inputs, { taskName: 'total' });
    assert.equal(result.state, 'error');
    assert.equal(result.handedBack, 'no-room', 'the task is handed back, as the loop would leave it');
    const inHash = inputsHash(inputs);
    assert.equal((await storage.refs.executionGetLatest(repo, hash, inHash))?.type, 'interrupted', 'its execution is interrupted, not an error');
    assert.notEqual(await storage.refs.executionPlanRead(repo, hash, inHash), null, 'and its plan stays rooted');
  });

  it('runs it whole as the loop decided it, the body not asked again', async () => {
    const { hash, inputs, expected } = await deployTotal();
    let asked = 0;
    const calls: TaskBodyRequest[] = [];
    const body: TaskBodyExecutor = Object.assign((request: TaskBodyRequest): Promise<ExecutionResult> => {
      calls.push(request);
      return Promise.resolve({ inputsHash: request.ids.inHash, executionId: request.ids.executionId, cached: false, state: 'success',
        outputHash: expected, exitCode: 0, duration: 1, error: null, cancelled: false });
    }, { takesWhole: () => ++asked === 1 });
    const runner = new LocalTaskRunner(repo, undefined, { body });
    assert.equal(runner.takesWhole(hash, { taskName: 'total' }), true, 'the loop asks once');
    const result = await runner.execute(storage, hash, inputs, { taskName: 'total', whole: true });
    assert.equal(result.state, 'success', result.error);
    assert.equal(asked, 1, 'and the body is not asked again');
    assert.deepEqual(calls.map((call) => call.role), ['task'], 'it ran whole, as the loop decided');
  });

  it('is not asked of a runner with no body, which plans every split task', async () => {
    const { hash } = await deployTotal();
    assert.equal(new LocalTaskRunner(repo).takesWhole(hash, { taskName: 'total' }), false);
  });
});
