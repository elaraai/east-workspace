/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A call's drafts (east-workspace#1619): unsaved edits a call passes, laid over
 * the records its function reads, and never saved.
 *
 * Over the in-memory backend, on a clock each case sets, with units a case
 * answers and no process: each check a call's start makes of a draft; what the
 * call keeps of the drafts it passed; the laying, in the order they were
 * passed; every end a draft gives a call, its function shown not to have run;
 * and the drafted state kept through a collection for as long as the call is.
 * Over a local repository and the real runner: a function's body reading
 * drafts its record's own programs laid over an indexed record, which is the
 * state a Save of them leaves, hash for hash.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import {
  ArrayType, DictType, East, IntegerType, NullType, OptionType, PatchType, SortedMap, StringType, StructType,
  compareFor, decodeBeast2For, encodeBeast2For, equalFor, none, sha256Hex, some, variant,
  type PatchTypeOf, type ValueTypeOf,
} from '@elaraai/east';
import e3 from '@elaraai/e3';
import {
  ExecuteResultType, FunctionCallDraftType, FunctionCallDraftedType, decodeFunctionCallJob, encodeFunctionCallJob,
  type FunctionCallJob, type FunctionCallRequest, type FunctionDraft, type TreePath,
} from '@elaraai/e3-types';
import { DatasetSegments, readDatasetWhole } from '../dataset-open.js';
import { inputsHash } from '../executions.js';
import { repoGc } from '../gc.js';
import { packageImport } from '../package-files.js';
import { packageRead } from '../packages.js';
import { encodeMutationArgs, readRecordState, recordHistory, recordMutate, resolveRecord } from '../records.js';
import { InMemoryStorage } from '../storage/in-memory/InMemoryStorage.js';
import type { StorageBackend } from '../storage/interfaces.js';
import { LocalStorage } from '../storage/local/index.js';
import { createTempDir, createTestRepo, removeTempDir, removeTestRepo } from '../test-helpers.js';
import { workspaceGetDataset } from '../trees.js';
import { uuidv7 } from '../uuid.js';
import { workspaceCreate, workspaceDeploy } from '../workspaces.js';
import { LocalTaskRunner } from './LocalTaskRunner.js';
import { MockTaskRunner, type MockTaskResult } from './MockTaskRunner.js';
import {
  functionCallLost, functionCallRun, functionCallStart, functionCallStatus,
  type FunctionCallLifetimes, type FunctionCallRun, type FunctionCallRunOptions,
} from './functionCall.js';
import { NO_CALL_DRAFTS, pinCallDrafts } from './functionDrafts.js';
import type { DetachedResult, DetachedRunOptions, DetachedSpec, TaskExecuteOptions, TaskResult, TaskRunner } from './interfaces.js';

const REPO = 'r';
const WS = 'ws';
const JOBS: TreePath = [variant('field', 'records'), variant('field', 'jobs')];
const TALLY: TreePath = [variant('field', 'records'), variant('field', 'tally')];
const RATE: TreePath = [variant('field', 'inputs'), variant('field', 'rate')];

/** The clock each in-memory case runs on, stopped at the time the case starts. */
let T = 0;
const now = (): number => T;

/** An hour for a success or a cancel, a day for any other end. */
const SUCCEEDED_MS = 60 * 60_000;
const FAILED_MS = 24 * 60 * 60_000;
const LIFETIMES: FunctionCallLifetimes = { succeededMs: SUCCEEDED_MS, failedMs: FAILED_MS };

const JobType = StructType({ press: StringType, hours: IntegerType });
const JobsType = DictType(StringType, JobType);
type Jobs = ValueTypeOf<typeof JobsType>;
/** What one touched key of a jobs patch carries, derived from the patch type. */
type JobOp = Extract<ValueTypeOf<PatchTypeOf<typeof JobsType>>, { type: 'patch' }>['value'] extends Map<string, infer Op> ? Op : never;

const encodeInt = encodeBeast2For(IntegerType);
const decodeInt = decodeBeast2For(IntegerType);
const encodeString = encodeBeast2For(StringType);
const decodeJobs = decodeBeast2For(JobsType);
const encodeJobsPatch = encodeBeast2For(PatchType(JobsType));
const sameJobs = equalFor(JobsType);
const sameInputs = equalFor(ExecuteResultType.fields.inputs);
const sameRead = equalFor(ExecuteResultType.fields.drafts);
const sameDrafts = equalFor(ArrayType(FunctionCallDraftType));
const sameDrafted = equalFor(ArrayType(FunctionCallDraftedType));
const sameResult = equalFor(ExecuteResultType);
const sameCaller = equalFor(OptionType(StringType));

/** The jobs the record is deployed with. */
const SAVED_JOBS: Jobs = new Map([['j1', { press: 'P1', hours: 2n }], ['j2', { press: 'P2', hours: 3n }]]);

/** A patch of the jobs: each touched key's op. */
function jobsPatch(ops: Array<[string, JobOp]>): Uint8Array {
  return encodeJobsPatch(variant('patch', new SortedMap<string, JobOp>(ops, compareFor(StringType))));
}

/** A job moved from one press to another, its hours as they were. */
function moved(before: string, after: string): JobOp {
  return variant('update', variant('patch', { press: variant('replace', { before, after }), hours: variant('unchanged', null) }));
}

/** A draft: a record's mutation, and its arguments as a mutation call takes them. */
function draft(record: string, mutation: string, ...args: Uint8Array[]): FunctionDraft {
  return { record, mutation, args };
}

/** A call of value arguments, with drafts. */
function request(args: Uint8Array[], drafts: FunctionDraft[], limits: FunctionCallRequest['limits'] = none): FunctionCallRequest {
  return { args: args.map((arg) => variant('value', arg)), runner: none, limits, drafts };
}

/** A runner's end, its value and its log tails. */
function ran(result: Partial<DetachedResult> & Pick<DetachedResult, 'kind'>): DetachedResult {
  return { stdout: 'out\n', stderr: 'err\n', stdoutTruncated: false, stderrTruncated: false, ...result } as DetachedResult;
}

