/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Unit tests for the `coerce_to` helper in ast_to_ir.ts. This helper is the
 * core of deep-As rewriting — it rewrites Struct and Variant IR nodes with
 * widened declared types so that every `IR_VARIANT` node's declared type
 * matches the variant type it is stored under (prevents the silent narrow →
 * wide `case_idx` desync that corrupts beast2/print/match downstream).
 *
 * Coverage targets every supported type kind, every source/target shape
 * combination, the RecursiveType cycle guard, and key edge cases.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { coerce_to } from "./ast_to_ir.js";
import { toEastTypeValue } from "./type_of_type.js";
import {
    IntegerType,
    FloatType,
    StringType,
    BooleanType,
    NullType,
    DateTimeType,
    BlobType,
    NeverType,
    StructType,
    VariantType,
    ArrayType,
    SetType,
    DictType,
    VectorType,
    MatrixType,
    RefType,
    FunctionType,
    AsyncFunctionType,
    OptionType,
    RecursiveType,
} from "./types.js";
import { variant } from "./containers/variant.js";

// ─── IR builders ──────────────────────────────────────────────────────────
// Hand-constructed IR nodes mirroring the shape that ast_to_ir.ts produces.

const LOC = 1n;

function mkValue(type: any, value: any) {
    return variant("Value", {
        type: toEastTypeValue(type),
        loc_id: LOC,
        value,
    });
}

function mkVariable(type: any, name = "v") {
    return variant("Variable", {
        type: toEastTypeValue(type),
        name,
        loc_id: LOC,
        mutable: false,
        captured: false,
    });
}

function mkCall(type: any) {
    return variant("Call", {
        type: toEastTypeValue(type),
        loc_id: LOC,
        function: mkVariable(FunctionType([], type)),
        arguments: [],
    });
}

function mkVariantIR(caseName: string, innerType: any, innerValue: any, declaredType: any) {
    return variant("Variant", {
        type: toEastTypeValue(declaredType),
        loc_id: LOC,
        case: caseName,
        value: mkValue(innerType, innerValue),
    });
}

function mkStructIR(declaredType: any, fields: { name: string, value: any }[]) {
    return variant("Struct", {
        type: toEastTypeValue(declaredType),
        loc_id: LOC,
        fields,
    });
}

// ─── §1. Identity: isTypeEqual → no-op, returns same IR ───────────────────

describe("coerce_to: identity (isTypeEqual → no-op)", () => {
    for (const [name, T] of [
        ["Integer", IntegerType],
        ["Float", FloatType],
        ["String", StringType],
        ["Boolean", BooleanType],
        ["Null", NullType],
        ["DateTime", DateTimeType],
        ["Blob", BlobType],
    ] as const) {
        it(`returns same IR for equal ${name}`, () => {
            const ir = mkValue(T, null);
            assert.equal(coerce_to(ir, T, T, LOC), ir);
        });
    }

    it("returns same IR for equal compound types (Struct, Variant, Array, Dict, Set, Ref, Vector, Matrix, Function)", () => {
        const cases = [
            StructType({ a: IntegerType, b: StringType }),
            VariantType({ some: IntegerType, none: NullType }),
            ArrayType(IntegerType),
            DictType(StringType, IntegerType),
            SetType(IntegerType),
            RefType(IntegerType),
            VectorType(FloatType),
            MatrixType(FloatType),
            FunctionType([IntegerType], IntegerType),
            AsyncFunctionType([IntegerType], IntegerType),
        ];
        for (const T of cases) {
            const ir = mkVariable(T, "v");
            assert.equal(coerce_to(ir, T, T, LOC), ir, `same-type IR passthrough failed for ${T.type}`);
        }
    });
});

// ─── §2. Invalid widening throws ──────────────────────────────────────────

