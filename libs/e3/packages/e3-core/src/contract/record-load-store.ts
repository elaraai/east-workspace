/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The record load store's contract: what any backend's load jobs do. A job is
 * filed and read back, moved on while it runs, and ended once: an ended job
 * takes no other status. A cancel records a request on a running job, once,
 * and leaves the job running, for the job to act on and end itself (ruling
 * 28); a job that has ended is left as it is.
 *
 * And what its jobs do once dispatched, run over the backend's own storage and
 * runner: one source's jobs apply in the order filed, among themselves and
 * with a load another process asks (ruling 37); a job that waits its turn
 * says so, and a request to cancel it reaches it there; and a job holds the
 * repository's running work from its dispatch, while it waits too.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { StringType, equalFor, none, printFor, some, variant } from '@elaraai/east';
import { loadCommitName, type FunctionCallCancel } from '@elaraai/e3-types';
import type { GatedTaskRunner } from '../execution/GatedTaskRunner.js';
import { recordLoad } from '../record-load.js';
import { recordHistory } from '../records.js';
import { TASKS_LOCK } from '../running-work.js';
import type { StorageBackend } from '../storage/interfaces.js';
import { RecordLoadJobType, type RecordLoadJob } from '../transfer/types.js';
import type { RecordLoadStore } from '../transfer/interfaces.js';
import { uuidv7 } from '../uuid.js';

const sameJob = equalFor(RecordLoadJobType);
const printJob = printFor(RecordLoadJobType);
const sameName = equalFor(StringType);

/** A backend's record load store, and what lets it go once a case is done. */
export interface RecordLoadStoreContext {
  readonly store: RecordLoadStore;
  readonly teardown?: () => Promise<void>;
  /** What the store's jobs load into, and run on. */
  readonly loads: {
    /** The storage the store's jobs run over */
    readonly storage: StorageBackend;
    /** A repository of the storage's, as the store's `execute` names it */
    readonly repo: string;
    /** A workspace of the repository, a case's own, with a package deployed
     *  that declares the record */
    readonly workspace: string;
    /** A composite record of the workspace */
    readonly record: string;
    /** An external source of the record, which no feed loads */
    readonly source: string;
    /** The runner the store's jobs run on, which holds a load's pieces when a
     *  case asks it to: their task is named `<record>.<source>` */
    readonly runner: GatedTaskRunner;
    /** Stores a delivery of the source's that no call before it stored, and
     *  answers its hash */
    deliver(): Promise<string>;
    /** How many holds of the repository's running work (`TASKS_LOCK`, shared)
     *  the backend's locks have now */
    working(): Promise<number>;
  };
}

/** Makes a fresh record load store for each case. */
export type RecordLoadStoreSetup = () => Promise<RecordLoadStoreContext>;

/** A load job as it is filed: running, nothing said yet. */
function filed(): RecordLoadJob {
  return {
    repo: 'r',
    workspace: 'main',
    record: 'orders',
    source: 'erp',
    delivery: 'd'.repeat(64),
    actor: 'ada@example.com',
    asOf: some(new Date('2026-11-02T03:00:00Z')),
    cancel: none,
    status: variant('processing', none),
    createdAt: new Date('2026-11-17T10:00:00Z'),
  };
}

/** The ends a job can come to. */
const ENDS: ReadonlyArray<RecordLoadJob['status']> = [
  variant('completed', {
    commit: some('c'.repeat(64)), state: some('s'.repeat(64)), delivery: 'd'.repeat(64), set: 2n, deleted: 0n, unchanged: 5n,
    outcome: variant('loaded', null),
  }),
  variant('failed', { message: 'the load of orders.erp failed: exit code 1' }),
  variant('cancelled', null),
];

/**
 * Registers the record load store's contract over the stores `setup` makes.
 *
 * @param name - What the suite is called: the backend's name
 * @param setup - Makes a fresh store for each case
 */
