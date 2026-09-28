/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The order of releases, by which an e3 tells a newer release's zip or
 * execution state from an older one's.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { E3_RELEASE, compareReleases } from './release.js';

describe('compareReleases', () => {
  it('orders releases by semantic-version precedence', () => {
    // Each precedes the next: the core numerically, a pre-release before its
    // core's release, numeric identifiers before words and numerically, and a
    // list before a longer one it begins.
    const ordered = [
      '0.9.0', '1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11',
      '1.0.0-rc.1', '1.0.0', '1.0.9', '1.0.10', '1.0.79', '1.0.80-beta.1', '1.0.80', '1.1.0', '2.0.0',
    ];
    for (let i = 0; i < ordered.length; i++) {
      for (let j = 0; j < ordered.length; j++) {
        const order = Math.sign(compareReleases(ordered[i]!, ordered[j]!));
        assert.equal(order, Math.sign(i - j), `${ordered[i]} against ${ordered[j]}`);
      }
    }
  });

  it('orders nothing by build metadata', () => {
    assert.equal(compareReleases('1.0.79+ci.7', '1.0.79'), 0);
    assert.equal(compareReleases('1.0.80-beta.1+a', '1.0.80-beta.1+b'), 0);
  });

  it('refuses what is not a semantic version, naming it', () => {
    for (const release of ['1.0', 'v1.0.79', '1.0.079', '1.0.79-', 'latest', '']) {
      assert.throws(() => compareReleases(release, E3_RELEASE), { message: new RegExp(`^${JSON.stringify(release).replace(/[.+]/g, '\\$&')} is not a release`) });
      assert.throws(() => compareReleases(E3_RELEASE, release), /is not a release/);
    }
  });

  it('is a release itself', () => {
    assert.equal(compareReleases(E3_RELEASE, E3_RELEASE), 0);
  });
});
