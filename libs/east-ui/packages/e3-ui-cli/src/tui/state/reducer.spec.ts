/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { dirtyCount, reduce } from './reducer.js';
import { initialState, taskView, type TuiState, type View } from './actions.js';

const size = { columns: 120, rows: 36 };
const start = (): TuiState => initialState(size, './demo');
const dashboard: View = { kind: 'dashboard', ws: 'main', list: { sel: 0, top: 0 } };

describe('reducer: views and history', () => {
    test('push records the previous view, pop restores it, pop at the root is a no-op', () => {
        let s = reduce(start(), { type: 'view/set', view: dashboard });
        assert.equal(s.history.length, 0);
        s = reduce(s, { type: 'view/push', view: taskView('main', 'forecast') });
        assert.equal(s.view.kind, 'task');
        assert.deepEqual(s.history.map(v => v.kind), ['dashboard']);
        s = reduce(s, { type: 'view/pop' });
        assert.equal(s.view.kind, 'dashboard');
        assert.equal(s.history.length, 0);
        assert.equal(reduce(s, { type: 'view/pop' }), s);
    });

    test('the launch step updates only while launching', () => {
        const s = reduce(start(), { type: 'view/launchStep', step: 'reading 3 workspaces' });
        assert.equal(s.view.kind === 'launch' && s.view.step, 'reading 3 workspaces');
        const later = reduce(reduce(s, { type: 'view/set', view: dashboard }), { type: 'view/launchStep', step: 'x' });
        assert.equal(later.view.kind, 'dashboard');
    });
});

describe('reducer: list navigation', () => {
    const at = (sel: number, top: number): TuiState => reduce(start(), { type: 'view/set', view: { kind: 'dashboard', ws: 'main', list: { sel, top } } });
    const list = (s: TuiState) => (s.view.kind === 'dashboard' ? s.view.list : null);

    test('up / down clamp to the rows and keep the selection visible', () => {
        let s = at(0, 0);
        s = reduce(s, { type: 'list/move', op: 'up', count: 10, visible: 4 });
        assert.deepEqual(list(s), { sel: 0, top: 0 });
        for (let i = 0; i < 5; i++) s = reduce(s, { type: 'list/move', op: 'down', count: 10, visible: 4 });
        assert.deepEqual(list(s), { sel: 5, top: 2 });
        for (let i = 0; i < 20; i++) s = reduce(s, { type: 'list/move', op: 'down', count: 10, visible: 4 });
        assert.deepEqual(list(s), { sel: 9, top: 6 });
    });

    test('page / home / end', () => {
        let s = at(0, 0);
        s = reduce(s, { type: 'list/move', op: 'pageDown', count: 100, visible: 10 });
        assert.deepEqual(list(s), { sel: 9, top: 0 });
        s = reduce(s, { type: 'list/move', op: 'pageDown', count: 100, visible: 10 });
        assert.deepEqual(list(s), { sel: 18, top: 9 });
        s = reduce(s, { type: 'list/move', op: 'end', count: 100, visible: 10 });
        assert.deepEqual(list(s), { sel: 99, top: 90 });
        s = reduce(s, { type: 'list/move', op: 'pageUp', count: 100, visible: 10 });
        assert.deepEqual(list(s), { sel: 90, top: 90 });
        s = reduce(s, { type: 'list/move', op: 'home', count: 100, visible: 10 });
        assert.deepEqual(list(s), { sel: 0, top: 0 });
    });

    test('an empty list resets, a shrunken list clamps the selection', () => {
        assert.deepEqual(list(reduce(at(5, 3), { type: 'list/move', op: 'down', count: 0, visible: 4 })), { sel: 0, top: 0 });
        assert.deepEqual(list(reduce(at(50, 40), { type: 'list/move', op: 'down', count: 10, visible: 4 })), { sel: 9, top: 6 });
    });

    test('select jumps and scrolls, scroll moves the window and drags the selection along', () => {
        assert.deepEqual(list(reduce(at(0, 0), { type: 'list/select', index: 42, count: 100, visible: 10 })), { sel: 42, top: 33 });
        assert.deepEqual(list(reduce(at(2, 0), { type: 'list/scroll', delta: 3, count: 100, visible: 10 })), { sel: 3, top: 3 });
        assert.deepEqual(list(reduce(at(50, 45), { type: 'list/scroll', delta: -3, count: 100, visible: 10 })), { sel: 50, top: 42 });
        assert.deepEqual(list(reduce(at(50, 95), { type: 'list/scroll', delta: 30, count: 100, visible: 10 })), { sel: 90, top: 90 });
    });

    test('a view without a primary list ignores navigation', () => {
        const s = reduce(start(), { type: 'view/set', view: { kind: 'about' } });
        assert.equal(reduce(s, { type: 'list/move', op: 'down', count: 5, visible: 5 }), s);
    });
});