export function recordLoadStoreTests(name: string, setup: RecordLoadStoreSetup): void {
  describe(`${name}: the record load store`, () => {
    let context: RecordLoadStoreContext;

    beforeEach(async () => {
      context = await setup();
    });

    afterEach(async () => {
      await context.teardown?.();
    });

    /** Asserts the store holds the job as expected. */
    const holds = async (id: string, expected: RecordLoadJob): Promise<void> => {
      const held = await context.store.get(id);
      assert.ok(held !== null && sameJob(held, expected), `the store holds ${held === null ? 'nothing' : printJob(held)}`);
    };

    it('files a job, and reads it back as filed; a job it does not hold reads as none', async () => {
      const id = uuidv7();
      await context.store.create(id, filed());
      await holds(id, filed());
      assert.equal(await context.store.get(uuidv7()), null);
    });

    it('records a running job\'s progress, and its end once: an ended job takes no other status', async () => {
      for (const end of ENDS) {
        const id = uuidv7();
        await context.store.create(id, filed());
        const progress: RecordLoadJob['status'] = variant('processing', some(variant('pieces', { done: 3n, total: 12n, cached: 1n })));
        assert.equal(await context.store.updateStatus(id, progress), true, 'progress is recorded while it runs');
        assert.equal(await context.store.updateStatus(id, end), true, `it ends ${end.type}`);
        for (const later of [variant('processing', none), ...ENDS] as ReadonlyArray<RecordLoadJob['status']>) {
          assert.equal(await context.store.updateStatus(id, later), false, `ended ${end.type}, it takes no ${later.type}`);
        }
        await holds(id, { ...filed(), status: end });
      }
    });

    it('records a request to cancel a running job, once, and leaves the job running for it to end itself', async () => {
      const id = uuidv7();
      await context.store.create(id, filed());
      const first: FunctionCallCancel = { by: some('ada@example.com'), at: new Date('2026-11-17T10:05:00Z') };
      const asked = await context.store.cancel(id, first);
      const expected: RecordLoadJob = { ...filed(), cancel: some(first) };
      assert.ok(asked !== null && sameJob(asked, expected), 'it answers the job as it stands, asked');
      // Asked again, the first request stands
      const again = await context.store.cancel(id, { by: some('bo@example.com'), at: new Date('2026-11-17T10:06:00Z') });
      assert.ok(again !== null && sameJob(again, expected));
      await holds(id, expected);
      // The job still writes its own progress, and its end
      assert.equal(await context.store.updateStatus(id, variant('processing', some(variant('commit', null)))), true);
      assert.equal(await context.store.updateStatus(id, variant('cancelled', null)), true);
      await holds(id, { ...expected, status: variant('cancelled', null) });
    });

    it('leaves an ended job as it is when asked to cancel it, and answers none for a job it does not hold', async () => {
      const id = uuidv7();
      await context.store.create(id, filed());
      await context.store.updateStatus(id, ENDS[0]!);
      const ended: RecordLoadJob = { ...filed(), status: ENDS[0]! };
      const asked = await context.store.cancel(id, { by: none, at: new Date() });
      assert.ok(asked !== null && sameJob(asked, ended), 'the cancel came too late: the job answers as it ended');
      await holds(id, ended);
      assert.equal(await context.store.cancel(uuidv7(), { by: none, at: new Date() }), null);
    });

    it('refuses the status of a job it does not hold, and forgets a job it deletes', async () => {
      await assert.rejects(context.store.updateStatus(uuidv7(), variant('cancelled', null)));
      const id = uuidv7();
      await context.store.create(id, filed());
      await context.store.delete(id);
      assert.equal(await context.store.get(id), null);
    });

    describe('its jobs, dispatched', () => {
      /** The task a load's pieces run as. */
      const pieces = (): string => `${context.loads.record}.${context.loads.source}`;

      afterEach(() => {
        // Nothing a case held is left held for the next
        const { runner } = context.loads;
        runner.pass(pieces());
        while (runner.holding(pieces()) > 0) runner.release(pieces());
      });

      /** Waits for what `read` answers, failing with what it waits for. */
      const until = async <T>(read: () => Promise<T | null>, what: string, ms = 60_000): Promise<T> => {
        const deadline = Date.now() + ms;
        for (;;) {
          const found = await read();
          if (found !== null) return found;
          if (Date.now() > deadline) assert.fail(`waited ${ms / 1000} s for ${what}`);
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      };
      /** Files a job of another delivery of the source's. */
      const file = async (): Promise<string> => {
        const { repo, workspace, record, source, deliver } = context.loads;
        const id = uuidv7();
        await context.store.create(id, {
          repo, workspace, record, source, delivery: await deliver(), actor: 'ada@example.com', asOf: none, cancel: none,
          status: variant('processing', none), createdAt: new Date(),
        });
        return id;
      };
      /** Files a job, and dispatches it. */
      const launch = async (): Promise<string> => {
        const id = await file();
        await context.store.execute(id, context.loads.repo);
        return id;
      };
      /** A job as the store holds it. */
      const held = async (id: string): Promise<RecordLoadJob> => {
        const job = await context.store.get(id);
        if (job === null) assert.fail(`job ${id} is gone`);
        return job;
      };
      /** A job once it has ended. */
      const ended = (id: string): Promise<RecordLoadJob> => until(async () => {
        const job = await held(id);
        return job.status.type === 'processing' ? null : job;
      }, 'the job to end');
      /** Settles once a job says it waits for an earlier load of its source. */
      const queued = (id: string): Promise<RecordLoadJob> => until(async () => {
        const job = await held(id);
        if (job.status.type !== 'processing') assert.fail(`the job ended ${job.status.type} before it said it waits`);
        return job.status.value.type === 'some' && job.status.value.value.type === 'queued' ? job : null;
      }, 'the job to say it waits');
      /** The commit a job's load made. */
      const commitOf = (job: RecordLoadJob): string => {
        if (job.status.type !== 'completed' || job.status.value.commit.type !== 'some') assert.fail(`the job ended ${printJob(job)}`);
        return job.status.value.commit.value;
      };
      /** The source's loads the record holds, by their commits, oldest first. */
      const loaded = async (): Promise<string[]> => {
        const { storage, repo, workspace, record, source } = context.loads;
        return (await recordHistory(storage, repo, workspace, record))
          .filter(({ commit }) => sameName(commit.mutation, loadCommitName(source))).map(({ hash }) => hash).reverse();
      };

      it('R14, ruling 37 — one source\'s jobs asked to run together apply in the order filed, each that waits saying so', async () => {
        const { repo, runner } = context.loads;
        runner.hold(pieces());
        const ids = [await file(), await file(), await file()];
        await Promise.all(ids.map((id) => context.store.execute(id, repo)));
        // One is in its pieces, and the two filed after it say they wait
        await runner.launched(pieces());
        await Promise.all([queued(ids[1]!), queued(ids[2]!)]);

        runner.pass(pieces());
        runner.release(pieces());
        const commits = (await Promise.all(ids.map(ended))).map(commitOf);
        assert.deepEqual(await loaded(), commits, 'each applied in the order it was filed');
      });

      it('ruling 37 — a load another process asks once a job is filed applies after it: a job that waits holds a place among every asker of its source\'s turn', async (t) => {
        const { storage, repo, workspace, record, source, runner, deliver } = context.loads;
        if (storage.locks.queuesWaiters !== true) {
          t.skip('this backend\'s lock service keeps no queue of its waiters: its job store keeps the order alone');
          return;
        }
        runner.hold(pieces());
        const first = await launch();
        await runner.launched(pieces());
        const second = await launch();
        await queued(second);
        // As `e3 load` asks from another process: of the storage, through no store
        let saidQueued!: () => void;
        const waits = new Promise<void>((resolve) => { saidQueued = resolve; });
        const third = recordLoad(storage, runner, repo, workspace, record, source, await deliver(), {
          actor: 'cli:ada', onProgress: (step) => { if (step.type === 'queued') saidQueued(); },
        });
        await waits;

        runner.pass(pieces());
        runner.release(pieces());
        const jobs = [commitOf(await ended(first)), commitOf(await ended(second))];
        const asked = await third;
        assert.deepEqual(await loaded(), [...jobs, asked.commit.type === 'some' ? asked.commit.value : null], 'the job filed before the load was asked applied before it');
      });

      it('R85 — a request to cancel a job that waits for an earlier load of its source reaches it there: it ends cancelled while the earlier load still runs, and loads nothing', async () => {
        const { runner } = context.loads;
        runner.hold(pieces());
        const first = await launch();
        await runner.launched(pieces());
        const second = await launch();
        await queued(second);

        const asked = await context.store.cancel(second, { by: some('ada@example.com'), at: new Date() });
        assert.ok(asked !== null && asked.cancel.type === 'some', 'the request is recorded');
        assert.equal((await ended(second)).status.type, 'cancelled');
        assert.equal((await held(first)).status.type, 'processing', 'the earlier load still runs');

        runner.pass(pieces());
        runner.release(pieces());
        const landed = commitOf(await ended(first));
        assert.deepEqual(await loaded(), [landed], 'the cancelled job loaded nothing');
      });

      it('R69 — a job that waits for an earlier load of its source holds the repository\'s running work meanwhile, beside the one that runs, and each lets it go as it ends', async () => {
        const { runner, working } = context.loads;
        runner.hold(pieces());
        const first = await launch();
        await runner.launched(pieces());
        const running = await working();
        assert.ok(running > 0, 'the load that runs holds the running work');
        const second = await launch();
        await queued(second);
        const waiting = await working();
        assert.ok(waiting > running, `the load that waits holds it too: ${waiting} holds, ${running} of them the first's`);

        runner.pass(pieces());
        runner.release(pieces());
        assert.deepEqual([(await ended(first)).status.type, (await ended(second)).status.type], ['completed', 'completed']);
        await until(async () => ((await working()) === 0 ? true : null), 'each job to let the running work go');
      });

      it('R69 — a job dispatched while a garbage collection holds the repository fails, naming it: a job holds the repository\'s running work from its dispatch', async () => {
        const { storage, repo } = context.loads;
        const gc = await storage.locks.acquire(repo, TASKS_LOCK, variant('dataflow', null));
        assert.ok(gc !== null, 'nothing holds the repository');
        try {
          const job = await ended(await launch());
          assert.ok(job.status.type === 'failed' && job.status.value.message.includes('a garbage collection or an upgrade holds this repository'),
            `it failed, naming gc: ${printJob(job)}`);
        } finally {
          await gc.release();
        }
      });
    });
  });
}
