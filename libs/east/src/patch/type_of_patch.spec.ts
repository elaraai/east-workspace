/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * PatchType over recursive types (#774): a pure function of the type, and
 * replace-only at a recursive wrapper — the patch type every runtime
 * declares and the type every runtime's patch values conform to.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  NullType, IntegerType, StringType, ArrayType, DictType, StructType, VariantType, OptionType, RecursiveType,
} from "../types.js";
import { PatchType } from "./type_of_patch.js";
import { diffFor } from "./diff.js";
import { applyFor } from "./apply.js";
import { isValueOf, isTypeEqual } from "../types.js";
import { variant } from "../containers/variant.js";

const Linked = RecursiveType((self) => VariantType({
  cons: StructType({ head: IntegerType, tail: self }),
  nil: NullType,
}));
const replaceOnly = (t: any) => VariantType({ unchanged: NullType, replace: StructType({ before: t, after: t }) });
const caseType = (v: any, name: string) => v.cases[name];
const cases = (v: any) => Object.keys(v.cases).sort();
const fieldsOf = (v: any) => v.fields;

describe("PatchType — recursive types (#774)", () => {
  test("a recursive type is replace-only: no patch case at the wrapper", () => {
    const p = PatchType(Linked);
    assert.deepEqual(cases(p), ["replace", "unchanged"]);
    assert.ok(isTypeEqual(p, replaceOnly(Linked)));
    // What diffFor computes and applyFor accepts — the type describes the values.
    const before = variant("cons", { head: 1n, tail: variant("nil", null) });
    const after = variant("cons", { head: 2n, tail: variant("nil", null) });
    const patch = diffFor(Linked)(before as any, after as any);
    assert.equal(patch.type, "replace");
    assert.ok(isValueOf(patch, p), "the runtime's patch is a value of the patch type");
    assert.deepEqual(applyFor(Linked)(before as any, patch), after);
  });

  test("the same type gets the same patch type wherever it occurs", () => {
    // A wrapper reached through a container and bare, side by side: the
    // shape the Patch_Fuzz corpus names several times over. An earlier
    // PatchType descended into the wrapper on its first occurrence only, so
    // `a`'s element and `b` disagreed and neither matched the runtime.
    const Both = StructType({ a: ArrayType(Linked), b: Linked, c: Linked });
    const p = PatchType(Both);
    const fields = fieldsOf(caseType(p, "patch"));
    const aElement = caseType(caseType(fields.a, "patch").value.fields.operation, "update");
    assert.ok(isTypeEqual(aElement, fields.b));
    assert.ok(isTypeEqual(fields.b, fields.c));
    assert.ok(isTypeEqual(fields.b, PatchType(Linked)));
    // ...and in the other order.
    const Swapped = StructType({ b: Linked, a: ArrayType(Linked) });
    assert.ok(isTypeEqual(fieldsOf(caseType(PatchType(Swapped), "patch")).b, fields.b));
  });

  test("a nested wrapper under an enclosing wrapper is replace-only too", () => {
    const Outer = RecursiveType((self) => StructType({
      first: DictType(StringType, Linked),
      second: OptionType(Linked),
      third: Linked,
      next: OptionType(self),
    }));
    const p = PatchType(Outer);
    assert.ok(isTypeEqual(p, replaceOnly(Outer)));
    // The wrapper's body, patched as a struct on its own, names Linked's
    // patch type in every position.
    const body = PatchType(Outer.node);
    const fields = fieldsOf(caseType(body, "patch"));
    const firstValue = caseType(caseType(fields.first, "patch").value, "update");
    assert.ok(isTypeEqual(firstValue, PatchType(Linked)));
    assert.ok(isTypeEqual(caseType(caseType(fields.second, "patch"), "some"), PatchType(Linked)));
    assert.ok(isTypeEqual(fields.third, PatchType(Linked)));
  });
});
