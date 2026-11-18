/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * An index of a record as an input of a task or a function
 * (east-workspace#1617): `e3.index(record.indexes.<name>)`. Each case goes
 * through the routes a page and a deployment call — a function described,
 * called and polled, the sync route, a task read, a dataflow run, the
 * workspace's status — against a real server and runner, and holds the index
 * to what its record holds: the run of one index key, the record's state both
 * are read at, the drafts a call lays over the record, and when a task runs
 * again.
 *
 * No case leans on a timing: each reads what a call names it read, or what a
 * run says it ran.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ArrayType, IntegerType, PatchType, SortedMap, StringType, compareFor, decodeBeast2For, diffFor, encodeBeast2For, equalFor, none, printFor, some,
  variant, type ValueTypeOf,
} from '@elaraai/east';
import {
  datasetGet,
  datasetGetStatus,
  dataflowExecute,
  functionCall,
  taskGet,
  workspaceFunctionCallStatus,
  workspaceFunctionCallSync,
  workspaceFunctionDescribe,
  workspaceFunctionStart,
  workspaceRecordHistory,
  workspaceRecordMutate,
  workspaceStatus,
  type DataflowResult,
  type ExecuteResult,
  type FunctionCallRequest,
  type FunctionCallStatus,
  type FunctionDraft,
  type RequestOptions,
} from '@elaraai/e3-api-client';
import { ExecuteResultType, FunctionInputType, TaskInputType, type TreePath } from '@elaraai/e3-types';

import { assertDataflowSucceeded, assertMutationCommitted, describeDataflowResult } from '../assertions.js';
import type { TestContext } from '../context.js';
import type { TestSetup } from '../setup.js';
import { templateWorkspace } from '../template.js';
import { createIndexInputsPackageZip, DraftJobRowType, DraftJobsType } from '../fixtures.js';

const PKG = 'index-inputs-pkg';
const VERSION = '1.0.0';

const JOBS_PATH: TreePath = [variant('field', 'records'), variant('field', 'jobs')];
const BACKLOG_PATH: TreePath = [variant('field', 'records'), variant('field', 'backlog')];
const WATCHED_PATH: TreePath = [variant('field', 'inputs'), variant('field', 'watched')];
const WATCHED_JOBS_PATH: TreePath = [variant('field', 'tasks'), variant('field', 'watched_jobs'), variant('field', 'output')];

/** What a result names it read. */
const InputsType = ExecuteResultType.fields.inputs;
/** What a signature says a function reads of a workspace. */
const DeclaredType = ArrayType(FunctionInputType);
/** What a task's details say it reads. */
const TaskInputsType = ArrayType(TaskInputType);

type Jobs = ValueTypeOf<typeof DraftJobsType>;
type Job = ValueTypeOf<typeof DraftJobRowType>;
type Inputs = ValueTypeOf<typeof InputsType>;

const encodeString = encodeBeast2For(StringType);
const encodeJobsPatch = encodeBeast2For(PatchType(DraftJobsType));
const decodeInt = decodeBeast2For(IntegerType);
const sameInputs = equalFor(InputsType);
const printInputs = printFor(InputsType);
const printOutcome = printFor(ExecuteResultType.fields.outcome);

/** The jobs the fixture's record holds as deployed: j1 and j3 on P1, j2 on P2. */
const SAVED: Jobs = new SortedMap<string, Job>([
  ['j1', { press: 'P1', hours: 2n }],
  ['j2', { press: 'P2', hours: 3n }],
  ['j3', { press: 'P1', hours: 4n }],
], compareFor(StringType));

/** A draft of the jobs' `move`: that job on that press. */
function moveDraft(key: string, press: string): FunctionDraft {
  return { record: 'jobs', mutation: 'move', args: [encodeString(key), encodeString(press)] };
}

/** A draft of the jobs' `patch`: j1's hours set, its press as it was. */
function hoursDraft(hours: bigint): FunctionDraft {
  const after = new SortedMap<string, Job>([...SAVED], compareFor(StringType));
  after.set('j1', { press: 'P1', hours });
  return { record: 'jobs', mutation: 'patch', args: [encodeJobsPatch(diffFor(DraftJobsType)(SAVED, after))] };
}

/** A call of a press, and the drafts it lays. */
function request(press: string, drafts: FunctionDraft[] = []): FunctionCallRequest {
  return { args: [variant('value', encodeString(press))], runner: none, limits: none, drafts };
}