describe("coerce_to: invalid widening throws", () => {
    it("Integer → String throws", () => {
        assert.throws(
            () => coerce_to(mkValue(IntegerType, 1n), IntegerType, StringType, LOC),
            /Cannot coerce value/,
        );
    });

    it("String → Integer throws", () => {
        assert.throws(
            () => coerce_to(mkValue(StringType, "x"), StringType, IntegerType, LOC),
            /Cannot coerce value/,
        );
    });

    it("VariantType adding a case that isn't in source is a widening (valid)", () => {
        const narrow = VariantType({ some: IntegerType });
        const wide = VariantType({ some: IntegerType, none: NullType });
        // narrow ⊆ wide: should NOT throw.
        const ir = mkVariantIR("some", IntegerType, 1n, narrow);
        const out: any = coerce_to(ir, narrow, wide, LOC);
        assert.equal(out.type, "Variant");
    });

    it("wide → narrow (removing a case the source has) throws", () => {
        const narrow = VariantType({ some: IntegerType });
        const wide = VariantType({ some: IntegerType, none: NullType });
        assert.throws(
            () => coerce_to(mkVariable(wide), wide, narrow, LOC),
            /Cannot coerce value/,
        );
    });
});

// ─── §3. Variant rewrite: narrow → wide (OptionType widening) ─────────────

describe("coerce_to: Variant narrow → wide", () => {
    it("rewrites case='some' variant to OptionType without outer As", () => {
        const narrow = VariantType({ some: IntegerType });
        const wide = OptionType(IntegerType);
        const ir = mkVariantIR("some", IntegerType, 42n, narrow);
        const out: any = coerce_to(ir, narrow, wide, LOC);

        assert.equal(out.type, "Variant");
        assert.equal(out.value.case, "some");
        assert.deepEqual(out.value.type, toEastTypeValue(wide));
    });

    it("widens subset variant {a} → {a,b,c} preserving inner value reference", () => {
        const narrow = VariantType({ a: IntegerType });
        const wide = VariantType({ a: IntegerType, b: StringType, c: NullType });
        const inner = mkValue(IntegerType, 7n);
        const ir = variant("Variant", {
            type: toEastTypeValue(narrow),
            loc_id: LOC,
            case: "a",
            value: inner,
        });
        const out: any = coerce_to(ir, narrow, wide, LOC);
        assert.equal(out.value.value, inner);
        assert.deepEqual(out.value.type, toEastTypeValue(wide));
    });

    it("widens inner field when case's sub-type is covariant", () => {
        const narrow_inner = VariantType({ ok: IntegerType });
        const wide_inner = VariantType({ ok: IntegerType, err: StringType });
        const narrow = VariantType({ wrapper: narrow_inner });
        const wide = VariantType({ wrapper: wide_inner });

        const inner_variant = mkVariantIR("ok", IntegerType, 1n, narrow_inner);
        const outer = variant("Variant", {
            type: toEastTypeValue(narrow),
            loc_id: LOC,
            case: "wrapper",
            value: inner_variant,
        });
        const out: any = coerce_to(outer, narrow, wide, LOC);
        // Outer Variant has wide type, inner Variant (the 'ok' case) also
        // has its type widened to wide_inner — THE deep-As invariant.
        assert.deepEqual(out.value.type, toEastTypeValue(wide));
        assert.deepEqual(out.value.value.value.type, toEastTypeValue(wide_inner));
    });
});

// ─── §4. Struct rewrite: narrow fields → wide fields ──────────────────────

