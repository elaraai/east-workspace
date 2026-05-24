/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Tests for the dataset path resolver.
 *
 * The pure functions (`levenshtein`, `suggestSimilar`, `indexFromTree`,
 * `indexFromRemoteEntries`, `resolveDatasetPathFromIndex`) are exercised
 * directly without a real repository.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { variant } from '@elaraai/east';
import type { TreeNode } from '@elaraai/e3-core';
import type { ListEntry } from '@elaraai/e3-api-client';
import {
  levenshtein,
  suggestSimilar,
  indexFromTree,
  indexFromRemoteEntries,
  resolveDatasetPathFromIndex,
  type ResolvedEntry,
} from './path-resolver.js';

// =============================================================================
// Tree fixture builders
// =============================================================================

function leaf(name: string): TreeNode {
  return { name, kind: 'dataset' };
}

function branch(name: string, children: TreeNode[]): TreeNode {
  return { name, kind: 'tree', children };
}

function inputs(...names: string[]): TreeNode {
  return branch('inputs', names.map(leaf));
}

function tasks(...names: string[]): TreeNode {
  return branch('tasks', names.map(leaf));
}

// Remote ListEntry builders
function remoteDataset(path: string): ListEntry {
  return variant('dataset', {
    path,
    type: variant('String', null),
    hash: variant('none', null),
    size: variant('none', null),
  });
}

function remoteTree(path: string): ListEntry {
  return variant('tree', { path, kind: variant('struct', null) });
}

// =============================================================================
// levenshtein
// =============================================================================

describe('levenshtein', () => {
  it('returns 0 for identical strings', () => {
    assert.strictEqual(levenshtein('abc', 'abc'), 0);
    assert.strictEqual(levenshtein('', ''), 0);
  });

  it('returns length of the non-empty string when one side is empty', () => {
    assert.strictEqual(levenshtein('', 'abc'), 3);
    assert.strictEqual(levenshtein('xyz', ''), 3);
  });

  it('returns 1 for single insertion', () => {
    assert.strictEqual(levenshtein('abc', 'abcd'), 1);
  });

  it('returns 1 for single deletion', () => {
    assert.strictEqual(levenshtein('abcd', 'abc'), 1);
  });

  it('returns 1 for single substitution', () => {
    assert.strictEqual(levenshtein('abc', 'abd'), 1);
  });

  it('handles the classic kitten/sitting case', () => {
    assert.strictEqual(levenshtein('kitten', 'sitting'), 3);
  });

  it('handles unicode characters as JS code units', () => {
    // résumé vs resume — two characters with accents replaced
    assert.strictEqual(levenshtein('résumé', 'resume'), 2);
  });
});

// =============================================================================
// suggestSimilar
// =============================================================================

describe('suggestSimilar', () => {
  it('returns exact match first', () => {
    const result = suggestSimilar('greet', ['greeting', 'greet', 'grit'], 5);
    assert.strictEqual(result[0], 'greet');
  });

  it('returns single-char typos within threshold', () => {
    const result = suggestSimilar('greet', ['greeting', 'gret', 'shout'], 5);
    assert.ok(result.includes('gret'));
  });

  it('filters out candidates beyond the threshold', () => {
    // target length 5 → threshold = max(2, 2) = 2
    const result = suggestSimilar('greet', ['completely-unrelated', 'gret'], 5);
    assert.deepStrictEqual(result, ['gret']);
  });

  it('returns at most `max` candidates', () => {
    const result = suggestSimilar('a', ['a', 'b', 'c', 'd', 'e', 'f'], 3);
    assert.strictEqual(result.length, 3);
  });

  it('returns candidates in distance order', () => {
    const result = suggestSimilar('hello', ['hellp', 'hxllo', 'help'], 5);
    // hellp d=1, hxllo d=1, help d=2 (all within threshold)
    // First two could be in either order (both d=1), but help must come last
    assert.strictEqual(result[result.length - 1], 'help');
  });

  it('returns empty array when candidates is empty', () => {
    assert.deepStrictEqual(suggestSimilar('greet', [], 5), []);
  });

  it('still applies threshold of 2 for very short targets', () => {
    // target 'a' → threshold = max(2, 0) = 2
    const result = suggestSimilar('a', ['ab', 'abc', 'abcd'], 5);
    // ab d=1, abc d=2, abcd d=3 (excluded)
    assert.ok(result.includes('ab'));
    assert.ok(result.includes('abc'));
    assert.ok(!result.includes('abcd'));
  });

  it('handles very long names with appropriate threshold', () => {
    // target length 100 → threshold = 50; far-apart strings still excluded
    const longName = 'a'.repeat(100);
    const result = suggestSimilar(longName, ['b'.repeat(100)], 5);
    // 100 edits — far above threshold of 50
    assert.deepStrictEqual(result, []);
  });
});

// =============================================================================
// indexFromTree
// =============================================================================