/** A result's Integer, once it succeeded. */
function countOf(result: ExecuteResult): bigint {
  if (result.outcome.type !== 'success') assert.fail(`expected success, got ${printOutcome(result.outcome)}\n${result.stderr}`);
  return decodeInt(result.outcome.value.value);
}

/** The messages of a result refused before anything ran. */
function refusals(result: ExecuteResult): string[] {
  if (result.outcome.type !== 'invalid') assert.fail(`expected invalid, got ${printOutcome(result.outcome)}\n${result.stderr}`);
  return result.outcome.value.diagnostics.map((diagnostic) => diagnostic.message);
}

/** Asserts a result names exactly `expected` as what it read. */
function assertInputs(result: ExecuteResult, expected: Inputs, what: string): void {
  assert.ok(sameInputs(result.inputs, expected), `${what}: inputs ${printInputs(result.inputs)}, expected ${printInputs(expected)}`);
}

/** A call started and polled to its end: its result. */
async function called(ctx: TestContext, ws: string, fn: string, req: FunctionCallRequest, opts: RequestOptions): Promise<ExecuteResult> {
  const answer = await workspaceFunctionStart(ctx.config.baseUrl, ctx.repoName, ws, fn, req, opts);
  let status: FunctionCallStatus = answer.status;
  while (status.type === 'running') {
    status = await workspaceFunctionCallStatus(ctx.config.baseUrl, ctx.repoName, ws, answer.id, opts, { waitMs: 20_000 });
  }
  if (status.type !== 'completed') assert.fail(`expected completed, got ${status.type}`);
  return status.value;
}

/** The hash the workspace holds a dataset at. */
async function hashOf(ctx: TestContext, ws: string, path: TreePath, opts: RequestOptions): Promise<string> {
  const status = await datasetGetStatus(ctx.config.baseUrl, ctx.repoName, ws, path, opts);
  if (status.hash.type === 'none') assert.fail(`${status.path} holds no value`);
  return status.hash.value;
}

/** A Save of a draft: its mutation called, to be committed. */
async function save(ctx: TestContext, ws: string, draft: FunctionDraft, opts: RequestOptions): Promise<void> {
  const result = await workspaceRecordMutate(ctx.config.baseUrl, ctx.repoName, ws, draft.record, draft.mutation, { args: draft.args, actor: none, limits: none }, opts);
  assertMutationCommitted(result, `saving ${draft.record}.${draft.mutation}`);
}

/** How a run left a task: whether the cache served it. */
function ranOf(result: DataflowResult, task: string): { cached: boolean } {
  const ran = result.tasks.find(({ name }) => name === task);
  if (ran === undefined) assert.fail(`the run names no task ${task}:\n${describeDataflowResult(result)}`);
  return { cached: ran.cached };
}

/**
 * Register the tests of an index of a record as an input.
 *
 * @param setup - Factory that creates a fresh test context per test
 */
