/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The repository record's contract: what an open does with a repository's
 * record and the upgrades it owes, over any backend.
 */

import { describe, it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ArrayType, IntegerType, OptionType, encodeBeast2For, equalFor, none, printFor, some, variant, type ValueTypeOf,
} from '@elaraai/east';
import e3 from '@elaraai/e3';
import {
  DataflowExecutionStateType, E3_RELEASE, ExecutionEventType, ExecutionStatusType, RepositoryUpgradeProgressType, WorkspaceRecordType,
  dataflowForce, decodeExecutionStatus, type DataflowExecutionState, type DataflowForce, type ExecutionEvent, type ExecutionStatus,
  type RepositoryUpgradeProgress, type StopReason,
} from '@elaraai/e3-types';
import type { EventSegment } from '../dataflow/state-store/events.js';
import { ExecutionCorruptError, RepoLayoutError, RepositoryUpgradePendingError } from '../errors.js';
import { MockTaskRunner } from '../execution/MockTaskRunner.js';
import { packageImport } from '../package-files.js';
import { recordHistory, recordSystemCommit } from '../records.js';
import { REPOSITORY_UPGRADES, repositoryOpen, repositoryUpgradeStep } from '../repository-record.js';
import { withRunningWork } from '../running-work.js';
import { DATAFLOW_EVENTS_APART, dataflowEventsApart } from '../upgrades/dataflow-events-apart.js';
import { DATAFLOW_FORCE_TASKS, DataflowStateBeforeForceTasksType, dataflowForceTasks } from '../upgrades/dataflow-force-tasks.js';
import { EXECUTION_STOP_REASONS, ExecutionStatusBeforeReasonsType, executionStopReasons } from '../upgrades/execution-stop-reasons.js';
import { RUNNING_EXECUTIONS_INDEXED } from '../upgrades/running-executions-indexed.js';
import { TASK_RUNS_INDEXED } from '../upgrades/task-runs-indexed.js';
import { uuidv7 } from '../uuid.js';
import { workspaceCreate } from '../workspaces.js';
import { workspaceDeploy } from '../workspace-files.js';
import type { RepositoryUpgrade, StorageBackend } from '../storage/interfaces.js';
import type { BackendSetup } from './setup.js';

/** How a step {@link register} adds behaves. */
interface StepOptions {
  /** Fails while this says so. */
  fails?: () => boolean;
  /** Takes this long, in milliseconds. */
  takes?: number;
  /**
   * How many units of work it does, each recorded in `ran` as
   * `<name>/<unit>`, a part's cursor the last unit it did. Unless set, it does
   * its work in one part, recorded as its name.
   */
  units?: number;
  /** The most units a part does: as many as its time allows unless set. */
  part?: number;
  /** Where to record how long each part is given, in milliseconds from when
   *  it is called. */
  allowed?: number[];
}

/**
 * Registers a step every backend applies, for one test: it records each run in
 * `ran`, and is removed when the test ends.
 */
function register(t: TestContext, name: string, ran: string[], options: StepOptions = {}): void {
  const upgrade: RepositoryUpgrade = {
    name,
    async apply(storage, repo, at, until) {
      options.allowed?.push(until - Date.now());
      assert.notEqual(await storage.refs.repositoryRead(repo), null, 'a step runs over a repository with its record');
      if (options.takes !== undefined) await new Promise((resolve) => setTimeout(resolve, options.takes));
      if (options.fails?.() === true) throw new Error(`${name} failed`);
      if (options.units === undefined) {
        ran.push(name);
        return null;
      }
      const from = at === null ? 0 : Number.parseInt(at, 10) + 1;
      for (let unit = from; unit < options.units; unit++) {
        ran.push(`${name}/${unit}`);
        if (unit + 1 < options.units && (Date.now() >= until || unit + 1 - from === options.part)) return `${unit}`;
      }
      return null;
    },
  };
  REPOSITORY_UPGRADES.push(upgrade);
  t.after(() => {
    REPOSITORY_UPGRADES.splice(REPOSITORY_UPGRADES.indexOf(upgrade), 1);
  });
}

const sameProgress = equalFor(RepositoryUpgradeProgressType);
const printProgress = printFor(OptionType(RepositoryUpgradeProgressType));

/** What an open records of a step under way, write by write: a part's stop,
 *  or none once the step is done. */
const ProgressWritesType = ArrayType(OptionType(RepositoryUpgradeProgressType));
const sameProgressWrites = equalFor(ProgressWritesType);
const printProgressWrites = printFor(ProgressWritesType);

/** Asserts the store upgrade the repository has under way is `expected`, or
 *  that it has none. */
async function assertProgress(
  storage: StorageBackend,
  repo: string,
  expected: RepositoryUpgradeProgress | null,
  message: string,
): Promise<void> {
  const read = await storage.refs.repositoryUpgradeRead(repo);
  const print = (progress: RepositoryUpgradeProgress | null) => printProgress(progress === null ? none : some(progress));
  const same = expected === null ? read === null : read !== null && sameProgress(read, expected);
  assert.ok(same, `${message}: ${print(read)}, where ${print(expected)} was expected`);
}

/**
 * Registers the repository record's contract suite over a backend.
 *
 * @remarks
 * Every case goes through the storage interfaces, so a backend runs it over its
 * own stores by giving its own setup: the record it keeps, the repository it
 * creates, its locks, and the records a workspace holds across an upgrade.
 *
 * @param setup - Makes a fresh backend and a repository in it for each test
 */