/** Something a case waits for, and the call that brings it. */
function gated<T>(): { readonly opened: Promise<T>; open(value: T): void } {
  let open!: (value: T) => void;
  const opened = new Promise<T>((resolve) => { open = resolve; });
  return { opened, open };
}

/**
 * A runner whose units answer as a case says, with no process. A mutation's
 * program runs as a unit: the case is given its task, its inputs — the state,
 * then each argument — and the run's options, its abort signal among them.
 */
class UnitRunner extends MockTaskRunner {
  constructor(private readonly unit: (taskHash: string, inputs: string[], options?: TaskExecuteOptions) => Promise<MockTaskResult>) {
    super();
  }

  override async execute(storage: StorageBackend, taskHash: string, inputHashes: string[], options?: TaskExecuteOptions): Promise<TaskResult> {
    await super.execute(storage, taskHash, inputHashes, options);
    const result = await this.unit(taskHash, inputHashes, options);
    return { ...result, executionId: result.executionId ?? uuidv7() };
  }
}

/** A runner whose function's run says it has started, and lasts until the
 *  case ends it. */
class GatedRunner extends MockTaskRunner {
  readonly running = gated<void>();
  private readonly ended = gated<DetachedResult>();

  override runDetached(spec: DetachedSpec, options?: DetachedRunOptions): Promise<DetachedResult> {
    void super.runDetached(spec, options);
    this.running.open();
    return this.ended.opened;
  }

  /** Ends the function's run. */
  finish(result: DetachedResult): void {
    this.ended.open(result);
  }
}

/**
 * The package the in-memory cases deploy: `jobs`, a Dict record with no index,
 * so a patch of it runs no program; `tally`, an Integer record, whose reducers
 * run as units a case answers; `unset`, a record with no state; and functions
 * that list some of them as records a call may draft, or none.
 */
function draftsPackage(): ReturnType<typeof e3.package> {
  const jobs = e3.record('jobs', JobsType, {
    initial: SAVED_JOBS,
    mutations: (mutation) => ({ patch: mutation.patch() }),
  });
  const tally = e3.record('tally', IntegerType, {
    initial: 0n,
    mutations: (mutation) => ({
      add: mutation.reduce(East.function([IntegerType, IntegerType], IntegerType, ($, state, by) => state.add(by))),
      reset: mutation.reduce(East.function([IntegerType], IntegerType, ($, _state) => 0n)),
    }),
  });
  const unset = e3.record('unset', IntegerType, {
    mutations: (mutation) => ({
      add: mutation.reduce(East.function([IntegerType, IntegerType], IntegerType, ($, state, by) => state.add(by))),
    }),
  });
  const rate = e3.input('rate', IntegerType, variant('value', 10n));

  const count = e3.function('count', { inputs: [jobs], args: [], output: IntegerType }, ($, jobs) => jobs.size());
  const jobsOn = e3.function('jobs_on', { inputs: [jobs, rate], drafts: [jobs], args: [StringType], output: IntegerType },
    ($, jobs, _rate, press) => {
      const found = $.let(0n);
      $.for(jobs, ($, job) => {
        $.if(East.equal(job.press, press), ($) => { $.assign(found, found.add(1n)); });
      });
      return found;
    });
  const load = e3.function('load', { inputs: [tally, jobs], drafts: [jobs, tally], args: [], output: IntegerType },
    ($, tally, jobs) => tally.add(jobs.size()));
  const guarded = e3.function('guarded', { inputs: [tally, jobs], drafts: [jobs], args: [], output: IntegerType },
    ($, tally, jobs) => tally.add(jobs.size()));
  const unsetPlus = e3.function('unset_plus', { inputs: [unset], drafts: [unset], args: [], output: IntegerType }, ($, unset) => unset.add(1n));
  return e3.package('drafts', '1.0.0', jobs, tally, unset, rate, count, jobsOn, load, guarded, unsetPlus);
}