describe('reducer: trees and tabs', () => {
    const inTask = (): TuiState => reduce(start(), { type: 'view/set', view: taskView('main', 'forecast') });
    const tree = (s: TuiState) => (s.view.kind === 'task' ? s.view.tree : null);

    test('toggle records the row, deep collapse closes descendants, expand/collapse all reset', () => {
        let s = reduce(inTask(), { type: 'tree/toggle', id: '[1]', expanded: true });
        assert.deepEqual(tree(s)!.open, { '[1]': true });
        s = reduce(s, { type: 'tree/toggle', id: '[1]', expanded: false, descendants: ['[1].a', '[1].b'] });
        assert.deepEqual(tree(s)!.open, { '[1]': false, '[1].a': false, '[1].b': false });
        s = reduce(s, { type: 'tree/expandAll' });
        assert.deepEqual(tree(s)!.open, {});
        assert.equal(tree(s)!.baseDepth, Number.MAX_SAFE_INTEGER);
        s = reduce(s, { type: 'tree/collapseAll' });
        assert.equal(tree(s)!.baseDepth, 0);
        s = reduce(s, { type: 'tree/restore', open: { x: true }, top: 12, baseDepth: undefined });
        assert.deepEqual(tree(s)!, { sel: 12, top: 12, open: { x: true }, baseDepth: undefined, match: null });
    });

    test('the tree is the primary list on the output tab, the runs list on the runs tab', () => {
        let s = reduce(inTask(), { type: 'list/move', op: 'down', count: 10, visible: 5 });
        assert.equal(tree(s)!.sel, 1);
        s = reduce(s, { type: 'task/tab', tab: 'runs' });
        s = reduce(s, { type: 'list/move', op: 'down', count: 10, visible: 5 });
        assert.equal(s.view.kind === 'task' && s.view.runs.sel, 1);
        assert.equal(tree(s)!.sel, 1);
        s = reduce(s, { type: 'runs/expand', expanded: true });
        assert.equal(s.view.kind === 'task' && s.view.runs.expanded, true);
    });

    test('logs state: stream switch resets scroll and follow, scroll and match update', () => {
        let s = reduce(inTask(), { type: 'logs/scroll', top: 40 });
        s = reduce(s, { type: 'logs/follow', follow: false });
        s = reduce(s, { type: 'logs/match', match: { text: 'Deli', index: 1 } });
        assert.deepEqual(s.view.kind === 'task' && s.view.logs, { stream: 'stdout', top: 40, follow: false, match: { text: 'Deli', index: 1 } });
        s = reduce(s, { type: 'logs/stream', stream: 'stderr' });
        assert.deepEqual(s.view.kind === 'task' && s.view.logs, { stream: 'stderr', top: 0, follow: true, match: null });
    });

    test('help tabs', () => {
        let s = reduce(start(), { type: 'view/set', view: { kind: 'help', tab: 'everywhere' } });
        s = reduce(s, { type: 'help/tab', tab: 'task' });
        assert.equal(s.view.kind === 'help' && s.view.tab, 'task');
    });
});

