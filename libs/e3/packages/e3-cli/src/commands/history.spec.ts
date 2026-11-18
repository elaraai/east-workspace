/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * `e3 history` over the API: asked for the whole chain, it walks a host's
 * pages to the chain's end, each from the last commit's parent; asked for a
 * limit, it makes the one request; and it stops where the chain does — at a
 * page answered empty, or before a commit it has already returned. And a
 * load's commit, which says in words what it loaded, with `--delta` what it
 * changed.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { DateTimeType, equalFor, none, parseFor, some, type ValueTypeOf } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { LocalStorage, LocalTaskRunner, OBJECT_CONCURRENCY, packageImport, recordHistory, recordLoad } from '@elaraai/e3-core';
import {
  ErpDeliveryType, LEDGER_ORDERS, SourcedOrderType, createTempDir, createTestRepo, encodeInSegmentsOf, ledgerOrders, ledgerWorkspaces,
  removeTempDir, removeTestRepo,
} from '@elaraai/e3-core/test';
import type { RecordHistoryResult } from '@elaraai/e3-api-client';
import { captured } from '../cli-test-helpers.js';
import { commitLine, historyCommand, loadsWords, remoteHistory, type HistoryPage } from './history.js';
import { loadWords } from './load.js';

type Commit = RecordHistoryResult['commits'][number];
type Request = [limit: number | undefined, from: string | undefined];

/** A commit named `hash` whose parent is `parent`, or the chain's root. */
function commit(hash: string, parent: string | undefined): Commit {
  return {
    hash,
    parent: parent === undefined ? none : some(parent),
    state: `state-${hash}`,
    mutation: 'increment',
    actor: 'test',
    at: new Date(0),
    delta: none,
    args: none,
  };
}

/** A chain of `n` commits, `c0` the head and the last the root. */
function chain(n: number): Commit[] {
  return Array.from({ length: n }, (_, i) => commit(`c${i}`, i + 1 < n ? `c${i + 1}` : undefined));
}

/**
 * A host holding `commits`, the first its record's head, that answers a
 * request naming no limit with `pageSize` of them, as e3-api-server does
 * under a `historyLimit`. Like the server, it walks the parents from the
 * commit a request names, ends a page at a commit it cannot find or has
 * walked, and records each request it is sent.
 */
function host(commits: Commit[], pageSize: number, requests: Request[]): HistoryPage {
  const byHash = new Map(commits.map((c) => [c.hash, c]));
  return async (limit, from) => {
    requests.push([limit, from]);
    const answered: Commit[] = [];
    const walked = new Set<string>();
    let at: string | undefined = from ?? commits[0]?.hash;
    while (at !== undefined && answered.length < (limit ?? pageSize) && !walked.has(at)) {
      walked.add(at);
      const found = byHash.get(at);
      if (found === undefined) break;
      answered.push(found);
      at = found.parent.type === 'some' ? found.parent.value : undefined;
    }
    return { commits: answered };
  };
}

describe('remoteHistory', () => {
  it('asked for the whole chain, walks a host\'s pages to its root', async () => {
    const requests: Request[] = [];
    const commits = await remoteHistory(host(chain(5), 2, requests), undefined, undefined);
    assert.deepEqual(commits.map((c) => c.hash), ['c0', 'c1', 'c2', 'c3', 'c4']);
    assert.deepEqual(requests, [[undefined, undefined], [undefined, 'c2'], [undefined, 'c4']],
      'each page goes on from the last commit\'s parent');
  });

  it('starts the walk at the commit it is given', async () => {
    const requests: Request[] = [];
    const commits = await remoteHistory(host(chain(5), 2, requests), undefined, 'c1');
    assert.deepEqual(commits.map((c) => c.hash), ['c1', 'c2', 'c3', 'c4']);
    assert.deepEqual(requests, [[undefined, 'c1'], [undefined, 'c3']]);
  });

  it('asked for a limit, makes the one request', async () => {
    const requests: Request[] = [];
    const commits = await remoteHistory(host(chain(5), 2, requests), 3, undefined);
    assert.deepEqual(commits.map((c) => c.hash), ['c0', 'c1', 'c2'], 'a request\'s own limit, not the host\'s page');
    assert.deepEqual(requests, [[3, undefined]]);
  });

  it('stops at a page answered empty, as the server answers a link it cannot read', async () => {
    const requests: Request[] = [];
    const commits = await remoteHistory(host([commit('c0', 'c1'), commit('c1', 'c2'), commit('c2', 'gone')], 2, requests), undefined, undefined);
    assert.deepEqual(commits.map((c) => c.hash), ['c0', 'c1', 'c2']);
    assert.deepEqual(requests, [[undefined, undefined], [undefined, 'c2'], [undefined, 'gone']]);
  });

  it('stops before a commit it has already returned, so a chain that loops ends', async () => {
    const requests: Request[] = [];
    const commits = await remoteHistory(host([commit('c0', 'c1'), commit('c1', 'c2'), commit('c2', 'c0')], 2, requests), undefined, undefined);
    assert.deepEqual(commits.map((c) => c.hash), ['c0', 'c1', 'c2'], 'each commit once');
    assert.deepEqual(requests, [[undefined, undefined], [undefined, 'c2']]);
  });
});

