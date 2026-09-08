/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isMouseInput, mouseSupported, parseSgr, MOUSE_OFF, MOUSE_ON } from './mouse.js';
import { hitAt, paneTopFromRow } from '../ui/frame.js';

describe('mouse', () => {
    test('parseSgr: presses, releases, drags, wheels, modifiers, with or without ESC, concatenated', () => {
        assert.deepEqual(parseSgr('[<0;12;5M'), [{ kind: 'press', button: 'left', x: 11, y: 4, shift: false, alt: false, ctrl: false }]);
        assert.deepEqual(parseSgr('\x1b[<0;12;5m'), [{ kind: 'release', button: 'left', x: 11, y: 4, shift: false, alt: false, ctrl: false }]);
        assert.deepEqual(parseSgr('[<32;40;20M')[0]?.kind, 'drag');
        assert.deepEqual(parseSgr('[<35;40;20M')[0], { kind: 'move', button: 'none', x: 39, y: 19, shift: false, alt: false, ctrl: false });
        assert.deepEqual(parseSgr('[<64;10;10M')[0]?.kind, 'wheelUp');
        assert.deepEqual(parseSgr('[<65;10;10M')[0]?.kind, 'wheelDown');
        assert.deepEqual(parseSgr('[<2;1;1M')[0]?.button, 'right');
        assert.deepEqual(parseSgr('[<1;1;1M')[0]?.button, 'middle');
        const mods = parseSgr('[<28;3;3M')[0]!;
        assert.deepEqual([mods.shift, mods.alt, mods.ctrl], [true, true, true]);
        assert.equal(parseSgr('[<65;3;3M[<65;3;4M').length, 2);
        assert.deepEqual(parseSgr('hello'), []);
    });

    test('isMouseInput accepts only whole mouse reports', () => {
        assert.equal(isMouseInput('[<0;12;5M'), true);
        assert.equal(isMouseInput('\x1b[<64;1;1M\x1b[<64;1;1M'), true);
        assert.equal(isMouseInput('/about\r'), false);
        assert.equal(isMouseInput('[<0;12;5Mx'), false);
    });

    test('mouseSupported needs a TTY that is not dumb; the sequences are the SGR trio', () => {
        assert.equal(mouseSupported({ TERM: 'xterm-kitty' }, { isTTY: true }), true);
        assert.equal(mouseSupported({ TERM: 'dumb' }, { isTTY: true }), false);
        assert.equal(mouseSupported({ TERM: 'xterm' }, { isTTY: false }), false);
        assert.equal(mouseSupported({}, {}), false);
        assert.equal(MOUSE_ON, '\x1b[?1000h\x1b[?1002h\x1b[?1006h');
        assert.equal(MOUSE_OFF, '\x1b[?1006l\x1b[?1002l\x1b[?1000l');
    });

    test('hitAt and the scrollbar drag arithmetic', () => {
        const frame = { layout: { columns: 120, rows: 36, bodyTop: 2, bodyRows: 30, commitRows: 0, completionRows: 0, commandTop: 32, hintRow: 35 }, hits: [{ row: 5, x0: 0, x1: 120, target: { kind: 'list' as const, index: 2 } }], pane: null };
        assert.deepEqual(hitAt(frame, 10, 5), { kind: 'list', index: 2 });
        assert.equal(hitAt(frame, 10, 6), null);
        const pane = { top: 5, rows: 26, total: 1000, visible: 26, scrollTop: 0 };
        assert.equal(paneTopFromRow(pane, 6), 0);
        assert.equal(paneTopFromRow(pane, 29), 974);
        assert.equal(paneTopFromRow(pane, 17), Math.round((11 / 23) * 974));
        assert.equal(paneTopFromRow(pane, 0), 0);
        assert.equal(paneTopFromRow(pane, 99), 974);
    });
});
