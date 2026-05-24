/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseGetFormat } from './get.js';

describe('parseGetFormat', () => {
  it('defaults to east when value is undefined', () => {
    assert.strictEqual(parseGetFormat(undefined), 'east');
  });

  it('accepts east', () => {
    assert.strictEqual(parseGetFormat('east'), 'east');
  });

  it('accepts json', () => {
    assert.strictEqual(parseGetFormat('json'), 'json');
  });

  it('accepts beast2', () => {
    assert.strictEqual(parseGetFormat('beast2'), 'beast2');
  });

  it('throws on unknown format, naming the supported set', () => {
    assert.throws(() => parseGetFormat('xml'), /Unknown format: 'xml'.*east, json, beast2/);
  });

  it('throws on empty string', () => {
    assert.throws(() => parseGetFormat(''), /Unknown format: ''/);
  });
});