describe('a call\'s drafts', () => {
  let dir: string;
  let storage: InMemoryStorage;
  let runner: MockTaskRunner;

  beforeEach(async () => {
    T = Date.now();
    dir = createTempDir();
    storage = new InMemoryStorage();
    runner = new MockTaskRunner();
    runner.setDetachedResult(ran({ kind: 'success', value: encodeInt(0n) }));
    await storage.repos.create(REPO);
    const zip = join(dir, 'drafts.zip');
    await e3.export(draftsPackage(), zip);
    await packageImport(storage, REPO, zip);
    await workspaceDeploy(storage, REPO, WS, 'drafts', '1.0.0');
  });

  afterEach(() => removeTempDir(dir));

  const start = (fn: string, args: Uint8Array[], drafts: FunctionDraft[], limits: FunctionCallRequest['limits'] = none): Promise<FunctionCallJob> =>
    functionCallStart(storage, REPO, WS, fn, request(args, drafts, limits), { caller: 'ada@example.com', lifetimes: LIFETIMES, now });
  const run = (id: string, on: TaskRunner = runner, options: FunctionCallRunOptions = {}): Promise<FunctionCallRun> =>
    functionCallRun(storage, on, REPO, WS, id, { now, ...options });

  /** The state a record holds, and the commit it stands at. */
  const head = async (record: string): Promise<{ state: string; commit: string }> => {
    const ref = await storage.datasets.read(REPO, WS, `records/${record}`);
    if (ref === null || ref.type !== 'value') assert.fail(`record ${record} holds no state`);
    const [latest] = await recordHistory(storage, REPO, WS, record, { limit: 1 });
    return { state: ref.value.hash, commit: latest!.hash };
  };
  /** The jobs a state holds. */
  const jobsAt = async (state: string): Promise<Jobs> =>
    decodeJobs(await readDatasetWhole(storage, REPO, (await readRecordState(storage, REPO, state)).primary));
  /** The object of a record's mutation, as the deployed package names it. */
  const mutationOf = async (record: string, mutation: string): Promise<string> =>
    (await resolveRecord(storage, REPO, WS, record))!.mutations.get(mutation)!;
  /** A unit's success: the new state, stored as its output. */
  const succeeded = async (value: bigint): Promise<MockTaskResult> =>
    ({ state: 'success', cached: false, outputHash: await storage.objects.write(REPO, encodeInt(value)) });
  /** A runner whose units hold until their signal aborts, and say when the
   *  first has begun. */
  const heldUnits = (): { readonly runner: UnitRunner; readonly begun: Promise<void> } => {
    const begun = gated<void>();
    const held = new UnitRunner((_task, _inputs, options) => new Promise((resolve) => {
      begun.open();
      options!.signal!.addEventListener('abort', () => resolve({ state: 'error', cached: false, cancelled: true }), { once: true });
    }));
    return { runner: held, begun: begun.opened };
  };

  /** A call its start refused: it says why, keeps nothing it was passed, and
   *  nothing runs. */
  const assertRefused = async (job: FunctionCallJob, why: string | RegExp): Promise<void> => {
    if (job.call.state.type !== 'invalid') assert.fail(`filed ${job.call.state.type}`);
    const [said] = job.call.state.value.diagnostics;
    if (typeof why === 'string') assert.equal(said!.message, why);
    else assert.match(said!.message, why);
    assert.equal(job.call.args.length + job.call.inputs.length + job.call.drafts.length + job.drafted.length, 0, 'it keeps no argument, input or draft');
    assert.equal(job.call.expiresAt.getTime(), T + FAILED_MS, 'kept as a failure is');
    assert.equal((await run(job.call.id)).result, null);
    assert.equal(runner.getCalls().length + runner.getDetachedCalls().length, 0, 'and nothing runs: no mutation\'s program, nor the function');
    const status = await functionCallStatus(storage, REPO, job);
    assert.ok(status.type === 'completed' && status.value.outcome.type === 'invalid' && status.value.drafts.length === 0, 'its result names no record drafted');
  };

  const insertJ3 = (): Uint8Array => jobsPatch([['j3', variant('insert', { press: 'P1', hours: 1n })]]);
  const withJ3: Jobs = new Map([...SAVED_JOBS, ['j3', { press: 'P1', hours: 1n }]]);

  describe('checked as the call starts', () => {
    it('refuses a draft its function does not take: one that lists no record, and a record it reads but does not list', async () => {
      await assertRefused(await start('count', [], [draft('jobs', 'patch', insertJ3())]),
        'draft jobs.patch (1 of 1): the function lists no record a call may draft');
      await assertRefused(await start('guarded', [], [draft('jobs', 'patch', insertJ3()), draft('tally', 'add', encodeInt(1n))]),
        'draft tally.add (2 of 2): the function does not list record \'tally\' among those a call may draft: \'jobs\'');
    });

    it('refuses an unknown mutation, and arguments of the wrong number or type, naming the draft by its place among the call\'s', async () => {
      const add = draft('tally', 'add', encodeInt(1n));
      await assertRefused(await start('load', [], [add, draft('tally', 'nope', encodeInt(1n))]),
        'draft tally.nope (2 of 2): mutation \'nope\' not found on record \'tally\'');
      await assertRefused(await start('load', [], [draft('tally', 'add'), add]),
        'draft tally.add (1 of 2): mutation \'add\' expects 1 argument(s), got 0');
      await assertRefused(await start('load', [], [add, add, draft('tally', 'add', encodeString('one'))]),
        'draft tally.add (3 of 3): argument 1 of mutation \'add\' holds .String, and the mutation takes .Integer');
      await assertRefused(await start('load', [], [draft('tally', 'add', new Uint8Array([1, 2, 3]))]),
        /^draft tally\.add \(1 of 1\): argument 1 of mutation 'add' is not beast2: /);
      // What is no patch of the record's rows is refused before a program reads it
      await assertRefused(await start('load', [], [draft('jobs', 'patch', encodeInt(1n))]),
        /^draft jobs\.patch \(1 of 1\): argument 1 of mutation 'patch' holds \.Integer, and the mutation takes /);
    });

    it('refuses a draft of a record that holds no state yet, as a Save of it is refused', async () => {
      await assertRefused(await start('unset_plus', [], [draft('unset', 'add', encodeInt(1n))]),
        'draft unset.add (1 of 1): record \'unset\' has no state yet: it is unassigned until its first state is committed');
    });

    it('refuses a draft of a record its function\'s package does not declare, or that none of the function\'s inputs reads', async () => {
      // What e3.function refuses to declare, another exporter could write
      const pkg = await packageRead(storage, REPO, 'drafts', '1.0.0');
      const add = (record: string): FunctionDraft[] => [draft(record, 'add', encodeInt(1n))];
      assert.deepEqual(await pinCallDrafts(storage, REPO, WS, pkg, { inputs: [TALLY], drafts: ['ghost'] }, add('ghost')),
        { invalid: 'draft ghost.add (1 of 1): record \'ghost\' not found' });
      assert.deepEqual(await pinCallDrafts(storage, REPO, WS, pkg, { inputs: [JOBS], drafts: ['tally'] }, add('tally')),
        { invalid: 'draft tally.add (1 of 1): the function reads no input of record \'tally\'' });
      assert.equal(await pinCallDrafts(storage, REPO, WS, pkg, { inputs: [JOBS], drafts: ['jobs'] }, []), NO_CALL_DRAFTS, 'a call that passes none pins none');
    });

    it('files a call with each draft it passed, its arguments stored, and what laying them reads: each record\'s state and commit, and its mutations', async () => {
      const patch = insertJ3();
      const [jobsHead, tallyHead] = [await head('jobs'), await head('tally')];
      const filed = await start('load', [], [
        draft('jobs', 'patch', patch), draft('tally', 'reset'), draft('tally', 'add', encodeInt(5n)), draft('jobs', 'patch', patch),
      ]);
      assert.equal(filed.call.state.type, 'running');

      const [patchArgs, addArgs] = [sha256Hex(encodeMutationArgs([patch])), sha256Hex(encodeMutationArgs([encodeInt(5n)]))];
      assert.ok(sameDrafts(filed.call.drafts, [
        { record: 'jobs', mutation: 'patch', args: some(patchArgs), commit: jobsHead.commit },
        { record: 'tally', mutation: 'reset', args: none, commit: tallyHead.commit },
        { record: 'tally', mutation: 'add', args: some(addArgs), commit: tallyHead.commit },
        { record: 'jobs', mutation: 'patch', args: some(patchArgs), commit: jobsHead.commit },
      ]), 'each draft as passed, in order, with the commit its record stood at');
      assert.deepEqual(await storage.objects.read(REPO, addArgs), encodeMutationArgs([encodeInt(5n)]),
        'its arguments stored as the tuple a Save\'s commit names a mutation\'s by');
      assert.ok(sameDrafted(filed.drafted, [
        { record: 'jobs', path: JOBS, base: jobsHead.state, mutations: new SortedMap([['patch', await mutationOf('jobs', 'patch')]]) },
        {
          record: 'tally',
          path: TALLY,
          base: tallyHead.state,
          mutations: new SortedMap([['add', await mutationOf('tally', 'add')], ['reset', await mutationOf('tally', 'reset')]]),
        },
      ]), 'each drafted record once, in the order its drafts first name them');
      assert.ok(sameInputs(filed.call.inputs, [{ path: TALLY, hash: tallyHead.state }, { path: JOBS, hash: jobsHead.state }]),
        'its inputs at the states the drafts are laid over');
      assert.equal(runner.getCalls().length, 0, 'the start runs no mutation\'s program');
      const kept = await storage.calls.get(REPO, WS, filed.call.id);
      assert.ok(kept !== null && sameDrafts(kept.call.drafts, filed.call.drafts) && sameDrafted(kept.drafted, filed.drafted), 'and filed in the store');
    });
  });

  describe('laid as the call runs', () => {
    it('lays a patch of a record with no index with no process, runs the function at the drafted state, and saves nothing', async () => {
      const before = await storage.datasets.read(REPO, WS, 'records/jobs');
      const jobsHead = await head('jobs');
      runner.setDetachedResult(ran({ kind: 'success', value: encodeInt(1n) }));
      // An update, a delete and an insert, as a page's edits are
      const edit = jobsPatch([['j1', moved('P1', 'P9')], ['j2', variant('delete', { press: 'P2', hours: 3n })], ['j3', variant('insert', { press: 'P1', hours: 1n })]]);
      const filed = await start('jobs_on', [encodeString('P1')], [draft('jobs', 'patch', edit)]);
      const { job, result } = await run(filed.call.id);
      if (job?.call.state.type !== 'succeeded') assert.fail(`the call ended ${job?.call.state.type}`);

      assert.equal(runner.getCalls().length, 0, 'the patch is its own delta: no program runs');
      const [jobsInput, rateInput] = job.call.inputs;
      const drafted = jobsInput!.hash;
      assert.notEqual(drafted, jobsHead.state);
      assert.ok(sameJobs(await jobsAt(drafted), new Map([['j1', { press: 'P9', hours: 2n }], ['j3', { press: 'P1', hours: 1n }]])),
        'the drafted state holds the edit');
      const [press] = filed.call.args;
      if (press?.type !== 'value') assert.fail('its argument is a value');
      assert.deepEqual(runner.getDetachedCalls()[0]!.args, [{ dataset: drafted }, { dataset: filed.call.inputs[1]!.hash }, { dataset: press.value }],
        'the function reads the record at the drafted state, and every other input as stored');
      assert.equal(rateInput!.hash, filed.call.inputs[1]!.hash);

      if (result === null) assert.fail('the run answers its result');
      assert.ok(sameInputs(result.inputs, [{ path: JOBS, hash: drafted }, { path: RATE, hash: rateInput!.hash }]), 'its result names the drafted state as read');
      assert.ok(sameRead(result.drafts, [{ record: 'jobs', commit: jobsHead.commit }]), 'and the commit the record stood at');
      const status = await functionCallStatus(storage, REPO, job);
      assert.ok(status.type === 'completed' && sameResult(status.value, result), 'read back, the kept call answers the same');

      // Nothing is saved
      assert.deepEqual(await storage.datasets.read(REPO, WS, 'records/jobs'), before, 'the record stands where it stood');
      assert.equal((await recordHistory(storage, REPO, WS, 'jobs')).length, 1, 'no commit joined its history');
      assert.ok(sameJobs(await workspaceGetDataset(storage, REPO, WS, JOBS) as Jobs, SAVED_JOBS), 'and another reader reads it as saved');
    });

    it('lays several drafts of one record in the order passed, each over the state the one before it left', async () => {
      // Each fits only the state the one before it leaves: a job added, moved, and moved again
      const drafts = [
        draft('jobs', 'patch', insertJ3()),
        draft('jobs', 'patch', jobsPatch([['j3', moved('P1', 'P2')]])),
        draft('jobs', 'patch', jobsPatch([['j1', variant('delete', { press: 'P1', hours: 2n })], ['j3', moved('P2', 'P3')]])),
      ];
      const filed = await start('jobs_on', [encodeString('P3')], drafts);
      const { job } = await run(filed.call.id);
      if (job?.call.state.type !== 'succeeded') assert.fail(`the call ended ${job?.call.state.type}`);
      assert.ok(sameJobs(await jobsAt(job.call.inputs[0]!.hash), new Map([['j2', { press: 'P2', hours: 3n }], ['j3', { press: 'P3', hours: 1n }]])));

      // Passed in another order, the first no longer fits the state it is laid over
      const reordered = await start('jobs_on', [encodeString('P3')], [drafts[1]!, drafts[0]!, drafts[2]!]);
      const unfit = await run(reordered.call.id);
      if (unfit.job?.call.state.type !== 'conflict') assert.fail(`the call ended ${unfit.job?.call.state.type}`);
      assert.match(unfit.job.call.state.value.message, /j3/);
      assert.equal(runner.getDetachedCalls().length, 1, 'and its function does not run');
    });

    it('lays the drafts of two records in the order the call passed them, each record\'s over its own state', async () => {
      const [jobsHead, tallyHead] = [await head('jobs'), await head('tally')];
      // The reducer, answered as it would answer: the state and what is added to it
      const adding = new UnitRunner(async (_task, [state, by]) =>
        succeeded(decodeInt(await storage.objects.read(REPO, state!)) + decodeInt(await storage.objects.read(REPO, by!))));
      adding.setDetachedResult(ran({ kind: 'success', value: encodeInt(10n) }));
      const filed = await start('load', [], [
        draft('tally', 'add', encodeInt(5n)), draft('jobs', 'patch', insertJ3()), draft('tally', 'add', encodeInt(2n)),
      ]);
      const { job, result } = await run(filed.call.id, adding);
      if (job?.call.state.type !== 'succeeded') assert.fail(`the call ended ${job?.call.state.type}`);

      const units = adding.getCalls();
      assert.equal(units.length, 2, 'each reducer ran, and no program for the patch');
      assert.equal(units[0]!.inputHashes[0], tallyHead.state, 'the first over the state the record held');
      assert.equal(units[1]!.inputHashes[0], sha256Hex(encodeInt(5n)), 'the second over the state the first left');
      const [tallyInput, jobsInput] = job.call.inputs;
      assert.equal(tallyInput!.hash, sha256Hex(encodeInt(7n)));
      assert.ok(sameJobs(await jobsAt(jobsInput!.hash), withJ3));
      assert.deepEqual(adding.getDetachedCalls()[0]!.args, [{ dataset: tallyInput!.hash }, { dataset: jobsInput!.hash }], 'the function reads each at its drafted state');
      assert.ok(result !== null && sameRead(result.drafts, [{ record: 'tally', commit: tallyHead.commit }, { record: 'jobs', commit: jobsHead.commit }]),
        'its result names each drafted record once, in the order first named');
      assert.equal(await workspaceGetDataset(storage, REPO, WS, TALLY), 0n, 'neither record is saved');
      assert.equal((await head('jobs')).state, jobsHead.state);
    });
  });

  describe('ended by a draft', () => {
    const add = (): FunctionDraft => draft('tally', 'add', encodeInt(5n));

    it('ends a call a draft\'s program failed as a Save of it would have ended: failed, the draft named in the first line of its stderr, and its function not run', async () => {
      const tallyHead = await head('tally');
      let units = 0;
      const failing = new UnitRunner(async (task, inputs) => {
        if (++units === 1) return succeeded(5n);
        const execution = uuidv7();
        await storage.logs.append(REPO, task, inputsHash(inputs), execution, 'stderr', `${'x'.repeat(100)}the tail`);
        return { state: 'failed', cached: false, exitCode: 3, executionId: execution };
      });
      const filed = await start('load', [], [add(), add(), add()], some({ timeoutMs: none, maxResultBytes: none, maxLogBytes: some(8n) }));
      const { job, result } = await run(filed.call.id, failing);
      if (job?.call.state.type !== 'failed') assert.fail(`the call ended ${job?.call.state.type}`);

      assert.equal(job.call.state.value.exitCode, 3n);
      assert.equal(job.call.stderr, 'draft tally.add (2 of 3) failed\nthe tail', 'the draft, then as much of its program\'s stderr as the call\'s log limit keeps');
      assert.equal(job.call.stderrTruncated, true);
      assert.equal(job.call.stdout, '');
      assert.equal(job.call.expiresAt.getTime(), T + FAILED_MS, 'kept as a failure is');
      assert.equal(failing.getCalls().length, 2, 'the draft after it did not run');
      assert.equal(failing.getDetachedCalls().length, 0, 'nor the function');
      if (result === null || result.outcome.type !== 'failed') assert.fail('the run answers the failure');
      assert.equal(result.stderr, job.call.stderr);
      assert.ok(sameInputs(result.inputs, filed.call.inputs), 'it names its inputs as its start pinned them');
      assert.ok(sameRead(result.drafts, [{ record: 'tally', commit: tallyHead.commit }]));
      const status = await functionCallStatus(storage, REPO, job);
      assert.ok(status.type === 'completed' && sameResult(status.value, result), 'read back, the kept call answers the same');
    });

    it('ends a call timed out, with its own timeout, when a draft is still running as it ends', async () => {
      // Stopped at the call's timeout, as a Save's run is at its request's
      const slow = new UnitRunner((task, inputs, options) => new Promise((resolve) => {
        options!.signal!.addEventListener('abort', () => {
          const execution = uuidv7();
          void storage.logs.append(REPO, task, inputsHash(inputs), execution, 'stderr', 'slow reducer')
            .then(() => resolve({ state: 'error', cached: false, cancelled: true, executionId: execution }));
        }, { once: true });
      }));
      const filed = await start('load', [], [add()], some({ timeoutMs: some(40n), maxResultBytes: none, maxLogBytes: none }));
      const { job, result } = await run(filed.call.id, slow);
      if (job?.call.state.type !== 'timed_out') assert.fail(`the call ended ${job?.call.state.type}`);
      assert.equal(job.call.state.value.ms, 40n, 'the call\'s timeout, which the draft ran under');
      assert.equal(job.call.stderr, 'draft tally.add (1 of 1) timed out\nslow reducer');
      assert.equal(job.call.stderrTruncated, false);
      assert.equal(slow.getDetachedCalls().length, 0, 'its function does not run');
      assert.ok(result?.outcome.type === 'timed_out' && result.outcome.value.ms === 40n);
    });

    it('ends a call timed out when its timeout ended before a draft started, or as the last was laid', async () => {
      // The first draft takes all of the call's time
      const spending = (): UnitRunner => new UnitRunner(async () => {
        T += 600_000;
        return succeeded(5n);
      });
      const first = spending();
      const two = await start('load', [], [add(), add()]);
      const unstarted = await run(two.call.id, first);
      if (unstarted.job?.call.state.type !== 'timed_out') assert.fail(`the call ended ${unstarted.job?.call.state.type}`);
      assert.equal(unstarted.job.call.state.value.ms, 600_000n);
      assert.equal(unstarted.job.call.stderr, 'draft tally.add (2 of 2) timed out\n', 'the draft that did not start');
      assert.equal(first.getCalls().length, 1);
      assert.equal(first.getDetachedCalls().length, 0);

      const second = spending();
      const one = await start('load', [], [add()]);
      const laid = await run(one.call.id, second);
      if (laid.job?.call.state.type !== 'timed_out') assert.fail(`the call ended ${laid.job?.call.state.type}`);
      assert.equal(laid.job.call.stderr, '', 'no draft ended it');
      assert.equal(second.getDetachedCalls().length, 0, 'its function does not start');
      assert.equal(laid.job.call.inputs[0]!.hash, sha256Hex(encodeInt(5n)), 'its drafts were laid, and it names the state they left');
    });

    it('ends a call with a conflict when a Save changed a row under the edit, naming the record, the mutation and the words a Save of the edit is refused in', async () => {
      // The page read j1 on P1 and moved it to P9; another Save moved it to P2 first
      const edit = jobsPatch([['j1', moved('P1', 'P9')]]);
      const saved = await recordMutate(storage, runner, REPO, WS, 'jobs', 'patch', [jobsPatch([['j1', moved('P1', 'P2')]])], { actor: 'grace@example.com' });
      assert.equal(saved.kind, 'committed');
      const jobsHead = await head('jobs');
      const filed = await start('jobs_on', [encodeString('P9')], [draft('jobs', 'patch', edit)]);
      const { job, result } = await run(filed.call.id);
      if (job?.call.state.type !== 'conflict') assert.fail(`the call ended ${job?.call.state.type}`);

      assert.equal(job.call.state.value.record, 'jobs');
      assert.equal(job.call.state.value.mutation, 'patch');
      const refused = await recordMutate(storage, runner, REPO, WS, 'jobs', 'patch', [edit], { actor: 'ada@example.com' });
      if (refused.kind !== 'conflict') assert.fail(`a Save of the edit ended ${refused.kind}`);
      assert.equal(job.call.state.value.message, refused.detail, 'as a Save of the edit ends');
      assert.equal(job.call.state.value.message, 'primary: Cannot apply replace - expected "P1", found "P2"');
      assert.equal(job.call.expiresAt.getTime(), T + FAILED_MS, 'kept as a failure is');
      assert.equal(job.call.stderr, '');
      assert.equal(runner.getDetachedCalls().length, 0, 'its function does not run');
      if (result === null || result.outcome.type !== 'conflict') assert.fail('the run answers the conflict');
      assert.equal(result.outcome.value.message, job.call.state.value.message);
      assert.ok(sameRead(result.drafts, [{ record: 'jobs', commit: jobsHead.commit }]), 'it names the commit the edit no longer fits');
      assert.deepEqual(await head('jobs'), jobsHead, 'and the record stands where the Save left it');
      const status = await functionCallStatus(storage, REPO, job);
      assert.ok(status.type === 'completed' && sameResult(status.value, result), 'read back, the kept call answers the same');
    });

    it('stops laying at a request to cancel the call, and at its host\'s stop', async () => {
      const asked = heldUnits();
      const first = await start('load', [], [add()]);
      const cancelling = run(first.call.id, asked.runner, { watchMs: 10 });
      await asked.begun;
      await storage.calls.requestCancel(REPO, WS, first.call.id, { by: some('grace@example.com'), at: new Date(T) });
      const cancelled = (await cancelling).job;
      if (cancelled?.call.state.type !== 'cancelled') assert.fail(`the call ended ${cancelled?.call.state.type}`);
      assert.ok(sameCaller(cancelled.call.state.value.by, some('grace@example.com')), 'naming who asked');
      assert.equal(cancelled.call.expiresAt.getTime(), T + SUCCEEDED_MS, 'kept as long as a success');
      assert.equal(asked.runner.getDetachedCalls().length, 0, 'its function does not run');

      const stopped = heldUnits();
      const second = await start('load', [], [add()]);
      const host = new AbortController();
      // A watch that would not look again before the case ends
      const stopping = run(second.call.id, stopped.runner, { watchMs: 60_000, signal: host.signal });
      await stopped.begun;
      host.abort();
      const lost = (await stopping).job;
      if (lost?.call.state.type !== 'lost') assert.fail(`the call ended ${lost?.call.state.type}`);
      assert.equal(lost.call.state.value.message, 'the call\'s host stopped before it ended');
      assert.equal(stopped.runner.getDetachedCalls().length, 0);
    });

    it('records a call whose drafts could not be laid lost, saying why, and leaves one that ended meanwhile as it ended', async () => {
      const broken = new UnitRunner(() => Promise.reject(new Error('no runner answers')));
      const first = await start('load', [], [add()]);
      const unlaid = (await run(first.call.id, broken)).job;
      if (unlaid?.call.state.type !== 'lost') assert.fail(`the call ended ${unlaid?.call.state.type}`);
      assert.equal(unlaid.call.state.value.message, 'the call\'s drafts could not be laid: no runner answers');
      assert.equal(broken.getDetachedCalls().length, 0);

      // Its dispatch gave it up while its drafts were laid: the first end stands
      const second = await start('load', [], [add()]);
      const ending = new UnitRunner(async () => {
        await functionCallLost(storage, REPO, second, 'its dispatch gave it up', T);
        return succeeded(5n);
      });
      const left = await run(second.call.id, ending);
      if (left.job?.call.state.type !== 'lost') assert.fail(`the call is ${left.job?.call.state.type}`);
      assert.equal(left.job.call.state.value.message, 'its dispatch gave it up');
      assert.equal(left.result, null);
      assert.ok(sameInputs(left.job.call.inputs, second.call.inputs), 'its inputs as its start pinned them');
      assert.equal(ending.getDetachedCalls().length, 0, 'and its function does not run');
    });
  });

  describe('kept and collected', () => {
    it('keeps the drafted state through a collection for as long as the call is kept, and lets it go after', async () => {
      const gate = new GatedRunner();
      const filed = await start('jobs_on', [encodeString('P1')], [draft('jobs', 'patch', insertJ3())]);
      // A watch that would not look again before the case ends
      const running = run(filed.call.id, gate, { watchMs: 60_000 });
      await gate.running.opened;
      const drafted = (await storage.calls.get(REPO, WS, filed.call.id))!.call.inputs[0]!.hash;
      assert.notEqual(drafted, filed.call.inputs[0]!.hash);

      // Nothing but the call names the drafted state, from the moment it is laid
      await repoGc(storage, REPO, { minAge: 0 });
      assert.ok(sameJobs(await jobsAt(drafted), withJ3), 'kept while its function runs');
      gate.finish(ran({ kind: 'success', value: encodeInt(2n) }));
      assert.equal((await running).job?.call.state.type, 'succeeded');
      await repoGc(storage, REPO, { minAge: 0 });
      assert.ok(sameJobs(await jobsAt(drafted), withJ3), 'and while the call is kept');

      // Its lifetime over: written as stored, the one way a kept call is written over
      const stored = (await storage.calls.readStored(REPO)).find((call) => call.id === filed.call.id);
      if (stored === undefined) assert.fail('the store holds the call');
      const kept = decodeFunctionCallJob((await stored.read())!);
      await stored.replace(encodeFunctionCallJob({ ...kept, call: { ...kept.call, expiresAt: new Date(Date.now() - 1) } }));
      await repoGc(storage, REPO, { minAge: 0 });
      assert.equal(await storage.objects.exists(REPO, drafted), false, 'collected once the call is kept no longer');
      assert.ok(sameJobs(await workspaceGetDataset(storage, REPO, WS, JOBS) as Jobs, SAVED_JOBS), 'and the record reads as saved');
    });
  });
});

