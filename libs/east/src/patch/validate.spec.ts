/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Unit tests for `validatePatchFor` — non-throwing per-leaf patch
 * validation against a base value.
 *
 * Covers each container kind (primitive, Dict, Struct, Array, Set, Variant)
 * and the corresponding stale-op shapes — plus the property: a clean
 * validate result implies `applyFor` does not throw.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { validatePatchFor } from "./validate.js";
import { applyFor } from "./apply.js";
import { variant } from "../containers/variant.js";
import { SortedMap } from "../containers/sortedmap.js";
import { compareFor } from "../comparison.js";
import {
  FloatType,
  IntegerType,
  StringType,
  StructType,
  DictType,
  ArrayType,
  SetType,
  VariantType,
  NullType,
} from "../types.js";

// ============================================================================
// Primitives
// ============================================================================

describe("validatePatchFor — primitives", () => {
  test("clean replace: empty conflicts; applyFor succeeds", () => {
    const validate = validatePatchFor(FloatType);
    const conflicts = validate(38.0, variant("replace", { before: 38.0, after: 50.0 }));
    assert.deepEqual(conflicts, []);
    assert.equal(applyFor(FloatType)(38.0, variant("replace", { before: 38.0, after: 50.0 })), 50.0);
  });

  test("stale replace: one conflict; applyFor would throw", () => {
    const validate = validatePatchFor(FloatType);
    const patch = variant("replace", { before: 38.0, after: 50.0 });
    const conflicts = validate(40.0, patch);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]!.op, "replace");
    assert.equal(conflicts[0]!.expected, 38.0);
    assert.equal(conflicts[0]!.actual, 40.0);
    assert.deepEqual(conflicts[0]!.path, []);
    assert.throws(() => applyFor(FloatType)(40.0, patch));
  });

  test("unchanged: empty conflicts", () => {
    assert.deepEqual(validatePatchFor(IntegerType)(42n, variant("unchanged", null)), []);
  });
});

// ============================================================================
// Dict<String, Float> — the regional_pricing_overlay_drift scenario.
// ============================================================================

describe("validatePatchFor — Dict<String, Float>", () => {
  const T = DictType(StringType, FloatType);
  const validate = validatePatchFor(T);
  const cmp = compareFor(StringType);

  function dictPatch(entries: Array<[string, any]>): any {
    const m = new SortedMap<string, any>(undefined, cmp);
    for (const [k, v] of entries) m.set(k, v);
    return variant("patch", m);
  }

  const source = new Map<string, number>([
    ["AU", 49.95],
    ["US", 39.95],
    ["EU", 44.95],
    ["JP", 5499.0],
  ]);

  test("clean op (update with matching before): no conflicts", () => {
    const patch = dictPatch([
      ["EU", variant("update", variant("replace", { before: 44.95, after: 39.95 }))],
    ]);
    assert.deepEqual(validate(source, patch), []);
  });

  test("stale delete: key not in source → one conflict, op=\"delete\", actual=undefined", () => {
    const patch = dictPatch([
      ["MX", variant("delete", 99.0)],
    ]);
    const conflicts = validate(source, patch);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]!.op, "delete");
    assert.equal(conflicts[0]!.expected, 99.0);
    assert.equal(conflicts[0]!.actual, undefined);
  });

  test("stale insert: key already exists → one conflict, op=\"insert\", actual=current value", () => {
    const patch = dictPatch([
      ["AU", variant("insert", 100.0)],
    ]);
    const conflicts = validate(source, patch);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]!.op, "insert");
    assert.equal(conflicts[0]!.expected, undefined);
    assert.equal(conflicts[0]!.actual, 49.95);
  });

  test("stale update: before mismatches actual → one conflict, op=\"replace\", actual=current value", () => {
    const patch = dictPatch([
      ["US", variant("update", variant("replace", { before: 30.0, after: 25.0 }))],
    ]);
    const conflicts = validate(source, patch);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]!.op, "replace");
    assert.equal(conflicts[0]!.expected, 30.0);
    assert.equal(conflicts[0]!.actual, 39.95);
  });

  test("the full regional_pricing scenario: 3 stale + 1 clean → 3 conflicts", () => {
    const patch = dictPatch([
      ["MX", variant("delete", 99.0)],
      ["AU", variant("insert", 100.0)],
      ["US", variant("update", variant("replace", { before: 30.0, after: 25.0 }))],
      ["EU", variant("update", variant("replace", { before: 44.95, after: 39.95 }))],
    ]);
    const conflicts = validate(source, patch);
    assert.equal(conflicts.length, 3);
    const ops = conflicts.map(c => c.op).sort();
    assert.deepEqual(ops, ["delete", "insert", "replace"]);
    // applyFor should throw — confirm conflicts and apply agree.
    assert.throws(() => applyFor(T)(source, patch));
  });

  test("clean dict patch: validate empty, applyFor succeeds", () => {
    const patch = dictPatch([
      ["EU", variant("update", variant("replace", { before: 44.95, after: 39.95 }))],
    ]);
    assert.deepEqual(validate(source, patch), []);
    const result = applyFor(T)(source, patch);
    assert.equal(result.get("EU"), 39.95);
    assert.equal(result.get("AU"), 49.95);
  });
});