describe('reducer: command box', () => {
    test('typing inserts at the cursor; backspace, delete and cursor moves stay in range', () => {
        let s = reduce(start(), { type: 'command/insert', text: '/ta' });
        assert.deepEqual(s.command, { mode: 'edit', text: '/ta', cursor: 3, completion: null, confirm: null });
        s = reduce(s, { type: 'command/cursor', to: 'left' });
        s = reduce(s, { type: 'command/insert', text: 'X' });
        assert.equal(s.command.text, '/tXa');
        s = reduce(s, { type: 'command/backspace' });
        assert.equal(s.command.text, '/ta');
        s = reduce(s, { type: 'command/cursor', to: 'home' });
        s = reduce(s, { type: 'command/delete' });
        assert.equal(s.command.text, 'ta');
        s = reduce(s, { type: 'command/cursor', to: 'end' });
        assert.equal(s.command.cursor, 2);
        s = reduce(s, { type: 'command/cursor', to: 'right' });
        assert.equal(s.command.cursor, 2);
        s = reduce(s, { type: 'command/cursor', to: -5 });
        assert.equal(s.command.cursor, 0);
        s = reduce(s, { type: 'command/backspace' });
        assert.equal(s.command.text, 'ta');
    });

    test('edit prefills, completion cycles, clear returns to idle, confirm holds a question', () => {
        let s = reduce(start(), { type: 'command/edit', text: '/run --force' });
        assert.equal(s.command.cursor, 12);
        s = reduce(s, { type: 'command/completion', items: [
            { kind: 'task', insert: '/task a', cells: ['/task', 'a'] },
            { kind: 'task', insert: '/task b', cells: ['/task', 'b'] },
        ] });
        assert.equal(s.command.completion?.index, 0);
        s = reduce(s, { type: 'command/completionMove', delta: -1 });
        assert.equal(s.command.completion?.index, 1);
        s = reduce(s, { type: 'command/completionMove', delta: 1 });
        assert.equal(s.command.completion?.index, 0);
        s = reduce(s, { type: 'command/completion', items: [] });
        assert.equal(s.command.completion, null);
        s = reduce(s, { type: 'command/clear' });
        assert.equal(s.command.mode, 'idle');
        s = reduce(s, { type: 'command/confirm', confirm: { question: 'quit with 2 unsaved changes?', command: '/quit --force' } });
        assert.equal(s.command.mode, 'confirm');
        assert.equal(s.command.confirm?.command, '/quit --force');
        assert.equal(reduce(s, { type: 'command/backspace' }), s);
    });

    test('toasts replace and clear by id', () => {
        let s = reduce(start(), { type: 'toast', toast: { id: 1, text: 'a', tone: 'pos', until: 10 } });
        s = reduce(s, { type: 'toast', toast: { id: 2, text: 'b', tone: 'pos', until: 10 } });
        assert.equal(reduce(s, { type: 'toast/clear', id: 1 }), s);
        assert.equal(reduce(s, { type: 'toast/clear', id: 2 }).toast, null);
    });
});

describe('reducer: data', () => {
    test('status polls record the time and clear the error; errors record without touching the result', () => {
        const result = { workspace: 'main', lock: { type: 'none', value: null }, datasets: [], tasks: [], summary: { datasets: { total: 0n, unset: 0n, stale: 0n, upToDate: 0n }, tasks: { total: 0n, upToDate: 0n, ready: 0n, waiting: 0n, inProgress: 0n, failed: 0n, error: 0n, staleRunning: 0n } } } as never;
        let s = reduce(start(), { type: 'data/statusError', ws: 'main', error: 'ECONNREFUSED' });
        assert.equal(s.data.statusError['main'], 'ECONNREFUSED');
        s = reduce(s, { type: 'data/status', ws: 'main', result, at: 123 });
        assert.equal(s.data.status['main']?.at, 123);
        assert.equal(s.data.polledAt, 123);
        assert.equal(s.data.statusError['main'], undefined);
    });

    test('execution flags settle when the poll shows the run and clear stopping when it stops', () => {
        let s = reduce(start(), { type: 'data/executionFlag', ws: 'main', settling: true });
        assert.equal(s.data.execution['main']?.settling, true);
        const running = { status: { type: 'running', value: null }, startedAt: 't1', completedAt: { type: 'none', value: null }, summary: { type: 'none', value: null }, events: [], totalEvents: 0n } as never;
        s = reduce(s, { type: 'data/execution', ws: 'main', state: running, events: [], startedAt: 't1' });
        assert.equal(s.data.execution['main']?.settling, false);
        s = reduce(s, { type: 'data/executionFlag', ws: 'main', stopping: true });
        assert.equal(s.data.execution['main']?.stopping, true);
        const aborted = { ...(running as object), status: { type: 'aborted', value: null } } as never;
        s = reduce(s, { type: 'data/execution', ws: 'main', state: aborted, events: [], startedAt: 't1' });
        assert.equal(s.data.execution['main']?.stopping, false);
    });

    test('dirtyCount counts the draft ops', () => {
        assert.equal(dirtyCount(start()), 0);
    });
});
