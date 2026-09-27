/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Dataset loader specs — the inline / paged decision, the window (a drag
 * across the collection fetches only where it stops, two pages at a time,
 * retention held at every arrival), the page size from the bytes per row,
 * a server that cuts pages short, the byte cache, a content-hash change,
 * the not-indexed and too-large states, `⏎ load whole value`, key search
 * on both paths, a failed page's retry hold and the hash-mismatch refetch,
 * and a record's index as a source of its own, all over the in-memory API.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { FloatType, IntegerType, NullType, StringType, StructType, toEastTypeValue, variant } from '@elaraai/east';
import { ApiError } from '@elaraai/e3-api-client';
import { dictOf, fakeRepo, wideDictOf, type FakeApi } from '../api.fake.js';
import { recordSource } from '../model/tree.js';
import { initialState, type DatasetData } from '../state/actions.js';
import { createStore, type Store } from '../state/store.js';
import { createDatasetLoader, INLINE_LIMIT, MAX_INFLIGHT, MAX_RETAINED_PAGES, PAGE_BYTES_TARGET, PAGE_SIZE_MAX, PAGE_SIZE_MIN, pageSizeFor, type DatasetLoader } from './dataset.js';

const session = { kind: 'local' as const, label: 'demo-repo', repo: 'default', apiUrl: 'http://x', path: '/x', origin: null, identity: null, stateKey: '/x', target: '/x' };

function setup(retryAfterMs?: number): { api: FakeApi; store: Store; loader: DatasetLoader } {
    const api = fakeRepo();
    const store = createStore(initialState({ columns: 120, rows: 36 }, '/x'));
    store.dispatch({ type: 'session', session });
    const loader = createDatasetLoader({ store, api: () => api, retryAfterMs });
    return { api, store, loader };
}

const settle = async (): Promise<void> => {
    for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve));
};

/** Settles until nothing is wanted and missing (bounded). */
const quiet = async (store: Store, ws: string, path: string): Promise<void> => {
    for (let i = 0; i < 200; i++) {
        await settle();
        const d = store.getState().data.dataset[ws]?.[path];
        if (d?.mode.kind === 'paged' && d.mode.loading.length === 0) return;
    }
    assert.fail('the window never settled');
};

const paged = (d: DatasetData | undefined): Extract<DatasetData['mode'], { kind: 'paged' }> => {
    assert.equal(d?.mode.kind, 'paged');
    return d!.mode as Extract<DatasetData['mode'], { kind: 'paged' }>;
};

