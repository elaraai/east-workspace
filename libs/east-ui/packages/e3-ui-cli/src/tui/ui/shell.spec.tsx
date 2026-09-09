/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Frame specs for the shell — the header, the command box in every mode
 * (idle / typing / completion / confirm / toast), the hint bar, the frame's
 * shape at several sizes, and the keys that work everywhere.
 */

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { KEY, dashboardView, frameShape, mountApp, type Mounted } from '../testing/harness.js';

let mounted: Mounted | null = null;
afterEach(() => { mounted?.unmount(); mounted = null; });

describe('the frame', () => {
    test('is exactly rows × columns at 120×36 and at 80×24', async () => {
        mounted = await mountApp({ view: dashboardView() });
        const shape = frameShape(mounted.frame());
        assert.equal(shape.rows, 36);
        assert.ok(shape.widths.every(w => w <= 120), `no line exceeds 120 cells: ${shape.widths}`);
        assert.equal(shape.widths[1], 120, 'the rule spans the width');
        await mounted.resize({ columns: 80, rows: 24 });
        const narrow = frameShape(mounted.frame());
        assert.equal(narrow.rows, 24);
        assert.ok(narrow.widths.every(w => w <= 80), `no line exceeds 80 cells: ${narrow.widths}`);
        assert.equal(narrow.widths[1], 80);
    });

    test('refuses below 60×16 with a one-line message', async () => {
        mounted = await mountApp({ view: dashboardView(), size: { columns: 58, rows: 14 } });
        assert.match(mounted.frame(), /terminal too small \(58×14\) — need 60×16/);
        await mounted.resize({ columns: 120, rows: 36 });
        assert.match(mounted.lines()[0]!, /^ e3-ui  demo-repo › main/);
    });
});

describe('the header', () => {
    test('shows the breadcrumb and the connection pill', async () => {
        mounted = await mountApp({ view: dashboardView() });
        const [header, rule] = mounted.lines();
        assert.match(header!, /^ e3-ui  demo-repo › main\s+● CONNECTED$/);
        assert.equal(rule, '─'.repeat(120));
    });

    test('shows the version instead of pills before a session opens', async () => {
        mounted = await mountApp({ session: null });
        assert.match(mounted.lines()[0]!, /^ e3-ui\s+v1\.0\.72$/);
    });

    test('shows reconnecting and offline, and the running pill', async () => {
        mounted = await mountApp({ view: dashboardView() });
        await mounted.dispatch({ type: 'connection', connection: { kind: 'reconnecting', attempt: 3, of: 4 } });
        assert.match(mounted.lines()[0]!, /◐ RECONNECTING 3\/4$/);
        await mounted.dispatch({ type: 'connection', connection: { kind: 'offline' } });
        assert.match(mounted.lines()[0]!, /✗ OFFLINE$/);
        await mounted.dispatch({ type: 'data/executionFlag', ws: 'main', settling: true });
        assert.match(mounted.lines()[0]!, /◔ RUNNING 0\/0 [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]  ✗ OFFLINE$/);
    });
});

describe('the command box', () => {
    test('idle shows the prompt and the hint', async () => {
        mounted = await mountApp({ view: dashboardView() });
        const lines = mounted.lines();
        assert.equal(lines[32], '─'.repeat(120));
        assert.match(lines[33]!, /^ › _\s+\/ commands · type a name to jump · \? help\s*$/);
        assert.equal(lines[34], '─'.repeat(120));
        assert.match(lines[35]!, /^ ↑↓ move   ⏎ open   r run   x stop   w workspaces   \/ commands\s*$/);
    });

    test('/ starts a command; typing shows completion rows above the box; tab completes; esc clears', async () => {
        mounted = await mountApp({ view: dashboardView() });
        await mounted.type('/ta');
        const lines = mounted.lines();
        const boxLine = lines.find(l => l.startsWith(' › /ta_'))!;
        assert.ok(boxLine, 'the box shows the typed text with the caret');
        assert.match(boxLine, /3 matches · ↑↓ pick · ⏎ open · tab complete/);
        const rows = lines.filter(l => /^ [▌ ] \/(task|tag|dataset)\s/.test(l));
        assert.equal(rows.length, 3);
        assert.match(rows[0]!, /^ ▌ \/task\s+<name>\s+open a task/);
        await mounted.press(KEY.tab);
        assert.ok(mounted.lines().some(l => l.startsWith(' › /task _')), 'tab inserted the command');
        await mounted.press(KEY.escape);
        assert.ok(mounted.lines().some(l => l.startsWith(' › _')), 'esc cleared the box');
    });

    test('a parse error shows in the box; an unknown command toasts on enter', async () => {
        mounted = await mountApp({ view: dashboardView() });
        await mounted.type('/bogus');
        assert.match(mounted.frame(), /unknown command \/bogus — \? for help/);
        await mounted.press(KEY.enter);
        assert.match(mounted.lines()[35]!, /^ ✗ unknown command \/bogus/);
        assert.match(mounted.lines()[33]!, /^ › \/bogus_/, 'the box keeps the text to fix');
    });

    test('a confirmation takes y / enter and esc / n', async () => {
        mounted = await mountApp({ view: dashboardView() });
        await mounted.dispatch({ type: 'command/confirm', confirm: { question: 'quit with 2 unsaved edits?', command: '/quit --force' } });
        assert.match(mounted.lines()[33]!, /^ › quit with 2 unsaved edits\?\s+⏎ yes · esc no$/);
        await mounted.press('j');
        assert.deepEqual(mounted.exits, []);
        await mounted.press(KEY.escape);
        assert.match(mounted.lines()[33]!, /^ › _/);
        await mounted.dispatch({ type: 'command/confirm', confirm: { question: 'quit?', command: '/quit --force' } });
        await mounted.press('y');
        assert.deepEqual(mounted.exits, [0]);
    });

    test('a toast shows in the command line for three seconds, then in the hint row while typing', async () => {
        let now = 1_000_000;
        mounted = await mountApp({ view: dashboardView(), now: () => now });
        mounted.controller.toast('Dataflow started · main · 6 tasks queued', 'pos');
        await mounted.dispatch({ type: 'pendingKey', key: null });
        assert.match(mounted.lines()[33]!, /^ ›  ● Dataflow started · main · 6 tasks queued\s*$/);
        await mounted.type('/');
        assert.match(mounted.lines()[35]!, /^ ● Dataflow started/);
        now += 4_000;
        // The frame's clock is sampled once a second, not per render: wait for its tick.
        await new Promise(resolve => setTimeout(resolve, 1_100));
        await mounted.dispatch({ type: 'pendingKey', key: 'g' });
        await mounted.dispatch({ type: 'pendingKey', key: null });
        assert.doesNotMatch(mounted.lines()[35]!, /Dataflow started/);
    });

    test('a plain word fuzzy-jumps: the completion lists kind, name, workspace and detail', async () => {
        mounted = await mountApp({ view: dashboardView(), actions: [{
            type: 'data/workspaces',
            workspaces: [
                { name: 'main', deployed: true, packageName: { type: 'some', value: 'demand' }, packageVersion: { type: 'some', value: '1.4.2' } },
                { name: 'staging', deployed: true, packageName: { type: 'some', value: 'demand' }, packageVersion: { type: 'some', value: '1.5.0-rc.1' } },
            ] as never,
        }] });
        await mounted.type('sta');
        const row = mounted.lines().find(l => /^ ▌ workspace\s+staging/.test(l));
        assert.ok(row, 'the jump row');
        assert.match(row!, /● DEPLOYED · demand@1\.5\.0-rc\.1/);
        assert.match(mounted.lines()[35]!, /type to jump anywhere · \/ for commands|↑↓ move/);
    });
});