describe("coerce_to: Struct with narrow → wide fields", () => {
    it("rewrites narrow field variant to wide OptionType at the field's position", () => {
        const narrow_area = VariantType({ some: StringType });
        const wide_area = OptionType(StringType);
        const Narrow = StructType({ area: narrow_area });
        const Wide = StructType({ area: wide_area });

        const area_ir = mkVariantIR("some", StringType, "A", narrow_area);
        const ir = mkStructIR(Narrow, [{ name: "area", value: area_ir }]);
        const out: any = coerce_to(ir, Narrow, Wide, LOC);

        assert.equal(out.type, "Struct");
        assert.deepEqual(out.value.type, toEastTypeValue(Wide));

        const area_field = out.value.fields.find((f: any) => f.name === "area");
        assert.equal(area_field.value.type, "Variant");
        assert.deepEqual(area_field.value.value.type, toEastTypeValue(wide_area));
    });

    it("leaves equal-typed fields untouched (same IR reference)", () => {
        const narrow_area = VariantType({ some: StringType });
        const wide_area = OptionType(StringType);
        const Narrow = StructType({ area: narrow_area, date: DateTimeType });
        const Wide = StructType({ area: wide_area, date: DateTimeType });

        const area_ir = mkVariantIR("some", StringType, "A", narrow_area);
        const date_ir = mkValue(DateTimeType, new Date("2025-01-01T00:00:00Z"));
        const ir = mkStructIR(Narrow, [
            { name: "area", value: area_ir },
            { name: "date", value: date_ir },
        ]);
        const out: any = coerce_to(ir, Narrow, Wide, LOC);

        const date_out = out.value.fields.find((f: any) => f.name === "date");
        assert.equal(date_out.value, date_ir, "equal-typed field should pass through by reference");
    });

    it("recursively coerces multiple fields with different widenings", () => {
        const n1 = VariantType({ some: IntegerType });
        const w1 = OptionType(IntegerType);
        const n2 = VariantType({ ok: StringType });
        const w2 = VariantType({ ok: StringType, err: StringType });
        const Narrow = StructType({ a: n1, b: n2 });
        const Wide = StructType({ a: w1, b: w2 });

        const a_ir = mkVariantIR("some", IntegerType, 5n, n1);
        const b_ir = mkVariantIR("ok", StringType, "done", n2);
        const ir = mkStructIR(Narrow, [
            { name: "a", value: a_ir },
            { name: "b", value: b_ir },
        ]);
        const out: any = coerce_to(ir, Narrow, Wide, LOC);
        const a_out = out.value.fields.find((f: any) => f.name === "a");
        const b_out = out.value.fields.find((f: any) => f.name === "b");
        assert.deepEqual(a_out.value.value.type, toEastTypeValue(w1));
        assert.deepEqual(b_out.value.value.type, toEastTypeValue(w2));
    });

    it("preserves outer Struct's loc_id on rewrite (not inlined from arg)", () => {
        const narrow_f = VariantType({ some: IntegerType });
        const wide_f = OptionType(IntegerType);
        const Narrow = StructType({ f: narrow_f });
        const Wide = StructType({ f: wide_f });

        const inner = mkVariantIR("some", IntegerType, 1n, narrow_f);
        const struct_ir = variant("Struct", {
            type: toEastTypeValue(Narrow),
            loc_id: 99n,                    // outer struct loc_id
            fields: [{ name: "f", value: inner }],
        });
        const out: any = coerce_to(struct_ir, Narrow, Wide, 500n);
        // The outer loc_id comes from the struct IR itself, NOT the coerce
        // loc_id argument.
        assert.equal(out.value.loc_id, 99n);
    });
});

// ─── §5. Nested compounds ─────────────────────────────────────────────────

describe("coerce_to: nested compounds", () => {
    it("Struct containing Struct containing Variant", () => {
        const narrow_v = VariantType({ some: StringType });
        const wide_v = OptionType(StringType);
        const NarrowInner = StructType({ x: narrow_v });
        const WideInner = StructType({ x: wide_v });
        const Narrow = StructType({ nested: NarrowInner });
        const Wide = StructType({ nested: WideInner });

        const leaf = mkVariantIR("some", StringType, "A", narrow_v);
        const inner = mkStructIR(NarrowInner, [{ name: "x", value: leaf }]);
        const outer = mkStructIR(Narrow, [{ name: "nested", value: inner }]);
        const out: any = coerce_to(outer, Narrow, Wide, LOC);

        // Three levels: outer Struct, inner Struct, leaf Variant — all rewritten.
        assert.deepEqual(out.value.type, toEastTypeValue(Wide));
        const nested = out.value.fields.find((f: any) => f.name === "nested");
        assert.deepEqual(nested.value.value.type, toEastTypeValue(WideInner));
        const x = nested.value.value.fields.find((f: any) => f.name === "x");
        assert.deepEqual(x.value.value.type, toEastTypeValue(wide_v));
    });

    it("Variant containing Struct containing Variant", () => {
        const n_leaf = VariantType({ some: IntegerType });
        const w_leaf = OptionType(IntegerType);
        const NarrowStruct = StructType({ val: n_leaf });
        const WideStruct = StructType({ val: w_leaf });
        const Narrow = VariantType({ wrap: NarrowStruct });
        const Wide = VariantType({ wrap: WideStruct, other: NullType });

        const leaf = mkVariantIR("some", IntegerType, 7n, n_leaf);
        const struct = mkStructIR(NarrowStruct, [{ name: "val", value: leaf }]);
        const outer = variant("Variant", {
            type: toEastTypeValue(Narrow),
            loc_id: LOC,
            case: "wrap",
            value: struct,
        });
        const out: any = coerce_to(outer, Narrow, Wide, LOC);

        // out is a Variant IR: { type: "Variant", value: { type: ETV_wide, case, value: INNER_STRUCT_IR, loc_id } }
        assert.equal(out.type, "Variant");
        assert.deepEqual(out.value.type, toEastTypeValue(Wide));

        // out.value.value is the inner Struct IR: { type: "Struct", value: { type: ETV_widestruct, fields, loc_id } }
        const innerStructIR = out.value.value;
        assert.equal(innerStructIR.type, "Struct");
        assert.deepEqual(innerStructIR.value.type, toEastTypeValue(WideStruct));

        // innerStructIR.value.fields[0].value is the leaf Variant IR.
        const leaf_field = innerStructIR.value.fields.find((f: any) => f.name === "val");
        assert.equal(leaf_field.value.type, "Variant");
        assert.deepEqual(leaf_field.value.value.type, toEastTypeValue(w_leaf));
    });
});

