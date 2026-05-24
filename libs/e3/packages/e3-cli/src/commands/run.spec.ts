/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseTaskSpec } from './run.js';

describe('parseTaskSpec', () => {
  it('parses pkg.task with default version', () => {
    assert.deepStrictEqual(parseTaskSpec('hello.greet'), {
      name: 'hello',
      version: 'latest',
      task: 'greet',
    });
  });

  it('parses pkg@version.task with explicit version', () => {
    assert.deepStrictEqual(parseTaskSpec('hello@1.2.3.greet'), {
      name: 'hello',
      version: '1.2.3',
      task: 'greet',
    });
  });

  it('uses the last dot as the task separator (versions contain dots)', () => {
    // pkg = 'hello@1.0.0', task = 'greet'
    const result = parseTaskSpec('hello@1.0.0.greet');
    assert.strictEqual(result.task, 'greet');
    assert.strictEqual(result.version, '1.0.0');
  });

  it('throws when no dot is present', () => {
    assert.throws(() => parseTaskSpec('helloPkg'), /Expected format: pkg.task/);
  });

  it('throws when package portion is empty', () => {
    assert.throws(() => parseTaskSpec('.greet'), /Package name cannot be empty/);
  });

  it('throws when task portion is empty', () => {
    assert.throws(() => parseTaskSpec('hello.'), /Task name cannot be empty/);
  });
});
