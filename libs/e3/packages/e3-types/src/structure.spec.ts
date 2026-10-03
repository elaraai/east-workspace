/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Keypaths: `parseKeypath` reads back what `pathToString` writes, whatever a
 * field is named, with no structure to check it against; `parsePath` reads the
 * same syntax and checks each field against a structure as it reads it.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { IntegerType, equalFor, printFor, toEastTypeValue, variant } from '@elaraai/east';
import { TreePathType, parseKeypath, parsePath, pathToString, type Structure, type TreePath } from './structure.js';

const equalPath = equalFor(TreePathType);
const printPath = printFor(TreePathType);

describe('parseKeypath', () => {
  it('reads back what pathToString writes, whatever a field is named', () => {
    const names = ['inputs', 'my field', 'a.b', 'a/b', 'back`tick', 'back\\slash', 'café', '1st', '', '`'];
    for (const name of names) {
      const path: TreePath = [variant('field', 'inputs'), variant('field', name)];
      const printed = pathToString(path);
      if (name === '') {
        // An empty field name prints as nothing a keypath can read.
        assert.throws(() => parseKeypath(printed));
        continue;
      }
      const read = parseKeypath(printed);
      assert.ok(equalPath(read, path), `${JSON.stringify(name)}: ${printed} read back as ${printPath(read)}`);
    }
  });

  it('reads the empty string as the root', () => {
    assert.ok(equalPath(parseKeypath(''), []));
  });

  it('refuses a string that is not a keypath, naming where', () => {
    assert.throws(() => parseKeypath('inputs.x'), { message: "parseKeypath: unexpected character at position 0: 'i'" });
    assert.throws(() => parseKeypath('.inputs.'), { message: "parseKeypath: expected identifier after '.' at position 8" });
    assert.throws(() => parseKeypath('.inputs!'), { message: "parseKeypath: unexpected character at position 7: '!'" });
  });
});

describe('parsePath', () => {
  const structure: Structure = variant('struct', new Map([
    ['inputs', variant('struct', new Map([
      ['sales', variant('value', { type: toEastTypeValue(IntegerType), writable: true })],
    ]))],
  ]));

  it('reads a keypath, and the structure at it', () => {
    const { path, structure: at } = parsePath('.inputs.sales', structure);
    assert.ok(equalPath(path, [variant('field', 'inputs'), variant('field', 'sales')]));
    assert.equal(at.type, 'value');
  });

  it('refuses a field the structure lacks before a malformed one after it, and a path into a dataset', () => {
    assert.throws(() => parsePath('.nope!', structure), { message: "parsePath: field 'nope' not found at ''. Available: inputs" });
    assert.throws(() => parsePath('.inputs!', structure), { message: "parsePath: unexpected character at position 7: '!'" });
    assert.throws(() => parsePath('.inputs.sales.more', structure), { message: "parsePath: cannot descend into dataset at '.inputs.sales'" });
  });
});
