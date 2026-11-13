/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A function's call over drafts (east-workspace#1619): unsaved edits of the
 * records a function reads, which its call lays over them, reads, and never
 * saves. Each case goes through the routes a page calls — a call started and
 * polled, the sync route, the kept call read whole — against a real server
 * and runner, and holds the call to what a Save of the same edit does: the
 * state it leaves, the words it refuses a write with, and how it ends.
 *
 * No case leans on a timing a server sets. The one call a Save lands beside
 * sleeps a second and a half (`count_after`), and reads the same rows whether
 * the Save lands while it sleeps or after it has ended: the state its drafts
 * are laid over is named as its start files it, before the Save is sent.
 *
 * What a clock or a host decides is held elsewhere: a draft still running
 * when its call's timeout ends, and a drafted state collected once its call
 * is forgotten, in e3-core's specs, over a clock they set; and the rule a
 * host gives on who may pass a draft, in e3-api-server's.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ArrayType, BlobType, IntegerType, OptionType, PatchType, SortedMap, StringType, compareFor, decodeBeast2For, diffFor, encodeBeast2For, equalFor,
  none, printFor, some, variant, type EastType, type ValueTypeOf,
} from '@elaraai/east';
import {
  ApiError,
  datasetGet,
  datasetGetStatus,
  dataflowExecute,
  functionCall,
  functionDraftEnded,
  objectGet,
  repoGc,
  workspaceCallGet,
  workspaceCallList,
  workspaceFunctionCall,
  workspaceFunctionCallStatus,
  workspaceFunctionCallSync,
  workspaceFunctionStart,
  workspaceRecordHistory,
  workspaceRecordMutate,
  workspaceStatus,
  type ExecuteResult,
  type FunctionCallRequest,
  type FunctionCallStatus,
  type FunctionDraft,
  type MutationResult,
  type RequestOptions,
} from '@elaraai/e3-api-client';
import {
  ExecuteResultType, FunctionDraftConflictType, MutationResultType, PermissionDeniedErrorType, TaskStatusInfoType, type TreePath,
} from '@elaraai/e3-types';

import { assertDataflowSucceeded, assertMutationCommitted } from '../assertions.js';
import type { TestContext } from '../context.js';
import type { TestSetup } from '../setup.js';
import { templateWorkspace } from '../template.js';
import { createDraftsPackageZip, DraftJobRowType, DraftJobsType } from '../fixtures.js';

const PKG = 'function-drafts-pkg';
const VERSION = '1.0.0';

/** The fixture's records, as a function's input of each names it. */
const JOBS_PATH: TreePath = [variant('field', 'records'), variant('field', 'jobs')];
const TALLY_PATH: TreePath = [variant('field', 'records'), variant('field', 'tally')];

/** What a result names it read. */
const InputsType = ExecuteResultType.fields.inputs;
/** The records a result names it drafted, each with the commit it stood at. */
const DraftedType = ExecuteResultType.fields.drafts;
/** A draft's arguments as a kept call holds them: the tuple a commit names a
 *  mutation's by. */
const DraftArgsType = ArrayType(BlobType);

type Jobs = ValueTypeOf<typeof DraftJobsType>;
type Job = ValueTypeOf<typeof DraftJobRowType>;
type Inputs = ValueTypeOf<typeof InputsType>;
type Drafted = ValueTypeOf<typeof DraftedType>;

const encodeInt = encodeBeast2For(IntegerType);
const encodeString = encodeBeast2For(StringType);
const encodeJobsPatch = encodeBeast2For(PatchType(DraftJobsType));
const decodeJobs = decodeBeast2For(DraftJobsType);
const decodeDraftArgs = decodeBeast2For(DraftArgsType);
const jobKeys = compareFor(StringType);
const sameJobs = equalFor(DraftJobsType);
const sameInputs = equalFor(InputsType);
const sameDrafted = equalFor(DraftedType);
const printJobs = printFor(DraftJobsType);
const printInputs = printFor(InputsType);
const printDrafted = printFor(DraftedType);
/** A result's outcome, printed where a case expected another. */
const printOutcome = printFor(ExecuteResultType.fields.outcome);
/** A Save's result, printed where a case expected another. */
const printSave = printFor(MutationResultType);
/** A Save's conflict detail, printed as East prints it. */
const printDetail = printFor(OptionType(StringType));

