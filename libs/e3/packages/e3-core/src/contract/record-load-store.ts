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
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { equalFor, none, printFor, some, variant } from '@elaraai/east';
import type { FunctionCallCancel } from '@elaraai/e3-types';
import { RecordLoadJobType, type RecordLoadJob } from '../transfer/types.js';
import type { RecordLoadStore } from '../transfer/interfaces.js';
import { uuidv7 } from '../uuid.js';

const sameJob = equalFor(RecordLoadJobType);
const printJob = printFor(RecordLoadJobType);

/** A backend's record load store, and what lets it go once a case is done. */
export interface RecordLoadStoreContext {
  readonly store: RecordLoadStore;
  readonly teardown?: () => Promise<void>;
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
  });
}
