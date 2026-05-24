/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatcher } from './find.js';

function matchAll(pattern: string, names: string[]): string[] {
  const m = makeMatcher(pattern);
  return names.filter(m);
}

describe('makeMatcher', () => {
  it('empty pattern matches nothing', () => {
    assert.deepStrictEqual(matchAll('', ['anything', 'else']), []);
  });

  it('plain pattern does literal substring match', () => {
    assert.deepStrictEqual(
      matchAll('dev', ['developer', 'devops', 'production']),
      ['developer', 'devops'],
    );
  });

  it('plain pattern does NOT treat regex meta-chars as regex', () => {
    // dot is regex-meta but as a substring pattern it must match literally
    assert.deepStrictEqual(matchAll('data.csv', ['data.csv', 'dataXcsv']), ['data.csv']);
  });

  it('glob `*` expands to "any sequence"', () => {
    assert.deepStrictEqual(
      matchAll('*output*', ['greet.output', 'shout.output', 'input.name']),
      ['greet.output', 'shout.output'],
    );
  });

  it('glob `?` expands to "any single character"', () => {
    assert.deepStrictEqual(
      matchAll('?reet', ['greet', 'treet', 'greeting']),
      ['greet', 'treet'],
    );
  });

  it('glob anchors at both ends (no implicit substring)', () => {
    // 'foo' without globs is substring; 'foo' as glob would be anchored.
    // We only enable anchored mode when the pattern contains * or ?.
    assert.deepStrictEqual(matchAll('foo*', ['foo', 'foobar', 'xfoo']), ['foo', 'foobar']);
    assert.deepStrictEqual(matchAll('*foo', ['foo', 'foobar', 'xfoo']), ['foo', 'xfoo']);
  });

  it('escapes regex meta-chars inside a glob pattern', () => {
    // Pattern: 'data.csv*' — the dot must remain literal even in glob mode.
    assert.deepStrictEqual(
      matchAll('data.csv*', ['data.csv', 'data.csv.bak', 'dataXcsv']),
      ['data.csv', 'data.csv.bak'],
    );
  });

  it('escapes brackets and parens inside a glob pattern', () => {
    assert.deepStrictEqual(
      matchAll('(a)*', ['(a)', '(a)1', 'a']),
      ['(a)', '(a)1'],
    );
  });
});