/** Jobs by key, as the record holds them. */
function jobsOf(rows: Iterable<readonly [string, Job]>): Jobs {
  return new SortedMap<string, Job>([...rows].map(([key, job]) => [key, job]), jobKeys);
}

/** The jobs the fixture's record holds as deployed: 9 hours in all. */
const SAVED = jobsOf([
  ['j1', { press: 'P1', hours: 2n }],
  ['j2', { press: 'P2', hours: 3n }],
  ['j3', { press: 'P1', hours: 4n }],
]);

/** A copy of `from`, with `change` made to it. */
function edited(from: Jobs, change: (rows: Jobs) => void): Jobs {
  const rows = jobsOf(from);
  change(rows);
  return rows;
}

/** A draft of the jobs' `patch`: the edit that takes them from `before` to `after`. */
function patchDraft(before: Jobs, after: Jobs): FunctionDraft {
  return { record: 'jobs', mutation: 'patch', args: [encodeJobsPatch(diffFor(DraftJobsType)(before, after))] };
}

/** A draft of the jobs' `move`: that job on that press. */
function moveDraft(key: string, press: string): FunctionDraft {
  return { record: 'jobs', mutation: 'move', args: [encodeString(key), encodeString(press)] };
}

/** A draft of the tally's `add`. */
function addDraft(by: bigint): FunctionDraft {
  return { record: 'tally', mutation: 'add', args: [encodeInt(by)] };
}

/** A call of value arguments, and the drafts it lays. */
function request(args: Uint8Array[], drafts: FunctionDraft[] = []): FunctionCallRequest {
  return { args: args.map((arg) => variant('value', arg)), runner: none, limits: none, drafts };
}

/** A status's result, once the call completed. */
function completed(status: FunctionCallStatus): ExecuteResult {
  if (status.type !== 'completed') assert.fail(`expected completed, got ${status.type}`);
  return status.value;
}

/** A result's value, once it succeeded. */
function valueOf<T extends EastType>(result: ExecuteResult, type: T): ValueTypeOf<T> {
  if (result.outcome.type !== 'success') assert.fail(`expected success, got ${printOutcome(result.outcome)}\n${result.stderr}`);
  return decodeBeast2For(type)(result.outcome.value.value);
}

/** The messages of a result refused before anything ran. */
function refusals(result: ExecuteResult): string[] {
  if (result.outcome.type !== 'invalid') assert.fail(`expected invalid, got ${printOutcome(result.outcome)}\n${result.stderr}`);
  return result.outcome.value.diagnostics.map((diagnostic) => diagnostic.message);
}

/** Asserts jobs read are `expected`. */
function assertJobs(read: Jobs, expected: Jobs, what: string): void {
  assert.ok(sameJobs(read, expected), `${what} read ${printJobs(read)}, expected ${printJobs(expected)}`);
}

/** Asserts a result names exactly `expected` as what it read. */
function assertInputs(result: ExecuteResult, expected: Inputs, what: string): void {
  assert.ok(sameInputs(result.inputs, expected), `${what}: inputs ${printInputs(result.inputs)}, expected ${printInputs(expected)}`);
}

/** Asserts a result names exactly `expected` as the records it drafted. */
function assertDrafted(result: ExecuteResult, expected: Drafted, what: string): void {
  assert.ok(sameDrafted(result.drafts, expected), `${what}: drafts ${printDrafted(result.drafts)}, expected ${printDrafted(expected)}`);
}

/** Polls a call until it has ended, each poll asking the server to wait for it. */
async function ended(ctx: TestContext, ws: string, id: string, opts: RequestOptions): Promise<FunctionCallStatus> {
  for (;;) {
    const status = await workspaceFunctionCallStatus(ctx.config.baseUrl, ctx.repoName, ws, id, opts, { waitMs: 20_000 });
    if (status.type !== 'running') return status;
  }
}

/** A call started and polled to its end: its id, and its result. */
async function called(
  ctx: TestContext, ws: string, fn: string, req: FunctionCallRequest, opts: RequestOptions,
): Promise<{ id: string; result: ExecuteResult }> {
  const answer = await workspaceFunctionStart(ctx.config.baseUrl, ctx.repoName, ws, fn, req, opts);
  return { id: answer.id, result: completed(answer.status.type === 'running' ? await ended(ctx, ws, answer.id, opts) : answer.status) };
}

