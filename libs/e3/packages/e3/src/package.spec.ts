/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { package_ } from './package.js';

describe('package', () => {
  it('refuses a name or a version no path can hold, since a repository keeps a package under both', () => {
    assert.throws(() => package_('../escape', '1.0.0'), /^Error: e3\.package: the package name "\.\.\/escape" holds "\/", which a file name cannot$/);
    assert.throws(() => package_('pkg', '..'), /^Error: e3\.package: the package version name "\.\." is a path of its own$/);
    assert.throws(() => package_('pkg', ''), /^Error: e3\.package: the package version name "" is empty$/);
    assert.strictEqual(package_('pkg', '1.0.0-rc.1').version, '1.0.0-rc.1');
  });
});
