/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * e3-web's storage in Chromium: the adapters' contract over IndexedDB, OPFS
 * and Web Locks — and over the adapters in memory, as a page opened with
 * `persist: false` uses them — each case a test of its own, run in a page;
 * what only pages show: a tab's session and its locks across tabs, a closed
 * tab's locks, and what one page writes read after a reload; and the stores
 * over the browser's adapters: a repository one page writes through them,
 * read after a reload and by another page and collected, a workspace's lock
 * across pages, a repository kept in memory, and a persisted storage refused
 * in a page without an API it needs.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { blobsContract, filesContract, locksContract, recordsContract, type AdapterCase } from '../testing/adapter-contract.js';
import { Harness, type HarnessPage } from './harness.js';
import type { Collected, LockSeen, Refused, RepositoryRead, Written } from './repository.page.js';

const entries = {
  storage: fileURLToPath(new URL('./storage.page.js', import.meta.url)),
  repository: fileURLToPath(new URL('./repository.page.js', import.meta.url)),
};

/** Each contract, and the implementations the page runs it over. */
const groups: ReadonlyArray<{ group: string; contract: readonly AdapterCase<never>[]; implementations: readonly string[] }> = [
  { group: 'records', contract: recordsContract, implementations: ['indexeddb', 'memory'] },
  { group: 'blobs', contract: blobsContract, implementations: ['opfs', 'memory'] },
  { group: 'locks', contract: locksContract, implementations: ['web-locks', 'memory'] },
  { group: 'files', contract: filesContract, implementations: ['opfs', 'memory'] },
];

/** What a sweep found. */
interface Swept {
  deleted: number;
  skippedYoung: number;
}

