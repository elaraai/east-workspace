/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { Key } from 'ink';
import { resolve, type KeyContext } from './keymap.js';

const key = (flags: Partial<Key> = {}): Key => ({
    upArrow: false, downArrow: false, leftArrow: false, rightArrow: false, pageDown: false, pageUp: false,
    home: false, end: false, return: false, escape: false, ctrl: false, shift: false, tab: false,
    backspace: false, delete: false, meta: false, super: false, hyper: false, capsLock: false, numLock: false,
    ...flags,
});
const ctx = (over: Partial<KeyContext> = {}): KeyContext => ({
    commandMode: 'idle', editingLeaf: false, scope: 'list', editable: false, tabs: 0, pendingKey: null, ...over,
});

describe('keymap: everywhere', () => {
    test('quit, help, back, refresh, tabs, pane cycling, slash', () => {
        assert.deepEqual(resolve('q', key(), ctx()), { kind: 'quit' });
        assert.deepEqual(resolve('c', key({ ctrl: true }), ctx({ commandMode: 'edit' })), { kind: 'quit' });
        assert.deepEqual(resolve('?', key(), ctx()), { kind: 'help' });
        assert.deepEqual(resolve('', key({ escape: true }), ctx()), { kind: 'back' });
        assert.deepEqual(resolve('', key({ backspace: true }), ctx()), { kind: 'back' });
        assert.deepEqual(resolve('R', key(), ctx()), { kind: 'refresh' });
        assert.equal(resolve('', key({ tab: true }), ctx()), null, 'no tabs, nothing to cycle');
        assert.deepEqual(resolve('', key({ tab: true }), ctx({ tabs: 3 })), { kind: 'tab.cycle', delta: 1 });
        assert.deepEqual(resolve('', key({ tab: true, shift: true }), ctx({ tabs: 3 })), { kind: 'tab.cycle', delta: -1 });
        // The arrows cycle tabs only where no content claims them.
        assert.deepEqual(resolve('', key({ rightArrow: true }), ctx({ tabs: 6, scope: 'none' })), { kind: 'tab.cycle', delta: 1 });
        assert.deepEqual(resolve('', key({ leftArrow: true }), ctx({ tabs: 4, scope: 'logs' })), { kind: 'tab.cycle', delta: -1 });
        assert.deepEqual(resolve('', key({ rightArrow: true }), ctx({ tabs: 4, scope: 'tree' })), { kind: 'expand' });
        assert.deepEqual(resolve('', key({ rightArrow: true }), ctx({ tabs: 4, scope: 'list' })), { kind: 'open' });
        assert.deepEqual(resolve('/', key(), ctx()), { kind: 'type', text: '/' });
        assert.deepEqual(resolve('2', key(), ctx({ tabs: 3 })), { kind: 'tab', index: 1 });
        assert.deepEqual(resolve('4', key(), ctx({ tabs: 3 })), { kind: 'type', text: '4' });
        assert.deepEqual(resolve('f', key(), ctx()), { kind: 'type', text: 'f' });
    });
});

describe('keymap: lists, trees, logs', () => {
    test('arrows and vim aliases move; gg / G jump', () => {
        assert.deepEqual(resolve('', key({ downArrow: true }), ctx()), { kind: 'move', op: 'down' });
        assert.deepEqual(resolve('j', key(), ctx()), { kind: 'move', op: 'down' });
        assert.deepEqual(resolve('k', key(), ctx()), { kind: 'move', op: 'up' });
        assert.deepEqual(resolve('', key({ pageDown: true }), ctx()), { kind: 'move', op: 'pageDown' });
        assert.deepEqual(resolve('u', key({ ctrl: true }), ctx()), { kind: 'move', op: 'pageUp' });
        assert.deepEqual(resolve('d', key({ ctrl: true }), ctx()), { kind: 'move', op: 'pageDown' });
        assert.deepEqual(resolve('G', key(), ctx()), { kind: 'move', op: 'end' });
        assert.deepEqual(resolve('g', key(), ctx()), { kind: 'pending', key: 'g' });
        assert.deepEqual(resolve('g', key(), ctx({ pendingKey: 'g' })), { kind: 'move', op: 'home' });
        assert.equal(resolve('x', key(), ctx({ pendingKey: 'g', scope: 'tree' })), null);
    });

    test('lists open on enter / right, and prefill run / stop / workspaces', () => {
        assert.deepEqual(resolve('', key({ return: true }), ctx()), { kind: 'open' });
        assert.deepEqual(resolve('l', key(), ctx()), { kind: 'open' });
        assert.deepEqual(resolve('r', key(), ctx()), { kind: 'prefill', text: '/run ' });
        assert.deepEqual(resolve('x', key(), ctx()), { kind: 'prefill', text: '/stop' });
        assert.deepEqual(resolve('w', key(), ctx()), { kind: 'prefill', text: '/workspaces' });
    });

    test('trees expand, collapse, toggle, deep-collapse, save, step matches', () => {
        const tree = ctx({ scope: 'tree' });
        assert.deepEqual(resolve('', key({ rightArrow: true }), tree), { kind: 'expand' });
        assert.deepEqual(resolve('h', key(), tree), { kind: 'collapse' });
        assert.deepEqual(resolve('', key({ leftArrow: true, shift: true }), tree), { kind: 'collapseDeep' });
        assert.deepEqual(resolve('', key({ return: true }), tree), { kind: 'toggle' });
        assert.deepEqual(resolve(' ', key(), tree), { kind: 'toggle' });
        assert.deepEqual(resolve('s', key(), tree), { kind: 'save' });
        assert.deepEqual(resolve('n', key(), tree), { kind: 'next' });
        assert.deepEqual(resolve('N', key(), tree), { kind: 'prev' });
        assert.deepEqual(resolve('e', key(), tree), { kind: 'type', text: 'e' });
    });

    test('editable trees add the editing keys and Enter applies', () => {
        const input = ctx({ scope: 'tree', editable: true });
        assert.deepEqual(resolve('e', key(), input), { kind: 'edit' });
        assert.deepEqual(resolve('a', key(), input), { kind: 'add' });
        assert.deepEqual(resolve('x', key(), input), { kind: 'remove' });
        assert.deepEqual(resolve('t', key(), input), { kind: 'tag' });
        assert.deepEqual(resolve('', key({ return: true }), input), { kind: 'apply' });
    });

    test('logs follow, save, copy, step matches (the streams are tabs, so `o` / `e` type a jump)', () => {
        const logs = ctx({ scope: 'logs' });
        assert.deepEqual(resolve('F', key(), logs), { kind: 'follow' });
        assert.deepEqual(resolve('e', key(), logs), { kind: 'type', text: 'e' });
        assert.deepEqual(resolve('s', key(), logs), { kind: 'save' });
        assert.deepEqual(resolve('c', key(), logs), { kind: 'copy' });
        assert.deepEqual(resolve('', key({ downArrow: true }), logs), { kind: 'move', op: 'down' });
    });

    test('a refusal screen retries on r', () => {
        assert.deepEqual(resolve('r', key(), ctx({ scope: 'none' })), { kind: 'retry' });
    });
});