/** A record as a result names an input of it: its path, and the hash the
 *  workspace holds it at. */
async function storedAt(ctx: TestContext, ws: string, path: TreePath, opts: RequestOptions): Promise<Inputs[number]> {
  const status = await datasetGetStatus(ctx.config.baseUrl, ctx.repoName, ws, path, opts);
  if (status.hash.type === 'none') assert.fail(`${status.path} holds no value`);
  return { path, hash: status.hash.value };
}

/** The jobs a reader of the workspace reads. */
async function readJobs(ctx: TestContext, ws: string, opts: RequestOptions): Promise<Jobs> {
  return decodeJobs((await datasetGet(ctx.config.baseUrl, ctx.repoName, ws, JOBS_PATH, opts)).data);
}

/** A record's commits, newest first, each by its hash. */
async function commitsOf(ctx: TestContext, ws: string, record: string, opts: RequestOptions): Promise<string[]> {
  return (await workspaceRecordHistory(ctx.config.baseUrl, ctx.repoName, ws, record, undefined, opts)).commits.map((commit) => commit.hash);
}

/** The commit a record stands at. */
async function headOf(ctx: TestContext, ws: string, record: string, opts: RequestOptions): Promise<string> {
  const [head] = await commitsOf(ctx, ws, record, opts);
  if (head === undefined) assert.fail(`record ${record} has no commit`);
  return head;
}

/** A Save of a draft: its mutation called, to be committed. */
async function save(ctx: TestContext, ws: string, draft: FunctionDraft, opts: RequestOptions): Promise<MutationResult> {
  return workspaceRecordMutate(ctx.config.baseUrl, ctx.repoName, ws, draft.record, draft.mutation, { args: draft.args, actor: none, limits: none }, opts);
}

/**
 * Register the tests of a function's call over drafts.
 *
 * @param setup - Factory that creates a fresh test context per test
 */