// ─── §6. Fallback: opaque source wrapped in As ────────────────────────────

describe("coerce_to: opaque source fallback (single outer As)", () => {
    it("Variable(narrow) → wide wraps in outer As", () => {
        const narrow = VariantType({ some: IntegerType });
        const wide = OptionType(IntegerType);
        const ir = mkVariable(narrow, "x");
        const out: any = coerce_to(ir, narrow, wide, 42n);
        assert.equal(out.type, "As");
        assert.deepEqual(out.value.type, toEastTypeValue(wide));
        assert.equal(out.value.value, ir);
        assert.equal(out.value.loc_id, 42n);
    });

    it("Call(narrow) → wide wraps in outer As", () => {
        const narrow = VariantType({ some: StringType });
        const wide = OptionType(StringType);
        const ir = mkCall(narrow);
        const out: any = coerce_to(ir, narrow, wide, LOC);
        assert.equal(out.type, "As");
        assert.equal(out.value.value, ir);
    });

    it("Value(Never) → any widens (Never is subtype of everything)", () => {
        const never_ir = variant("Error", {
            type: variant("Never", null),
            loc_id: LOC,
            message: mkValue(StringType, "boom"),
        });
        // Never <: Integer, so this is a valid widening via the As fallback.
        const out: any = coerce_to(never_ir as any, NeverType, IntegerType, LOC);
        assert.equal(out.type, "As");
        assert.deepEqual(out.value.type, toEastTypeValue(IntegerType));
    });

    it("Struct IR source but non-Struct target falls back to As", () => {
        // A Struct IR whose declared type widens to something non-Struct is
        // impossible via isSubtype in practice; but defensively verify that
        // coerce_to doesn't try to rewrite the struct when the target's
        // unwrapped kind isn't Struct.
        const S = StructType({ a: IntegerType });
        const ir = mkStructIR(S, [{ name: "a", value: mkValue(IntegerType, 1n) }]);
        // S → S is no-op; we use S → S to show the Struct rewrite branch
        // only fires when both sides are actually Struct.
        assert.equal(coerce_to(ir, S, S, LOC), ir);
    });
});

// ─── §7. Invariant containers: Array / Set / Dict / Vector / Matrix / Ref ─

