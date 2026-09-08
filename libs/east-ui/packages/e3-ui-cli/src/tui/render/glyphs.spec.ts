/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ASCII, UNICODE, localeIsUtf8, selectGlyphs } from './glyphs.js';
import { displayWidth } from './text.js';

describe('glyphs', () => {
    test('every unicode glyph the row math relies on is one cell wide', () => {
        for (const key of ['expanded', 'collapsed', 'leaf', 'dot', 'half', 'quarter', 'empty', 'cross', 'diamond', 'sel', 'tabL', 'tabR', 'rule', 'dashed', 'vbar', 'scrollUp', 'thumb', 'scrollDown', 'placeholder', 'loading', 'crumb', 'prompt', 'sep', 'edited', 'square', 'bullet', 'ellipsis', 'cursor'] as const) {
            assert.equal(displayWidth(UNICODE[key]), 1, `${key} is one cell`);
        }
        for (const frame of UNICODE.spinner) assert.equal(displayWidth(frame), 1);
        for (const bar of UNICODE.bars) assert.equal(displayWidth(bar), 1);
    });

    test('the ASCII set has the same shape and one-cell single-char markers', () => {
        assert.deepEqual(Object.keys(ASCII).sort(), Object.keys(UNICODE).sort());
        for (const key of ['expanded', 'collapsed', 'leaf', 'dot', 'sel', 'rule', 'dashed', 'vbar', 'scrollUp', 'thumb', 'scrollDown', 'placeholder', 'prompt', 'sep', 'cursor'] as const) {
            assert.equal(ASCII[key].length, 1, `${key} is one character`);
        }
    });

    test('localeIsUtf8 reads LC_ALL, LC_CTYPE, LANG in that order', () => {
        assert.equal(localeIsUtf8({}), true);
        assert.equal(localeIsUtf8({ LANG: 'en_AU.UTF-8' }), true);
        assert.equal(localeIsUtf8({ LANG: 'en_AU.utf8' }), true);
        assert.equal(localeIsUtf8({ LANG: 'C' }), true);
        assert.equal(localeIsUtf8({ LANG: 'en_US.ISO-8859-1' }), false);
        assert.equal(localeIsUtf8({ LANG: 'en_US.UTF-8', LC_ALL: 'C.latin1' }), false);
        assert.equal(localeIsUtf8({ LANG: 'en_US.latin1', LC_CTYPE: 'C.UTF-8' }), true);
    });

    test('selectGlyphs prefers unicode unless told otherwise', () => {
        assert.equal(selectGlyphs({ env: {} }), UNICODE);
        assert.equal(selectGlyphs({ ascii: true, env: {} }), ASCII);
        assert.equal(selectGlyphs({ env: { E3_UI_ASCII: '1' } }), ASCII);
        assert.equal(selectGlyphs({ env: { E3_UI_ASCII: '0' } }), UNICODE);
        assert.equal(selectGlyphs({ env: { TERM: 'linux' } }), ASCII);
        assert.equal(selectGlyphs({ env: { TERM: 'xterm-kitty' } }), UNICODE);
        assert.equal(selectGlyphs({ env: { LANG: 'en_US.ISO-8859-1' } }), ASCII);
    });
});
