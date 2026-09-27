/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Records loader specs — what a poll reads of a workspace's records (once
 * per state, and again under a new package), and the History tab's pages:
 * the newest page, the pages after it, the newest joined to them as commits
 * land, and a chain rewritten under the view, all over the in-memory API.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { none } from '@elaraai/east';
import { commitChain, dictOf, fakeRepo, type FakeApi, type FakeRecord } from '../api.fake.js';
import { initialState } from '../state/actions.js';
import { createStore, type Store } from '../state/store.js';
import { createRecordsLoader, HISTORY_PAGE, joinPages, type RecordsLoader } from './records.js';

const session = { kind: 'local' as const, label: 'demo-repo', repo: 'default', apiUrl: 'http://x', path: '/x', origin: null, identity: null, stateKey: '/x', target: '/x' };
const NOW = Date.UTC(2026, 8, 8, 12, 0, 0);

/** A ledger of `rows` rows whose chain holds `commits` commits, the newest at `newest`. */
function ledger(rows: number, commits: number, newest = NOW): FakeRecord {
    const { type, value } = dictOf(rows);
    return { name: 'ledger', type, value, mutations: [{ name: 'set_status', form: 'patch' }], commits: commitChain(commits, new Date(newest)) };
}

function setup(): { api: FakeApi; store: Store; loader: RecordsLoader } {
    const api = fakeRepo();
    api.geometry = true;
    api.record('main', ledger(40, 250));
    const store = createStore(initialState({ columns: 120, rows: 36 }, '/x'));
    store.dispatch({ type: 'session', session });
    return { api, store, loader: createRecordsLoader({ store, api: () => api }) };
}

/** The dataset list, as the datasets feed dispatches it before each tick. */
async function listed(api: FakeApi, store: Store): Promise<void> {
    store.dispatch({ type: 'data/datasets', ws: 'main', entries: await api.datasetList('main') });
}

const describes = (api: FakeApi): number => api.calls.filter(c => c.startsWith('recordDescribe ')).length;
const facts = (store: Store) => store.getState().data.records['main']?.['ledger'];

