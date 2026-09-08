/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Dataset loader specs — the inline / paged decision, page retention and
 * the byte cache, a content-hash change, the not-indexed and too-large
 * states, `⏎ load whole value`, key search on both paths, and the
 * hash-mismatch refetch, all over the in-memory API.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { FloatType, IntegerType, StringType, StructType, variant } from '@elaraai/east';
import { dictOf, fakeRepo, type FakeApi } from '../api.fake.js';
import { initialState } from '../state/actions.js';
import { createStore, type Store } from '../state/store.js';
import { createDatasetLoader, INLINE_LIMIT, MAX_RETAINED_PAGES, PAGE_SIZE, type DatasetLoader } from './dataset.js';

const session = { kind: 'local' as const, label: 'demo-repo', repo: 'default', apiUrl: 'http://x', path: '/x', origin: null, identity: null, stateKey: '/x', target: '/x' };

function setup(): { api: FakeApi; store: Store; loader: DatasetLoader } {
    const api = fakeRepo();
    const store = createStore(initialState({ columns: 120, rows: 36 }, '/x'));
    store.dispatch({ type: 'session', session });
    const loader = createDatasetLoader({ store, api: () => api });
    return { api, store, loader };
}

const settle = async (): Promise<void> => {
    for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve));
};

const ready = variant('up-to-date', { cached: false });
const FORECAST = '.tasks.forecast.output';

