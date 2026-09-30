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
import { IntegerType, encodeBeast2For, none, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { E3_RELEASE, WorkspaceRecordType } from '@elaraai/e3-types';
import { RepoLayoutError, RepositoryUpgradePendingError } from '../errors.js';
import { MockTaskRunner } from '../execution/MockTaskRunner.js';
import { packageImport } from '../packages.js';
import { recordHistory, recordSystemCommit } from '../records.js';
import { REPOSITORY_UPGRADES, repositoryOpen } from '../repository-record.js';
import { withRunningWork } from '../running-work.js';
import { workspaceCreate, workspaceDeploy } from '../workspaces.js';
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
  });
}