const PlanType = StructType({ status: StringType, due: IntegerType, title: StringType });
const PlansType = DictType(StringType, PlanType);
const StatusKeyType = StructType({ status: StringType, due: IntegerType });
const LabelsType = DictType(StringType, StringType);
type PlanOp = Extract<ValueTypeOf<PatchTypeOf<typeof PlansType>>, { type: 'patch' }>['value'] extends Map<string, infer Op> ? Op : never;

const encodePlansPatch = encodeBeast2For(PatchType(PlansType));
const decodeLabels = decodeBeast2For(LabelsType);
const sameLabels = equalFor(LabelsType);

/** A real runner that counts the functions it ran. */
class CountingRunner extends LocalTaskRunner {
  detached = 0;

  override runDetached(spec: DetachedSpec, options?: DetachedRunOptions): Promise<DetachedResult> {
    this.detached++;
    return super.runDetached(spec, options);
  }
}

/**
 * The package the real-runner cases deploy: `plans`, a Dict record with an
 * index, so every mutation of it runs its program, which maintains the index;
 * and `labels`, a function whose body reads the record's rows.
 */
function plansPackage(): ReturnType<typeof e3.package> {
  const plans = e3.record('plans', PlansType, {
    initial: new Map([
      ['p-1', { status: 'ok', due: 1n, title: 'Plan 1' }],
      ['p-2', { status: 'late', due: 2n, title: 'Plan 2' }],
      ['p-3', { status: 'ok', due: 3n, title: 'Plan 3' }],
    ]),
    indexes: (index) => ({
      by_status: index.key(East.function([StringType, PlanType], StatusKeyType, ($, _key, plan) => ({ status: plan.status, due: plan.due })), {
        value: East.function([StringType, PlanType], StringType, ($, _key, plan) => plan.title),
      }),
    }),
    mutations: (mutation) => ({
      retitle: mutation.edit(East.function([PlansType, StringType, StringType, e3.mutation.editType(PlansType)], NullType, ($, state, key, title, edit) => {
        const plan = $.let(state.get(key));
        $(edit.set(key, { status: plan.status, due: plan.due, title }));
      })),
      patch: mutation.patch(),
      refuse: mutation.reduce(East.function([PlansType, StringType], PlansType, ($, _state, why) => $.error(East.str`refused: ${why}`))),
    }),
  });
  const labels = e3.function('labels', { inputs: [plans], drafts: [plans], args: [StringType], output: LabelsType }, ($, plans, mark) => {
    const found = $.let(new Map(), LabelsType);
    $.for(plans, ($, plan, key) => {
      $(found.insert(key, East.str`${mark}${plan.status}/${plan.title}`));
    });
    return found;
  });
  return e3.package('plans', '1.0.0', plans, labels);
}