describe('indexFromTree', () => {
  it('returns [] for empty tree', () => {
    assert.deepStrictEqual(indexFromTree([]), []);
  });

  it('indexes inputs as kind=input with [inputs, name] storage', () => {
    const tree: TreeNode[] = [inputs('name', 'count')];
    const result = indexFromTree(tree);
    const name = result.find((e) => e.name === 'name')!;
    assert.strictEqual(name.kind, 'input');
    assert.deepStrictEqual(
      name.storage.map((s) => s.value),
      ['inputs', 'name'],
    );
  });

  it('indexes tasks as kind=task-output with [tasks, name, output] storage', () => {
    const tree: TreeNode[] = [tasks('greet')];
    const result = indexFromTree(tree);
    const greet = result.find((e) => e.name === 'greet')!;
    assert.strictEqual(greet.kind, 'task-output');
    assert.deepStrictEqual(
      greet.storage.map((s) => s.value),
      ['tasks', 'greet', 'output'],
    );
  });

  it('indexes both inputs and tasks in a typical workspace', () => {
    const tree: TreeNode[] = [inputs('name'), tasks('greet', 'shout')];
    const result = indexFromTree(tree);
    assert.strictEqual(result.length, 3);
    assert.ok(result.some((e) => e.name === 'name' && e.kind === 'input'));
    assert.ok(result.some((e) => e.name === 'greet' && e.kind === 'task-output'));
    assert.ok(result.some((e) => e.name === 'shout' && e.kind === 'task-output'));
  });

  it('treats nested non-input/non-task branches as kind=other with dotted name', () => {
    const tree: TreeNode[] = [branch('config', [leaf('value')])];
    const result = indexFromTree(tree);
    assert.strictEqual(result.length, 1);
    const e = result[0]!;
    assert.strictEqual(e.kind, 'other');
    assert.strictEqual(e.name, 'config.value');
    assert.deepStrictEqual(e.storage.map((s) => s.value), ['config', 'value']);
  });

  it('handles a leaf at the root (no prefix)', () => {
    // unusual but well-defined: dataset at root would be kind=other with bare name
    const tree: TreeNode[] = [leaf('bare')];
    const result = indexFromTree(tree);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0]!.kind, 'other');
    assert.strictEqual(result[0]!.name, 'bare');
  });
});

// =============================================================================
// indexFromRemoteEntries
// =============================================================================

describe('indexFromRemoteEntries', () => {
  it('returns [] for empty list', () => {
    assert.deepStrictEqual(indexFromRemoteEntries([]), []);
  });

  it('indexes inputs.<name> as kind=input', () => {
    const result = indexFromRemoteEntries([remoteDataset('inputs.name')]);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0]!.kind, 'input');
    assert.strictEqual(result[0]!.name, 'name');
  });

  it('indexes tasks.<name> as kind=task-output with output suffix in storage', () => {
    const result = indexFromRemoteEntries([remoteDataset('tasks.greet')]);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0]!.kind, 'task-output');
    assert.strictEqual(result[0]!.name, 'greet');
    assert.deepStrictEqual(
      result[0]!.storage.map((s) => s.value),
      ['tasks', 'greet', 'output'],
    );
  });

  it('ignores tree entries (only datasets are indexable leaves)', () => {
    const result = indexFromRemoteEntries([remoteTree('inputs'), remoteDataset('inputs.name')]);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0]!.name, 'name');
  });
});

// =============================================================================
// resolveDatasetPathFromIndex
// =============================================================================

describe('resolveDatasetPathFromIndex', () => {
  const index: ResolvedEntry[] = indexFromTree([
    inputs('name', 'count'),
    tasks('greet', 'shout'),
  ]);

  it('resolves a known input', () => {
    const result = resolveDatasetPathFromIndex('dev.name', index);
    assert.strictEqual(result.ws, 'dev');
    assert.strictEqual(result.kind, 'input');
    assert.deepStrictEqual(result.path.map((s) => s.value), ['inputs', 'name']);
  });

  it('resolves a known task with the output suffix added', () => {
    const result = resolveDatasetPathFromIndex('dev.greet', index);
    assert.strictEqual(result.kind, 'task-output');
    assert.deepStrictEqual(result.path.map((s) => s.value), ['tasks', 'greet', 'output']);
  });

  it('errors on path with no name segment', () => {
    assert.throws(
      () => resolveDatasetPathFromIndex('dev', index),
      /Path must include a name/,
    );
  });

  it('rejects legacy inputs.<name> form with a hint', () => {
    assert.throws(
      () => resolveDatasetPathFromIndex('dev.inputs.name', index),
      /Use the short form: 'dev.name'/,
    );
  });

  it('rejects legacy tasks.<name>.output form with a hint', () => {
    assert.throws(
      () => resolveDatasetPathFromIndex('dev.tasks.greet.output', index),
      /Use the short form: 'dev.greet'/,
    );
  });

  it('suggests close matches for typos', () => {
    assert.throws(
      () => resolveDatasetPathFromIndex('dev.gret', index),
      /Did you mean.*dev\.greet/s,
    );
  });

  it('lists available names when no close match exists', () => {
    assert.throws(
      () => resolveDatasetPathFromIndex('dev.completelyDifferentName', index),
      /Available names/,
    );
  });

  it('caps the available list at 10 names with a "... and N more" suffix', () => {
    const many = indexFromTree([
      inputs(...Array.from({ length: 15 }, (_, i) => `in${i}`)),
    ]);
    let err: Error | undefined;
    try {
      resolveDatasetPathFromIndex('dev.completelyDifferentName', many);
    } catch (e) {
      err = e as Error;
    }
    assert.ok(err, 'expected error');
    assert.match(err!.message, /\.\.\. and 5 more/);
  });

  it('reports ambiguity when an input and task share a name', () => {
    const ambig = indexFromTree([inputs('foo'), tasks('foo')]);
    assert.throws(
      () => resolveDatasetPathFromIndex('dev.foo', ambig),
      /ambiguous/,
    );
  });

  it('rejects nested field access past the leaf', () => {
    assert.throws(
      () => resolveDatasetPathFromIndex('dev.greet.field', index),
      /Nested field access/,
    );
  });
});