export function indexInputTests(setup: TestSetup<TestContext>): void {
  describe('index inputs', { concurrency: false }, () => {
    /** A copy of a workspace the fixture is deployed to, the test's own:
     *  `jobs` holds j1 and j3 on P1 and j2 on P2, `backlog` holds no state,
     *  and `watched` is P1. Deployed once for the suite. */
    const withIndexes = templateWorkspace(setup, async (ctx, ws) => {
      await ctx.importPackage(await createIndexInputsPackageZip(ctx.tempDir, PKG, VERSION));
      await ctx.createWorkspace(ws);
      await ctx.deployPackage(ws, `${PKG}@${VERSION}`);
    });

    /** The watched press's count, as the task last wrote it. */
    async function watchedJobs(ctx: TestContext, ws: string, opts: RequestOptions): Promise<bigint> {
      return decodeInt((await datasetGet(ctx.config.baseUrl, ctx.repoName, ws, WATCHED_JOBS_PATH, opts)).data);
    }

    /** The status of the task `watched_jobs`, as the workspace's status says it. */
    async function watchedJobsStatus(ctx: TestContext, ws: string, opts: RequestOptions): Promise<string> {
      const task = (await workspaceStatus(ctx.config.baseUrl, ctx.repoName, ws, opts)).tasks.find(({ name }) => name === 'watched_jobs');
      if (task === undefined) assert.fail('the workspace has no task watched_jobs');
      return task.status.type;
    }

    it('a function\'s signature and a task\'s details name the record and the index each reads', async (t) => {
      const { ctx, workspace: ws } = await withIndexes(t);
      const opts = await ctx.opts();
      const base = ctx.config.baseUrl;

      const alone = await workspaceFunctionDescribe(base, ctx.repoName, ws, 'jobs_on_press', opts);
      assert.ok(equalFor(DeclaredType)(alone.inputs, [{ path: JOBS_PATH, index: some('by_press') }]),
        `jobs_on_press reads ${printFor(DeclaredType)(alone.inputs)}`);
      assert.deepEqual(alone.drafts, ['jobs'], 'and may be passed drafts of the record its index is over');
      const beside = await workspaceFunctionDescribe(base, ctx.repoName, ws, 'hours_on_press', opts);
      assert.ok(equalFor(DeclaredType)(beside.inputs, [{ path: JOBS_PATH, index: some('by_press') }, { path: JOBS_PATH, index: none }]),
        `hours_on_press reads ${printFor(DeclaredType)(beside.inputs)}`);

      const task = await taskGet(base, ctx.repoName, ws, 'watched_jobs', opts);
      assert.ok(equalFor(TaskInputsType)(task.inputs, [
        { path: JOBS_PATH, index: some('by_press'), partition: none },
        { path: WATCHED_PATH, index: none, partition: none },
      ]), `watched_jobs reads ${printFor(TaskInputsType)(task.inputs)}`);
    });

    it('a call reads the run of an index key, and names the record, the index and the one state its inputs of the record were read at', async (t) => {
      const { ctx, workspace: ws } = await withIndexes(t);
      const opts = await ctx.opts();
      const state = await hashOf(ctx, ws, JOBS_PATH, opts);

      const onP1 = await called(ctx, ws, 'jobs_on_press', request('P1'), opts);
      assert.equal(countOf(onP1), 2n, 'j1 and j3');
      assertInputs(onP1, [{ path: JOBS_PATH, index: some('by_press'), hash: state }], 'a call that reads the index alone');
      assert.equal(countOf(await called(ctx, ws, 'jobs_on_press', request('P2'), opts)), 1n, 'j2');
      assert.equal(countOf(await called(ctx, ws, 'jobs_on_press', request('P9'), opts)), 0n, 'a press with no job');

      // More of a row than the index carries, read from the record beside it by the entry's key
      const hours = await workspaceFunctionCallSync(ctx.config.baseUrl, ctx.repoName, ws, 'hours_on_press', request('P1'), opts);
      assert.equal(countOf(hours), 6n, 'j1\'s 2 hours and j3\'s 4');
      assertInputs(hours, [
        { path: JOBS_PATH, index: some('by_press'), hash: state },
        { path: JOBS_PATH, index: none, hash: state },
      ], 'the index and the record beside it are read at one state');
    });

    it('a call\'s drafts are read through the index, at the drafted state, and nothing is saved', async (t) => {
      const { ctx, workspace: ws } = await withIndexes(t);
      const opts = await ctx.opts();
      const base = ctx.config.baseUrl;
      const state = await hashOf(ctx, ws, JOBS_PATH, opts);
      const commits = (await workspaceRecordHistory(base, ctx.repoName, ws, 'jobs', undefined, opts)).commits.length;

      // j2 dragged onto P1, unsaved: the index holds it as it would after the Save
      const drafted = await called(ctx, ws, 'jobs_on_press', request('P1', [moveDraft('j2', 'P1')]), opts);
      assert.equal(countOf(drafted), 3n, 'j1, j3 and the job dragged on');
      const [read] = drafted.inputs;
      if (read === undefined || drafted.inputs.length !== 1) assert.fail(`it names ${printInputs(drafted.inputs)} as read`);
      assertInputs(drafted, [{ path: JOBS_PATH, index: some('by_press'), hash: read.hash }], 'the drafted call');
      assert.notEqual(read.hash, state, 'the index is read at the drafted state, which the result names');

      // The record beside the index holds the drafts too, at the same state
      const hours = await called(ctx, ws, 'hours_on_press', request('P1', [moveDraft('j2', 'P1'), hoursDraft(10n)]), opts);
      assert.equal(countOf(hours), 17n, 'j1\'s 10 hours as edited, j2\'s 3 and j3\'s 4');
      assert.ok(hours.inputs.length === 2 && hours.inputs[0]!.hash === hours.inputs[1]!.hash && hours.inputs[0]!.hash !== state,
        `both inputs of the record name the one drafted state: ${printInputs(hours.inputs)}`);

      assert.equal(await hashOf(ctx, ws, JOBS_PATH, opts), state, 'the record stands where it stood');
      assert.equal((await workspaceRecordHistory(base, ctx.repoName, ws, 'jobs', undefined, opts)).commits.length, commits, 'and no commit joined its history');
      assert.equal(countOf(await called(ctx, ws, 'jobs_on_press', request('P1'), opts)), 2n, 'a call with no draft reads it as saved');

      // A Save of the same edit leaves the state the call read
      await save(ctx, ws, moveDraft('j2', 'P1'), opts);
      assert.equal(await hashOf(ctx, ws, JOBS_PATH, opts), read.hash, 'hash for hash');
    });

    it('a task runs over an index, is served by the cache when a write leaves the index as it was, and runs again when the index changes', async (t) => {
      const { ctx, workspace: ws } = await withIndexes(t);
      const opts = await ctx.opts();
      const base = ctx.config.baseUrl;

      const first = await dataflowExecute(base, ctx.repoName, ws, {}, opts);
      assertDataflowSucceeded(first, 'the first run');
      assert.deepEqual(ranOf(first, 'watched_jobs'), { cached: false });
      assert.equal(await watchedJobs(ctx, ws, opts), 2n, 'j1 and j3 are on the watched press');
      assert.equal(await watchedJobsStatus(ctx, ws, opts), 'up-to-date');

      // j1's hours change: the record changes, and its index by press does not
      const before = await hashOf(ctx, ws, JOBS_PATH, opts);
      await save(ctx, ws, hoursDraft(10n), opts);
      assert.notEqual(await hashOf(ctx, ws, JOBS_PATH, opts), before, 'the record changed');
      assert.equal(await watchedJobsStatus(ctx, ws, opts), 'up-to-date', 'what the task read is as it was');
      const again = await dataflowExecute(base, ctx.repoName, ws, {}, opts);
      assertDataflowSucceeded(again, 'the run after the hours changed');
      assert.equal(again.executed, 0n, `nothing ran again:\n${describeDataflowResult(again)}`);
      assert.equal(await watchedJobs(ctx, ws, opts), 2n);

      // j2 moves onto the watched press: the index changes
      await save(ctx, ws, moveDraft('j2', 'P1'), opts);
      assert.equal(await watchedJobsStatus(ctx, ws, opts), 'ready', 'the task is to run again');
      const rerun = await dataflowExecute(base, ctx.repoName, ws, {}, opts);
      assertDataflowSucceeded(rerun, 'the run after the job moved');
      assert.deepEqual(ranOf(rerun, 'watched_jobs'), { cached: false });
      assert.equal(await watchedJobs(ctx, ws, opts), 3n);
      assert.equal(await watchedJobsStatus(ctx, ws, opts), 'up-to-date');
    });

    it('an index of a record with no state yet makes a call invalid and a task wait, as the record does', async (t) => {
      const { ctx, workspace: ws } = await withIndexes(t);
      const opts = await ctx.opts();
      const base = ctx.config.baseUrl;
      assert.equal((await datasetGetStatus(base, ctx.repoName, ws, BACKLOG_PATH, opts)).hash.type, 'none', 'the backlog holds no state');

      const result = await called(ctx, ws, 'backlog_on_press', request('P1'), opts);
      assert.deepEqual(refusals(result), [
        'The function\'s input .records.backlog is not assigned (ref type: unassigned): its first state is not yet committed, and nothing ran',
      ]);
      assertInputs(result, [], 'a call refused before anything ran');

      const run = await dataflowExecute(base, ctx.repoName, ws, {}, opts);
      assertDataflowSucceeded(run, 'the run goes on without the task that waits');
      assert.equal(run.waiting, 1n, `the backlog's task waits:\n${describeDataflowResult(run)}`);
      const waiting = (await workspaceStatus(base, ctx.repoName, ws, opts)).tasks.find(({ name }) => name === 'watched_backlog');
      assert.equal(waiting?.status.type, 'waiting');
    });

    it('a call through the package, which reads no workspace, is refused, naming the index and the record', async (t) => {
      const { ctx } = await withIndexes(t);
      const opts = await ctx.opts();
      const viaPackage = await functionCall(ctx.config.baseUrl, ctx.repoName, PKG, VERSION, 'hours_on_press', request('P1'), opts);
      assert.deepEqual(refusals(viaPackage), [
        '\'hours_on_press\' reads the index by_press of .records.jobs, .records.jobs from the workspace it is called through, '
        + 'and a call through the package has none: call it through a workspace it is deployed to, at …/workspaces/<ws>/functions/hours_on_press',
      ]);
    });
  });
}