describe('keys that work everywhere', () => {
    test('q quits, Ctrl-C quits, ? opens help on the page tab, esc goes back', async () => {
        mounted = await mountApp({ view: dashboardView() });
        await mounted.press('?');
        assert.match(mounted.lines()[2]!, /^ HELP\s+1 Everywhere\s+2 Repos\s+3 Workspaces\s+▌4 Dashboard▐/);
        await mounted.press('1');
        assert.match(mounted.lines()[2]!, /▌1 Everywhere▐/);
        await mounted.press(KEY.escape);
        assert.match(mounted.lines()[0]!, /demo-repo › main/);
        assert.equal(mounted.store.getState().view.kind, 'dashboard');
        await mounted.press(KEY.ctrlC);
        assert.deepEqual(mounted.exits, [0]);
        await mounted.press('q');
        assert.deepEqual(mounted.exits, [0, 0]);
    });

    test('/about and /help open as views; /quit exits; /refresh toasts', async () => {
        mounted = await mountApp({ view: dashboardView() });
        await mounted.type('/about');
        await mounted.press(KEY.enter);
        assert.match(mounted.frame(), /e3-ui 1\.0\.72/);
        assert.match(mounted.frame(), /server     embedded @elaraai\/e3-api-server 1\.0\.72 · http:\/\/127\.0\.0\.1:41823 · repo default/);
        assert.match(mounted.frame(), /repository \/home\/u\/demo-repo · 12,408 objects · 2 packages · 3 workspaces/);
        assert.match(mounted.frame(), /state      ~\/\.local\/state\/e3-ui\/state\.json/);
        await mounted.press(KEY.escape);
        await mounted.type('/help');
        await mounted.press(KEY.enter);
        assert.equal(mounted.store.getState().view.kind, 'help');
        await mounted.press(KEY.escape);
        await mounted.type('/refresh');
        await mounted.press(KEY.enter);
        assert.match(mounted.lines()[33]!, /polling every feed now/);
        await mounted.type('/quit');
        await mounted.press(KEY.enter);
        assert.deepEqual(mounted.exits, [0]);
    });

    test('quitting with pending edits asks first', async () => {
        mounted = await mountApp({ view: dashboardView(), actions: [{
            type: 'edit/set',
            edit: { ws: 'main', path: '.inputs.params', type: { type: 'Integer', value: null } as never, base: 1n, baseHash: 'a', ops: [{ kind: 'edit', path: [], leaf: { type: 'integer', value: 2n } }, { kind: 'insert', path: [] }], draft: 2n, root: { type: 'leaf', value: { type: 'integer', value: 2n } } as never, changed: ['$'], conflict: null, applying: false },
        }] });
        assert.match(mounted.lines()[0]!, /◆ 2 DIRTY  ● CONNECTED$/);
        await mounted.press('q');
        assert.deepEqual(mounted.exits, []);
        assert.match(mounted.lines()[33]!, /quit with 2 unsaved edits\?/);
        await mounted.press(KEY.enter);
        assert.deepEqual(mounted.exits, [0]);
    });
});