describe('dataset loader', () => {
    test('a non-collection under the inline limit is fetched whole and materialized once per hash', async () => {
        const { api, store, loader } = setup();
        api.task('main', { name: 'params', status: ready, inputs: [], dependsOn: [], output: { type: StructType({ horizon: IntegerType, smoothing: FloatType }), value: { horizon: 14n, smoothing: 0.35 } } });
        await loader.tick('main', '.tasks.params.output');
        const d = store.getState().data.dataset['main']!['.tasks.params.output']!;
        assert.equal(d.mode.kind, 'inline');
        assert.ok(d.hash !== null && d.size > 0);
        assert.equal(d.mode.kind === 'inline' && d.mode.root.type, 'struct');
        assert.deepEqual(d.mode.kind === 'inline' && d.mode.root.type === 'struct' ? d.mode.root.value.fields.map(f => f.name) : [], ['horizon', 'smoothing']);
        await loader.tick('main', '.tasks.params.output');
        assert.equal(api.calls.filter(c => c === 'datasetGet main.tasks.params.output').length, 1, 'the same hash is not refetched');
        assert.equal(store.getState().data.dataset['main']!['.tasks.params.output']!.mode.kind, 'inline');
    });

    test('a collection pages: the first page, then windows with retention and a byte cache; a new hash resets', async () => {
        const { api, store, loader } = setup();
        const { type, value } = dictOf(5_000);
        api.task('main', { name: 'forecast', status: ready, inputs: [], dependsOn: [], output: { type, value } });
        await loader.tick('main', FORECAST);
        await settle();
        let d = store.getState().data.dataset['main']![FORECAST]!;
        assert.equal(d.mode.kind, 'paged');
        if (d.mode.kind !== 'paged') return;
        assert.equal(d.mode.totalRows, 5_000);
        assert.deepEqual([...d.mode.pages.keys()].sort((a, b) => a - b), [0, 1], 'the first window plus one page of margin');
        assert.equal(d.mode.pages.get(0)?.length, PAGE_SIZE);
        assert.equal(d.mode.pages.get(0)?.[0]?.label, 'k0000');
        loader.needRows('main', FORECAST, 2_400, 2_600);
        await settle();
        d = store.getState().data.dataset['main']![FORECAST]!;
        assert.deepEqual(d.mode.kind === 'paged' ? [...d.mode.pages.keys()].sort((a, b) => a - b) : [], [0, 1, 4, 5]);
        for (let p = 0; p < 10; p++) {
            loader.needRows('main', FORECAST, p * PAGE_SIZE, p * PAGE_SIZE + 1);
            await settle();
        }
        d = store.getState().data.dataset['main']![FORECAST]!;
        const kept = d.mode.kind === 'paged' ? [...d.mode.pages.keys()].sort((a, b) => a - b) : [];
        assert.ok(kept.length <= MAX_RETAINED_PAGES, `retained ${kept.length}`);
        assert.ok(kept.includes(9) && !kept.includes(0), `kept ${kept.join(',')}`);
        // Returning to an evicted page re-materializes from the byte cache: no second request.
        const fetches = () => api.calls.filter(c => c === `datasetGetPage main${FORECAST} 0+${PAGE_SIZE}`).length;
        assert.equal(fetches(), 1);
        loader.needRows('main', FORECAST, 0, 1);
        await settle();
        d = store.getState().data.dataset['main']![FORECAST]!;
        assert.ok(d.mode.kind === 'paged' && d.mode.pages.has(0));
        assert.equal(fetches(), 1);
        // A new value: pages reset, totals follow.
        api.store('main', FORECAST, type, dictOf(700).value);
        await loader.tick('main', FORECAST);
        await settle();
        d = store.getState().data.dataset['main']![FORECAST]!;
        assert.equal(d.mode.kind === 'paged' && d.mode.totalRows, 700);
        assert.deepEqual(d.mode.kind === 'paged' ? [...d.mode.pages.keys()].sort((a, b) => a - b) : [], [0, 1]);
    });

    test('a legacy blob: the not-indexed state, then ⏎ loads it whole', async () => {
        const { api, store, loader } = setup();
        const { type, value } = dictOf(20);
        api.task('main', { name: 'ingest', status: ready, inputs: [], dependsOn: [], output: { type, value }, notIndexed: true });
        await loader.tick('main', '.tasks.ingest.output');
        await settle();
        let d = store.getState().data.dataset['main']!['.tasks.ingest.output']!;
        assert.deepEqual(d.mode, { kind: 'not-indexed', loadable: true });
        await loader.loadWhole('main', '.tasks.ingest.output');
        d = store.getState().data.dataset['main']!['.tasks.ingest.output']!;
        assert.equal(d.mode.kind, 'inline');
        assert.equal(d.forced, true);
        assert.equal(d.mode.kind === 'inline' && d.mode.root.type === 'dict' ? d.mode.root.value.entries.length : -1, 20);
        assert.deepEqual(await loader.findKey('main', '.tasks.ingest.output', { key: '"k0005"' }), { found: true, row: 5, count: 1 });
        assert.deepEqual(await loader.findKey('main', '.tasks.ingest.output', { prefix: 'k001' }), { found: true, row: 10, count: 10 });
    });

    test('too large: an oversize non-collection, and a page the server refuses', async () => {
        const { api, store, loader } = setup();
        api.task('main', { name: 'features', status: ready, inputs: [], dependsOn: [], output: { type: StringType, value: randomBytes(INLINE_LIMIT * 2).toString('base64') } });
        await loader.tick('main', '.tasks.features.output');
        assert.equal(store.getState().data.dataset['main']!['.tasks.features.output']!.mode.kind, 'too-large');
        const { type, value } = dictOf(10);
        api.task('main', { name: 'wide', status: ready, inputs: [], dependsOn: [], output: { type, value }, tooLarge: true });
        await loader.tick('main', '.tasks.wide.output');
        await settle();
        assert.equal(store.getState().data.dataset['main']!['.tasks.wide.output']!.mode.kind, 'too-large');
        assert.equal(api.calls.filter(c => c.startsWith('datasetGet main.tasks.features')).length, 0, 'an oversize value is never fetched');
    });

    test('no value yet → unset; the paged key search goes to the server; a hash mismatch refetches the status', async () => {
        const { api, store, loader } = setup();
        api.task('main', { name: 'dashboard', status: variant('ready', null), inputs: [], dependsOn: [] });
        await loader.tick('main', '.tasks.dashboard.output');
        assert.equal(store.getState().data.dataset['main']!['.tasks.dashboard.output']!.mode.kind, 'unset');
        const { type, value } = dictOf(1_200);
        api.task('main', { name: 'forecast', status: ready, inputs: [], dependsOn: [], output: { type, value } });
        await loader.tick('main', FORECAST);
        await settle();
        assert.deepEqual(await loader.findKey('main', FORECAST, { prefix: 'k015' }), { found: true, row: 150, count: 10 });
        assert.ok(api.calls.some(c => c.startsWith(`datasetFindKey main${FORECAST}`)));
        // The value changes underneath a page request: the stale hash is refused, the status refetched.
        const before = store.getState().data.dataset['main']![FORECAST]!.hash;
        api.store('main', FORECAST, type, dictOf(900).value);
        loader.needRows('main', FORECAST, 1_000, 1_001);
        await settle();
        await settle();
        const d = store.getState().data.dataset['main']![FORECAST]!;
        assert.notEqual(d.hash, before);
        assert.equal(d.mode.kind === 'paged' && d.mode.totalRows, 900);
    });
});
