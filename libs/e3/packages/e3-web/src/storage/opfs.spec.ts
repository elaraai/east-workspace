/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The names OPFS files are given: every key's part and path's name escaped to
 * one no other escapes to, whatever case the file system folds. The adapters
 * themselves are held to their contract in Chromium, by
 * `browser/storage.spec.ts`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { escapeName, unescapeName } from './opfs.js';

describe('the names of OPFS files', () => {
  it('keeps lowercase letters, digits, underscores, hyphens and a dot after the first character', () => {
    assert.equal(escapeName('abc-012_xyz.beast2'), 'abc-012_xyz.beast2');
    assert.equal(escapeName('a.b..c'), 'a.b..c');
  });

  it('escapes every other character as the hex of its UTF-8 bytes', () => {
    assert.equal(escapeName('Case'), '%43ase');
    assert.equal(escapeName('.'), '%2E');
    assert.equal(escapeName('..'), '%2E.');
    assert.equal(escapeName('.hidden'), '%2Ehidden');
    assert.equal(escapeName('%41'), '%2541');
    assert.equal(escapeName('~'), '%7E');
    assert.equal(escapeName('a/b\\c'), 'a%2Fb%5Cc');
    assert.equal(escapeName("!'()*"), '%21%27%28%29%2A');
    assert.equal(escapeName('é'), '%C3%A9');
    assert.equal(escapeName('😀'), '%F0%9F%98%80');
    assert.equal(escapeName('nul\u0000'), 'nul%00');
  });

  it('gives names that differ even where a file system folds case', () => {
    const parts = ['Case', 'case', 'CASE', 'J', 'j', '%4A', '%4a', 'é', 'É', 'ß', 'SS'];
    const folded = parts.map((part) => escapeName(part).toLowerCase());
    assert.equal(new Set(folded).size, parts.length, folded.join(' '));
  });

  it('unescapes every name it gives, and no other', () => {
    for (const part of ['abc', 'Case', '.', '..', '%41', '~', 'a/b', 'é', '日本', 'emoji 😀', 'nul\u0000']) {
      assert.equal(unescapeName(escapeName(part)), part);
    }
    assert.equal(unescapeName('%41'), 'A');
    for (const name of ['A', '%4a', '.x', '~', 'a~', '%', '%E0%A4%A', '']) {
      assert.equal(unescapeName(name), null, `'${name}' is no name escapeName gives`);
    }
  });

  it('refuses an empty part, and one holding a lone surrogate', () => {
    assert.throws(() => escapeName(''), TypeError);
    assert.throws(() => escapeName('a\uD83D'), TypeError);
  });
});
