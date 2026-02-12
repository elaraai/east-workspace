/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Unit tests for schedule trigger pure functions.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { globToRegex, resolveForceTaskPatterns } from './schedule-trigger.js';

describe('globToRegex', () => {
  it('prefix wildcard: input* matches input_orders', () => {
    const re = globToRegex('input*');
    assert.ok(re.test('input_orders'));
    assert.ok(re.test('input'));
    assert.ok(!re.test('process_input'));
  });

  it('suffix wildcard: *_load matches daily_load', () => {
    const re = globToRegex('*_load');
    assert.ok(re.test('daily_load'));
    assert.ok(!re.test('load_data'));
  });

  it('exact match: no wildcard', () => {
    const re = globToRegex('exact_name');
    assert.ok(re.test('exact_name'));
    assert.ok(!re.test('exact_name_extra'));
    assert.ok(!re.test('not_exact_name'));
  });

  it('bare wildcard: * matches everything', () => {
    const re = globToRegex('*');
    assert.ok(re.test('anything'));
    assert.ok(re.test(''));
    assert.ok(re.test('foo_bar_baz'));
  });

  it('dot is escaped: foo.bar matches literal dot', () => {
    const re = globToRegex('foo.bar');
    assert.ok(re.test('foo.bar'));
    assert.ok(!re.test('fooXbar'));
  });

  it('escaped asterisk: \\* matches literal *', () => {
    const re = globToRegex('test\\*literal');
    assert.ok(re.test('test*literal'));
    assert.ok(!re.test('test_literal'));
    assert.ok(!re.test('testXliteral'));
  });

  it('escaped backslash: \\\\ matches literal backslash', () => {
    const re = globToRegex('path\\\\dir');
    assert.ok(re.test('path\\dir'));
    assert.ok(!re.test('pathXdir'));
  });
});

describe('resolveForceTaskPatterns', () => {
  const taskNames = ['input_orders', 'input_products', 'process_data', 'output_report', 'daily_load'];

  it('single pattern matching multiple tasks', () => {
    const result = resolveForceTaskPatterns(['input*'], taskNames);
    assert.deepStrictEqual(result.sort(), ['input_orders', 'input_products']);
  });

  it('multiple patterns with deduplication', () => {
    const result = resolveForceTaskPatterns(['input*', '*_orders'], taskNames);
    // input_orders matched by both patterns, should appear once
    assert.deepStrictEqual(result.sort(), ['input_orders', 'input_products']);
  });

  it('no matches returns empty array', () => {
    const result = resolveForceTaskPatterns(['nonexistent*'], taskNames);
    assert.deepStrictEqual(result, []);
  });

  it('empty patterns returns empty array', () => {
    const result = resolveForceTaskPatterns([], taskNames);
    assert.deepStrictEqual(result, []);
  });

  it('wildcard matches all tasks', () => {
    const result = resolveForceTaskPatterns(['*'], taskNames);
    assert.strictEqual(result.length, taskNames.length);
  });

  it('exact match pattern', () => {
    const result = resolveForceTaskPatterns(['daily_load'], taskNames);
    assert.deepStrictEqual(result, ['daily_load']);
  });
});
