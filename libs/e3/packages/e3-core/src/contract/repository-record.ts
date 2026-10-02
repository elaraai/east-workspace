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
import { IntegerType, encodeBeast2For, equalFor, none, some, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { E3_RELEASE, ExecutionStatusType, WorkspaceRecordType, decodeExecutionStatus, type StopReason } from '@elaraai/e3-types';
import { ExecutionCorruptError, RepoLayoutError, RepositoryUpgradePendingError } from '../errors.js';
import { MockTaskRunner } from '../execution/MockTaskRunner.js';
import { packageImport } from '../package-files.js';
import { recordHistory, recordSystemCommit } from '../records.js';
import { REPOSITORY_UPGRADES, repositoryOpen } from '../repository-record.js';
import { withRunningWork } from '../running-work.js';
import { EXECUTION_STOP_REASONS, ExecutionStatusBeforeReasonsType } from '../upgrades/execution-stop-reasons.js';
import { uuidv7 } from '../uuid.js';
import { workspaceCreate } from '../workspaces.js';
import { workspaceDeploy } from '../workspace-files.js';
import type { RepositoryUpgrade } from '../storage/interfaces.js';
import type { BackendSetup } from './setup.js';

/** How a step {@link register} adds behaves. */
interface StepOptions {
  /** Fails while this says so. */
  fails?: () => boolean;
  /** Takes this long, in milliseconds. */
  takes?: number;
}

/**
 * Registers a step every backend applies, for one test: it records each run in
 * `ran`, and is removed when the test ends.
 */
function register(t: TestContext, name: string, ran: string[], options: StepOptions = {}): void {
  const upgrade: RepositoryUpgrade = {
    name,
    async apply(storage, repo) {
      assert.notEqual(await storage.refs.repositoryRead(repo), null, 'a step runs over a repository with its record');
      if (options.takes !== undefined) await new Promise((resolve) => setTimeout(resolve, options.takes));
      if (options.fails?.() === true) throw new Error(`${name} failed`);
      ran.push(name);
    },
  };
  REPOSITORY_UPGRADES.push(upgrade);
  t.after(() => {
    REPOSITORY_UPGRADES.splice(REPOSITORY_UPGRADES.indexOf(upgrade), 1);
  });
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
  });
}