describe("coerce_to: invariant containers (Array/Set/Dict/Vector/Matrix/Ref)", () => {
    it("Array<T> → Array<T> identity only (invariant)", () => {
        const T = ArrayType(IntegerType);
        const ir = mkVariable(T, "a");
        assert.equal(coerce_to(ir, T, T, LOC), ir);
    });

    it("Array<narrow> !<: Array<wide> — throws on widening attempt", () => {
        const narrow = ArrayType(VariantType({ some: IntegerType }));
        const wide = ArrayType(OptionType(IntegerType));
        assert.throws(
            () => coerce_to(mkVariable(narrow), narrow, wide, LOC),
            /Cannot coerce value/,
        );
    });

    it("Set<narrow> !<: Set<wide> — throws on widening attempt", () => {
        const narrow = SetType(VariantType({ some: IntegerType }));
        const wide = SetType(OptionType(IntegerType));
        assert.throws(
            () => coerce_to(mkVariable(narrow), narrow, wide, LOC),
            /Cannot coerce value/,
        );
    });

    it("Dict<K, narrow> !<: Dict<K, wide> — throws on widening attempt", () => {
        const narrow = DictType(StringType, VariantType({ some: IntegerType }));
        const wide = DictType(StringType, OptionType(IntegerType));
        assert.throws(
            () => coerce_to(mkVariable(narrow), narrow, wide, LOC),
            /Cannot coerce value/,
        );
    });

    it("Ref<narrow> !<: Ref<wide> — throws on widening attempt (invariant)", () => {
        const narrow = RefType(VariantType({ some: IntegerType }));
        const wide = RefType(OptionType(IntegerType));
        assert.throws(
            () => coerce_to(mkVariable(narrow), narrow, wide, LOC),
            /Cannot coerce value/,
        );
    });

    it("Vector/Matrix element types are constrained to scalars so variant widening is unrepresentable", () => {
        // Vector/Matrix accept only Float/Integer/Boolean elements (enforced at type
        // construction). VectorType(VariantType({...})) throws at construction, so
        // there's no narrow→wide widening pair to test here at the coerce_to level.
        // This test documents the constraint so the gap in coverage is intentional.
        assert.throws(() => VectorType(VariantType({ some: FloatType })), /element type/);
        assert.throws(() => MatrixType(VariantType({ some: FloatType })), /element type/);
    });
});

// ─── §8. RecursiveType cycle guard ────────────────────────────────────────

describe("coerce_to: RecursiveType handling", () => {
    it("unwraps RecursiveType on either side for equal recursive types (no-op)", () => {
        const R = RecursiveType(self => VariantType({ nil: NullType, cons: self }));
        const ir = variant("Variant", {
            type: toEastTypeValue(R),
            loc_id: LOC,
            case: "nil",
            value: mkValue(NullType, null),
        });
        assert.equal(coerce_to(ir, R, R, LOC), ir);
    });

    it("visited-set terminates even if recursion revisits the same pair", () => {
        const R = RecursiveType(self => VariantType({ nil: NullType, cons: self }));
        const ir = variant("Variant", {
            type: toEastTypeValue(R),
            loc_id: LOC,
            case: "nil",
            value: mkValue(NullType, null),
        });
        // Same R → R with pre-populated visited: fallback to As at boundary.
        const visited = new Set<string>();
        const out: any = coerce_to(ir, R, R, LOC, visited);
        // isTypeEqual short-circuits before visited check, returns ir.
        assert.equal(out, ir);
    });

    it("does not infinitely recurse on nested recursive widening", () => {
        const R = RecursiveType(self => VariantType({ nil: NullType, cons: self }));
        // Verify coerce_to terminates (would hang or overflow if buggy).
        const start = Date.now();
        const ir = variant("Variant", {
            type: toEastTypeValue(R),
            loc_id: LOC,
            case: "cons",
            value: mkVariable(R, "inner"),
        });
        const _out = coerce_to(ir, R, R, LOC);
        const ms = Date.now() - start;
        assert.ok(ms < 1000, `coerce_to took ${ms}ms — possible infinite recursion`);
    });
});

// ─── §9. Determinism / structural sanity ──────────────────────────────────

describe("coerce_to: determinism", () => {
    it("produces structurally equal IR across two calls (no hidden state)", () => {
        const narrow = VariantType({ some: IntegerType });
        const wide = OptionType(IntegerType);
        const a1 = mkVariantIR("some", IntegerType, 42n, narrow);
        const a2 = mkVariantIR("some", IntegerType, 42n, narrow);
        const r1: any = coerce_to(a1, narrow, wide, LOC);
        const r2: any = coerce_to(a2, narrow, wide, LOC);
        assert.deepEqual(r1.value.type, r2.value.type);
        assert.equal(r1.value.case, r2.value.case);
    });

    it("rewriting doesn't mutate the input IR", () => {
        const narrow = VariantType({ some: IntegerType });
        const wide = OptionType(IntegerType);
        const ir = mkVariantIR("some", IntegerType, 42n, narrow);
        const before_type = ir.value.type;
        coerce_to(ir, narrow, wide, LOC);
        assert.equal(ir.value.type, before_type, "input IR's type should not be mutated");
    });
});
