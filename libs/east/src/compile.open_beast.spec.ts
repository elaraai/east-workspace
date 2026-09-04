/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The `blob.openBeast` builtin's laziness (#659): the compliance corpus pins
 * its VALUES on every runtime, and this probe pins the mechanism — that the
 * served reads answer from the pager and never hydrate, that the opened value
 * is frozen, and that the not-pageable fallback is the whole frozen decode.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  East, BlobType, IntegerType, StringType, StructType, DictType, ArrayType,
  SortedMap, compareFor, encodeBeast2PagedFor, encodeBeast2For, isFrozenValue, Beast2Pages,
} from "./index.js";

const RowType = StructType({ id: IntegerType, name: StringType });
const TableType = DictType(IntegerType, RowType);

function table(n: number): SortedMap<bigint, { id: bigint; name: string }> {
  return new SortedMap(
    Array.from({ length: n }, (_, i): [bigint, { id: bigint; name: string }] => [BigInt(i), { id: BigInt(i), name: `row-${i}` }]),
    compareFor(IntegerType),
  );
}

/** Counts calls of a prototype method for the duration of `run`. */
function countCalls<T extends object>(proto: T, name: keyof T & string, run: () => void): number {
  const original = (proto as Record<string, unknown>)[name] as (...args: unknown[]) => unknown;
  let calls = 0;
  (proto as Record<string, unknown>)[name] = function (this: unknown, ...args: unknown[]) {
    calls++;
    return original.apply(this, args);
  };
  try {
    run();
  } finally {
    (proto as Record<string, unknown>)[name] = original;
  }
  return calls;
}

describe("blob.openBeast — the lazy paged open at the expression level", () => {
  // 30 rows in segments of 10: three segments, so a keyed read touches one.
  const paged = encodeBeast2PagedFor(TableType, { batchSize: 10 })(table(30));

  test("size, a keyed read and a for loop are served from the pager", () => {
    const fn = East.function([BlobType], IntegerType, ($, blob) => {
      const t = $.let(blob.openBeast(TableType));
      const sum = $.let(t.size().add(t.get(7n).id));
      $.for(t, ($, row) => {
        $.assign(sum, sum.add(row.id));
      });
      return sum;
    });
    const compiled = East.compile(fn, []);
    let segments = 0;
    const keyed = countCalls(Beast2Pages.prototype, "get", () => {
      segments = countCalls(Beast2Pages.prototype, "segment", () => {
        assert.equal(compiled(paged), 37n + 435n);
      });
    });
    assert.equal(keyed, 1, "one keyed read reaches the pager");
    assert.equal(segments, 3, "the for loop streams each segment exactly once");
  });

  test("the opened value is frozen and stays un-hydrated after served reads", () => {
    const fn = East.function([BlobType], TableType, ($, blob) => {
      const t = $.let(blob.openBeast(TableType));
      $(t.get(7n));
      $(t.has(9999n));
      return t;
    });
    const out = East.compile(fn, [])(paged) as SortedMap<bigint, { id: bigint; name: string }>;
    assert.ok(out instanceof SortedMap);
    assert.ok(isFrozenValue(out), "the opened value carries the frozen brand");
    assert.equal((out as unknown as { hydrated: boolean }).hydrated, false, "served reads never hydrate");
    assert.equal(out.size, 30);
  });

  test("an index-less blob takes the whole frozen decode", () => {
    const whole = encodeBeast2For(TableType)(table(30));
    const fn = East.function([BlobType], TableType, ($, blob) => blob.openBeast(TableType));
    const out = East.compile(fn, [])(whole) as SortedMap<bigint, { id: bigint; name: string }>;
    assert.ok(out instanceof SortedMap);
    assert.ok(isFrozenValue(out));
    assert.equal((out as unknown as { hydrated?: boolean }).hydrated, undefined, "an eager SortedMap, not a lazy one");
    assert.equal(out.get(7n)?.name, "row-7");
  });

  test("a non-collection type is refused when the expression is built", () => {
    assert.throws(
      () => East.function([BlobType], IntegerType, ($, blob) => (blob as unknown as { openBeast: (t: unknown) => never }).openBeast(IntegerType)),
      /openBeast opens Array, Set or Dict blobs/,
    );
  });

  test("a wire type mismatch is refused before any decode", () => {
    const fn = East.function([BlobType], ArrayType(IntegerType), ($, blob) => blob.openBeast(ArrayType(IntegerType)));
    const compiled = East.compile(fn, []);
    assert.throws(() => compiled(paged), /cannot open a blob of type/);
  });

  test("a v4 container is checked by its header type too, then decodes whole and frozen", () => {
    const v4 = encodeBeast2For(TableType, { version: 4 })(table(30));
    const mismatch = East.compile(East.function([BlobType], ArrayType(IntegerType), ($, blob) => blob.openBeast(ArrayType(IntegerType))), []);
    assert.throws(() => mismatch(v4), /cannot open a blob of type/);
    const fn = East.function([BlobType], TableType, ($, blob) => blob.openBeast(TableType));
    const out = East.compile(fn, [])(v4) as SortedMap<bigint, { id: bigint; name: string }>;
    assert.ok(out instanceof SortedMap);
    assert.ok(isFrozenValue(out));
    assert.equal((out as unknown as { hydrated?: boolean }).hydrated, undefined, "a v4 blob has no index: the eager frozen decode");
    assert.equal(out.get(7n)?.name, "row-7");
  });
});