describe('e3-web\'s storage in Chromium', () => {
  let harness: Harness | undefined;
  /** The page each contract case runs in */
  let page: HarnessPage;

  before(async () => {
    harness = await Harness.open({ entries });
    page = await harness.newPage('storage');
  });

  after(async () => {
    await harness?.close();
  });

  /** A page of its own for a test, closed once the test ends. */
  async function openPage(t: { after(fn: () => Promise<void>): void }, entry = 'storage'): Promise<HarnessPage> {
    const opened = await harness!.newPage(entry);
    t.after(() => opened.close());
    return opened;
  }

  /** A name no other test's storage has, whose IndexedDB database and OPFS
   *  directory are removed once the test ends. */
  function storageName(t: { after(fn: () => Promise<void>): void }): string {
    const name = `e3-web-test-${randomUUID()}`;
    t.after(() => page.call('clearState', name));
    return name;
  }

  for (const { group, contract, implementations } of groups) {
    for (const implementation of implementations) {
      describe(`the ${group} adapter over ${implementation}`, () => {
        for (const { name } of contract) {
          it(name, () => page.call('runCase', group, implementation, name));
        }
      });
    }
  }

  describe('the OPFS blobs\' staging', () => {
    it('counts what a write in flight and one abandoned leave, removing only the abandoned one, and only past the age gate', async () => {
      const found = await page.call<{
        staged: string[];
        dryInFlight: Swept;
        gatedInFlight: Swept;
        written: number;
        inflight: string;
        gatedAbandoned: Swept;
        dryAbandoned: Swept;
        sweptAbandoned: Swept;
        left: string[];
      }>('sweepStaging');
      assert.ok(found.staged.length >= 1, `a write in flight stages its file: ${found.staged.join(', ')}`);
      assert.deepEqual(found.dryInFlight, { deleted: found.staged.length, skippedYoung: 0 }, 'a dry run with no age gate counts it');
      assert.deepEqual(found.gatedInFlight, { deleted: 0, skippedYoung: found.staged.length }, 'a young leftover is left');
      assert.equal(found.written, 9);
      assert.equal(found.inflight, 'in flight', 'the write the sweeps passed over finishes');
      assert.deepEqual(found.gatedAbandoned, { deleted: 0, skippedYoung: 1 }, 'an abandoned write younger than the gate is left');
      assert.deepEqual(found.dryAbandoned, { deleted: 1, skippedYoung: 0 }, 'a dry run counts it');
      assert.deepEqual(found.sweptAbandoned, { deleted: 1, skippedYoung: 0 });
      assert.deepEqual(found.left, [], 'nothing is left behind');
    });
  });

  describe('across pages', () => {
    it('lets no two pages hold a workspace\'s exclusive lock at once', async (t) => {
      const [first, second] = [await openPage(t), await openPage(t)];
      const prefix = `e3-web-test-${randomUUID()}:`;
      const [a, b] = [await first.call<string>('openSession', prefix), await second.call<string>('openSession', prefix)];

      // Both pages ask at once, round after round: one holds it each time.
      for (let round = 0; round < 10; round++) {
        const [heldByFirst, heldBySecond] = await Promise.all([
          first.call<string | null>('acquire', a, 'workspace', 'exclusive'),
          second.call<string | null>('acquire', b, 'workspace', 'exclusive'),
        ]);
        assert.equal([heldByFirst, heldBySecond].filter((hold) => hold !== null).length, 1, `round ${round}: one page holds it`);
        if (heldByFirst !== null) await first.call('release', heldByFirst);
        if (heldBySecond !== null) await second.call('release', heldBySecond);
      }

      const held = await first.call<string | null>('acquire', a, 'workspace', 'exclusive');
      assert.ok(held !== null);
      assert.equal(await second.call('acquire', b, 'workspace', 'exclusive'), null, 'the other page is refused');
      assert.equal(await second.call('acquire', b, 'workspace', 'shared'), null, 'shared too');
      assert.equal(await second.call('acquire', b, 'workspace', 'exclusive', { wait: true, timeout: 200 }), null,
        'a wait for it runs out while the first page holds it');
      assert.deepEqual(await second.call('held', b, 'workspace'), ['exclusive'], 'the other page sees it held');
      assert.equal(await second.call('isAlive', b, a), true, 'the holder\'s session is alive');
      const waiting = second.call<string | null>('acquire', b, 'workspace', 'exclusive', { wait: true });
      await first.call('release', held);
      assert.ok((await waiting) !== null, 'the other page takes it once it is released');
    });

    it('frees a lock a closed page held to another page, and ends the closed page\'s session', async (t) => {
      const [first, second] = [await openPage(t), await openPage(t)];
      const prefix = `e3-web-test-${randomUUID()}:`;
      const [a, b] = [await first.call<string>('openSession', prefix), await second.call<string>('openSession', prefix)];
      assert.ok((await first.call('acquire', a, 'workspace', 'exclusive')) !== null);
      assert.ok((await first.call('acquire', a, 'workspace#dataflow', 'shared')) !== null);
      assert.equal(await second.call('acquire', b, 'workspace', 'exclusive'), null);
      assert.equal(await second.call('isAlive', b, a), true);

      // The tab closes holding both: nothing is released first.
      await first.close();

      const taken = await second.call<string | null>('acquire', b, 'workspace', 'exclusive', { wait: true });
      assert.ok(taken !== null, 'the other page takes the workspace lock the closed page held');
      assert.ok((await second.call('acquire', b, 'workspace#dataflow', 'exclusive', { wait: true })) !== null,
        'and the lock it held shared');
      await second.call('awaitEnded', prefix, a);
      assert.equal(await second.call('isAlive', b, a), false, 'the closed page\'s session is not alive');
      assert.equal(await second.call('isAlive', b, b), true, 'the open page\'s is');
    });

    it('reads after a reload, and in another page, the records, blobs and files a page wrote', async (t) => {
      const writer = await openPage(t);
      const name = storageName(t);
      await writer.call('writeState', name);
      const expected = {
        records: [[['refs', 'dev'], 'another ref'], [['refs', 'main'], 'a ref']],
        blobs: [[['objects', 'ab12'], 'an object']],
        file: 'a delivery',
      };
      await writer.reload();
      assert.deepEqual(await writer.call('readState', name), expected, 'the page after a reload reads it');
      const reader = await openPage(t);
      assert.deepEqual(await reader.call('readState', name), expected, 'another page reads it');
    });
  });

  describe('a repository through the stores, over IndexedDB, OPFS and Web Locks', () => {
    it('reads after a reload, and in another page, what a page wrote through the stores, and collects only what nothing names', async (t) => {
      const writer = await openPage(t, 'repository');
      const name = storageName(t);
      const written = await writer.call<Written>('writeRepository', name);
      const expected: RepositoryRead = {
        repositories: ['default'],
        status: 'active',
        release: true,
        greeting: 'hello from a page',
        range: 'object',
        size: 'an object nothing names'.length,
        objects: [written.value, written.pkg, written.orphan].sort(),
        packages: ['greeting@1.0.0'],
        resolved: written.pkg,
        workspaces: ['main'],
        dataset: true,
        execution: true,
        log: { data: 'é€', offset: 1, size: 5, totalSize: 7, complete: false },
        run: { id: written.runId, status: 'running' },
      };

      await writer.reload();
      assert.deepEqual(await writer.call('readRepository', name, written), expected, 'the page after a reload reads it');
      const reader = await openPage(t, 'repository');
      assert.deepEqual(await reader.call('readRepository', name, written), expected, 'another page reads it');

      // gc holds the repository still through Web Locks, marks from what the
      // package and the execution name, and deletes the object nothing names
      const collected = await reader.call<Collected>('collectRepository', name, written);
      assert.deepEqual(collected, {
        deletedObjects: 1, retainedObjects: 2, deletedPartials: 0, exists: { value: true, pkg: true, orphan: false },
      });
      await writer.reload();
      assert.deepEqual(await writer.call('listObjects', name), [written.value, written.pkg].sort(),
        'the page after another reload finds what gc left, and only that');
    });

    it('names a workspace\'s holder to another page while it holds the lock, and frees the lock once its page closes', async (t) => {
      const [holder, other] = [await openPage(t, 'repository'), await openPage(t, 'repository')];
      const name = storageName(t);
      const session = await holder.call<string>('holdWorkspace', name);

      assert.deepEqual(await other.call<LockSeen>('readLock', name), {
        holder: { operation: 'deployment', session, alive: true }, progress: true, recorded: true,
      }, 'the other page sees the holder, alive, and what it reported');
      assert.deepEqual(await other.call('tryWorkspace', name, false), { taken: false, own: false, cleared: false }, 'and cannot take the lock');

      // The tab closes holding it: nothing is released first, and its state is
      // left recorded.
      await holder.close();
      await other.call('awaitSessionEnded', name, session);
      assert.deepEqual(await other.call<LockSeen>('readLock', name), { holder: null, progress: null, recorded: true },
        'the closed page\'s state is no one\'s');
      assert.deepEqual(await other.call('tryWorkspace', name, true), { taken: true, own: true, cleared: true },
        'the other page takes the lock, its state names the other page, and its release takes the state away');
    });

    it('keeps a repository opened with persist: false while the page lives, persisting nothing, and none after a reload', async (t) => {
      const tab = await openPage(t, 'repository');
      assert.deepEqual(await tab.call('writeInMemory'), ['default']);
      assert.deepEqual(await tab.call('readInMemory'), { repositories: ['default'], objects: 1, persisted: false });
      await tab.reload();
      assert.deepEqual(await tab.call('readInMemory'), { repositories: [], objects: 0, persisted: false });
    });

    it('refuses a persisted storage in a page whose OPFS cannot move a file, naming FileSystemFileHandle.move, before it makes anything', async (t) => {
      const tab = await openPage(t, 'repository');
      const name = storageName(t);
      const opened = await tab.call<Refused>('openWithoutMove', name);
      assert.match(opened.refusal ?? 'it opened', /it has no FileSystemFileHandle\.move /);
      assert.match(opened.refusal ?? 'it opened', /persist: false to keep repositories in memory/);
      assert.deepEqual([opened.database, opened.directory], [false, false], 'neither its database nor its directory was made');
    });
  });
});
