/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { collectNodeModulesBins } from './LocalTaskRunner.js';

describe('collectNodeModulesBins', () => {
  let root: string;

  before(() => {
    root = mkdtempSync(path.join(tmpdir(), 'e3-bin-walk-'));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // Filter out any .bin dirs the walk picks up OUTSIDE our temp subtree
  // (the walk always reaches `/` and a system-wide node_modules above the
  // temp would otherwise leak into the assertion).
  const within = (entries: string[], base: string) =>
    entries.filter((b) => b.startsWith(base + path.sep));

  it('finds .bin in the start dir', () => {
    const proj = path.join(root, 'a');
    const bin = path.join(proj, 'node_modules', '.bin');
    mkdirSync(bin, { recursive: true });
    assert.deepEqual(within(collectNodeModulesBins(proj), root), [bin]);
  });

  it('walks up to a parent .bin from a nested subdirectory (typical .repos case)', () => {
    const proj = path.join(root, 'b');
    const bin = path.join(proj, 'node_modules', '.bin');
    const nested = path.join(proj, '.repos', 'workspace_id');
    mkdirSync(bin, { recursive: true });
    mkdirSync(nested, { recursive: true });
    assert.deepEqual(within(collectNodeModulesBins(nested), root), [bin]);
  });

  it('returns an empty list when no node_modules/.bin exists in the subtree', () => {
    const island = path.join(root, 'c', 'no-modules-anywhere');
    mkdirSync(island, { recursive: true });
    assert.deepEqual(within(collectNodeModulesBins(island), root), []);
  });

  it('collects every .bin on the walk-up path, closest first', () => {
    const outer = path.join(root, 'd');
    const inner = path.join(outer, 'inner-pkg');
    const outerBin = path.join(outer, 'node_modules', '.bin');
    const innerBin = path.join(inner, 'node_modules', '.bin');
    mkdirSync(outerBin, { recursive: true });
    mkdirSync(innerBin, { recursive: true });
    assert.deepEqual(within(collectNodeModulesBins(inner), root), [innerBin, outerBin]);
  });
});
