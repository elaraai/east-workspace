/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseViewport, parsePositive, parseTaskPath, detectIrFormat, stripExt } from './shot.js';

test('parseViewport accepts WxH and bounds the dimensions', () => {
    assert.deepEqual(parseViewport('1280x900'), { width: 1280, height: 900 });
    assert.deepEqual(parseViewport(' 800x600 '), { width: 800, height: 600 });
    assert.throws(() => parseViewport('1280'), /Invalid --viewport/);
    assert.throws(() => parseViewport('1280X'), /Invalid --viewport/);
    assert.throws(() => parseViewport('0x0'), /1\.\.16384/);
    assert.throws(() => parseViewport('99999x10'), /1\.\.16384/);
});

test('parsePositive rejects non-positive / non-finite', () => {
    assert.equal(parsePositive('2', '--dpr'), 2);
    assert.throws(() => parsePositive('0', '--dpr'), /positive number/);
    assert.throws(() => parsePositive('-1', '--wait'), /positive number/);
    assert.throws(() => parsePositive('x', '--dpr'), /positive number/);
});

test('parseTaskPath splits on the first dot', () => {
    assert.deepEqual(parseTaskPath('main.dashboard'), { workspace: 'main', task: 'dashboard' });
    assert.deepEqual(parseTaskPath('ws.a.b'), { workspace: 'ws', task: 'a.b' });
    assert.throws(() => parseTaskPath('nodot'), /expected <workspace>\.<task>/);
    assert.throws(() => parseTaskPath('.task'), /expected <workspace>\.<task>/);
    assert.throws(() => parseTaskPath('ws.'), /expected <workspace>\.<task>/);
});

test('detectIrFormat accepts beast2/json and rejects ts', () => {
    assert.equal(detectIrFormat('x.beast2'), 'beast2');
    assert.equal(detectIrFormat('x.json'), 'json');
    assert.throws(() => detectIrFormat('x.tsx'), /use --from-source/);
    assert.throws(() => detectIrFormat('x.png'), /Cannot detect format/);
});

test('stripExt strips known extensions and the directory', () => {
    assert.equal(stripExt('/a/b/widget.tsx'), 'widget');
    assert.equal(stripExt('comp.beast2'), 'comp');
    assert.equal(stripExt('/x/ir.json'), 'ir');
});
