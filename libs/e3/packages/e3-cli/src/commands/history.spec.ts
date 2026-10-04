/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * `e3 history` over the API: asked for the whole chain, it walks a host's
 * pages to the chain's end, each from the last commit's parent; asked for a
 * limit, it makes the one request; and it stops where the chain does — at a
 * page answered empty, or before a commit it has already returned.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { none, some } from '@elaraai/east';
import type { RecordHistoryResult } from '@elaraai/e3-api-client';
import { remoteHistory, type HistoryPage } from './history.js';

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
