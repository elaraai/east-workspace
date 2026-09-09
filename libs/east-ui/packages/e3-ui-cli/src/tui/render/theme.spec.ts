/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createTheme, detectColorLevel, toneColor } from './theme.js';

describe('detectColorLevel', () => {
    const depth = (n: number) => ({ isTTY: true, getColorDepth: () => n });

    test('NO_COLOR wins over everything', () => {
        assert.equal(detectColorLevel({ NO_COLOR: '1', FORCE_COLOR: '3' }, depth(24)), 0);
        assert.equal(detectColorLevel({ NO_COLOR: '' }, depth(24)), 3);
    });

    test('FORCE_COLOR overrides the stream', () => {
        assert.equal(detectColorLevel({ FORCE_COLOR: '0' }, depth(24)), 0);
        assert.equal(detectColorLevel({ FORCE_COLOR: '1' }, {}), 1);
        assert.equal(detectColorLevel({ FORCE_COLOR: '2' }, {}), 2);
        assert.equal(detectColorLevel({ FORCE_COLOR: '3' }, {}), 3);
        assert.equal(detectColorLevel({ FORCE_COLOR: '' }, {}), 1);
        assert.equal(detectColorLevel({ FORCE_COLOR: 'true' }, {}), 1);
        assert.equal(detectColorLevel({ FORCE_COLOR: 'false' }, depth(24)), 0);
    });

    test('the stream depth maps 1/4/8/24 bits to the four levels', () => {
        assert.equal(detectColorLevel({}, depth(1)), 0);
        assert.equal(detectColorLevel({}, depth(4)), 1);
        assert.equal(detectColorLevel({}, depth(8)), 2);
        assert.equal(detectColorLevel({}, depth(24)), 3);
    });

    test('without a depth the TERM / COLORTERM hints decide', () => {
        assert.equal(detectColorLevel({ COLORTERM: 'truecolor' }, {}), 3);
        assert.equal(detectColorLevel({ TERM: 'xterm-256color' }, {}), 2);
        assert.equal(detectColorLevel({ TERM: 'xterm' }, {}), 1);
        assert.equal(detectColorLevel({ TERM: 'dumb' }, {}), 0);
        assert.equal(detectColorLevel({}, {}), 0);
    });
});

describe('createTheme', () => {
    test('monochrome has no colours at all — bold / dim / inverse carry the meaning', () => {
        const theme = createTheme(0);
        for (const [key, value] of Object.entries(theme)) {
            if (key === 'level') continue;
            assert.equal(value, undefined, `${key} is undefined at level 0`);
        }
        assert.equal(toneColor(theme, 'pos'), undefined);
    });

    test('truecolor carries the design tokens; 256 and 16 colours approximate them', () => {
        assert.equal(createTheme(3).brand, '#488e97');
        assert.equal(createTheme(3).pos, '#2f7a5b');
        assert.equal(createTheme(3).neg, '#b85a4a');
        assert.equal(createTheme(3).warn, '#b8862d');
        assert.equal(createTheme(3).info, '#3a7780');
        assert.match(createTheme(2).brand ?? '', /^ansi256\(\d+\)$/);
        assert.equal(createTheme(1).brand, 'cyan');
        assert.equal(createTheme(1).neg, 'red');
        assert.equal(toneColor(createTheme(3), 'warn'), '#b8862d');
        assert.equal(toneColor(createTheme(3), 'plain'), undefined);
    });
});