describe('records loader', () => {
    test('a poll reads a record once per state: its signature, its rows and its newest commit', async () => {
        const { api, store, loader } = setup();
        await listed(api, store);
        await loader.tick('main');
        assert.equal(facts(store)?.rows, 40);
        assert.deepEqual(facts(store)?.signature?.mutations.map(m => m.name), ['set_status']);
        assert.equal(facts(store)?.head?.hash, commitChain(250, new Date(NOW))[0]!.hash);
        assert.equal(facts(store)?.history, null, 'no history until the History tab reads it');
        const reads = api.calls.length;
        assert.deepEqual(api.calls.slice(-3).sort(), ['datasetGetStatus main.records.ledger', 'recordDescribe main.ledger', 'recordHistory main.ledger head+1']);
        await listed(api, store);
        await loader.tick('main');
        assert.equal(api.calls.length, reads + 1, 'nothing moved: the list, and nothing else');
        // A commit moves the state: the record is read again.
        api.record('main', ledger(41, 251, NOW + 60_000));
        await listed(api, store);
        await loader.tick('main');
        assert.equal(describes(api), 2);
        assert.equal(facts(store)?.rows, 41);
        assert.equal(facts(store)?.head?.hash, commitChain(251, new Date(NOW))[0]!.hash);
    });

    test('a record that cannot be read is logged and read on the next poll; the poll it follows never fails', async () => {
        const { api, store } = setup();
        const lines: string[] = [];
        const loader = createRecordsLoader({ store, api: () => api, log: line => lines.push(line) });
        await listed(api, store);
        // The list names a record the server no longer describes.
        const workspace = api.workspace('main');
        const held = workspace.records;
        workspace.records = [];
        await loader.tick('main');
        assert.equal(facts(store), undefined);
        assert.match(lines.join('\n'), /record main\.ledger not read: /);
        workspace.records = held;
        await loader.tick('main');
        assert.equal(facts(store)?.rows, 40);
    });

    test('a redeploy reads the signature again where the state did not move; one read before the package was known stands', async () => {
        const { api, store, loader } = setup();
        await listed(api, store);
        await loader.tick('main');
        assert.equal(describes(api), 1);
        const deployed = (packageHash: string) => store.dispatch({ type: 'data/workspaceState', ws: 'main', state: { packageName: 'demand', packageVersion: '1.4.2', packageHash, deployedAt: new Date(NOW), currentRunId: none } });
        deployed('p1');
        await loader.tick('main');
        assert.equal(describes(api), 1, 'read before the package was known, and taken as read under it');
        deployed('p2');
        await loader.tick('main');
        assert.equal(describes(api), 2, 'a new package: read again');
        await loader.tick('main');
        assert.equal(describes(api), 2);
    });

    test('the History tab: the newest page, the pages after it, the newest joined as commits land, a rewritten chain started again', async () => {
        const { api, store, loader } = setup();
        // Before any poll has named the record: its commits come first.
        await loader.history('main', 'ledger');
        assert.equal(facts(store)?.history?.length, HISTORY_PAGE);
        assert.equal(facts(store)?.complete, false);
        await loader.history('main', 'ledger', true);
        assert.equal(facts(store)?.history?.length, 2 * HISTORY_PAGE);
        await loader.history('main', 'ledger', true);
        assert.equal(facts(store)?.history?.length, 250);
        assert.equal(facts(store)?.complete, true, 'a short page ends the chain');
        assert.equal(facts(store)?.history?.at(-1)?.mutation, '$init');
        const chain = commitChain(250, new Date(NOW));
        assert.deepEqual(api.calls.filter(c => c.startsWith('recordHistory ')), [
            `recordHistory main.ledger head+${HISTORY_PAGE}`,
            `recordHistory main.ledger ${chain[100]!.hash}+${HISTORY_PAGE}`,
            `recordHistory main.ledger ${chain[200]!.hash}+${HISTORY_PAGE}`,
        ]);
        await loader.history('main', 'ledger', true);
        assert.equal(api.calls.filter(c => c.startsWith('recordHistory ')).length, 3, 'nothing past the root');
        // Two commits land: the newest page reaches the held ones and joins them.
        api.record('main', ledger(40, 252, NOW + 120_000));
        await loader.history('main', 'ledger');
        assert.equal(facts(store)?.history?.length, 252);
        assert.equal(facts(store)?.complete, true);
        assert.equal(facts(store)?.head?.hash, commitChain(252, new Date(NOW))[0]!.hash);
        assert.deepEqual(facts(store)?.history?.slice(2).map(c => c.hash), chain.map(c => c.hash), 'the held pages follow the new head');
        // Compacted: the chain no longer reaches the held pages, so they are dropped.
        api.record('main', { ...ledger(40, 0), commits: [{ hash: 'compacted', parent: none, state: 's', mutation: '$compact', actor: 'e3', at: new Date(NOW + 180_000), delta: none }] });
        await loader.history('main', 'ledger');
        assert.deepEqual(facts(store)?.history?.map(c => c.mutation), ['$compact']);
        assert.equal(facts(store)?.complete, true);
    });

    test('joinPages: the newest page, then the held commits from where it reaches them', () => {
        const chain = commitChain(6, new Date(NOW));
        assert.deepEqual(joinPages(chain.slice(0, 3), []).map(c => c.hash), chain.slice(0, 3).map(c => c.hash));
        assert.deepEqual(joinPages(chain.slice(0, 3), chain.slice(2)).map(c => c.hash), chain.map(c => c.hash));
        assert.deepEqual(joinPages(chain.slice(0, 2), chain.slice(3)).map(c => c.hash), chain.slice(0, 2).map(c => c.hash), 'a page that does not reach them drops them');
    });
});