describe('a load\'s commit in e3 history (R33)', () => {
  const DELIVERY = '5e7a3b0c9d1f'.padEnd(64, '0');
  const loaded = {
    delivery: DELIVERY, load: 'a'.repeat(64), first: true, execution: { inputsHash: 'b'.repeat(64), executionId: 'run-1' },
    set: 1_204n, deleted: 31n, unchanged: 98_112n,
  };

  it('says in words what a load\'s commit loaded: its delivery, its as-of, and what it did to the source\'s entries', () => {
    assert.equal(loadWords({ ...loaded, asOf: some(new Date('2026-11-02T03:00:00.000Z')) }),
      'delivery 5e7a3b0c9d1f as of 2026-11-02T03:00:00.000: 1,204 set, 31 deleted, 98,112 unchanged');
    assert.equal(loadWords({ ...loaded, asOf: none }), 'delivery 5e7a3b0c9d1f: 1,204 set, 31 deleted, 98,112 unchanged');
  });

  describe('of a local repository', () => {
    let repoDir: string;
    let dir: string;
    let storage: LocalStorage;

    before(async () => {
      repoDir = createTestRepo();
      dir = createTempDir();
      storage = new LocalStorage(dirname(repoDir));
      await e3.export(e3.package('ledger', '1.0.0', ledgerOrders()), join(dir, 'ledger.zip'));
      await packageImport(storage, repoDir, join(dir, 'ledger.zip'));
    });

    after(() => {
      removeTestRepo(repoDir);
      removeTempDir(dir);
    });

    it('prints a load\'s commit with what it loaded, and with --delta what it changed, as a mutation\'s', async () => {
      const runner = new LocalTaskRunner(repoDir);
      const ws = await ledgerWorkspaces(storage, repoDir, runner).fresh();
      const delivery = await storage.objects.write(repoDir, encodeInSegmentsOf(ErpDeliveryType, 2)(
        new Map<string, ValueTypeOf<typeof SourcedOrderType>>([['SO-3301', LEDGER_ORDERS.acme], ['SO-3302', LEDGER_ORDERS.birch]])));
      const result = await recordLoad(storage, runner, repoDir, ws, 'orders', 'erp', delivery, {
        actor: 'cli:ada', asOf: new Date('2026-11-02T03:00:00.000Z'),
      });
      assert.ok(result.commit.type === 'some' && result.outcome.type === 'loaded');

      const printed = (await captured(() => historyCommand(repoDir, 'orders', { workspace: ws, delta: true }))).split('\n');
      const at = printed.findIndex((line) => line.startsWith(result.commit.type === 'some' ? result.commit.value.slice(0, 12) : '-'));
      assert.match(printed[at] ?? '', new RegExp(
        `^[0-9a-f]{12}  \\$load:erp\\s+cli:ada\\s+\\S+  delivery ${delivery.slice(0, 12)} as of 2026-11-02T03:00:00\\.000: 2 set, 0 deleted, 0 unchanged$`));
      // Its delta, as a mutation's: the source's two orders inserted into the record, and into its index
      const changed = printed.slice(at + 1, at + 3).map((line) => line.trim().replace(/\s+/g, ' '));
      assert.deepEqual(changed.sort(), ['by_customer +2 ~0 -0', 'primary +2 ~0 -0']);

      // A long chain's loads: their arguments are read a few at a time, and a commit whose arguments cannot be
      // read is printed without its load's words
      const [head] = await recordHistory(storage, repoDir, ws, 'orders', { limit: 1 });
      assert.ok(head !== undefined && head.commit.args.type === 'some');
      const args = await storage.objects.read(repoDir, head.commit.args.value);
      const commits = Array.from({ length: 4 * OBJECT_CONCURRENCY }, (_, i) => ({ hash: `c${i}`, mutation: '$load:erp', args: `args-${i}` }));
      let reading = 0;
      let most = 0;
      const words = await loadsWords([...commits, { hash: 'edit', mutation: 'edit', args: 'args-edit' }], async (hash) => {
        most = Math.max(most, ++reading);
        await new Promise((resolve) => { setImmediate(resolve); });
        reading--;
        if (hash === 'args-3') throw new Error('the object route refused it');
        return args;
      });
      assert.equal(most, OBJECT_CONCURRENCY, 'no more at once than the objects a store is asked for together');
      assert.deepEqual([words.size, words.has('c3'), words.has('edit')], [commits.length - 1, false, false]);
      assert.match(words.get('c0') ?? '', /^delivery [0-9a-f]{12} as of 2026-11-02T03:00:00\.000: 2 set, 0 deleted, 0 unchanged$/);
    });
  });

  it('prints a commit\'s time as East prints a DateTime, which East reads back', () => {
    const at = new Date('2026-11-02T03:00:12.000Z');
    const line = commitLine({ hash: 'c'.repeat(64), mutation: 'edit', actor: 'cli:ada', at });
    assert.equal(line, `${'c'.repeat(12)}  ${'edit'.padEnd(18)}  ${'cli:ada'.padEnd(16)}  2026-11-02T03:00:12.000`);
    const read = parseFor(DateTimeType)(line.split('  ').at(-1)!);
    assert.ok(read.success && equalFor(DateTimeType)(read.value, at), 'the time reads back as the commit\'s');
  });
});