// ============================================================================
// Struct
// ============================================================================

describe("validatePatchFor — Struct", () => {
  const Person = StructType({ name: StringType, age: IntegerType });
  const validate = validatePatchFor(Person);

  test("stale field replace: conflict at .age", () => {
    const patch = variant("patch", {
      name: variant("unchanged", null),
      age: variant("replace", { before: 30n, after: 35n }),
    });
    const conflicts = validate({ name: "Alice", age: 32n }, patch);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]!.op, "replace");
    assert.equal(conflicts[0]!.expected, 30n);
    assert.equal(conflicts[0]!.actual, 32n);
    assert.deepEqual(conflicts[0]!.path[0], { kind: "field", name: "age" });
  });

  test("clean: empty", () => {
    const patch = variant("patch", {
      name: variant("unchanged", null),
      age: variant("replace", { before: 30n, after: 35n }),
    });
    assert.deepEqual(validate({ name: "Alice", age: 30n }, patch), []);
  });
});

// ============================================================================
// Set<String>
// ============================================================================

describe("validatePatchFor — Set<String>", () => {
  const T = SetType(StringType);
  const validate = validatePatchFor(T);
  const cmp = compareFor(StringType);

  function setPatch(entries: Array<[string, any]>): any {
    const m = new SortedMap<string, any>(undefined, cmp);
    for (const [k, v] of entries) m.set(k, v);
    return variant("patch", m);
  }

  const source = new Set<string>(["dark_mode", "experiments"]);

  test("stale delete (key absent): conflict, op=\"delete\"", () => {
    const conflicts = validate(source, setPatch([["beta", variant("delete", null)]]));
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]!.op, "delete");
    assert.equal(conflicts[0]!.actual, undefined);
  });

  test("stale insert (key present): conflict, op=\"insert\"", () => {
    const conflicts = validate(source, setPatch([["dark_mode", variant("insert", null)]]));
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]!.op, "insert");
  });

  test("clean: insert new + delete existing → no conflicts", () => {
    const conflicts = validate(source, setPatch([
      ["new_flag", variant("insert", null)],
      ["dark_mode", variant("delete", null)],
    ]));
    assert.deepEqual(conflicts, []);
  });
});

// ============================================================================
// Array<Float>
// ============================================================================

describe("validatePatchFor — Array<Float>", () => {
  const T = ArrayType(FloatType);
  const validate = validatePatchFor(T);

  test("stale delete (mismatched value): one conflict", () => {
    const patch = variant("patch", [
      { key: 0n, offset: 0n, operation: variant("delete", 99.0) },
    ]);
    const conflicts = validate([10.0, 20.0, 30.0], patch);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]!.op, "delete");
    assert.equal(conflicts[0]!.expected, 99.0);
    assert.equal(conflicts[0]!.actual, 10.0);
  });

  test("clean delete + insert: no conflicts", () => {
    const patch = variant("patch", [
      { key: 0n, offset: 0n, operation: variant("delete", 10.0) },
      { key: 1n, offset: -1n, operation: variant("insert", 99.0) },
    ]);
    assert.deepEqual(validate([10.0, 20.0, 30.0], patch), []);
  });
});

// ============================================================================
// Variant
// ============================================================================

describe("validatePatchFor — Variant", () => {
  const Status = VariantType({ pending: NullType, active: NullType, done: NullType });
  const validate = validatePatchFor(Status);

  test("stale tag (patch expects tag the base doesn't have): conflict", () => {
    const patch = variant("patch", variant("active", variant("unchanged", null)));
    const conflicts = validate(variant("done", null), patch);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]!.op, "update");
  });

  test("matching tag: empty", () => {
    const patch = variant("patch", variant("active", variant("unchanged", null)));
    assert.deepEqual(validate(variant("active", null), patch), []);
  });
});