export function repositoryRecordTests(setup: BackendSetup): void {
  describe('the repository record', () => {
    it('names, for a new repository, this release and every upgrade this e3 knows', async (t) => {
      const ran: string[] = [];
      register(t, 'contract-known', ran);
      const { storage, repo } = await setup(t);

      const record = await repositoryOpen(storage, repo);
      assert.equal(record.release, E3_RELEASE);
      assert.deepEqual(record.upgrades, [...storage.upgrades, ...REPOSITORY_UPGRADES].map(({ name }) => ({ name, release: E3_RELEASE })));
      assert.deepEqual(ran, [], 'a new repository is in the forms every step writes');
    });

    it('is read, and nothing written, by an open of a repository that has had every upgrade', async (t) => {
      const { storage, repo } = await setup(t);
      const record = await repositoryOpen(storage, repo);

      // Another release wrote it last, and applied no step this e3 does not know.
      for (const release of ['0.0.1', '999.0.0']) {
        await storage.refs.repositoryWrite(repo, { ...record, release });
        assert.deepEqual(await repositoryOpen(storage, repo), { ...record, release });
        assert.deepEqual(await storage.refs.repositoryRead(repo), { ...record, release }, `${release}: nothing is written`);
      }
    });

    it('gains, as an open applies them in order and once, the upgrades the repository had not had', async (t) => {
      const { storage, repo } = await setup(t);
      const before = await repositoryOpen(storage, repo);
      await storage.refs.repositoryWrite(repo, { ...before, release: '0.0.1' });
      const ran: string[] = [];
      register(t, 'contract-first', ran);
      register(t, 'contract-second', ran);

      const record = await repositoryOpen(storage, repo);
      assert.deepEqual(ran, ['contract-first', 'contract-second']);
      assert.equal(record.release, E3_RELEASE);
      assert.deepEqual(record.upgrades, [
        ...before.upgrades, { name: 'contract-first', release: E3_RELEASE }, { name: 'contract-second', release: E3_RELEASE },
      ]);
      assert.deepEqual(await storage.refs.repositoryRead(repo), record);

      await repositoryOpen(storage, repo);
      assert.deepEqual(ran, ['contract-first', 'contract-second'], 'opened again, nothing more is applied');
    });

    it('keeps the steps before a failed one, so the next open applies only the rest', async (t) => {
      const { storage, repo } = await setup(t);
      const before = await repositoryOpen(storage, repo);
      const ran: string[] = [];
      let failing = true;
      register(t, 'contract-first', ran);
      register(t, 'contract-second', ran, { fails: () => failing });

      await assert.rejects(repositoryOpen(storage, repo), /contract-second failed/);
      const recorded = await storage.refs.repositoryRead(repo);
      assert.deepEqual(recorded?.upgrades.slice(before.upgrades.length).map(({ name }) => name), ['contract-first']);

      failing = false;
      await repositoryOpen(storage, repo);
      assert.deepEqual(ran, ['contract-first', 'contract-second']);
    });

    it('is upgraded once by two opens at once', async (t) => {
      const { storage, repo } = await setup(t);
      const ran: string[] = [];
      register(t, 'contract-slow', ran, { takes: 50 });

      const [first, second] = await Promise.all([repositoryOpen(storage, repo), repositoryOpen(storage, repo)]);
      assert.deepEqual(ran, ['contract-slow']);
      assert.deepEqual(first, second);
    });

    it('refuses an open when it names an upgrade this e3 does not know, naming the release that applied it', async (t) => {
      const { storage, repo } = await setup(t);
      const record = await repositoryOpen(storage, repo);
      // A later release wrote it last; an earlier newer one applied the step.
      await storage.refs.repositoryWrite(repo, {
        release: '999.1.0', upgrades: [...record.upgrades, { name: 'from-a-newer-e3', release: '999.0.0' }],
      });

      await assert.rejects(repositoryOpen(storage, repo), (err: unknown) => {
        assert.ok(err instanceof RepoLayoutError);
        assert.deepEqual(err.upgrade, { name: 'from-a-newer-e3', release: '999.0.0' });
        assert.equal(err.message, `the repository at ${repo} has had the upgrade "from-a-newer-e3", which e3 999.0.0 applied and this e3, ` +
          `${E3_RELEASE}, does not know — open it with e3 999.0.0 or a newer one`);
        return true;
      });
    });

    it('is upgraded only once work running in the repository has finished', async (t) => {
      const { storage, repo } = await setup(t);
      const ran: string[] = [];
      register(t, 'contract-waits', ran);

      let holding!: () => void;
      let finish!: () => void;
      const held = new Promise<void>((resolve) => { holding = resolve; });
      const working = withRunningWork(storage, repo, () => new Promise<void>((resolve) => {
        finish = resolve;
        holding();
      }));
      await held;

      const opened = repositoryOpen(storage, repo);
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.deepEqual(ran, [], 'the step waits while the work runs');
      finish();
      await working;
      assert.deepEqual((await opened).upgrades.at(-1), { name: 'contract-waits', release: E3_RELEASE });
      assert.deepEqual(ran, ['contract-waits']);
    });

    it('refuses at once an open that may not wait while a dataflow holds the repository, naming the steps and the run, and applies nothing', async (t) => {
      const { storage, repo } = await setup(t);
      await storage.refs.workspaceWrite(repo, 'main', encodeBeast2For(WorkspaceRecordType)(none));
      const ran: string[] = [];
      register(t, 'contract-owed', ran);
      const run = await storage.locks.acquire(repo, 'main#dataflow', variant('dataflow', null));
      assert.ok(run, 'a dataflow holds its workspace');
      try {
        const started = Date.now();
        await assert.rejects(repositoryOpen(storage, repo, { waitMs: 0 }), (err: unknown) => {
          assert.ok(err instanceof RepositoryUpgradePendingError, `expected a RepositoryUpgradePendingError, got ${err}`);
          assert.deepEqual([err.upgrades, err.workspace], [['contract-owed'], 'main']);
          assert.equal(err.message, `the repository ${repo} owes the upgrade "contract-owed", which applies once nothing runs in it, ` +
            'and a dataflow is running in workspace \'main\' — retry when it finishes, or cancel it');
          return true;
        });
        assert.ok(Date.now() - started < 5_000, 'it did not wait for the run');
        assert.deepEqual(ran, []);
      } finally {
        await run.release();
      }

      await repositoryOpen(storage, repo, { waitMs: 0 });
      assert.deepEqual(ran, ['contract-owed'], 'the step applies once nothing runs');
    });

    it('refuses at once an open that leaves the upgrades to a job, naming them, and the job\'s open applies them', async (t) => {
      const { storage, repo } = await setup(t);
      const ran: string[] = [];
      register(t, 'contract-first', ran);
      register(t, 'contract-second', ran);

      // Nothing runs in the repository, and the open applies nothing all the
      // same.
      await assert.rejects(repositoryOpen(storage, repo, { apply: false }), (err: unknown) => {
        assert.ok(err instanceof RepositoryUpgradePendingError, `expected a RepositoryUpgradePendingError, got ${err}`);
        assert.deepEqual([err.upgrades, err.workspace, err.job], [['contract-first', 'contract-second'], null, true]);
        assert.equal(err.message, `the repository ${repo} owes the upgrades "contract-first", "contract-second", ` +
          'which a job applies before the repository is read — retry once it has');
        return true;
      });
      assert.deepEqual(ran, []);

      // The host's job opens it, applying them, and an open that leaves them to
      // a job finds none owed.
      const record = await repositoryOpen(storage, repo);
      assert.deepEqual(ran, ['contract-first', 'contract-second']);
      assert.deepEqual(await repositoryOpen(storage, repo, { apply: false }), record);
    });

    it('applies the upgrades in the parts a job asks for, each taken up where the last stopped, and records a step once it is done', async (t) => {
      const { storage, repo } = await setup(t);
      const before = await repositoryOpen(storage, repo);
      const ran: string[] = [];
      register(t, 'contract-parts', ran, { units: 3 });
      register(t, 'contract-after', ran);
      const recorded = async () => (await storage.refs.repositoryRead(repo))?.upgrades.slice(before.upgrades.length).map(({ name }) => name);

      // A part with no time to spare does a unit of the step's work, and
      // records where it stopped beside the record, which lists the step only
      // once it is done.
      for (const unit of [0, 1]) {
        assert.deepEqual(await repositoryUpgradeStep(storage, repo, { budgetMs: 0 }), { owed: ['contract-parts', 'contract-after'] });
        await assertProgress(storage, repo, { step: 'contract-parts', release: E3_RELEASE, cursor: `${unit}` }, `after unit ${unit}`);
      }
      assert.deepEqual(ran, ['contract-parts/0', 'contract-parts/1']);
      assert.deepEqual(await recorded(), []);
      await assert.rejects(repositoryOpen(storage, repo, { apply: false }), RepositoryUpgradePendingError,
        'meanwhile an open that leaves the steps to the job refuses');

      assert.deepEqual(await repositoryUpgradeStep(storage, repo, { budgetMs: 0 }), { owed: ['contract-after'] });
      assert.deepEqual(ran, ['contract-parts/0', 'contract-parts/1', 'contract-parts/2']);
      assert.deepEqual(await recorded(), ['contract-parts']);
      await assertProgress(storage, repo, null, 'a step done is under way no more');

      assert.deepEqual(await repositoryUpgradeStep(storage, repo, { budgetMs: 0 }), { owed: [] });
      assert.deepEqual(await repositoryUpgradeStep(storage, repo, { budgetMs: 0 }), { owed: [] });
      assert.deepEqual(ran, ['contract-parts/0', 'contract-parts/1', 'contract-parts/2', 'contract-after'],
        'once nothing is owed, a part applies nothing');
      assert.deepEqual(await recorded(), ['contract-parts', 'contract-after']);
      await repositoryOpen(storage, repo, { apply: false });
    });

    it('goes on, in a part with time to spare, through every step owed', async (t) => {
      const { storage, repo } = await setup(t);
      const ran: string[] = [];
      register(t, 'contract-parts', ran, { units: 3 });
      register(t, 'contract-after', ran);

      assert.deepEqual(await repositoryUpgradeStep(storage, repo, { budgetMs: 60_000 }), { owed: [] });
      assert.deepEqual(ran, ['contract-parts/0', 'contract-parts/1', 'contract-parts/2', 'contract-after']);
      await assertProgress(storage, repo, null, 'no step is under way');
    });

    it('takes up, in an open, the step a job\'s parts left, from the last part that recorded where it stopped', async (t) => {
      const { storage, repo } = await setup(t);
      const ran: string[] = [];
      let failing = false;
      register(t, 'contract-parts', ran, { units: 3, fails: () => failing });

      await repositoryUpgradeStep(storage, repo, { budgetMs: 0 });
      failing = true;
      await assert.rejects(repositoryUpgradeStep(storage, repo, { budgetMs: 0 }), /contract-parts failed/);
      await assertProgress(storage, repo, { step: 'contract-parts', release: E3_RELEASE, cursor: '0' }, 'a part that failed records nothing');

      failing = false;
      const record = await repositoryOpen(storage, repo);
      assert.deepEqual(ran, ['contract-parts/0', 'contract-parts/1', 'contract-parts/2'], 'the open takes the step up where the job left it');
      assert.equal(record.upgrades.at(-1)?.name, 'contract-parts');
      await assertProgress(storage, repo, null, 'the step is done');
    });

    it('gives each part of a step in an open at most 10 s, and records where each stopped, until the step is done', async (t) => {
      const { storage, repo } = await setup(t);
      const ran: string[] = [];
      const allowed: number[] = [];
      register(t, 'contract-parts', ran, { units: 3, part: 1, allowed });

      const written: ValueTypeOf<typeof ProgressWritesType> = [];
      const write = storage.refs.repositoryUpgradeWrite.bind(storage.refs);
      storage.refs.repositoryUpgradeWrite = (r, progress) => {
        written.push(progress === null ? none : some(progress));
        return write(r, progress);
      };
      try {
        const record = await repositoryOpen(storage, repo);
        assert.deepEqual(ran, ['contract-parts/0', 'contract-parts/1', 'contract-parts/2']);
        assert.equal(record.upgrades.at(-1)?.name, 'contract-parts');
        const expected = [
          some({ step: 'contract-parts', release: E3_RELEASE, cursor: '0' }),
          some({ step: 'contract-parts', release: E3_RELEASE, cursor: '1' }),
          none,
        ];
        assert.ok(sameProgressWrites(written, expected), `each part's stop is recorded, and then none: ${printProgressWrites(written)}`);
        assert.ok(allowed.length === 3 && allowed.every((ms) => ms > 0 && ms <= 10_000), `each part is given at most 10 s: ${allowed.join(', ')} ms`);
      } finally {
        storage.refs.repositoryUpgradeWrite = write;
      }
    });

    it('gives each part of a job\'s call the whole of what is left of its budget, where an open\'s are given 10 s', async (t) => {
      const { storage, repo } = await setup(t);
      const ran: string[] = [];
      const allowed: number[] = [];
      register(t, 'contract-parts', ran, { units: 3, part: 2, allowed });

      assert.deepEqual(await repositoryUpgradeStep(storage, repo, { budgetMs: 60_000 }), { owed: [] });
      assert.deepEqual(ran, ['contract-parts/0', 'contract-parts/1', 'contract-parts/2']);
      assert.ok(allowed.length === 2 && allowed.every((ms) => ms > 50_000 && ms <= 60_000),
        `each part is given what is left of the call's budget: ${allowed.join(', ')} ms`);
    });

    it('keeps where a step stopped until the record lists it done, so a failed write of the record loses none of the step\'s work', async (t) => {
      const { storage, repo } = await setup(t);
      const ran: string[] = [];
      register(t, 'contract-parts', ran, { units: 2, part: 1 });

      const write = storage.refs.repositoryWrite.bind(storage.refs);
      storage.refs.repositoryWrite = () => Promise.reject(new Error('the store failed the write'));
      try {
        await assert.rejects(repositoryOpen(storage, repo), /the store failed the write/);
      } finally {
        storage.refs.repositoryWrite = write;
      }
      assert.deepEqual(ran, ['contract-parts/0', 'contract-parts/1']);
      await assertProgress(storage, repo, { step: 'contract-parts', release: E3_RELEASE, cursor: '0' }, 'the last part recorded is kept');

      // The next open takes the step up from there.
      const record = await repositoryOpen(storage, repo);
      assert.deepEqual(ran, ['contract-parts/0', 'contract-parts/1', 'contract-parts/1']);
      assert.equal(record.upgrades.at(-1)?.name, 'contract-parts');
      await assertProgress(storage, repo, null, 'the step is done');
    });

    it('passes over the record of a step under way that the repository has had, which a crash between the two writes left', async (t) => {
      const { storage, repo } = await setup(t);
      const record = await repositoryOpen(storage, repo);
      // The record lists the step done, and a crash before its progress was
      // cleared left the progress.
      await storage.refs.repositoryUpgradeWrite(repo, { step: record.upgrades.at(-1)!.name, release: E3_RELEASE, cursor: '0' });
      const ran: string[] = [];
      register(t, 'contract-next', ran, { units: 2 });

      await repositoryOpen(storage, repo);
      assert.deepEqual(ran, ['contract-next/0', 'contract-next/1'], 'the next step starts at its start');
      await assertProgress(storage, repo, null, 'the next step done, no step is under way');
    });

    it('refuses a part whose budget is no whole number of milliseconds, before it applies anything', async (t) => {
      const { storage, repo } = await setup(t);
      const ran: string[] = [];
      register(t, 'contract-owed', ran);

      for (const budgetMs of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        await assert.rejects(repositoryUpgradeStep(storage, repo, { budgetMs }), (err: unknown) =>
          err instanceof RangeError && err.message === `a part's budgetMs is a whole number of zero or more, not ${budgetMs}`);
      }
      assert.deepEqual(ran, []);
    });

    it('refuses at once a part that may not wait while a dataflow holds the repository, naming the steps and the run, and applies nothing', async (t) => {
      const { storage, repo } = await setup(t);
      await storage.refs.workspaceWrite(repo, 'main', encodeBeast2For(WorkspaceRecordType)(none));
      const ran: string[] = [];
      register(t, 'contract-owed', ran);
      const run = await storage.locks.acquire(repo, 'main#dataflow', variant('dataflow', null));
      assert.ok(run, 'a dataflow holds its workspace');
      try {
        const started = Date.now();
        await assert.rejects(repositoryUpgradeStep(storage, repo, { budgetMs: 0, waitMs: 0 }), (err: unknown) => {
          assert.ok(err instanceof RepositoryUpgradePendingError, `expected a RepositoryUpgradePendingError, got ${err}`);
          assert.deepEqual([err.upgrades, err.workspace, err.job], [['contract-owed'], 'main', false]);
          return true;
        });
        assert.ok(Date.now() - started < 5_000, 'it did not wait for the run');
        assert.deepEqual(ran, []);
      } finally {
        await run.release();
      }

      assert.deepEqual(await repositoryUpgradeStep(storage, repo, { budgetMs: 0, waitMs: 0 }), { owed: [] });
      assert.deepEqual(ran, ['contract-owed'], 'the step applies once nothing runs');
    });

    it('leaves a workspace\'s records their states and histories across an upgrade, and they take commits after it', async (t) => {
      const { storage, repo } = await setup(t);
      const dir = mkdtempSync(join(tmpdir(), 'e3-contract-'));
      t.after(() => rmSync(dir, { recursive: true, force: true }));
      const zip = join(dir, 'records.zip');
      await e3.export(e3.package('records', '1.0.0', e3.record('counter', IntegerType, 0n)), zip);
      await packageImport(storage, repo, zip);
      await workspaceCreate(storage, repo, 'main');
      await workspaceDeploy(storage, repo, 'main', 'records', '1.0.0');

      // A commit beside the deploy's: a restore of the record's own state,
      // which runs nothing.
      const runner = new MockTaskRunner();
      const [init] = await recordHistory(storage, repo, 'main', 'counter');
      assert.ok(init !== undefined, 'the deploy minted the record');
      const restore = () => recordSystemCommit(storage, runner, repo, 'main', 'counter', {
        name: '$restore', target: { state: init.commit.state, applied: [] }, actor: 'contract',
      });
      assert.equal((await restore()).kind, 'committed');
      const history = await recordHistory(storage, repo, 'main', 'counter');
      const ref = await storage.datasets.read(repo, 'main', 'records/counter');

      const ran: string[] = [];
      register(t, 'contract-records', ran);
      await repositoryOpen(storage, repo);
      assert.deepEqual(ran, ['contract-records']);

      assert.deepEqual(await recordHistory(storage, repo, 'main', 'counter'), history);
      assert.deepEqual(await storage.datasets.read(repo, 'main', 'records/counter'), ref);
      assert.equal((await restore()).kind, 'committed');
      assert.equal((await recordHistory(storage, repo, 'main', 'counter')).length, history.length + 1);
    });

    it('carries every execution record an earlier release wrote into the form that says why a stopped one stopped, of every case, and leaves the rest as they are', async (t) => {
      const { storage, repo, damage } = await setup(t);
      if (damage === undefined) return t.skip('the setup cannot leave a record in the form an earlier release wrote');
      const record = await repositoryOpen(storage, repo);
      // A repository an earlier release wrote, which has not had the upgrade.
      const before = { release: '1.0.84', upgrades: record.upgrades.filter(({ name }) => name !== EXECUTION_STOP_REASONS) };
      await storage.refs.repositoryWrite(repo, before);

      const task = 'a'.repeat(64);
      const inputs = '1'.repeat(64);
      const at = new Date(1_000);
      const own = { inputHashes: ['b'.repeat(64)], startedAt: at, unit: false };
      const running = variant('running', { ...own, executionId: uuidv7(), pid: 41n, pidStartTime: 7n, bootId: 'boot' });
      const success = variant('success', { ...own, executionId: uuidv7(), outputHash: 'c'.repeat(64), completedAt: at, peakBytes: some(1024n), plan: none });
      const failed = variant('failed', { ...own, executionId: uuidv7(), completedAt: at, exitCode: 2n, peakBytes: none });
      const error = variant('error', { ...own, executionId: uuidv7(), completedAt: at, message: 'Failed to read output' });
      const cancelled = variant('cancelled', { ...own, executionId: uuidv7(), completedAt: at });
      const interrupted = variant('interrupted', { ...own, executionId: uuidv7(), completedAt: at, pid: 41n, unit: true });
      const encodeEarlier = encodeBeast2For(ExecutionStatusBeforeReasonsType);
      for (const status of [running, success, failed, error, cancelled, interrupted]) {
        await damage.execution(task, inputs, status.value.executionId, encodeEarlier(status));
      }
      // One in the current form, and one in neither, which a crash left.
      const host: StopReason = { kind: variant('host', 'OutOfMemoryError'), message: 'its container ran out of memory' };
      const current = variant('interrupted', { ...own, executionId: uuidv7(), completedAt: at, pid: 0n, reason: host });
      await storage.refs.executionWrite(repo, task, inputs, current.value.executionId, current);
      const currentBytes = await storage.refs.executionReadBytes(repo, task, inputs, current.value.executionId);
      const corrupt = uuidv7();
      await damage.execution(task, inputs, corrupt);
      await assert.rejects(storage.refs.executionGet(repo, task, inputs, cancelled.value.executionId), ExecutionCorruptError,
        'before the upgrade, a record in the earlier form does not read');

      // What the opens write, by execution.
      const writes: string[] = [];
      const write = storage.refs.executionWrite.bind(storage.refs);
      storage.refs.executionWrite = (r, tk, i, id, status) => {
        writes.push(id);
        return write(r, tk, i, id, status);
      };
      try {
        const opened = await repositoryOpen(storage, repo);
        assert.deepEqual(opened.upgrades, [...before.upgrades, { name: EXECUTION_STOP_REASONS, release: E3_RELEASE }]);
        assert.deepEqual([...writes].sort(), [running, success, failed, error, cancelled, interrupted].map((status) => status.value.executionId).sort(),
          'every record in the earlier form is rewritten, of every case, and no other');

        const equal = equalFor(ExecutionStatusType);
        const unrecorded: StopReason = { kind: variant('unrecorded', null), message: '' };
        const carried = [
          running, success, failed, error,
          variant('cancelled', { ...cancelled.value, reason: unrecorded }),
          variant('interrupted', { ...interrupted.value, reason: unrecorded }),
        ];
        for (const status of carried) {
          const read = await storage.refs.executionGet(repo, task, inputs, status.value.executionId);
          assert.ok(read !== null && equal(read, status), `a ${status.type} record reads as it was, in the current form`);
          const bytes = await storage.refs.executionReadBytes(repo, task, inputs, status.value.executionId);
          assert.ok(bytes !== null && equal(decodeExecutionStatus(bytes), status), `a ${status.type} record is stored in the current form`);
        }
        assert.deepEqual(await storage.refs.executionReadBytes(repo, task, inputs, current.value.executionId), currentBytes,
          'a record in the current form is left as it is');
        await assert.rejects(storage.refs.executionGet(repo, task, inputs, corrupt), ExecutionCorruptError,
          'a record in neither form is left as it is');

        // Cut short by a crash, the upgrade runs again whole, and rewrites
        // nothing it carried.
        writes.length = 0;
        await storage.refs.repositoryWrite(repo, before);
        await repositoryOpen(storage, repo);
        assert.deepEqual(writes, []);
      } finally {
        storage.refs.executionWrite = write;
      }
    });

    it('carries the execution records in parts, a task\'s inputs at a time and sixteen at once, each part taking up where the last stopped', async (t) => {
      const { storage, repo, damage } = await setup(t);
      if (damage === undefined) return t.skip('the setup cannot leave a record in the form an earlier release wrote');
      // Seventeen of a task's inputs, each with an attempt an earlier release
      // recorded: a batch of sixteen, and one more.
      const task = 'a'.repeat(64);
      const inputs = Array.from({ length: 17 }, (_, i) => i.toString(16).padStart(64, '0'));
      const ids = inputs.map(() => uuidv7());
      const at = new Date(1_000);
      const encodeEarlier = encodeBeast2For(ExecutionStatusBeforeReasonsType);
      for (const [i, each] of inputs.entries()) {
        const executionId = ids[i]!;
        await damage.execution(task, each, executionId, encodeEarlier(variant('cancelled', {
          executionId, inputHashes: [], startedAt: at, completedAt: at, unit: false,
        })));
      }

      // What the parts write, by inputs.
      const written: string[] = [];
      const write = storage.refs.executionWrite.bind(storage.refs);
      storage.refs.executionWrite = (r, tk, i, id, status) => {
        written.push(i);
        return write(r, tk, i, id, status);
      };
      try {
        // A part with no time to spare carries a batch, the first sixteen by
        // their keys, and stops at the last of them.
        const stopped = await executionStopReasons.apply(storage, repo, null, 0);
        assert.equal(stopped, `${task}/${inputs[15]}`);
        assert.deepEqual([...written].sort(), inputs.slice(0, 16));

        written.length = 0;
        assert.equal(await executionStopReasons.apply(storage, repo, stopped, 0), null, 'the part that carries the last unit is the step\'s last');
        assert.deepEqual(written, [inputs[16]]);
        for (const [i, each] of inputs.entries()) {
          assert.notEqual(await storage.refs.executionGet(repo, task, each, ids[i]!), null, 'every record reads, in the current form');
        }

        // From the start, with time to spare, a part goes through every unit,
        // and rewrites none it carried.
        written.length = 0;
        assert.equal(await executionStopReasons.apply(storage, repo, null, Date.now() + 60_000), null);
        assert.deepEqual(written, []);
      } finally {
        storage.refs.executionWrite = write;
      }
    });

    it('carries every dataflow run an earlier release stored into the form that names the tasks a run forces, and leaves the rest as they are', async (t) => {
      const { storage, repo } = await setup(t);
      const record = await repositoryOpen(storage, repo);
      // A repository an earlier release wrote, which has not had the upgrade.
      const before = { release: '1.0.84', upgrades: record.upgrades.filter(({ name }) => name !== DATAFLOW_FORCE_TASKS) };
      await storage.refs.repositoryWrite(repo, before);

      // A run in each of four workspaces, each the workspace's latest, as
      // every store keeps one: two an earlier release stored, one that forced
      // its tasks and ended and one that forced none and is left running; one
      // in the current form; and one in neither, which a crash left.
      const run = (workspace: string, force: DataflowForce, status: string): DataflowExecutionState => ({
        release: '1.0.84', id: uuidv7(), repo, workspace, startedAt: new Date(1_000), force, filter: none,
        graph: some({ tasks: [{ name: 'etl', hash: 'a'.repeat(64), inputs: ['.inputs.sales'], output: '.tasks.etl.output', dependsOn: [] }] }),
        graphHash: none, tasks: new Map(), executed: 1n, cached: 0n, failed: 0n, skipped: 0n, status,
        completedAt: status === 'running' ? none : some(new Date(2_000)), error: none, versionVectors: new Map(),
        inputSnapshot: new Map([['.inputs.sales', 'b'.repeat(64)]]), taskOutputPaths: ['.tasks.etl.output'], reexecuted: 0n,
        events: [variant('task_started', { seq: 1n, timestamp: new Date(1_500), task: 'etl' })], eventSeq: 1n,
      });
      const forced = run('forced', dataflowForce(true), 'completed');
      const unforced = run('unforced', dataflowForce(false), 'running');
      const current = run('current', dataflowForce(['etl']), 'completed');
      const crashed = run('crashed', dataflowForce(false), 'failed');
      for (const state of [forced, unforced, current, crashed]) await storage.runStates(repo).create(state);
      const stored = async (workspace: string) => (await storage.runStates(repo).readStored(repo)).find((each) => each.workspace === workspace)!;
      const encodeEarlier = encodeBeast2For(DataflowStateBeforeForceTasksType);
      await (await stored('forced')).replace(encodeEarlier({ ...forced, force: true }));
      await (await stored('unforced')).replace(encodeEarlier({ ...unforced, force: false }));
      await (await stored('crashed')).replace(new TextEncoder().encode('not a run'));
      const currentBytes = new Uint8Array((await stored('current')).bytes);
      await assert.rejects(storage.runStates(repo).read(repo, 'forced', forced.id), /written by e3 1\.0\.84/,
        'before the upgrade, a run in the earlier form does not read');

      // What the opens write, by workspace: each stored run's replace, through
      // every store the backend gives the upgrade.
      const replaced: string[] = [];
      const watched = new WeakSet<object>();
      const runStates = storage.runStates.bind(storage);
      storage.runStates = (of) => {
        const store = runStates(of);
        if (!watched.has(store)) {
          watched.add(store);
          const readStored = store.readStored.bind(store);
          store.readStored = async (r) => (await readStored(r)).map((each) => ({
            ...each,
            replace: (bytes: Uint8Array) => {
              replaced.push(each.workspace);
              return each.replace(bytes);
            },
          }));
        }
        return store;
      };
      try {
        const opened = await repositoryOpen(storage, repo);
        assert.deepEqual(opened.upgrades, [...before.upgrades, { name: DATAFLOW_FORCE_TASKS, release: E3_RELEASE }]);
        assert.deepEqual([...replaced].sort(), ['forced', 'unforced'], 'every run in the earlier form is rewritten, and no other');

        const equal = equalFor(DataflowExecutionStateType);
        const print = printFor(DataflowExecutionStateType);
        for (const [state, force] of [[forced, dataflowForce(true)], [unforced, dataflowForce(false)]] as const) {
          const read = await runStates(repo).read(repo, state.workspace, state.id);
          const carried = { ...state, force };
          assert.ok(read !== null && equal(read, carried), `the ${state.workspace} run reads as it was, forcing ${force.type}: ${read === null ? 'none' : print(read)}`);
        }
        assert.deepEqual(new Uint8Array((await stored('current')).bytes), currentBytes, 'a run in the current form is left as it is');
        assert.deepEqual(new Uint8Array((await stored('crashed')).bytes), new TextEncoder().encode('not a run'), 'a run in neither form is left as it is');

        // Cut short by a crash, the upgrade runs again whole, and rewrites
        // nothing it carried.
        replaced.length = 0;
        await storage.refs.repositoryWrite(repo, before);
        await repositoryOpen(storage, repo);
        assert.deepEqual(replaced, []);

        // In parts, a workspace at a time in the order of their names, each
        // part taking up where the last stopped: at most a part a workspace.
        await (await stored('forced')).replace(encodeEarlier({ ...forced, force: true }));
        await (await stored('unforced')).replace(encodeEarlier({ ...unforced, force: false }));
        replaced.length = 0;
        const stops: (string | null)[] = [];
        let stopped: string | null = null;
        do {
          stopped = await dataflowForceTasks.apply(storage, repo, stopped, 0);
          stops.push(stopped);
        } while (stopped !== null && stops.length < 4);
        assert.deepEqual(stops, ['crashed', 'current', 'forced', null]);
        assert.deepEqual(replaced, ['forced', 'unforced']);
      } finally {
        storage.runStates = runStates;
      }
    });

    it('moves every dataflow run\'s events out of its state, as its store keeps them apart, and leaves the rest as they are', async (t) => {
      const { storage, repo } = await setup(t);
      const record = await repositoryOpen(storage, repo);
      // A repository an earlier release wrote, which has not had the upgrade.
      const before = { release: '1.0.85', upgrades: record.upgrades.filter(({ name }) => name !== DATAFLOW_EVENTS_APART) };
      await storage.refs.repositoryWrite(repo, before);

      // A run in each of four workspaces, each the workspace's latest, as an
      // earlier release stored them: two whose states hold their events, one
      // of them 2,500 of them and one that never counted its own, as one of
      // events recorded on their own; one with none; and one in no form, which
      // a crash left.
      const event = (seq: bigint): ExecutionEvent => variant('task_started', { seq, timestamp: new Date(1_500), task: 'etl' });
      const run = (workspace: string, events: ExecutionEvent[]): DataflowExecutionState => ({
        release: '1.0.85', id: uuidv7(), repo, workspace, startedAt: new Date(1_000), force: dataflowForce(false), filter: none,
        graph: none, graphHash: none, tasks: new Map(), executed: 1n, cached: 0n, failed: 0n, skipped: 0n, status: 'completed',
        completedAt: some(new Date(2_000)), error: none, versionVectors: new Map(), inputSnapshot: new Map(), taskOutputPaths: [],
        reexecuted: 0n, events, eventSeq: events.at(-1)?.value.seq ?? 0n,
      });
      const few = { ...run('few', [event(1n), event(2n)]), eventSeq: 0n };
      const many = run('many', Array.from({ length: 2_500 }, (_, i) => event(BigInt(i + 1))));
      const idle = run('idle', []);
      const crashed = run('crashed', [event(1n)]);
      for (const each of [few, many, idle, crashed]) await storage.runStates(repo).create({ ...each, events: [] });
      const stored = async (workspace: string) => (await storage.runStates(repo).readStored(repo)).find((each) => each.workspace === workspace)!;
      const encodeState = encodeBeast2For(DataflowExecutionStateType);
      const storedInline = async () => {
        for (const each of [few, many]) await (await stored(each.workspace)).replace(encodeState(each));
      };
      await storedInline();
      await (await stored('crashed')).replace(new TextEncoder().encode('not a run'));
      const idleBytes = new Uint8Array((await stored('idle')).bytes);

      // What the opens write, by workspace: each stored run's replace, and
      // each segment of events it writes apart.
      const replaced: string[] = [];
      const segments: string[] = [];
      const watched = new WeakSet<object>();
      const runStates = storage.runStates.bind(storage);
      storage.runStates = (of) => {
        const store = runStates(of);
        if (!watched.has(store)) {
          watched.add(store);
          const readStored = store.readStored.bind(store);
          store.readStored = async (r) => (await readStored(r)).map((each) => ({
            ...each,
            replace: (bytes: Uint8Array) => {
              replaced.push(each.workspace);
              return each.replace(bytes);
            },
            writeEvents: (runId: string, segment: EventSegment) => {
              segments.push(each.workspace);
              return each.writeEvents(runId, segment);
            },
          }));
        }
        return store;
      };
      try {
        const opened = await repositoryOpen(storage, repo);
        assert.deepEqual(opened.upgrades, [...before.upgrades, { name: DATAFLOW_EVENTS_APART, release: E3_RELEASE }]);
        assert.deepEqual([...replaced].sort(), ['few', 'many'], 'every run whose state holds events is rewritten, and no other');
        assert.deepEqual(segments.filter((workspace) => workspace === 'many').length, 3, 'its events in segments of a thousand');

        const equal = equalFor(DataflowExecutionStateType);
        const print = printFor(DataflowExecutionStateType);
        const sameEvents = equalFor(ArrayType(ExecutionEventType));
        for (const each of [few, many]) {
          const read = await runStates(repo).read(repo, each.workspace, each.id);
          // Numbering its last event, however its state counted them
          const apart = { ...each, events: [], eventSeq: each.events.at(-1)!.value.seq };
          assert.ok(read !== null && equal(read, apart), `the ${each.workspace} run holds its events no more: ${read === null ? 'none' : print(read)}`);
          assert.ok(sameEvents(await runStates(repo).getEventsSince(repo, each.workspace, each.id, 0), each.events), `the ${each.workspace} run's events, apart`);
          assert.equal((await runStates(repo).readLatestSummary(repo, each.workspace))?.lastSeq, apart.eventSeq);
        }
        assert.deepEqual(new Uint8Array((await stored('idle')).bytes), idleBytes, 'a run whose state holds none is left as it is');
        assert.deepEqual(new Uint8Array((await stored('crashed')).bytes), new TextEncoder().encode('not a run'), 'a run in no form is left as it is');

        // Cut short by a crash between a run's events and its state, the step
        // runs again, writing the events over themselves.
        await (await stored('few')).replace(encodeState(few));
        await storage.refs.repositoryWrite(repo, before);
        replaced.length = 0;
        await repositoryOpen(storage, repo);
        assert.deepEqual(replaced, ['few']);
        assert.ok(sameEvents(await runStates(repo).getEventsSince(repo, 'few', few.id, 0), few.events), 'the events, once');

        // In parts, a workspace at a time in the order of their names, each
        // part taking up where the last stopped: at most a part a workspace.
        await storedInline();
        replaced.length = 0;
        const stops: (string | null)[] = [];
        let stopped: string | null = null;
        do {
          stopped = await dataflowEventsApart.apply(storage, repo, stopped, 0);
          stops.push(stopped);
        } while (stopped !== null && stops.length < 4);
        assert.deepEqual(stops, ['crashed', 'few', 'idle', null]);
        assert.deepEqual(replaced, ['few', 'many']);
      } finally {
        storage.runStates = runStates;
      }
    });

    it('indexes every execution an earlier release recorded running, so its task\'s running attempts are answered, and writes no other', async (t) => {
      const { storage, repo, damage } = await setup(t);
      if (damage === undefined) return t.skip('the setup cannot leave a record as an earlier release wrote it');
      const record = await repositoryOpen(storage, repo);
      // A repository an earlier release wrote, which has not had the upgrade.
      const before = { release: '1.0.85', upgrades: record.upgrades.filter(({ name }) => name !== RUNNING_EXECUTIONS_INDEXED) };
      await storage.refs.repositoryWrite(repo, before);

      // Records as a release from before the index wrote them, which no index
      // holds: an attempt running and a split task's unit running, each over
      // inputs of its own; an attempt that ended; and one in no form, which a
      // crash left.
      const task = 'a'.repeat(64);
      const [inputs, unitInputs, endedInputs, corruptInputs] = ['1', '2', '3', '4'].map((digit) => digit.repeat(64)) as [string, string, string, string];
      const at = new Date(1_000);
      const own = { inputHashes: ['b'.repeat(64)], startedAt: at };
      const running: ExecutionStatus = variant('running', { ...own, executionId: uuidv7(), pid: 41n, pidStartTime: 7n, bootId: 'boot', unit: false });
      const unit: ExecutionStatus = variant('running', { ...own, executionId: uuidv7(), pid: 42n, pidStartTime: 7n, bootId: 'boot', unit: true });
      const ended: ExecutionStatus = variant('failed', { ...own, executionId: uuidv7(), completedAt: at, exitCode: 2n, peakBytes: none, unit: false });
      const encode = encodeBeast2For(ExecutionStatusType);
      for (const [under, status] of [[inputs, running], [unitInputs, unit], [endedInputs, ended]] as const) {
        await damage.execution(task, under, status.value.executionId, encode(status));
      }
      const corrupt = uuidv7();
      await damage.execution(task, corruptInputs, corrupt);
      const endedBytes = await storage.refs.executionReadBytes(repo, task, endedInputs, ended.value.executionId);
      assert.deepEqual(await storage.refs.executionListRunning(repo, task), [], 'before the upgrade, no index holds them');

      // What the opens write, by execution.
      const writes: string[] = [];
      const write = storage.refs.executionWrite.bind(storage.refs);
      storage.refs.executionWrite = (r, tk, i, id, status) => {
        writes.push(id);
        return write(r, tk, i, id, status);
      };
      try {
        const opened = await repositoryOpen(storage, repo);
        assert.deepEqual(opened.upgrades, [...before.upgrades, { name: RUNNING_EXECUTIONS_INDEXED, release: E3_RELEASE }]);
        assert.deepEqual([...writes].sort(), [running.value.executionId, unit.value.executionId].sort(),
          'every record running is written again, and no other');

        const equal = equalFor(ExecutionStatusType);
        const listed = new Map((await storage.refs.executionListRunning(repo, task)).map(({ inputsHash: under, status }) => [under, status]));
        assert.deepEqual([...listed.keys()].sort(), [inputs, unitInputs], 'the attempt and the unit are indexed');
        assert.ok(equal(listed.get(inputs)!, running) && equal(listed.get(unitInputs)!, unit), 'each as it was recorded');
        assert.deepEqual(await storage.refs.executionReadBytes(repo, task, endedInputs, ended.value.executionId), endedBytes,
          'a record of an attempt that ended is left as it is');
        await assert.rejects(storage.refs.executionGet(repo, task, corruptInputs, corrupt), ExecutionCorruptError,
          'a record in no form is left as it is');

        // Cut short by a crash, the upgrade runs again whole, and writes the
        // records running again as they are, and no other.
        writes.length = 0;
        await storage.refs.repositoryWrite(repo, before);
        await repositoryOpen(storage, repo);
        assert.deepEqual([...writes].sort(), [running.value.executionId, unit.value.executionId].sort());
        assert.equal((await storage.refs.executionListRunning(repo, task)).length, 2);
      } finally {
        storage.refs.executionWrite = write;
      }
    });

    it('indexes every run an earlier release recorded, so a task\'s runs are listed, and writes no unit\'s', async (t) => {
      const { storage, repo, damage } = await setup(t);
      if (damage === undefined) return t.skip('the setup cannot leave a record as an earlier release wrote it');
      const record = await repositoryOpen(storage, repo);
      // A repository an earlier release wrote, which has not had the upgrade.
      const before = { release: '1.0.85', upgrades: record.upgrades.filter(({ name }) => name !== TASK_RUNS_INDEXED) };
      await storage.refs.repositoryWrite(repo, before);

      // Records as a release from before the index wrote them, which no index
      // holds: two runs of a task, each over inputs of its own; a split task's
      // unit; and one in no form, which a crash left.
      const task = 'a'.repeat(64);
      const [inputs, otherInputs, unitInputs, corruptInputs] = ['1', '2', '3', '4'].map((digit) => digit.repeat(64)) as [string, string, string, string];
      const at = new Date(1_000);
      const own = { inputHashes: ['b'.repeat(64)], startedAt: at };
      const first: ExecutionStatus = variant('failed', { ...own, executionId: uuidv7(), completedAt: at, exitCode: 2n, peakBytes: none, unit: false });
      const second: ExecutionStatus = variant('running', { ...own, executionId: uuidv7(), pid: 41n, pidStartTime: 7n, bootId: 'boot', unit: false });
      const unit: ExecutionStatus = variant('running', { ...own, executionId: uuidv7(), pid: 42n, pidStartTime: 7n, bootId: 'boot', unit: true });
      const encode = encodeBeast2For(ExecutionStatusType);
      for (const [under, status] of [[inputs, first], [otherInputs, second], [unitInputs, unit]] as const) {
        await damage.execution(task, under, status.value.executionId, encode(status));
      }
      const corrupt = uuidv7();
      await damage.execution(task, corruptInputs, corrupt);
      assert.deepEqual(await storage.refs.executionListRuns(repo, task, { limit: 10 }), [], 'before the upgrade, no index holds them');

      // What the opens write, by execution.
      const writes: string[] = [];
      const write = storage.refs.executionWrite.bind(storage.refs);
      storage.refs.executionWrite = (r, tk, i, id, status) => {
        writes.push(id);
        return write(r, tk, i, id, status);
      };
      try {
        const opened = await repositoryOpen(storage, repo);
        assert.deepEqual(opened.upgrades, [...before.upgrades, { name: TASK_RUNS_INDEXED, release: E3_RELEASE }]);
        const runIds = [first.value.executionId, second.value.executionId];
        assert.deepEqual([...writes].sort(), [...runIds].sort(), 'every run is written again, and no unit');

        const listed = await storage.refs.executionListRuns(repo, task, { limit: 10 });
        assert.deepEqual(listed.map(({ inputsHash: under, executionId }) => `${under}/${executionId}`),
          [`${otherInputs}/${second.value.executionId}`, `${inputs}/${first.value.executionId}`], 'the runs are indexed, the latest first');
        const equal = equalFor(ExecutionStatusType);
        assert.ok(equal(listed[0]!.status, second) && equal(listed[1]!.status, first), 'each as it was recorded');
        await assert.rejects(storage.refs.executionGet(repo, task, corruptInputs, corrupt), ExecutionCorruptError,
          'a record in no form is left as it is');

        // Cut short by a crash, the upgrade runs again whole, and writes the
        // runs again as they are, and no other.
        writes.length = 0;
        await storage.refs.repositoryWrite(repo, before);
        await repositoryOpen(storage, repo);
        assert.deepEqual([...writes].sort(), [...runIds].sort());
        assert.equal((await storage.refs.executionListRuns(repo, task, { limit: 10 })).length, 2);
      } finally {
        storage.refs.executionWrite = write;
      }
    });
  });
}