const ready = variant('up-to-date', { cached: false });
const FORECAST = '.tasks.forecast.output';
const pageCalls = (api: FakeApi): string[] => api.calls.filter(c => c.startsWith(`datasetGetPage main${FORECAST} `));

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

    test('a collection pages: the first window, then windows with retention and a byte cache; a new hash resets', async () => {
        const { api, store, loader } = setup();
        const { type, value } = dictOf(5_000);
        api.task('main', { name: 'forecast', status: ready, inputs: [], dependsOn: [], output: { type, value } });
        await loader.tick('main', FORECAST);
        await quiet(store, 'main', FORECAST);
        let d = paged(store.getState().data.dataset['main']![FORECAST]);
        assert.equal(d.totalRows, 5_000);
        assert.equal(d.pageSize, PAGE_SIZE_MAX, 'narrow rows page at the cap');
        assert.deepEqual([...d.pages.keys()].sort((a, b) => a - b), [0, 1], 'the first window plus one page of margin');
        assert.equal(d.pages.get(0)?.length, PAGE_SIZE_MAX);
        assert.equal(d.pages.get(0)?.[0]?.label, 'k0000');
        loader.needRows('main', FORECAST, 2_400, 2_600);
        await quiet(store, 'main', FORECAST);
        d = paged(store.getState().data.dataset['main']![FORECAST]);
        assert.deepEqual([...d.pages.keys()].sort((a, b) => a - b), [0, 1, 4, 5]);
        for (let p = 0; p < 10; p++) {
            loader.needRows('main', FORECAST, p * PAGE_SIZE_MAX, p * PAGE_SIZE_MAX + 1);
            await quiet(store, 'main', FORECAST);
        }
        d = paged(store.getState().data.dataset['main']![FORECAST]);
        const kept = [...d.pages.keys()].sort((a, b) => a - b);
        assert.ok(kept.length <= MAX_RETAINED_PAGES, `retained ${kept.length}`);
        assert.ok(kept.includes(9) && !kept.includes(0), `kept ${kept.join(',')}`);
        // Returning to an evicted page re-materializes from the byte cache: no second request.
        const fetches = () => api.calls.filter(c => c === `datasetGetPage main${FORECAST} 0+${PAGE_SIZE_MAX}`).length;
        assert.equal(fetches(), 1);
        loader.needRows('main', FORECAST, 0, 1);
        await quiet(store, 'main', FORECAST);
        d = paged(store.getState().data.dataset['main']![FORECAST]);
        assert.ok(d.pages.has(0));
        assert.equal(fetches(), 1);
        // A new value: pages reset, totals follow.
        api.store('main', FORECAST, type, dictOf(700).value);
        await loader.tick('main', FORECAST);
        await quiet(store, 'main', FORECAST);
        d = paged(store.getState().data.dataset['main']![FORECAST]);
        assert.equal(d.totalRows, 700);
        assert.deepEqual([...d.pages.keys()].sort((a, b) => a - b), [0, 1]);
    });

    test('a drag across the collection fetches only where it stops, two pages at a time; retention holds at every arrival', async () => {
        const { api, store, loader } = setup();
        const { type, value } = dictOf(20_000);
        api.task('main', { name: 'forecast', status: ready, inputs: [], dependsOn: [], output: { type, value } });
        await loader.tick('main', FORECAST);
        await quiet(store, 'main', FORECAST);
        const before = pageCalls(api).length;
        let peak = 0;
        const unsubscribe = store.subscribe(() => {
            const d = store.getState().data.dataset['main']?.[FORECAST];
            if (d?.mode.kind === 'paged') peak = Math.max(peak, d.mode.pages.size);
        });
        // The controller's thumb drag: one window per report, all before a page can land.
        const target = 10_000;
        const reports = 25;
        for (let i = 1; i <= reports; i++) {
            const top = Math.floor((target * i) / reports);
            loader.needRows('main', FORECAST, top - PAGE_SIZE_MAX, top + 36 + PAGE_SIZE_MAX);
        }
        await quiet(store, 'main', FORECAST);
        unsubscribe();
        const d = paged(store.getState().data.dataset['main']![FORECAST]);
        const first = Math.floor((target - PAGE_SIZE_MAX) / PAGE_SIZE_MAX);
        const last = Math.ceil((target + 36 + PAGE_SIZE_MAX) / PAGE_SIZE_MAX) - 1;
        const wanted = Array.from({ length: last - first + 1 }, (_, i) => first + i);
        for (const p of wanted) assert.ok(d.pages.has(p), `page ${p} of the destination window is loaded`);
        assert.ok(d.pages.size <= MAX_RETAINED_PAGES, `retained ${d.pages.size}`);
        assert.ok(peak <= MAX_RETAINED_PAGES, `peak retained ${peak}`);
        const issued = pageCalls(api).length - before;
        assert.ok(issued <= wanted.length + MAX_INFLIGHT, `${issued} page requests for a ${wanted.length}-page destination (at most ${MAX_INFLIGHT} in flight when the drag started)`);
        // Every request was for a page of the window current when it was issued — never for a position the drag had left by then.
        const offsets = pageCalls(api).slice(before).map(c => Number(c.split(' ').at(-1)!.split('+')[0]) / PAGE_SIZE_MAX);
        assert.ok(offsets.every(p => p <= last), `requested pages ${offsets.join(',')}`);
    });

    test('the page size follows the bytes per row: from the status geometry, else from one probe window', async () => {
        const { type, value } = wideDictOf(1_500, 2_000);
        for (const geometry of [true, false]) {
            const { api, store, loader } = setup();
            api.geometry = geometry;
            api.task('main', { name: 'forecast', status: ready, inputs: [], dependsOn: [], output: { type, value } });
            const bytes = api.stored('main', FORECAST)!.bytes.length;
            const expected = pageSizeFor(bytes, 1_500);
            assert.ok(expected > 1 && expected < PAGE_SIZE_MAX, `wide rows page below the cap (${expected})`);
            assert.ok(expected * (bytes / 1_500) <= PAGE_BYTES_TARGET, 'a page holds at most the byte target');
            await loader.tick('main', FORECAST);
            await quiet(store, 'main', FORECAST);
            const d = paged(store.getState().data.dataset['main']![FORECAST]);
            assert.equal(d.pageSize, expected, `geometry ${geometry}`);
            assert.equal(d.pages.get(0)?.length, expected);
            assert.equal(d.pages.get(1)?.[0]?.label, `k${String(expected).padStart(5, '0')}`, 'page 1 starts where page 0 ends');
            const calls = pageCalls(api);
            // With the geometry the first request is already page-sized; without it, one probe window of the head decides the size and seeds page 0 (no second request for it).
            assert.equal(calls[0], `datasetGetPage main${FORECAST} 0+${geometry ? expected : PAGE_SIZE_MAX}`);
            assert.equal(calls.filter(c => c.endsWith(' 0+' + String(expected)) || c.endsWith(' 0+' + String(PAGE_SIZE_MAX))).length, 1, 'page 0 is requested once');
        }
    });

    test('rows wider than the byte target covers sixteen of still page sixteen at a time', async () => {
        const { api, store, loader } = setup();
        api.geometry = true;
        const { type, value } = wideDictOf(200, 32_000);
        api.task('main', { name: 'forecast', status: ready, inputs: [], dependsOn: [], output: { type, value } });
        const bytes = api.stored('main', FORECAST)!.bytes.length;
        assert.ok(Math.floor(PAGE_BYTES_TARGET / (bytes / 200)) < PAGE_SIZE_MIN, 'the byte target alone would page fewer');
        assert.equal(pageSizeFor(bytes, 200), PAGE_SIZE_MIN);
        await loader.tick('main', FORECAST);
        await quiet(store, 'main', FORECAST);
        const d = paged(store.getState().data.dataset['main']![FORECAST]);
        assert.equal(d.pageSize, PAGE_SIZE_MIN);
        assert.equal(d.pages.get(0)?.length, PAGE_SIZE_MIN);
        // The first window, sixty rows and a page of margin, in five requests.
        assert.deepEqual(pageCalls(api).map(c => c.split(' ').at(-1)!).sort((a, b) => parseInt(a) - parseInt(b)),
            ['0+16', '16+16', '32+16', '48+16', '64+16']);
    });

    test('a server that cuts pages short by its byte budget: each page fills with follow-up windows', async () => {
        const { api, store, loader } = setup();
        const { type, value } = dictOf(1_200);
        api.pageRowCap = 200;
        api.task('main', { name: 'forecast', status: ready, inputs: [], dependsOn: [], output: { type, value } });
        await loader.tick('main', FORECAST);
        await quiet(store, 'main', FORECAST);
        let d = paged(store.getState().data.dataset['main']![FORECAST]);
        assert.equal(d.pageSize, PAGE_SIZE_MAX);
        assert.equal(d.pages.get(0)?.length, PAGE_SIZE_MAX, 'page 0 is whole');
        assert.equal(d.pages.get(1)?.length, PAGE_SIZE_MAX, 'page 1 is whole');
        assert.equal(d.pages.get(0)?.[499]?.label, 'k0499');
        assert.equal(d.pages.get(1)?.[0]?.label, 'k0500');
        // Two pages fill concurrently, so their windows interleave; each page's own windows continue from where the last ended.
        const windowsOf = (page: number): string[] => pageCalls(api).map(c => c.split(' ').at(-1)!).filter(w => Math.floor(Number(w.split('+')[0]) / PAGE_SIZE_MAX) === page);
        assert.deepEqual(windowsOf(0), ['0+500', '200+300', '400+100'], 'the rest of a page is asked for from where the window ended');
        assert.deepEqual(windowsOf(1), ['500+500', '700+300', '900+100']);
        loader.needRows('main', FORECAST, 1_000, 1_200);
        await quiet(store, 'main', FORECAST);
        d = paged(store.getState().data.dataset['main']![FORECAST]);
        assert.equal(d.pages.get(2)?.length, 200, 'the last page holds the rest');
        assert.deepEqual(pageCalls(api).slice(-1), [`datasetGetPage main${FORECAST} 1000+200`], 'a short last page is one window');
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

    test('a failed page waits out a hold before it is asked for again — never a loop', async () => {
        const { api, store, loader } = setup(30);
        const { type, value } = dictOf(5_000);
        api.task('main', { name: 'forecast', status: ready, inputs: [], dependsOn: [], output: { type, value } });
        await loader.tick('main', FORECAST);
        await quiet(store, 'main', FORECAST);
        const before = pageCalls(api).length;
        api.failWith = new ApiError('internal', { message: 'disk on fire' });
        loader.needRows('main', FORECAST, 3_000, 3_100);
        await settle();
        await settle();
        const failed = pageCalls(api).length - before;
        assert.equal(failed, 1, 'one attempt per page in the hold');
        assert.deepEqual(paged(store.getState().data.dataset['main']![FORECAST]).loading, [6], 'the page is still wanted');
        api.failWith = null;
        await new Promise(resolve => setTimeout(resolve, 60));
        await quiet(store, 'main', FORECAST);
        assert.ok(paged(store.getState().data.dataset['main']![FORECAST]).pages.has(6), 'retried after the hold');
        assert.equal(pageCalls(api).length - before, 2);
    });

    test('a hold that ends before the wall clock agrees is still asked again', async () => {
        // `setTimeout` counts on libuv's monotonic clock while the hold is
        // stamped from `Date.now`, so a retry timer can fire a hair before the
        // wall clock agrees the hold is over. The pump then found the page
        // still held, skipped it, and — since the failure had scheduled the
        // only timer — left nothing to ask again: the page stranded in
        // `loading` until the window next moved. In CI that read as "the
        // window never settled", about one run in a few dozen.
        //
        // Here the clock is held behind the timer so the race is certain
        // rather than occasional.
        const api = fakeRepo();
        const store = createStore(initialState({ columns: 120, rows: 36 }, '/x'));
        store.dispatch({ type: 'session', session });
        let now = 1_700_000_000_000;
        const loader = createDatasetLoader({ store, api: () => api, retryAfterMs: 5, now: () => now });
        const { type, value } = dictOf(5_000);
        api.task('main', { name: 'forecast', status: ready, inputs: [], dependsOn: [], output: { type, value } });
        await loader.tick('main', FORECAST);
        await quiet(store, 'main', FORECAST);

        api.failWith = new ApiError('internal', { message: 'disk on fire' });
        loader.needRows('main', FORECAST, 3_000, 3_100);
        await settle();
        await settle();
        assert.deepEqual(paged(store.getState().data.dataset['main']![FORECAST]).loading, [6], 'the page is held');

        // Real time passes — the timers fire — while the clock says the hold
        // still holds. Nothing may load, and nothing may give up either.
        api.failWith = null;
        await new Promise(resolve => setTimeout(resolve, 40));
        await settle();
        assert.deepEqual(paged(store.getState().data.dataset['main']![FORECAST]).loading, [6],
            'still held while the clock has not reached the hold');

        // The clock catches up: the re-armed pump asks again on its own, with
        // no window move to prompt it.
        now += 1_000;
        await quiet(store, 'main', FORECAST);
        assert.ok(paged(store.getState().data.dataset['main']![FORECAST]).pages.has(6),
            'the hold ended and the page was asked for again');
    });

    test('no value yet → unset; the paged key search goes to the server; a hash mismatch refetches the status', async () => {
        const { api, store, loader } = setup();
        api.task('main', { name: 'dashboard', status: variant('ready', null), inputs: [], dependsOn: [] });
        await loader.tick('main', '.tasks.dashboard.output');
        assert.equal(store.getState().data.dataset['main']!['.tasks.dashboard.output']!.mode.kind, 'unset');
        const { type, value } = dictOf(1_200);
        api.task('main', { name: 'forecast', status: ready, inputs: [], dependsOn: [], output: { type, value } });
        await loader.tick('main', FORECAST);
        await quiet(store, 'main', FORECAST);
        assert.deepEqual(await loader.findKey('main', FORECAST, { prefix: 'k015' }), { found: true, row: 150, count: 10 });
        assert.ok(api.calls.some(c => c.startsWith(`datasetFindKey main${FORECAST}`)));
        // The value changes underneath a page request: the stale hash is refused, the status refetched.
        const before = store.getState().data.dataset['main']![FORECAST]!.hash;
        api.store('main', FORECAST, type, dictOf(900).value);
        loader.needRows('main', FORECAST, 1_000, 1_001);
        await settle();
        await settle();
        await quiet(store, 'main', FORECAST);
        const d = store.getState().data.dataset['main']![FORECAST]!;
        assert.notEqual(d.hash, before);
        assert.equal(paged(d).totalRows, 900);
    });

    test('a record\'s index is a source of its own: entries labelled by its key, rows joined or projections shown, searched by its key', async () => {
        const { api, store, loader } = setup();
        api.geometry = true;
        const { type, value } = dictOf(300);
        api.record('main', {
            name: 'ledger',
            type,
            value,
            indexes: [
                { name: 'by_store', keyType: StringType, valueType: NullType, entries: (_key, row) => [{ ik: (row as { store: string }).store, value: null }] },
                { name: 'by_units', keyType: IntegerType, valueType: StringType, entries: (_key, row) => [{ ik: (row as { units: bigint }).units, value: (row as { store: string }).store }] },
            ],
        });
        const BY_STORE = recordSource('ledger', 'by_store');
        await loader.tick('main', BY_STORE);
        await quiet(store, 'main', BY_STORE);
        const d = store.getState().data.dataset['main']![BY_STORE]!;
        assert.deepEqual(d.index, { name: 'by_store', keyType: toEastTypeValue(StringType), join: true });
        assert.equal(paged(d).totalRows, 300, 'an entry a row');
        // The record's geometry counts its rows, not the index's entries: the index is probed, its rows joined.
        const calls = api.calls.filter(c => c.startsWith('datasetGetPage main.records.ledger '));
        assert.equal(calls[0], `datasetGetPage main.records.ledger 0+${PAGE_SIZE_MAX} #by_store+join`);
        assert.ok(calls.every(c => c.endsWith(' #by_store+join')), 'every window reads through the index');
        const first = paged(d).pages.get(0)![0]!;
        assert.equal(first.label, 'Bakery', 'labelled by its index key');
        assert.deepEqual(first.node.type === 'struct' ? first.node.value.fields.map(f => f.name) : [], ['key', 'row']);
        const row = first.node.type === 'struct' ? first.node.value.fields.find(f => f.name === 'row')?.node : undefined;
        assert.equal(row?.type, 'struct', 'the joined row, not the option the window carries it in');
        assert.equal(paged(d).pages.get(0)![100]?.label, 'Deli', 'in index order');
        assert.deepEqual(await loader.findKey('main', BY_STORE, { prefix: 'Deli' }), { found: true, row: 100, count: 100 });
        assert.ok(api.calls.some(c => c.startsWith('datasetFindKey main.records.ledger') && c.includes('"index":"by_store"')), 'the key search goes through the index');
        // An index with a projection shows it, and never asks for the rows.
        const BY_UNITS = recordSource('ledger', 'by_units');
        await loader.tick('main', BY_UNITS);
        await quiet(store, 'main', BY_UNITS);
        const u = store.getState().data.dataset['main']![BY_UNITS]!;
        assert.equal(u.index?.join, false);
        const cheapest = paged(u).pages.get(0)![0]!;
        assert.equal(cheapest.label, '1000');
        assert.deepEqual(cheapest.node.type === 'struct' ? cheapest.node.value.fields.map(f => f.name) : [], ['key', 'value']);
        assert.ok(api.calls.filter(c => c.includes(' #by_units')).every(c => !c.endsWith('+join')));
        // An index the record does not declare says so; /save of an index writes the record's rows.
        const NOPE = recordSource('ledger', 'nope');
        await loader.tick('main', NOPE);
        assert.deepEqual(store.getState().data.dataset['main']![NOPE]!.mode, { kind: 'error', message: 'ledger has no index nope' });
        const parts: Uint8Array[] = [];
        for await (const chunk of await loader.bytes('main', BY_STORE)) parts.push(chunk);
        assert.deepEqual(new Uint8Array(Buffer.concat(parts)), api.stored('main', '.records.ledger')!.bytes);
    });
});
