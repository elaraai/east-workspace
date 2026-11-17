/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * An index of a record as an input of a task or a function —
 * `e3.index(record.indexes.<name>)` (east-workspace#1617) — on a real runner:
 * a body reads a run of an index at the cost of the run, the inputs of one
 * record — and a dataset argument naming it — are read at one state of it, a
 * task is decided again when its record changes and runs again when the index
 * it reads did, a call's drafts are read through the index, a record with no
 * state makes a task wait and a call `invalid`, and a state that holds no such
 * index makes a task wait while the run and the gc go on.
 *
 * What a read cost is the segments the runner's pager decoded of the input,
 * which its verbose account says — a count, never a clock.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import {
  DictType, East, IntegerType, NullType, SortedMap, StringType, StructType, compareFor, decodeBeast2For, encodeBeast2For, equalFor, none, printFor, some,
  variant,
} from '@elaraai/east';
import e3 from '@elaraai/e3';
import {
  ExecuteResultType, TaskObjectType, decodeTaskObject, type ExecuteResult, type FunctionDraft, type TreePath,
} from '@elaraai/e3-types';
import { dataflowResolveInputHashes } from './dataflow.js';
import type { InputWait } from './dataflow/types.js';
import { DatasetSegments, indexNotHeld, inputObject, readDatasetWhole, recordIndexManifests } from './dataset-open.js';
import { executionFindCurrent } from './executions.js';
import { repoGc } from './gc.js';
import { dataflowExecute } from './execution/local-orchestrator.js';
import { functionCallUnkept } from './execution/functionCallUnkept.js';
import { LocalTaskRunner } from './execution/LocalTaskRunner.js';
import { packageImport } from './package-files.js';
import { packageRead } from './packages.js';
import { readRecordState, recordHistory, recordMutate } from './records.js';
import { LocalStorage } from './storage/local/index.js';
import type { StorageBackend } from './storage/interfaces.js';
import { createTempDir, createTestRepo, decodedOf, onRuntime, removeTempDir, removeTestRepo, stockRuntimesOnPath } from './test-helpers.js';
import { workspaceCreate } from './workspaces.js';
import { workspaceDeploy } from './workspace-files.js';
import { workspaceStatus } from './workspaceStatus.js';

/** Print jobs: enough of them that the index over their presses is stored in
 *  several segments. Job `i` is on press `i mod PRESSES`. */
const JOBS = 12_000;
const PRESSES = 60;
const ON_A_PRESS = JOBS / PRESSES;
/** The two as the record's `seed` mutation counts them. */
const JOB_COUNT = BigInt(JOBS);
const PRESS_COUNT = BigInt(PRESSES);

/** The runtimes each held to the one behaviour: a function and a task of the
 *  package run on each, named by it. */
const RUNTIMES = stockRuntimesOnPath();

const JobType = StructType({ press: StringType, title: StringType });
const JobsType = DictType(StringType, JobType);
const TitlesType = DictType(StringType, StringType);

/** Job `i`'s key and its press, each of one width, so they sort as their
 *  numbers do: as the record's `seed` mutation makes them. */
const jobKey = (i: number): string => `j${100_000 + i}`;
const pressOf = (i: number): string => `P${100 + (i % PRESSES)}`;

const WS = 'main';
const JOBS_PATH: TreePath = [variant('field', 'records'), variant('field', 'jobs')];
const LIMITS = { timeoutMs: 120_000, maxResultBytes: 4 * 1024 * 1024, maxLogBytes: 64 * 1024 };

const encodeString = encodeBeast2For(StringType);
const decodeInt = decodeBeast2For(IntegerType);
const decodeTitles = decodeBeast2For(TitlesType);
const sameTitles = equalFor(TitlesType);
const InputsType = ExecuteResultType.fields.inputs;
const sameInputs = equalFor(InputsType);
const printInputs = printFor(InputsType);

/** The titles of the jobs a press holds, as saved at the deploy. */
function titlesOn(press: number): Map<string, string> {
  const rows = new SortedMap<string, string>([], compareFor(StringType));
  for (let i = press; i < JOBS; i += PRESSES) rows.set(jobKey(i), `Job ${i}`);
  return rows;
}

/** How titles read differ from those expected, in a few words: a run holds two hundred. */
function titlesDiffer(read: Map<string, string>, expected: Map<string, string>): string {
  const differing = [...new Set([...read.keys(), ...expected.keys()])].filter((key) => read.get(key) !== expected.get(key));
  return `${read.size} read, ${expected.size} expected, differing at ${differing.slice(0, 5).map((key) => `${key}: ${read.get(key)} / ${expected.get(key)}`).join('; ')}`;
}

/** A draft of a mutation of `jobs`, its arguments Strings. */
function draft(mutation: string, ...args: string[]): FunctionDraft {
  return { record: 'jobs', mutation, args: args.map((arg) => encodeString(arg)) };
}

describe('an index of a record as an input', { timeout: 480_000, concurrency: false }, () => {
  let repo: string;
  let tempDir: string;
  let storage: StorageBackend;
  let runner: LocalTaskRunner;

  before(async () => {
    repo = createTestRepo();
    tempDir = createTempDir();
    storage = new LocalStorage(dirname(repo));
    runner = new LocalTaskRunner(repo);

    const jobs = e3.record('jobs', JobsType, {
      initial: new Map(),
      indexes: (index) => ({ jobs_by_press: index.on(['press']) }),
      mutations: (mutation) => ({
        // The jobs, made where the data is: job i on press i mod PRESSES
        seed: mutation.reduce(East.function([JobsType], JobsType, ($, _state) => {
          const rows = $.let(new Map(), JobsType);
          $.for(East.Array.range(0n, JOB_COUNT), ($, i) => {
            $(rows.insert(East.str`j${i.add(100_000n)}`, { press: East.str`P${i.remainder(PRESS_COUNT).add(100n)}`, title: East.str`Job ${i}` }));
          });
          return rows;
        })),
        // A job moved to another press: its index entry moves with it
        move: mutation.edit(East.function([JobsType, StringType, StringType, e3.mutation.editType(JobsType)], NullType,
          ($, state, key, press, edit) => { $(edit.set(key, { press, title: state.get(key).title })); })),
        // A job given another title: the index, which carries nothing, is as it was
        retitle: mutation.edit(East.function([JobsType, StringType, StringType, e3.mutation.editType(JobsType)], NullType,
          ($, state, key, title, edit) => { $(edit.set(key, { press: state.get(key).press, title })); })),
      }),
    });
    // A record whose first state is committed from outside: unassigned until then
    const backlog = e3.record('backlog', JobsType, { indexes: (index) => ({ backlog_by_press: index.on(['press']) }) });
    const watched = e3.input('watched', StringType, variant('value', 'P107'));

    const byPress = e3.index(jobs.indexes.jobs_by_press);
    const jobsOnPress = e3.function('jobs_on_press', { inputs: [byPress], drafts: [jobs], args: [StringType], output: IntegerType },
      ($, jobsByPress, press) => jobsByPress.prefix({ ik: press }).size());
    const titlesOnPress = e3.function('titles_on_press', { inputs: [byPress, jobs], drafts: [jobs], args: [StringType], output: TitlesType },
      ($, jobsByPress, jobs, press) => {
        const titles = $.let(new Map(), TitlesType);
        $.for(jobsByPress.prefix({ ik: press }), ($, _carried, key) => {
          $(titles.insert(key.k, jobs.get(key.k).title));
        });
        return titles;
      });
    const backlogOnPress = e3.function('backlog_on_press', { inputs: [e3.index(backlog.indexes.backlog_by_press)], args: [StringType], output: IntegerType },
      ($, backlogByPress, press) => backlogByPress.prefix({ ik: press }).size());
    // The rows as an argument its caller names beside the index the function reads
    const titlesOfRows = e3.function('titles_of_rows', { inputs: [byPress], args: [StringType, JobsType], output: TitlesType },
      ($, jobsByPress, press, jobs) => {
        const titles = $.let(new Map(), TitlesType);
        $.for(jobsByPress.prefix({ ik: press }), ($, _carried, key) => {
          $(titles.insert(key.k, jobs.get(key.k).title));
        });
        return titles;
      });

    const watchedJobs = e3.task('watched_jobs', [byPress, watched],
      East.function([byPress.type, StringType], IntegerType, ($, jobsByPress, press) => jobsByPress.prefix({ ik: press }).size()));
    const backlogByPress = e3.index(backlog.indexes.backlog_by_press);
    const watchedBacklog = e3.task('watched_backlog', [backlogByPress, watched],
      East.function([backlogByPress.type, StringType], IntegerType, ($, entries, press) => entries.prefix({ ik: press }).size()));

    // The same function and the same task on each runtime, which is handed the
    // index as the default runner is
    const onEachRuntime = RUNTIMES.flatMap((runtime) => [
      e3.function(onRuntime('jobs_on_press', runtime), { inputs: [byPress], args: [StringType], output: IntegerType, runner: { runtime, platforms: [] } },
        ($, jobsByPress, press) => jobsByPress.prefix({ ik: press }).size()),
      e3.task(onRuntime('watched_jobs', runtime), [byPress, watched],
        East.function([byPress.type, StringType], IntegerType, ($, jobsByPress, press) => jobsByPress.prefix({ ik: press }).size()),
        { runner: { runtime, platforms: [] } }),
    ]);

    const zip = join(tempDir, 'presses.zip');
    await e3.export(e3.package('presses', '1.0.0', jobsOnPress, titlesOnPress, backlogOnPress, titlesOfRows, watchedJobs, watchedBacklog, ...onEachRuntime), zip);
    await packageImport(storage, repo, zip);
    await workspaceCreate(storage, repo, WS);
    await workspaceDeploy(storage, repo, WS, 'presses', '1.0.0', { runner });
    const seeded = await recordMutate(storage, runner, repo, WS, 'jobs', 'seed', [], { actor: 'ada@example.com' });
    assert.equal(seeded.kind, 'committed', JSON.stringify(seeded));
    assert.equal(pressOf(7), 'P107', 'the watched press is the one the task\'s input names');
  });

  after(() => {
    removeTestRepo(repo);
    removeTempDir(tempDir);
  });

  /** The hash the workspace holds `jobs` at: its state's. */
  async function jobsState(): Promise<string> {
    const ref = await storage.datasets.read(repo, WS, 'records/jobs');
    if (ref?.type !== 'value') assert.fail('jobs holds a state');
    return ref.value.hash;
  }

  /** The manifest a state of `jobs` holds its index in. */
  async function indexOf(state: string): Promise<string> {
    const held = (await readRecordState(storage, repo, state)).indexes.get('jobs_by_press');
    assert.ok(held !== undefined, 'the state names the index');
    return held.manifest;
  }

  /** A call no store keeps, of a function of the package deployed to the workspace. */
  async function call(fn: string, args: string[], drafts: FunctionDraft[] = [], verbose = false): Promise<ExecuteResult> {
    return functionCallUnkept(storage, runner, repo, WS, fn,
      { args: args.map((arg) => variant('value', encodeString(arg))), drafts }, { limits: LIMITS, verbose });
  }

  /** A call's value, once it succeeded. */
  function valueOf(result: ExecuteResult): Uint8Array {
    if (result.outcome.type !== 'success') assert.fail(`the call ended ${result.outcome.type}:\n${result.stderr}`);
    return result.outcome.value.value;
  }

  /** What a task that counts the watched press's jobs last wrote. */
  async function watchedJobsOutput(task = 'watched_jobs'): Promise<bigint> {
    const ref = await storage.datasets.read(repo, WS, `tasks/${task}/output`);
    if (ref?.type !== 'value') assert.fail(`${task} has written its output`);
    return decodeInt(await readDatasetWhole(storage, repo, ref.value.hash));
  }

  /** The status of the task `watched_jobs`, as the workspace's status says it. */
  async function watchedJobsStatus(): Promise<string> {
    const status = await workspaceStatus(storage, runner, repo, WS);
    return status.tasks.find((task) => task.name === 'watched_jobs')!.status.type;
  }

  it('finds an index\'s manifest in the state its record holds, and none where the state names no such index', async () => {
    const state = await jobsState();
    const { primary } = await readRecordState(storage, repo, state);
    const index = await indexOf(state);
    assert.equal(await inputObject(storage, repo, state, null), state, 'a dataset itself is read at the hash it holds');
    assert.equal(await inputObject(storage, repo, state, 'jobs_by_press'), index, 'an index is read as the manifest the state names for it');
    assert.equal(await inputObject(storage, repo, state, 'jobs_by_title'), null, 'a state names no index its record does not declare');
    assert.equal(await inputObject(storage, repo, primary, 'jobs_by_press'), null, 'and a collection that is no record\'s state names none');
    assert.deepEqual([...(await recordIndexManifests(storage, repo, state))!], [['jobs_by_press', index]]);
    assert.equal(await recordIndexManifests(storage, repo, primary), null);

    // The index is stored in several segments, which a run of it must not all cost
    assert.ok((await DatasetSegments.open(storage, repo, index)).segmentCount >= 8, 'the index is in at least eight segments');
  });

  it('a function reads a run of an index at the cost of the run, and its result names the record, the index and the state read', async () => {
    const state = await jobsState();
    const result = await call('jobs_on_press', [pressOf(7)], [], true);
    assert.equal(decodeInt(valueOf(result)), BigInt(ON_A_PRESS));
    assert.ok(sameInputs(result.inputs, [{ path: JOBS_PATH, index: some('jobs_by_press'), hash: state }]),
      `it names the record, the index and the hash the record was pinned at: ${printInputs(result.inputs)}`);

    const index = await DatasetSegments.open(storage, repo, await indexOf(state));
    const { decoded, segments } = decodedOf(result.stderr, 0);
    assert.equal(segments, index.segmentCount, 'the runner was handed the index\'s own segments, not the record\'s rows');
    assert.ok(decoded <= 2, `the size of a press's run decodes the segment each of its ends lands in, and none between: ${decoded} of ${segments}`);

    assert.equal(decodeInt(valueOf(await call('jobs_on_press', ['P99']))), 0n, 'a press with no job holds none');
  });

  for (const runtime of RUNTIMES) {
    it(`${runtime} is handed the index's own segments, and reads a run of it at the cost of the run`, async () => {
      const result = await call(onRuntime('jobs_on_press', runtime), [pressOf(7)], [], true);
      assert.equal(decodeInt(valueOf(result)), BigInt(ON_A_PRESS));
      const index = await DatasetSegments.open(storage, repo, await indexOf(await jobsState()));
      const { decoded, segments } = decodedOf(result.stderr, 0);
      assert.equal(segments, index.segmentCount, 'the runner was handed the index\'s own segments, not the record\'s rows');
      assert.ok(decoded <= 2, `the size of a press's run decodes the segment each of its ends lands in, and none between: ${decoded} of ${segments}`);
    });
  }

  /**
   * Runs `read` with a write landing as soon as the record's ref is first
   * read — job `key` moved to another press — so a second read of the ref
   * would find the record at another state; then moves the job back.
   */
  async function withWriteAfterFirstRead<T>(key: string, read: () => Promise<T>): Promise<T> {
    const readRef = storage.datasets.read.bind(storage.datasets);
    const move = async (press: string): Promise<void> => {
      const saved = await recordMutate(storage, runner, repo, WS, 'jobs', 'move', [encodeString(key), encodeString(press)], { actor: 'ada@example.com' });
      assert.equal(saved.kind, 'committed', JSON.stringify(saved));
    };
    let reads = 0;
    storage.datasets.read = async (...at) => {
      const ref = await readRef(...at);
      if (at[2] === 'records/jobs' && reads++ === 0) await move(pressOf(8));
      return ref;
    };
    try {
      return await read();
    } finally {
      storage.datasets.read = readRef;
      assert.ok(reads > 0, 'the record was read, and the write landed');
      await move(pressOf(7));
    }
  }

  it('a call reads the record beside its index at one state of it, though a write lands between the two', async () => {
    const before = await jobsState();
    const result = await withWriteAfterFirstRead(jobKey(7), () => call('titles_on_press', [pressOf(7)]));
    assert.ok(sameInputs(result.inputs, [
      { path: JOBS_PATH, index: some('jobs_by_press'), hash: before },
      { path: JOBS_PATH, index: none, hash: before },
    ]), `the index and the record are read at the one state the first read found: ${printInputs(result.inputs)}`);
    const titles = decodeTitles(valueOf(result));
    assert.ok(sameTitles(titles, titlesOn(7)), `every entry of the index named a row the record held: ${titlesDiffer(titles, titlesOn(7))}`);
  });

  it('a call reads its index input and a dataset argument naming the same record at one state of it, though a write lands between the two', async () => {
    const before = await jobsState();
    const result = await withWriteAfterFirstRead(jobKey(7), () => functionCallUnkept(storage, runner, repo, WS, 'titles_of_rows', {
      args: [variant('value', encodeString(pressOf(7))), variant('dataset', JOBS_PATH)], drafts: [],
    }, { limits: LIMITS }));
    assert.ok(sameInputs(result.inputs, [
      { path: JOBS_PATH, index: some('jobs_by_press'), hash: before },
      { path: JOBS_PATH, index: none, hash: before },
    ]), `the index and the argument are read at the one state the first read found: ${printInputs(result.inputs)}`);
    const titles = decodeTitles(valueOf(result));
    assert.ok(sameTitles(titles, titlesOn(7)), `every entry of the index named a row the argument held: ${titlesDiffer(titles, titlesOn(7))}`);
  });

  it('a task\'s inputs of one record are resolved at one state of it, though a write lands between the two', async () => {
    // The package's task, given the record beside its index
    const pkg = await packageRead(storage, repo, 'presses', '1.0.0');
    const task = decodeTaskObject(await storage.objects.read(repo, pkg.tasks.get('watched_jobs')!));
    const hash = await storage.objects.write(repo, encodeBeast2For(TaskObjectType)({
      ...task,
      inputs: [{ path: JOBS_PATH, index: some('jobs_by_press'), partition: none }, { path: JOBS_PATH, index: none, partition: none }],
    }));
    const before = await jobsState();
    const resolved = await withWriteAfterFirstRead(jobKey(7), () => dataflowResolveInputHashes(storage, repo, WS, {
      name: 'watched_jobs', hash, inputs: ['.records.jobs', '.records.jobs'], output: '.tasks.watched_jobs.output', dependsOn: [], load: none,
    }));
    assert.deepEqual(resolved, [await indexOf(before), before], 'the index\'s manifest in the state the one read found, and that state');
  });

  it('a task runs over an index, is decided again when its record changes, and runs again when the index it reads did', async () => {
    const first = await dataflowExecute(storage, repo, WS, { runner });
    assert.equal(first.success, true, JSON.stringify(first.tasks));
    assert.deepEqual(first.tasks.find((task) => task.name === 'watched_jobs'), { ...first.tasks.find((task) => task.name === 'watched_jobs'), cached: false, state: 'success' });
    assert.equal(await watchedJobsOutput(), BigInt(ON_A_PRESS));
    assert.equal(await watchedJobsStatus(), 'up-to-date');
    for (const runtime of RUNTIMES) assert.equal(await watchedJobsOutput(onRuntime('watched_jobs', runtime)), BigInt(ON_A_PRESS), `${runtime} counted the run`);

    // Its execution is keyed by the objects it read: the index's manifest, and the input
    const state = await jobsState();
    const current = await executionFindCurrent(storage, repo, WS, 'watched_jobs');
    assert.ok(current !== null && current.isCurrent, 'its latest attempt is over its current inputs');

    // A write that leaves the index as it was: the record changes, the index does not
    const retitled = await recordMutate(storage, runner, repo, WS, 'jobs', 'retitle', [encodeString(jobKey(7)), encodeString('Annual report')], { actor: 'ada@example.com' });
    assert.equal(retitled.kind, 'committed', JSON.stringify(retitled));
    const after = await jobsState();
    assert.notEqual(after, state, 'the record changed');
    assert.equal(await indexOf(after), await indexOf(state), 'its index did not');
    assert.equal(await watchedJobsStatus(), 'up-to-date', 'the task still reads up to date: what it read is as it was');
    const again = await dataflowExecute(storage, repo, WS, { runner });
    assert.equal(again.success, true, JSON.stringify(again.tasks));
    assert.equal(again.tasks.find((task) => task.name === 'watched_jobs')?.cached, true, 'decided again, and served by the cache');
    assert.equal(again.executed, 0, 'and so is the task on each runtime');

    // A write that changes the index: a job leaves the watched press
    const moved = await recordMutate(storage, runner, repo, WS, 'jobs', 'move', [encodeString(jobKey(7)), encodeString(pressOf(9))], { actor: 'ada@example.com' });
    assert.equal(moved.kind, 'committed', JSON.stringify(moved));
    assert.notEqual(await indexOf(await jobsState()), await indexOf(state), 'the index changed');
    assert.equal(await watchedJobsStatus(), 'ready', 'the task is to run again');
    const rerun = await dataflowExecute(storage, repo, WS, { runner });
    assert.equal(rerun.success, true, JSON.stringify(rerun.tasks));
    assert.equal(rerun.tasks.find((task) => task.name === 'watched_jobs')?.cached, false, 'it ran again');
    assert.equal(await watchedJobsOutput(), BigInt(ON_A_PRESS - 1));
    assert.equal(await watchedJobsStatus(), 'up-to-date');
    for (const runtime of RUNTIMES) {
      const task = onRuntime('watched_jobs', runtime);
      assert.equal(rerun.tasks.find((ran) => ran.name === task)?.cached, false, `${runtime} ran again`);
      assert.equal(await watchedJobsOutput(task), BigInt(ON_A_PRESS - 1), `${runtime} counted the run as the write left it`);
    }

    // Back as it was
    for (const [mutation, value] of [['move', pressOf(7)], ['retitle', 'Job 7']] as const) {
      const back = await recordMutate(storage, runner, repo, WS, 'jobs', mutation, [encodeString(jobKey(7)), encodeString(value)], { actor: 'ada@example.com' });
      assert.equal(back.kind, 'committed', JSON.stringify(back));
    }
  });

  it('a call\'s drafts are read through the index, at the drafted state, and nothing is saved', async () => {
    const state = await jobsState();
    const commits = (await recordHistory(storage, repo, WS, 'jobs')).length;
    // A job dragged onto the watched press, and one dragged off it, neither saved
    const drafts = [draft('move', jobKey(8), pressOf(7)), draft('move', jobKey(67), pressOf(9))];
    const counted = await call('jobs_on_press', [pressOf(7)], drafts);
    assert.equal(decodeInt(valueOf(counted)), BigInt(ON_A_PRESS), 'one on, one off');
    const [read] = counted.inputs;
    assert.ok(read !== undefined && counted.inputs.length === 1 && read.index.type === 'some' && read.index.value === 'jobs_by_press');
    assert.notEqual(read.hash, state, 'the index is read at the drafted state, which the result names');

    const titled = await call('titles_on_press', [pressOf(7)], drafts);
    const expected = titlesOn(7);
    expected.set(jobKey(8), 'Job 8');
    expected.delete(jobKey(67));
    const titles = decodeTitles(valueOf(titled));
    assert.ok(sameTitles(titles, expected), `the index and the rows hold the drafts alike: ${titlesDiffer(titles, expected)}`);
    assert.ok(titled.inputs.length === 2 && titled.inputs[0]!.hash === titled.inputs[1]!.hash && titled.inputs[0]!.hash === read.hash,
      `both inputs of the record are read at the one drafted state: ${printInputs(titled.inputs)}`);

    assert.equal(await jobsState(), state, 'the record stands where it stood');
    assert.equal((await recordHistory(storage, repo, WS, 'jobs')).length, commits, 'and no commit joined its history');
    assert.equal(decodeInt(valueOf(await call('jobs_on_press', [pressOf(7)]))), BigInt(ON_A_PRESS), 'a call with no draft reads it as saved');
  });

  it('an index of a record with no state yet makes a call invalid and a task wait, as the record does', async () => {
    const result = await call('backlog_on_press', [pressOf(7)]);
    if (result.outcome.type !== 'invalid') assert.fail(`the call ended ${result.outcome.type}`);
    assert.deepEqual(result.outcome.value.diagnostics.map(({ message }) => message), [
      'The function\'s input .records.backlog is not assigned (ref type: unassigned): its first state is not yet committed, and nothing ran',
    ]);
    assert.equal(result.inputs.length, 0);

    const waiting: Array<[string, InputWait[]]> = [];
    const run = await dataflowExecute(storage, repo, WS, { runner, onTaskWaiting: (task, waits) => waiting.push([task, waits]) });
    assert.equal(run.success, true, 'the run goes on without it');
    assert.deepEqual(waiting, [['watched_backlog', [{ input: '.records.backlog', kind: 'unset' }]]], 'the task waits on the record');
    assert.equal(run.waiting, 1);
    const status = await workspaceStatus(storage, runner, repo, WS);
    assert.deepEqual(status.tasks.find((task) => task.name === 'watched_backlog')!.status, { type: 'waiting', reason: 'Input \'.records.backlog\' is not set' });
  });

  it('a state that holds no index a task reads leaves the task waiting, as its status says, and the run and the gc go on', async () => {
    const ref = await storage.datasets.read(repo, WS, 'records/jobs');
    if (ref?.type !== 'value') assert.fail('jobs holds a state');
    const { primary } = await readRecordState(storage, repo, ref.value.hash);
    // A state written outside the doors that build every index its record
    // declares: the record's rows alone
    await storage.datasets.write(repo, WS, 'records/jobs', variant('value', { ...ref.value, hash: primary }));
    try {
      const waiting: Array<[string, InputWait[]]> = [];
      const run = await dataflowExecute(storage, repo, WS, { runner, onTaskWaiting: (task, waits) => waiting.push([task, waits]) });
      assert.equal(run.success, true, `the run goes on without it: ${JSON.stringify(run.tasks)}`);
      assert.ok(waiting.some(([task, waits]) => task === 'watched_jobs' && waits.some((wait) => wait.kind === 'unset' && wait.input === '.records.jobs')),
        `the task waits on the record, as on one not set: ${JSON.stringify(waiting)}`);
      const status = await workspaceStatus(storage, runner, repo, WS);
      assert.deepEqual(status.tasks.find((task) => task.name === 'watched_jobs')!.status,
        { type: 'waiting', reason: `Input '.records.jobs': ${indexNotHeld('.records.jobs', 'jobs_by_press')}` });
      // The gc's keep phase reads every task's current inputs
      await repoGc(storage, repo, { minAge: 0 });
    } finally {
      await storage.datasets.write(repo, WS, 'records/jobs', ref);
    }
  });
});