describe('a call\'s drafts, on the real runner', () => {
  let repo: string;
  let dir: string;
  let storage: StorageBackend;
  let runner: CountingRunner;
  const ws = 'main';

  beforeEach(async () => {
    repo = createTestRepo();
    dir = createTempDir();
    storage = new LocalStorage(dirname(repo));
    runner = new CountingRunner(repo);
    const zip = join(dir, 'plans.zip');
    await e3.export(plansPackage(), zip);
    await packageImport(storage, repo, zip);
    await workspaceCreate(storage, repo, ws);
    await workspaceDeploy(storage, repo, ws, 'plans', '1.0.0', { runner });
  });

  afterEach(() => {
    removeTestRepo(repo);
    removeTempDir(dir);
  });

  const call = async (drafts: FunctionDraft[]): Promise<FunctionCallJob> =>
    functionCallStart(storage, repo, ws, 'labels', request([encodeString('')], drafts), { caller: 'ada@example.com' });
  const recordRef = async (): Promise<{ hash: string; commit: string }> => {
    const ref = await storage.datasets.read(repo, ws, 'records/plans');
    if (ref === null || ref.type !== 'value') assert.fail('the record holds no state');
    const [latest] = await recordHistory(storage, repo, ws, 'plans', { limit: 1 });
    return { hash: ref.value.hash, commit: latest!.hash };
  };
  /** What an ended call's function answered. */
  const labelsOf = (run: FunctionCallRun): ValueTypeOf<typeof LabelsType> => {
    if (run.result === null || run.result.outcome.type !== 'success') {
      assert.fail(`the call ended ${run.job?.call.state.type}: ${run.job?.call.stderr}`);
    }
    return decodeLabels(run.result.outcome.value.value);
  };

  const retitle = (key: string, title: string): FunctionDraft => draft('plans', 'retitle', encodeString(key), encodeString(title));
  /** An insert, an update and a delete, as a page's edits are. */
  const edits = (): Uint8Array => encodePlansPatch(variant('patch', new SortedMap<string, PlanOp>([
    ['p-2', variant('delete', { status: 'late', due: 2n, title: 'Plan 2' })],
    ['p-3', variant('update', variant('patch', {
      status: variant('replace', { before: 'ok', after: 'late' }),
      due: variant('unchanged', null),
      title: variant('unchanged', null),
    }))],
    ['p-4', variant('insert', { status: 'ok', due: 4n, title: 'Plan 4' })],
  ], compareFor(StringType))));

  it('a function reads a drafted insert, update and delete, laid by the record\'s own programs: the state a Save of them leaves, index and all', async () => {
    const before = await storage.datasets.read(repo, ws, 'records/plans');
    const commits = (await recordHistory(storage, repo, ws, 'plans')).length;
    const stood = await recordRef();
    const filed = await call([retitle('p-1', 'Renamed'), draft('plans', 'patch', edits())]);
    const ended = await functionCallRun(storage, runner, repo, ws, filed.call.id);

    assert.ok(sameLabels(labelsOf(ended), new Map([['p-1', 'ok/Renamed'], ['p-3', 'late/Plan 3'], ['p-4', 'ok/Plan 4']])),
      'the body reads the rows with every draft laid');
    const drafted = ended.job!.call.inputs[0]!.hash;
    assert.ok(sameRead(ended.result!.drafts, [{ record: 'plans', commit: stood.commit }]));
    const index = await DatasetSegments.open(storage, repo, (await readRecordState(storage, repo, drafted)).indexes.get('by_status')!.manifest);
    assert.equal(index.elementCount, 3, 'the drafted state\'s index holds the drafts: a row gone, a row added');

    // Nothing is saved
    assert.deepEqual(await storage.datasets.read(repo, ws, 'records/plans'), before, 'the record stands where it stood');
    assert.equal((await recordHistory(storage, repo, ws, 'plans')).length, commits, 'no commit joined its history');
    const asSaved = await functionCallRun(storage, runner, repo, ws, (await call([])).call.id);
    assert.ok(sameLabels(labelsOf(asSaved), new Map([['p-1', 'ok/Plan 1'], ['p-2', 'late/Plan 2'], ['p-3', 'ok/Plan 3']])), 'a call with no draft reads it as saved');

    // Saved, the same mutations leave the state the drafts were read at
    for (const [mutation, args] of [['retitle', [encodeString('p-1'), encodeString('Renamed')]], ['patch', [edits()]]] as const) {
      const saved = await recordMutate(storage, runner, repo, ws, 'plans', mutation, [...args], { actor: 'ada@example.com' });
      assert.equal(saved.kind, 'committed', JSON.stringify(saved));
    }
    assert.equal((await recordRef()).hash, drafted, 'hash for hash');
  });

  it('a Save racing the call lands, and the call\'s read is unmoved', async () => {
    const stood = await recordRef();
    const filed = await call([retitle('p-1', 'Drafted')]);
    // Between the call's start and its run
    const saved = await recordMutate(storage, runner, repo, ws, 'plans', 'retitle', [encodeString('p-2'), encodeString('Saved')], { actor: 'grace@example.com' });
    assert.equal(saved.kind, 'committed', JSON.stringify(saved));
    const ended = await functionCallRun(storage, runner, repo, ws, filed.call.id);

    assert.ok(sameLabels(labelsOf(ended), new Map([['p-1', 'ok/Drafted'], ['p-2', 'late/Plan 2'], ['p-3', 'ok/Plan 3']])),
      'the call reads its draft over the state it started at, without the Save');
    assert.ok(sameRead(ended.result!.drafts, [{ record: 'plans', commit: stood.commit }]), 'and names the commit that state stood at');
    const landed = await recordRef();
    assert.notEqual(landed.commit, stood.commit, 'which the record has left: the Save landed');
    const asSaved = await functionCallRun(storage, runner, repo, ws, (await call([])).call.id);
    assert.ok(sameLabels(labelsOf(asSaved), new Map([['p-1', 'ok/Plan 1'], ['p-2', 'late/Saved'], ['p-3', 'ok/Plan 3']])), 'with the Save\'s row, and no draft');
  });

  it('a draft whose program fails ends the call failed, the program\'s own stderr after the draft\'s line, and the function does not run', async () => {
    const before = await storage.datasets.read(repo, ws, 'records/plans');
    const filed = await call([retitle('p-1', 'Renamed'), draft('plans', 'refuse', encodeString('not today'))]);
    const { job, result } = await functionCallRun(storage, runner, repo, ws, filed.call.id);
    if (job?.call.state.type !== 'failed') assert.fail(`the call ended ${job?.call.state.type}`);
    const [first, ...rest] = job.call.stderr.split('\n');
    assert.equal(first, 'draft plans.refuse (2 of 2) failed');
    assert.match(rest.join('\n'), /refused: not today/, 'the mutation\'s own stderr follows, as a Save returns it');
    assert.equal(runner.detached, 0, 'the function\'s body did not run');
    assert.ok(result?.outcome.type === 'failed');
    assert.deepEqual(await storage.datasets.read(repo, ws, 'records/plans'), before, 'and nothing is saved');
  });
});
