/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { IntegerType, StringType, StructType, variant, type EastTypeValue } from '@elaraai/east';
import { checkDatasetType } from './dataset-type.js';

/** A tree of `head`s, its wrapper numbered `id`, as a build or a header numbers it. */
const tree = (id: bigint, head: EastTypeValue): EastTypeValue => variant('Recursive', variant('wrapper', {
  id,
  inner: variant('Struct', [
    { name: 'head', type: head },
    { name: 'kids', type: variant('Array', variant('Recursive', variant('ref', id))) },
  ]),
}));
const integer: EastTypeValue = variant('Integer', null);
const string: EastTypeValue = variant('String', null);

describe('checkDatasetType', () => {
  it('passes the declared type, and names the first difference of another', () => {
    const Row = StructType({ id: IntegerType, name: StringType });
    assert.equal(checkDatasetType("dataset '.inputs.rows'", 'the value', Row, Row), null);
    const mismatch = checkDatasetType("dataset '.inputs.rows'", 'the value', Row, StructType({ id: IntegerType, name: IntegerType }));
    assert.match(mismatch?.message ?? '', /^dataset '\.inputs\.rows' declares .* but the value carries .* — first difference at /);
  });

  it('reads a recursive type by its structure: one id on both sides is not one type (#1233)', () => {
    assert.notEqual(checkDatasetType("dataset '.inputs.tree'", 'the value', tree(0n, integer), tree(0n, string)), null,
      'a tree of strings is not a tree of integers, whatever id each gives its wrapper');
    assert.equal(checkDatasetType("dataset '.inputs.tree'", 'the value', tree(228n, integer), tree(0n, integer)), null,
      "a build's ids and a header's name one structure");
  });
});
