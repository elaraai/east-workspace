/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { completionCandidates } from './complete.js';

/**
 * The static branches of `completionCandidates` are exercised here.
 * Dynamic branches (workspace/dataset path lookups) hit storage or the API,
 * which is covered by integration tests.
 */

describe('completionCandidates — static', () => {
  it('returns top-level commands when cword=0', async () => {
    const c = await completionCandidates('0', ['']);
    assert.ok(c.includes('dataset'));
    assert.ok(c.includes('workspace'));
    assert.ok(c.includes('completion'));
  });

  it('filters top-level commands by prefix', async () => {
    const c = await completionCandidates('0', ['dat']);
    assert.deepStrictEqual(c, ['dataset', 'dataflow']);
  });

  it('returns nothing for unknown numeric cword string', async () => {
    assert.deepStrictEqual(await completionCandidates('xyz', []), []);
    assert.deepStrictEqual(await completionCandidates('-1', []), []);
  });

  it('returns subcommands for a known noun at cword=1', async () => {
    const c = await completionCandidates('1', ['dataset', '']);
    assert.deepStrictEqual(c.sort(), ['find', 'get', 'list', 'set', 'status']);
  });

  it('filters subcommands by prefix', async () => {
    const c = await completionCandidates('1', ['dataset', 'g']);
    assert.deepStrictEqual(c, ['get']);
  });

  it('returns empty for unknown noun at cword=1', async () => {
    assert.deepStrictEqual(await completionCandidates('1', ['nosuch', '']), []);
  });

  it('suggests format enum after --format', async () => {
    const c = await completionCandidates('5', ['dataset', 'get', '.', 'dev.greet', '--format', '']);
    assert.deepStrictEqual(c, ['east', 'json', 'beast2']);
  });

  it('filters format enum by prefix', async () => {
    const c = await completionCandidates('5', ['dataset', 'get', '.', 'dev.greet', '--format', 'j']);
    assert.deepStrictEqual(c, ['json']);
  });

  it('suggests repo seeds at the repo slot', async () => {
    const c = await completionCandidates('2', ['dataset', 'get', '']);
    assert.ok(c.includes('.'));
    assert.ok(c.includes('http://'));
    assert.ok(c.includes('https://'));
  });

  it('filters repo seeds by prefix', async () => {
    const c = await completionCandidates('2', ['dataset', 'get', 'http']);
    assert.deepStrictEqual(c.sort(), ['http://', 'https://']);
  });

  it('returns empty when no rule matches a position', async () => {
    // cword beyond known shape and no special rule
    const c = await completionCandidates('5', ['convert', 'file.east', '--from', 'east', '--to', '']);
    assert.deepStrictEqual(c, []);
  });
});
