/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Frame specs for the task view's Output tab (mocks S08, S08b, S09): the
 * title lines, a paged value's rows and placeholders, the tree keys,
 * `/goto`, `/find` with n / N / esc, `/save`, the no-output / too-large /
 * not-indexed states, an inline value, and the persisted expand-set.
 */

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { FloatType, IntegerType, StringType, StructType, variant } from '@elaraai/east';
import { dictOf, fakeRepo, type FakeApi } from '../../api.fake.js';
import { INLINE_LIMIT } from '../../data/dataset.js';
import { createPersister, emptyState } from '../../state/persist.js';
import { taskView } from '../../state/actions.js';
import { KEY, mountApp, type Mounted } from '../../testing/harness.js';

let mounted: Mounted | null = null;
afterEach(() => { mounted?.unmount(); mounted = null; });

/** The fixture: a paged Dict, an inline Struct, no output, an oversize String, a legacy blob. */
function repo(): FakeApi {
    const api = fakeRepo();
    const up = variant('up-to-date', { cached: true });
    api.task('main', { name: 'forecast', status: up, inputs: [], dependsOn: ['features'], output: dictOf(1_200) });
    api.task('main', { name: 'params', status: variant('up-to-date', { cached: false }), inputs: [], dependsOn: [], output: { type: StructType({ horizon: IntegerType, smoothing: FloatType }), value: { horizon: 14n, smoothing: 0.35 } } });
    api.task('main', { name: 'dashboard', status: variant('ready', null), inputs: [], dependsOn: [] });
    api.task('main', { name: 'features', status: up, inputs: [], dependsOn: [], output: { type: StringType, value: randomBytes(INLINE_LIMIT * 2).toString('base64') } });
    api.task('main', { name: 'ingest', status: up, inputs: [], dependsOn: [], output: dictOf(30), notIndexed: true });
    return api;
}

const treeShown = (m: Mounted, label: string) => () => m.lines().some(l => l.includes(label));

