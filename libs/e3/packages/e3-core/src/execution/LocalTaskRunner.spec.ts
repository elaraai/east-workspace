/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { findNearestNodeModulesBin } from './LocalTaskRunner.js';

describe('findNearestNodeModulesBin', () => {
  let root: string;

  before(() => {
    root = mkdtempSync(path.join(tmpdir(), 'e3-bin-walk-'));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('finds .bin in the start dir', () => {
    const proj = path.join(root, 'a');
    const bin = path.join(proj, 'node_modules', '.bin');
    mkdirSync(bin, { recursive: true });
    assert.equal(findNearestNodeModulesBin(proj), bin);
  });

  it('walks up to a parent .bin from a nested subdirectory (typical .repos case)', () => {
    const proj = path.join(root, 'b');
    const bin = path.join(proj, 'node_modules', '.bin');
    const nested = path.join(proj, '.repos', 'workspace_id');
    mkdirSync(bin, { recursive: true });
    mkdirSync(nested, { recursive: true });
    assert.equal(findNearestNodeModulesBin(nested), bin);
  });

  it('returns null when no node_modules/.bin exists between start and root', () => {
    const island = path.join(root, 'c', 'no-modules-anywhere');
    mkdirSync(island, { recursive: true });
    // Walks up to filesystem root, finds nothing in the chain we created.
    const result = findNearestNodeModulesBin(island);
    // The walk reaches `/` — if the host has a system-wide node_modules
    // there (unlikely on test runners; impossible on /), the result is
    // that path. Be tolerant: assert it's not anything inside our temp.
    if (result !== null) {
      assert.ok(
        !result.startsWith(path.join(root, 'c')),
        'no .bin should be found inside the temp subtree',
      );
    }
  });

  it('prefers the closest .bin when multiple are on the walk-up path', () => {
    const outer = path.join(root, 'd');
    const inner = path.join(outer, 'inner-pkg');
    const outerBin = path.join(outer, 'node_modules', '.bin');
    const innerBin = path.join(inner, 'node_modules', '.bin');
    mkdirSync(outerBin, { recursive: true });
    mkdirSync(innerBin, { recursive: true });
    assert.equal(findNearestNodeModulesBin(inner), innerBin);
  });
});
