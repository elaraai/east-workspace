/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Mouse frame specs — SGR reports through Ink's stdin: a click selects a
 * dashboard row, the wheel scrolls the pane under the cursor, a click on a
 * tree row selects it and on its twist toggles it, a drag on the thumb
 * scrolls proportionally, clicks on tabs / crumbs / pills / completion
 * rows act like the keys, and `--no-mouse` ignores reports.
 */

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { IntegerType, variant } from '@elaraai/east';
import { dictOf, fakeRepo, type FakeApi } from '../api.fake.js';
import { taskView } from '../state/actions.js';
import { dashboardView, mountApp, type Mounted } from '../testing/harness.js';

let mounted: Mounted | null = null;
afterEach(() => { mounted?.unmount(); mounted = null; });

/** An SGR report (1-based cells). */
const sgr = (code: number, x: number, y: number, release = false): string => `\x1b[<${code};${x};${y}${release ? 'm' : 'M'}`;
const click = (x: number, y: number): string => sgr(0, x, y);
const wheelDown = (x: number, y: number): string => sgr(65, x, y);
const wheelUp = (x: number, y: number): string => sgr(64, x, y);

function repo(): FakeApi {
    const api = fakeRepo();
    for (let i = 0; i < 40; i++) api.task('main', { name: `task${String(i).padStart(2, '0')}`, status: variant('ready', null), inputs: ['.inputs.a'], dependsOn: [] });
    api.task('main', { name: 'forecast', status: variant('up-to-date', { cached: true }), inputs: [], dependsOn: [], output: dictOf(1_200) });
    api.input('main', { name: 'a', type: IntegerType, value: 1n });
    return api;
}

describe('mouse', () => {
    test('a click selects a dashboard row; the wheel scrolls the column; the pill and a completion row act', async () => {
        mounted = await mountApp({ api: repo(), feeds: true, mouse: true, view: dashboardView() });
        await mounted.waitFor(() => /task05/.test(mounted!.frame()));
        const y = mounted.lines().findIndex(l => /^\s+task05\b/.test(l));
        assert.ok(y > 0);
        await mounted.press(click(5, y + 1));
        assert.match(mounted.lines()[y]!, /^ ▌task05/);
        const listTop = (): number => { const v = mounted!.store.getState().view; return v.kind === 'dashboard' ? v.list.top : -1; };
        await mounted.press(wheelDown(5, y + 1));
        assert.equal(listTop(), 3);
        await mounted.press(wheelUp(5, y + 1));
        assert.equal(listTop(), 0);
        // The connection pill is flush right on row 0: a click on it polls now.
        await mounted.press(click(110, 1));
        assert.match(mounted.lines()[33]!, /polling every feed now/);
        // A completion row above the box runs that candidate.
        await mounted.type('/task fore');
        const n = mounted.store.getState().command.completion?.items.length ?? 0;
        assert.ok(n >= 1);
        await mounted.press(click(5, 32 - n + 1));
        assert.equal(mounted.store.getState().view.kind, 'task');
    });

    test('tree rows: click selects, a click on the twist toggles, the wheel scrolls, the thumb drags', async () => {
        mounted = await mountApp({ api: repo(), feeds: true, mouse: true, view: taskView('main', 'forecast') });
        await mounted.waitFor(() => /k0002/.test(mounted!.frame()));
        assert.match(mounted.lines()[35]!, /wheel · drag █$/);
        await mounted.press(click(10, 14));
        assert.match(mounted.lines()[13]!, /^▌▾ k0002/);
        await mounted.press(click(2, 14));
        assert.match(mounted.lines()[13]!, /^▌▸ k0002/);
        await mounted.press(click(2, 14));
        assert.match(mounted.lines()[13]!, /^▌▾ k0002/);
        await mounted.press(wheelDown(40, 20));
        assert.match(mounted.lines()[31]!, /^ rows 4–29 of/);
        const treeTop = (): number => { const v = mounted!.store.getState().view; return v.kind === 'task' ? v.tree.top : -1; };
        assert.equal(treeTop(), 3);
        // Press on the scrollbar column near the top of the track, drag to its bottom.
        await mounted.press(click(120, 7));
        await mounted.press(sgr(32, 120, 31));
        await mounted.press(sgr(0, 120, 31, true));
        await mounted.waitFor(() => /k1199/.test(mounted!.frame()));
        assert.match(mounted.lines()[31]!, /^ rows [\d,]+–4,800 of 4,800/);
    });

    test('tabs, crumbs', async () => {
        mounted = await mountApp({ api: repo(), feeds: true, mouse: true, view: taskView('main', 'forecast') });
        await mounted.waitFor(() => /k0000/.test(mounted!.frame()));
        await mounted.press(click(27, 3));
        assert.match(mounted.lines()[2]!, /▌2 Stdout▐/);
        await mounted.press(click(15, 3));
        assert.match(mounted.lines()[2]!, /▌1 Output▐/);
        await mounted.press(click(21, 1));
        assert.equal(mounted.store.getState().view.kind, 'dashboard');
        await mounted.press(click(10, 1));
        assert.equal(mounted.store.getState().view.kind, 'workspaces');
    });

    test('with mouse reporting off, reports are dropped and never typed', async () => {
        mounted = await mountApp({ api: repo(), feeds: true, view: taskView('main', 'forecast') });
        await mounted.waitFor(() => /k0002/.test(mounted!.frame()));
        assert.doesNotMatch(mounted.lines()[35]!, /wheel/);
        await mounted.press(click(10, 14));
        assert.match(mounted.lines()[5]!, /^▌▾ k0000/);
        assert.equal(mounted.store.getState().command.mode, 'idle');
    });
});