describe('the task view — Output', () => {
    test('a paged Dict: the title lines, the first rows, the footer, the hints (S08)', async () => {
        const api = repo();
        mounted = await mountApp({ api, feeds: true, view: taskView('main', 'forecast') });
        await mounted.waitFor(treeShown(mounted, 'k0000'));
        const lines = mounted.lines();
        assert.match(lines[0]!, /^ e3-ui  demo-repo › main › forecast\s+● CONNECTED$/);
        assert.match(lines[2]!, /^ forecast   ▌1 Output▐  2 Stdout   3 Stderr   4 Runs\s+DATA TASK · ● UP-TO-DATE · cached$/);
        assert.match(lines[3]!, /^ \.tasks\.forecast\.output · Dict<String, Struct> · 1,200 entries · [\d.]+ KB · [0-9a-f]{12}$/);
        assert.match(lines[4]!, /^┄+$/);
        assert.match(lines[5]!, /^▌▾ k0000\s+Bakery · 2025-09-01 00:00:00 · 1000\s+▲$/);
        assert.match(lines[6]!, /^   · Store\s+"Bakery"\s+[█│]$/);
        assert.match(lines[7]!, /^   · Day\s+2025-09-01 00:00:00\s+[█│]$/);
        assert.match(lines[8]!, /^   · Units\s+1000\s+[█│]$/);
        assert.match(lines[9]!, /^ ▾ k0001\s+Deli · 2025-09-02 00:00:00 · 1037/);
        assert.match(lines[31]!, /^ rows 1–26 of [\d,]+ · 0\.\d\d%.*▾ expand all  ▸ collapse all  s save \.beast2$/);
        assert.match(lines[35]!, /^ ↑↓ move   → expand   ← collapse   \/find <key>   \/goto <row\|%>   s save   2 stdout  3 stderr  4 runs$/);
        // Unloaded pages show as placeholders past the loaded window.
        await mounted.press('G');
        await mounted.waitFor(() => /k1199/.test(mounted!.frame()));
        assert.match(mounted.lines()[31]!, /^ rows [\d,]+–4,800 of 4,800/);
        await mounted.press('g');
        await mounted.press('g');
        assert.match(mounted.lines()[5]!, /^▌▾ k0000/);
    });

    test('tree keys: collapse / expand, to the parent, deep collapse, page moves', async () => {
        mounted = await mountApp({ api: repo(), feeds: true, view: taskView('main', 'forecast') });
        await mounted.waitFor(treeShown(mounted, 'k0000'));
        await mounted.press(KEY.left);
        assert.match(mounted.lines()[5]!, /^▌▸ k0000/);
        assert.match(mounted.lines()[6]!, /^ ▾ k0001/);
        await mounted.press(KEY.right);
        assert.match(mounted.lines()[5]!, /^▌▾ k0000/);
        await mounted.press(KEY.right);
        assert.match(mounted.lines()[6]!, /^▌  · Store/);
        await mounted.press('h');
        assert.match(mounted.lines()[5]!, /^▌▾ k0000/);
        await mounted.press(' ');
        assert.match(mounted.lines()[5]!, /^▌▸ k0000/);
        await mounted.press(KEY.enter);
        assert.match(mounted.lines()[5]!, /^▌▾ k0000/);
        await mounted.press(KEY.shiftLeft);
        assert.match(mounted.lines()[5]!, /^▌▸ k0000/);
        await mounted.press(KEY.pageDown);
        assert.match(mounted.lines()[30]!, /^▌/);
        await mounted.press(KEY.pageUp);
        assert.match(mounted.lines()[5]!, /^▌/);
        await mounted.press('j');
        await mounted.press('k');
        assert.match(mounted.lines()[5]!, /^▌▸ k0000/);
    });

    test('/goto by row and by percent lands the row two lines below the top', async () => {
        mounted = await mountApp({ api: repo(), feeds: true, view: taskView('main', 'forecast') });
        await mounted.waitFor(treeShown(mounted, 'k0000'));
        await mounted.type('/goto 600');
        await mounted.press(KEY.enter);
        await mounted.waitFor(() => /^▌▾ k0599/.test(mounted!.lines()[7] ?? ''));
        await mounted.type('/goto 50%');
        await mounted.press(KEY.enter);
        await mounted.waitFor(() => /^▌▾ k0600/.test(mounted!.lines()[7] ?? ''));
        await mounted.type('/goto 5000');
        await mounted.press(KEY.enter);
        assert.match(mounted.lines()[33]!, /row 5,000 is past the end — 1,200 rows/);
    });

    test('/find: prefix and exact matches held until esc, n / N step, a miss toasts (S08b)', async () => {
        mounted = await mountApp({ api: repo(), feeds: true, view: taskView('main', 'forecast') });
        await mounted.waitFor(treeShown(mounted, 'k0000'));
        await mounted.type('/find k015');
        await mounted.press(KEY.enter);
        await mounted.waitFor(() => /^▌▾ k0150/.test(mounted!.lines()[7] ?? ''));
        assert.match(mounted.lines()[33]!, /^ ›  ◔ prefix · 10 matches from row 151 · n N next\/prev · esc$/);
        assert.match(mounted.lines()[31]!, /match held until esc/);
        await mounted.press('n');
        await mounted.waitFor(() => /^▌▾ k0151/.test(mounted!.lines()[7] ?? ''));
        await mounted.press('N');
        await mounted.waitFor(() => /^▌▾ k0150/.test(mounted!.lines()[7] ?? ''));
        await mounted.press(KEY.escape);
        assert.doesNotMatch(mounted.lines()[31]!, /match held/);
        assert.equal(mounted.store.getState().view.kind, 'task', 'esc clears the match before going back');
        await mounted.type('/find "k0007"');
        await mounted.press(KEY.enter);
        await mounted.waitFor(() => /^▌▾ k0007/.test(mounted!.lines()[7] ?? ''));
        assert.match(mounted.lines()[33]!, /exact · 1 match from row 8/);
        await mounted.type('/find zzz');
        await mounted.press(KEY.enter);
        await mounted.waitFor(() => /no prefix match for zzz/.test(mounted!.lines()[33] ?? ''));
    });

    test('/save writes the stored bytes and asks before overwriting', async () => {
        const scratch = fs.mkdtempSync(path.join(tmpdir(), 'e3-ui-save-'));
        try {
            const api = repo();
            mounted = await mountApp({ api, feeds: true, view: taskView('main', 'forecast') });
            await mounted.waitFor(treeShown(mounted, 'k0000'));
            const file = path.join(scratch, 'forecast.beast2');
            await mounted.type(`/save ${file}`);
            await mounted.press(KEY.enter);
            await mounted.waitFor(() => fs.existsSync(file));
            assert.equal(fs.statSync(file).size, api.stored('main', '.tasks.forecast.output')!.bytes.length);
            assert.match(mounted.lines()[33]!, new RegExp(`saved [\\d.]+ KB to ${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
            await mounted.type(`/save ${file}`);
            await mounted.press(KEY.enter);
            assert.match(mounted.lines()[33]!, /^ › overwrite .*forecast\.beast2\?\s+⏎ yes · esc no/);
            await mounted.press(KEY.enter);
            await mounted.waitFor(() => /saved/.test(mounted!.lines()[33] ?? ''));
        } finally {
            fs.rmSync(scratch, { recursive: true, force: true });
        }
    });

    test('states: no output yet, too large, not indexed with ⏎ load whole value, and an inline struct (S09)', async () => {
        mounted = await mountApp({ api: repo(), feeds: true, view: taskView('main', 'dashboard') });
        await mounted.waitFor(() => /NO OUTPUT YET/.test(mounted!.frame()));
        assert.match(mounted.frame(), /○  NO OUTPUT YET/);
        assert.match(mounted.frame(), /dashboard has not produced a value/);
        assert.match(mounted.frame(), /r  run the dataflow/);
        assert.match(mounted.lines()[2]!, /DATA TASK · ○ READY$/);
        assert.match(mounted.lines()[35]!, /^ 2 stdout  3 stderr  4 runs   esc back/);
        mounted.controller.openTask('main', 'features');
        await mounted.waitFor(() => /TOO LARGE TO SHOW INLINE/.test(mounted!.frame()));
        assert.match(mounted.frame(), /features · String · [\d.]+ KB — not a collection, so it cannot be paged/);
        assert.match(mounted.frame(), /s  save to features\.beast2        e3 dataset get main\.features/);
        mounted.controller.openTask('main', 'ingest');
        await mounted.waitFor(() => /NOT INDEXED/.test(mounted!.frame()));
        assert.match(mounted.frame(), /ingest · this value predates paged storage \(dataset_not_indexed\)/);
        assert.match(mounted.frame(), /re-run the producing task to re-write it    s save    ⏎ load whole value \([\d.]+ (B|KB)\)/);
        await mounted.press(KEY.enter);
        await mounted.waitFor(treeShown(mounted, 'k0000'));
        assert.match(mounted.lines()[3]!, /^ \.tasks\.ingest\.output · Dict<String, Struct> · 30 entries/);
        assert.match(mounted.lines()[31]!, /^ rows 1–26 of 120/);
        mounted.controller.openTask('main', 'params');
        await mounted.waitFor(treeShown(mounted, 'Horizon'));
        assert.match(mounted.lines()[3]!, /^ \.tasks\.params\.output · Struct · \d+ B · [0-9a-f]{12}$/);
        assert.match(mounted.lines()[5]!, /^▌· Horizon\s+14\s*$/);
        assert.match(mounted.lines()[6]!, /^ · Smoothing\s+0\.35\s*$/);
        assert.match(mounted.lines()[31]!, /^ rows 1–2 of 2/);
    });

    test('the expand-set and top row are remembered per workspace and path', async () => {
        const scratch = fs.mkdtempSync(path.join(tmpdir(), 'e3-ui-tree-'));
        try {
            const persist = createPersister(path.join(scratch, 'state.json'), emptyState(), { debounceMs: 0 });
            mounted = await mountApp({ api: repo(), feeds: true, view: taskView('main', 'forecast'), persist });
            await mounted.waitFor(treeShown(mounted, 'k0000'));
            await mounted.press(KEY.left);
            await mounted.press('j');
            await mounted.press(KEY.left);
            assert.match(mounted.lines()[6]!, /^▌▸ k0001/);
            mounted.controller.openTask('main', 'params');
            await mounted.waitFor(treeShown(mounted, 'Horizon'));
            mounted.controller.openTask('main', 'forecast');
            await mounted.waitFor(treeShown(mounted, 'k0000'));
            assert.match(mounted.lines()[5]!, /^▌▸ k0000/);
            assert.match(mounted.lines()[6]!, /^ ▸ k0001/);
            assert.match(mounted.lines()[7]!, /^ ▾ k0002/);
            const trees = persist.state.repos['/home/u/demo-repo']?.trees ?? {};
            assert.deepEqual(Object.keys(trees), ['main:.tasks.forecast.output']);
            assert.deepEqual(trees['main:.tasks.forecast.output']?.open, { '{k0000}': false, '{k0001}': false });
        } finally {
            fs.rmSync(scratch, { recursive: true, force: true });
        }
    });
});