export function functionDraftTests(setup: TestSetup<TestContext>): void {
  describe('function drafts', { concurrency: false }, () => {
    /** A copy of a workspace the drafts fixture is deployed to, the test's
     *  own: `jobs` holds j1 on P1 for 2 hours, j2 on P2 for 3 and j3 on P1 for
     *  4, and `tally` holds 0. Deployed once for the suite. */
    const withDrafts = templateWorkspace(setup, async (ctx, ws) => {
      await ctx.importPackage(await createDraftsPackageZip(ctx.tempDir, PKG, VERSION));
      await ctx.createWorkspace(ws);
      await ctx.deployPackage(ws, `${PKG}@${VERSION}`);
    });

    it('a drafted insert, update and delete are read through the record\'s rows, at the state a Save of them leaves, which the result names', async (t) => {
      const { ctx, workspace: ws } = await withDrafts(t);
      const opts = await ctx.opts();
      const stored = await storedAt(ctx, ws, JOBS_PATH, opts);
      const head = await headOf(ctx, ws, 'jobs', opts);

      // A call that passes no draft reads the record as any reader does
      const asSaved = await called(ctx, ws, 'job_rows', request([]), opts);
      assertJobs(valueOf(asSaved.result, DraftJobsType), SAVED, 'a call that passes no draft');
      assertInputs(asSaved.result, [stored], 'a call that passes no draft');
      assertDrafted(asSaved.result, [], 'a call that passes no draft');

      // j4 inserted, j2 moved to P1 and given 5 hours, and j1 deleted
      const next = jobsOf([
        ['j2', { press: 'P1', hours: 5n }],
        ['j3', { press: 'P1', hours: 4n }],
        ['j4', { press: 'P3', hours: 6n }],
      ]);
      const draft = patchDraft(SAVED, next);
      const { result } = await called(ctx, ws, 'job_rows', request([], [draft]), opts);
      assertJobs(valueOf(result, DraftJobsType), next, 'the call that passes the edit');
      // The state it read is the drafted one, which the workspace holds nowhere
      assert.equal(result.inputs.length, 1);
      assert.notEqual(result.inputs[0]!.hash, stored.hash, 'its input names the drafted state, not the saved one');
      assertDrafted(result, [{ record: 'jobs', commit: head }], 'the commit the record stood at');
      assert.ok(sameInputs([await storedAt(ctx, ws, JOBS_PATH, opts)], [stored]), 'the record stands where it stood');

      // A Save of the same edit leaves the state the call read: the rows, and
      // the index over them
      assertMutationCommitted(await save(ctx, ws, draft, opts), 'saving the drafted edit');
      assertInputs(result, [await storedAt(ctx, ws, JOBS_PATH, opts)], 'the drafted state is the one a Save of the edit leaves');
    });

    it('saves nothing: the record\'s commits, what a reader reads and its dependent\'s run are as they were, and a Save of the same edit moves each', async (t) => {
      const { ctx, workspace: ws } = await withDrafts(t);
      const opts = await ctx.opts();
      const base = ctx.config.baseUrl;
      /** The jobs' dependent, as the workspace's status shows it. */
      const dependent = async (): Promise<ValueTypeOf<typeof TaskStatusInfoType>> => {
        const task = (await workspaceStatus(base, ctx.repoName, ws, opts)).tasks.find(({ name }) => name === 'job_total');
        if (task === undefined) assert.fail('the workspace has no task job_total');
        return task;
      };

      // The dependent has run over the jobs as saved
      assertDataflowSucceeded(await dataflowExecute(base, ctx.repoName, ws, {}, opts), 'the run before the call');
      const before = { commits: await commitsOf(ctx, ws, 'jobs', opts), at: await storedAt(ctx, ws, JOBS_PATH, opts), task: await dependent() };
      assert.equal(before.task.status.type, 'up-to-date');

      const draft = moveDraft('j2', 'P1');
      const moved = edited(SAVED, (rows) => rows.set('j2', { press: 'P1', hours: 3n }));
      const { result } = await called(ctx, ws, 'job_rows', request([], [draft]), opts);
      assertJobs(valueOf(result, DraftJobsType), moved, 'the call');

      assert.deepEqual(await commitsOf(ctx, ws, 'jobs', opts), before.commits, 'no commit was stored');
      assert.ok(sameInputs([await storedAt(ctx, ws, JOBS_PATH, opts)], [before.at]), 'the record was not moved');
      assertJobs(await readJobs(ctx, ws, opts), SAVED, 'the caller, reading the record,');
      assertJobs(await readJobs(ctx, ws, await ctx.readerOpts()), SAVED, 'another reader');
      assert.ok(equalFor(TaskStatusInfoType)(await dependent(), before.task), 'the dependent stands as its run left it');
      const again = await dataflowExecute(base, ctx.repoName, ws, {}, opts);
      assertDataflowSucceeded(again, 'the run after the call');
      assert.equal(again.executed, 0n, 'a run finds nothing to run again');

      // A Save of the same edit moves each
      assertMutationCommitted(await save(ctx, ws, draft, opts), 'saving the drafted edit');
      assert.equal((await commitsOf(ctx, ws, 'jobs', opts)).length, before.commits.length + 1, 'the Save stored a commit');
      assertJobs(await readJobs(ctx, ws, opts), moved, 'a reader, once the edit is saved,');
      assert.equal((await dependent()).status.type, 'ready', 'the dependent is left to run again');
    });

    it('lays several drafts in the order passed, each over the state the one before it left, and the drafts of two records', async (t) => {
      const { ctx, workspace: ws } = await withDrafts(t);
      const opts = await ctx.opts();
      const base = ctx.config.baseUrl;

      // The second draft fits only the state the first leaves: j2 deleted as
      // the move left it
      const moved = edited(SAVED, (rows) => rows.set('j2', { press: 'P1', hours: 3n }));
      const gone = edited(moved, (rows) => rows.delete('j2'));
      const inOrder = [moveDraft('j2', 'P1'), patchDraft(moved, gone)];
      const laid = await workspaceFunctionCall(base, ctx.repoName, ws, 'job_rows', request([], inOrder), opts);
      assertJobs(valueOf(laid, DraftJobsType), gone, 'the call that moves j2, then deletes it as moved,');
      // The other way round, the delete is of a row the record does not hold
      // as the edit says
      const reversed = await workspaceFunctionCall(base, ctx.repoName, ws, 'job_rows', request([], [...inOrder].reverse()), opts);
      if (reversed.outcome.type !== 'conflict') assert.fail(`expected conflict, got ${printOutcome(reversed.outcome)}`);
      assert.deepEqual([reversed.outcome.value.record, reversed.outcome.value.mutation], ['jobs', 'patch']);

      // Two records, their drafts interleaved: j1's 2 hours gone, and a tally
      // of 5 less 1
      const heads = { jobs: await headOf(ctx, ws, 'jobs', opts), tally: await headOf(ctx, ws, 'tally', opts) };
      const both = [addDraft(5n), patchDraft(SAVED, edited(SAVED, (rows) => rows.delete('j1'))), addDraft(-1n)];
      const summed = await workspaceFunctionCall(base, ctx.repoName, ws, 'hours', request([], both), opts);
      assert.equal(valueOf(summed, IntegerType), 11n, 'j2\'s 3 hours and j3\'s 4, and a tally of 4');
      assertDrafted(summed, [{ record: 'tally', commit: heads.tally }, { record: 'jobs', commit: heads.jobs }],
        'each record once, in the order its drafts first name it');

      // Each input was read at the state the Saves of its record's drafts
      // leave, laid in the same order
      for (const draft of both) assertMutationCommitted(await save(ctx, ws, draft, opts), `saving ${draft.record}.${draft.mutation}`);
      assertInputs(summed, [await storedAt(ctx, ws, JOBS_PATH, opts), await storedAt(ctx, ws, TALLY_PATH, opts)],
        'each input at its record\'s drafted state');
    });

    it('the kept call shows its drafts, the commit each record stood at and the drafted states it read, which a collection keeps while the call is kept', async (t) => {
      const { ctx, workspace: ws } = await withDrafts(t);
      const opts = await ctx.opts();
      const base = ctx.config.baseUrl;
      const heads = { jobs: await headOf(ctx, ws, 'jobs', opts), tally: await headOf(ctx, ws, 'tally', opts) };

      const drafts = [addDraft(5n), moveDraft('j2', 'P1'), addDraft(-1n)];
      const { id, result } = await called(ctx, ws, 'hours', request([], drafts), opts);
      assert.equal(valueOf(result, IntegerType), 13n, 'the jobs\' 9 hours, and a tally of 4');

      const call = await workspaceCallGet(base, ctx.repoName, ws, id, opts);
      assert.equal(call.state.type, 'succeeded');
      assert.deepEqual(call.drafts.map(({ record, mutation, commit }) => [record, mutation, commit]), [
        ['tally', 'add', heads.tally],
        ['jobs', 'move', heads.jobs],
        ['tally', 'add', heads.tally],
      ], 'its drafts, in the order passed, each with the commit its record stood at');
      for (const [at, kept] of call.drafts.entries()) {
        if (kept.args.type !== 'some') assert.fail(`draft ${at + 1} is kept with no arguments`);
        const args = decodeDraftArgs(await objectGet(base, ctx.repoName, kept.args.value, opts));
        assert.ok(equalFor(DraftArgsType)(args, drafts[at]!.args), `draft ${at + 1}'s arguments, by the object they were stored as`);
      }
      assert.ok(sameInputs(call.inputs, result.inputs), `its inputs name the drafted states it read, ${printInputs(call.inputs)}`);

      // A collection that sweeps whatever nothing names: the kept call names
      // the drafted states, which nothing else does
      await repoGc(base, ctx.repoName, { dryRun: false, minAge: some(0n), keepRuns: none, keepDays: none }, opts);
      for (const [at, { hash }] of result.inputs.entries()) {
        await assert.doesNotReject(objectGet(base, ctx.repoName, hash, opts), `the drafted state input ${at + 1} was read at survives the collection`);
      }
    });

    it('a draft its function or its record does not take ends the call invalid as it starts, naming the draft, and nothing runs', async (t) => {
      const { ctx, workspace: ws } = await withDrafts(t);
      const opts = await ctx.opts();
      const move = moveDraft('j2', 'P1');
      const unknown: FunctionDraft = { record: 'jobs', mutation: 'nope', args: [] };
      const short: FunctionDraft = { record: 'jobs', mutation: 'move', args: [encodeString('j2')] };
      const mistyped: FunctionDraft = { record: 'tally', mutation: 'add', args: [encodeString('five')] };
      const zero = [encodeInt(0n)];
      const before = await commitsOf(ctx, ws, 'jobs', opts);

      for (const { fn, args, drafts, label, why, asSave } of [
        // The author's word: a function lists the records a call may draft
        { fn: 'job_count', args: [], drafts: [move], label: 'draft jobs.move (1 of 1)', why: 'the function lists no record a call may draft', asSave: null },
        {
          fn: 'count_after', args: zero, drafts: [move, addDraft(1n)], label: 'draft tally.add (2 of 2)',
          why: 'the function does not list record \'tally\' among those a call may draft: \'jobs\'', asSave: null,
        },
        // Checked as a Save of the record checks its mutation
        { fn: 'count_after', args: zero, drafts: [unknown], label: 'draft jobs.nope (1 of 1)', why: 'mutation \'nope\' not found on record \'jobs\'', asSave: unknown },
        { fn: 'count_after', args: zero, drafts: [move, short], label: 'draft jobs.move (2 of 2)', why: 'mutation \'move\' expects 2 argument(s), got 1', asSave: short },
        // And by its arguments' types beside, which a Save leaves to its
        // mutation's program
        {
          fn: 'hours', args: [], drafts: [mistyped], label: 'draft tally.add (1 of 1)',
          why: 'argument 1 of mutation \'add\' holds .String, and the mutation takes .Integer', asSave: null,
        },
      ]) {
        const { id, result } = await called(ctx, ws, fn, request(args, drafts), opts);
        assert.deepEqual(refusals(result), [`${label}: ${why}`]);
        assert.equal(result.stdout, '', `${label}: the function did not run`);
        assertInputs(result, [], label);
        assertDrafted(result, [], label);
        const call = await workspaceCallGet(ctx.config.baseUrl, ctx.repoName, ws, id, opts);
        assert.equal(call.state.type, 'invalid', label);
        assert.equal(call.drafts.length, 0, `${label}: a call refused as it starts keeps no draft`);
        if (asSave !== null) {
          const saved = await save(ctx, ws, asSave, opts);
          if (saved.outcome.type !== 'invalid') assert.fail(`${label}: expected the Save to be invalid, got ${printSave(saved)}`);
          assert.equal(saved.outcome.value.message, why, `${label}: refused in a Save's words`);
        }
      }
      assert.deepEqual(await commitsOf(ctx, ws, 'jobs', opts), before, 'nothing was saved');
    });

    it('a draft its record refuses ends the call as a Save of it ends, failed or in conflict, saying which draft, and the function does not run', async (t) => {
      const { ctx, workspace: ws } = await withDrafts(t);
      const opts = await ctx.opts();
      const base = ctx.config.baseUrl;
      const stored = await storedAt(ctx, ws, JOBS_PATH, opts);
      const before = await commitsOf(ctx, ws, 'jobs', opts);
      const head = before[0]!;
      const zero = [encodeInt(0n)];

      // A call that runs says so as it starts
      const ran = await called(ctx, ws, 'count_after', request(zero), opts);
      assert.equal(valueOf(ran.result, IntegerType), 3n);
      assert.match(ran.result.stdout, /counting the jobs/);

      // A mutation that fails as it runs: its Save fails, and so does the
      // call that drafts it, after a draft that lays
      const refuse: FunctionDraft = { record: 'jobs', mutation: 'refuse', args: [encodeString('not today')] };
      const refused = await save(ctx, ws, refuse, opts);
      if (refused.outcome.type !== 'failed') assert.fail(`expected the Save to fail, got ${printSave(refused)}`);
      assert.match(refused.outcome.value.stderr, /refused: not today/);
      const failed = await called(ctx, ws, 'count_after', request(zero, [moveDraft('j2', 'P1'), refuse]), opts);
      if (failed.result.outcome.type !== 'failed') assert.fail(`expected failed, got ${printOutcome(failed.result.outcome)}`);
      assert.equal(failed.result.outcome.value.exitCode, refused.outcome.value.exitCode, 'the exit code its Save ends with');
      const [line, ...own] = failed.result.stderr.split('\n');
      assert.equal(line, 'draft jobs.refuse (2 of 2) failed', 'the first line of its stderr says which draft');
      assert.match(own.join('\n'), /refused: not today/, 'and the mutation\'s own stderr follows it');
      assert.deepEqual(functionDraftEnded(failed.result), { record: 'jobs', mutation: 'refuse', place: 2, of: 2, how: 'failed' });
      assert.equal(failed.result.stdout, '', 'the function did not run');
      assertInputs(failed.result, [stored], 'a call a draft ended names its input as it was pinned');
      assertDrafted(failed.result, [{ record: 'jobs', commit: head }], 'a call a draft ended');
      const failure = await workspaceCallGet(base, ctx.repoName, ws, failed.id, opts);
      assert.equal(failure.state.type, 'failed');
      assert.equal(failure.stderr, failed.result.stderr, 'the kept call holds the same stderr');
      assert.equal(failure.drafts.length, 2, 'and both its drafts');

      // An edit made over the jobs as they were read, j2 deleted; and another
      // Save that changes the row under it
      const stale = patchDraft(SAVED, edited(SAVED, (rows) => rows.delete('j2')));
      assertMutationCommitted(await save(ctx, ws, moveDraft('j2', 'P1'), opts), 'the other Save');
      const unfit = await called(ctx, ws, 'count_after', request(zero, [stale]), opts);
      if (unfit.result.outcome.type !== 'conflict') assert.fail(`expected conflict, got ${printOutcome(unfit.result.outcome)}`);
      const conflict = unfit.result.outcome.value;
      assert.deepEqual([conflict.record, conflict.mutation], ['jobs', 'patch']);
      assert.match(conflict.message, /j2/, 'the refusal names the row');
      assert.equal(unfit.result.stdout, '', 'the function did not run');
      // A Save of the same edit ends in conflict, in the same words
      const lost = await save(ctx, ws, stale, opts);
      if (lost.outcome.type !== 'conflict') assert.fail(`expected the Save to conflict, got ${printSave(lost)}`);
      assert.ok(equalFor(OptionType(StringType))(lost.outcome.value.detail, some(conflict.message)),
        `the Save's detail is ${printDetail(lost.outcome.value.detail)}, and the call's message ${JSON.stringify(conflict.message)}`);
      const kept = await workspaceCallGet(base, ctx.repoName, ws, unfit.id, opts);
      if (kept.state.type !== 'conflict') assert.fail(`the kept call ended ${kept.state.type}`);
      assert.ok(equalFor(FunctionDraftConflictType)(kept.state.value, conflict), 'the kept call holds the same conflict');

      // The one commit stored since is the other Save's
      assert.deepEqual((await commitsOf(ctx, ws, 'jobs', opts)).slice(1), before, 'neither call saved anything, nor either Save that was refused');
    });

    it('a Save that lands while a drafted call runs is saved, and the call reads the state it was started over', async (t) => {
      const { ctx, workspace: ws } = await withDrafts(t);
      const opts = await ctx.opts();
      const base = ctx.config.baseUrl;
      const head = await headOf(ctx, ws, 'jobs', opts);

      // j4 drafted over the three jobs the record holds, for a function that
      // sleeps a second and a half before it counts them
      const draft = patchDraft(SAVED, edited(SAVED, (rows) => rows.set('j4', { press: 'P3', hours: 6n })));
      const answer = await workspaceFunctionStart(base, ctx.repoName, ws, 'count_after', request([encodeInt(1500n)], [draft]), opts, { waitMs: 0 });
      assert.equal(answer.status.type, 'running', 'a start waits for none of the call: its own run lays its drafts');
      // Another Save, of a row the edit does not touch: j1 deleted
      const fewer = edited(SAVED, (rows) => rows.delete('j1'));
      assertMutationCommitted(await save(ctx, ws, patchDraft(SAVED, fewer), opts), 'the Save beside the call');

      const result = completed(await ended(ctx, ws, answer.id, opts));
      assert.equal(valueOf(result, IntegerType), 4n, 'the three jobs the call was started over, and the one it drafted');
      assertDrafted(result, [{ record: 'jobs', commit: head }], 'the commit the record stood at as the call started');
      const latest = await headOf(ctx, ws, 'jobs', opts);
      assert.notEqual(latest, head, 'the Save moved the record on, which a caller holding its commit knows the call by');
      assertJobs(await readJobs(ctx, ws, opts), fewer, 'a reader, who sees the Save and nothing of the draft,');

      // The same edit laid again is laid over the Save
      const again = await called(ctx, ws, 'count_after', request([encodeInt(0n)], [draft]), opts);
      assert.equal(valueOf(again.result, IntegerType), 3n, 'the two jobs the Save left, and the one drafted');
      assertDrafted(again.result, [{ record: 'jobs', commit: latest }], 'the call made after the Save');
    });

    it('the sync route lays a call\'s drafts and keeps the call, and a call through the package, which reads no workspace, refuses one', async (t) => {
      const { ctx, workspace: ws } = await withDrafts(t);
      const opts = await ctx.opts();
      const base = ctx.config.baseUrl;
      const head = await headOf(ctx, ws, 'jobs', opts);
      const draft = moveDraft('j2', 'P1');

      const result = await workspaceFunctionCallSync(base, ctx.repoName, ws, 'job_rows', request([], [draft]), opts);
      assertJobs(valueOf(result, DraftJobsType), edited(SAVED, (rows) => rows.set('j2', { press: 'P1', hours: 3n })), 'the sync route\'s call');
      assertDrafted(result, [{ record: 'jobs', commit: head }], 'the sync route\'s call');
      const page = await workspaceCallList(base, ctx.repoName, ws, opts);
      assert.deepEqual(page.calls.map((call) => call.state.type), ['succeeded'], 'the workspace keeps the call');
      assert.equal((await workspaceCallGet(base, ctx.repoName, ws, page.calls[0]!.id, opts)).drafts.length, 1, 'with its draft');
      assertJobs(await readJobs(ctx, ws, opts), SAVED, 'a reader');

      const viaPackage = await functionCall(base, ctx.repoName, PKG, VERSION, 'count_after', request([encodeInt(0n)], [draft]), opts);
      assert.deepEqual(refusals(viaPackage), [
        'The call passes 1 draft(s), and a call through the package reads no workspace to lay one over: '
        + 'start it as a call a workspace keeps, at …/workspaces/<ws>/functions/count_after',
      ]);
      assert.equal(viaPackage.stdout, '', 'the function did not run');
    });

    // A caller may pass a draft only where they may commit its mutation. Which
    // that is for a reader is the server's to say, so the case reads it from
    // the server: a Save by the reader either commits or is refused, and a
    // draft of the same mutation is answered alike.
    it('a reader passes a draft where the server lets them commit its mutation, and is refused it where the server does not', async (t) => {
      const { ctx, workspace: ws } = await withDrafts(t);
      const reader = await ctx.readerOpts();
      const base = ctx.config.baseUrl;

      let commits: boolean;
      try {
        assertMutationCommitted(await save(ctx, ws, addDraft(1n), reader), 'a Save by a reader the server lets write');
        commits = true;
      } catch (err) {
        if (!(err instanceof ApiError && err.code === 'permission_denied')) throw err;
        commits = false;
      }

      const drafted = workspaceFunctionStart(base, ctx.repoName, ws, 'hours', request([], [addDraft(5n)]), reader);
      if (commits) {
        const answer = await drafted;
        const result = completed(answer.status.type === 'running' ? await ended(ctx, ws, answer.id, reader) : answer.status);
        assert.equal(valueOf(result, IntegerType), 15n, 'the jobs\' 9 hours, the tally the reader saved, and the 5 drafted');
      } else {
        await assert.rejects(drafted, (err: unknown) => {
          assert.ok(err instanceof ApiError, 'expected an ApiError');
          assert.equal(err.code, 'permission_denied');
          const details = err.details as ValueTypeOf<typeof PermissionDeniedErrorType>;
          assert.ok(equalFor(PermissionDeniedErrorType)(details, { path: 'draft tally.add' }), printFor(PermissionDeniedErrorType)(details));
          return true;
        });
        assert.equal((await workspaceCallList(base, ctx.repoName, ws, reader)).calls.length, 0, 'the refused call was not filed');
      }
    });
  });
}
