/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { StringType, IntegerType } from '@elaraai/east';
import { value, valuesTree } from './value.js';
import { package_ } from './package.js';

describe('e3.value', () => {
  it('mounts a writable dataset at .values.<name>', () => {
    const name = value('name', StringType, 'World');
    assert.strictEqual(name.kind, 'dataset');
    assert.strictEqual(name.name, 'name');
    assert.strictEqual(name.writable, true);
    assert.strictEqual(name.default, 'World');
    assert.deepStrictEqual(
      name.path.map((s) => (s.type === 'field' ? s.value : s.type)),
      ['values', 'name']
    );
    // Depends on the .values tree so the struct node is materialised.
    assert.ok(name.deps.has(valuesTree));
  });

  it('omits the default when none is given', () => {
    const count = value('count', IntegerType);
    assert.strictEqual(count.default, undefined);
  });

  it('is collected into a package like any other dataset', () => {
    const greeting = value('greeting', StringType, 'hi');
    const pkg = package_('vals', '1.0.0', greeting);
    assert.ok(pkg.contents.includes(greeting));
    // The .values datatree is pulled in transitively as a dependency.
    assert.ok(pkg.contents.some((c) => c.kind === 'datatree' && c.name === 'values'));
  });
});