describe('keymap: pasted text', () => {
    test('a multi-character chunk is typed into the box; a trailing newline submits', () => {
        assert.deepEqual(resolve('/about\r', key(), ctx()), { kind: 'paste', text: '/about', submit: true });
        assert.deepEqual(resolve('forecast', key(), ctx({ commandMode: 'edit' })), { kind: 'paste', text: 'forecast', submit: false });
        assert.equal(resolve('ab', key(), ctx({ commandMode: 'confirm' })), null);
        assert.deepEqual(resolve('ab', key(), ctx({ editingLeaf: true, scope: 'tree', editable: true })), { kind: 'leaf.char', text: 'ab' });
    });
});

describe('keymap: the command box and leaf editors', () => {
    test('editing the command box: submit, cancel, complete, history, cursor, chars', () => {
        const edit = ctx({ commandMode: 'edit' });
        assert.deepEqual(resolve('', key({ return: true }), edit), { kind: 'cmd.submit' });
        assert.deepEqual(resolve('', key({ escape: true }), edit), { kind: 'cmd.cancel' });
        assert.deepEqual(resolve('', key({ tab: true }), edit), { kind: 'cmd.complete' });
        assert.deepEqual(resolve('', key({ upArrow: true }), edit), { kind: 'cmd.up' });
        assert.deepEqual(resolve('n', key({ ctrl: true }), edit), { kind: 'cmd.down' });
        assert.deepEqual(resolve('', key({ leftArrow: true }), edit), { kind: 'cmd.left' });
        assert.deepEqual(resolve('a', key({ ctrl: true }), edit), { kind: 'cmd.home' });
        assert.deepEqual(resolve('', key({ end: true }), edit), { kind: 'cmd.end' });
        assert.deepEqual(resolve('', key({ backspace: true }), edit), { kind: 'cmd.backspace' });
        assert.deepEqual(resolve('', key({ delete: true }), edit), { kind: 'cmd.delete' });
        assert.deepEqual(resolve('u', key({ ctrl: true }), edit), { kind: 'cmd.cancel' });
        assert.deepEqual(resolve('q', key(), edit), { kind: 'cmd.char', text: 'q' });
        assert.deepEqual(resolve('fore', key(), edit), { kind: 'paste', text: 'fore', submit: false });
        assert.equal(resolve('', key({ pageUp: true }), edit), null);
    });

    test('a confirmation takes enter / y and esc / n only', () => {
        const confirm = ctx({ commandMode: 'confirm' });
        assert.deepEqual(resolve('', key({ return: true }), confirm), { kind: 'cmd.submit' });
        assert.deepEqual(resolve('y', key(), confirm), { kind: 'cmd.submit' });
        assert.deepEqual(resolve('', key({ escape: true }), confirm), { kind: 'cmd.cancel' });
        assert.deepEqual(resolve('n', key(), confirm), { kind: 'cmd.cancel' });
        assert.equal(resolve('j', key(), confirm), null);
    });

    test('a leaf editor owns the keys while open', () => {
        const leaf = ctx({ scope: 'tree', editable: true, editingLeaf: true });
        assert.deepEqual(resolve('', key({ return: true }), leaf), { kind: 'leaf.submit' });
        assert.deepEqual(resolve('', key({ escape: true }), leaf), { kind: 'leaf.cancel' });
        assert.deepEqual(resolve('7', key(), leaf), { kind: 'leaf.char', text: '7' });
        assert.deepEqual(resolve(' ', key(), leaf), { kind: 'leaf.toggle' });
        assert.deepEqual(resolve('', key({ backspace: true }), leaf), { kind: 'leaf.backspace' });
        assert.deepEqual(resolve('q', key(), leaf), { kind: 'leaf.char', text: 'q' });
    });
});
