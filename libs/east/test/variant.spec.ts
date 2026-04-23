/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { ArrayType, DictType, East, Expr, IntegerType, NullType, OptionType, SetType, some, none, StringType, StructType, variant, VariantType } from "../src/index.js";
import { describeEast as describe, assertEast as assert } from "./platforms.spec.js";
import * as ex from "./variant.examples.js";

await describe("Variant", (test) => {
    assert.examples(test, {
        variantCreate: ex.variantCreate,
    });

    test("Variant equality and type merging", $ => {
        $(assert.equal(East.value(true).ifElse(_$ => variant("some", 42n), _$ => variant("none", null)), variant("some", 42n)));
        $(assert.equal(East.value(false).ifElse(_$ => variant("some", 42n), _$ => variant("none", null)), variant("none", null)));
    });

    assert.examples(test, {
        variantMatchStatement: ex.variantMatchStatement,
    });

    test("Match statement", $ => {
        const f = $.const(East.function([VariantType({ none: NullType, some: IntegerType })], IntegerType, ($, x) => {
            let ret = $.let(0n);
            $.match(x, {
                some: ($, data) => $.assign(ret, data),
            })
            $.return(ret);
        }));

        $(assert.equal(f(variant("some", 42n)), 42n));
        $(assert.equal(f(variant("none", null)), 0n));
    });

    assert.examples(test, {
        variantMatchTagStatement: ex.variantMatchTagStatement,
    });

    test("matchTag statement", $ => {
        const f = $.const(East.function([VariantType({ none: NullType, some: IntegerType })], IntegerType, ($, x) => {
            let ret = $.let(0n);
            $.matchTag(x, "some", ($, data) => $.assign(ret, data));
            $.return(ret);
        }));

        $(assert.equal(f(variant("some", 42n)), 42n));
        $(assert.equal(f(variant("none", null)), 0n));
    });

    assert.examples(test, {
        variantExprMatch: ex.variantExprMatch,
        variantMatchTagExpr: ex.variantMatchTagExpr,
        variantMatchPartial: ex.variantMatchPartial,
        variantMatchExhaustive: ex.variantMatchExhaustive,
        variantGetTag: ex.variantGetTag,
        variantHasTag: ex.variantHasTag,
        variantUnwrapWithDefault: ex.variantUnwrapWithDefault,
        variantUnwrap: ex.variantUnwrap,
        variantUnwrapAuto: ex.variantUnwrapAuto,
    });

    test("Expressions", $ => {
        const v1 = $.let(variant("some", 42n), OptionType(IntegerType));
        const v2 = $.let(variant("none", null), OptionType(IntegerType));

        $(assert.equal(Expr.match(v1, { some: ($, data) => data, none: () => 0n }), 42n));
        $(assert.equal(Expr.match(v2, { some: ($, data) => data, none: () => 0n }), 0n));

        $(assert.equal(v1.getTag(), "some"));
        $(assert.equal(v2.getTag(), "none"));

        $(assert.equal(v1.hasTag("some"), true));
        $(assert.equal(v1.hasTag("none"), false));
        $(assert.equal(v2.hasTag("some"), false));
        $(assert.equal(v2.hasTag("none"), true));

        $(assert.equal(v1.unwrap("some", _$ => 0n), 42n));
        $(assert.equal(v1.unwrap("none", _$ => null), null));
        $(assert.equal(v2.unwrap("some", _$ => 0n), 0n));
        $(assert.equal(v2.unwrap("none", _$ => null), null));

        $(assert.equal(v1.unwrap("some"), 42n));
        $(assert.throws(v1.unwrap("none")));
        $(assert.throws(v2.unwrap("some")));
        $(assert.equal(v2.unwrap("none"), null));

        $(assert.equal(v1.unwrap(), 42n));
        $(assert.throws(v2.unwrap()));

        const v3 = $.let(variant("other", 3.14));

        $(assert.throws(v3.unwrap()));

        const ResultType = VariantType({ ok: IntegerType, error: IntegerType, pending: NullType });
        const r1 = $.let(variant("ok", 100n), ResultType);
        const r2 = $.let(variant("error", -1n), ResultType);
        const r3 = $.let(variant("pending", null), ResultType);

        // matchTag: single tag match with default
        $(assert.equal(v1.matchTag("some", (_$, val) => val, _$ => 0n), 42n));
        $(assert.equal(v2.matchTag("some", (_$, val) => val, _$ => 0n), 0n));
        $(assert.equal(r1.matchTag("ok", (_$, val) => val, _$ => 0n), 100n));
        $(assert.equal(r2.matchTag("ok", (_$, val) => val, _$ => 0n), 0n));
        $(assert.equal(r3.matchTag("ok", (_$, val) => val, _$ => 0n), 0n));

        // partial match: only some cases + default (2nd arg)
        $(assert.equal(v1.match({ some: (_$, val) => val }, _$ => 0n), 42n));
        $(assert.equal(v2.match({ some: (_$, val) => val }, _$ => 0n), 0n));
        $(assert.equal(v1.match({ none: _$ => -1n }, _$ => -1n), -1n));
        $(assert.equal(v2.match({ none: _$ => -1n }, _$ => -1n), -1n));
        $(assert.equal(r1.match({ ok: (_$, val) => val, error: (_$, val) => val }, _$ => 0n), 100n));
        $(assert.equal(r2.match({ ok: (_$, val) => val, error: (_$, val) => val }, _$ => 0n), -1n));
        $(assert.equal(r3.match({ ok: (_$, val) => val, error: (_$, val) => val }, _$ => 0n), 0n));

        // exhaustive match: all cases handled, no default (no 2nd arg)
        $(assert.equal(v1.match({ some: (_$, val) => val, none: _$ => 0n }), 42n));
        $(assert.equal(v2.match({ some: (_$, val) => val, none: _$ => 0n }), 0n));
        $(assert.equal(r1.match({ ok: (_$, val) => val, error: (_$, val) => val, pending: _$ => 0n }), 100n));
        $(assert.equal(r2.match({ ok: (_$, val) => val, error: (_$, val) => val, pending: _$ => 0n }), -1n));
        $(assert.equal(r3.match({ ok: (_$, val) => val, error: (_$, val) => val, pending: _$ => 0n }), 0n));
    });

    assert.examples(test, {
        variantEquals: ex.variantEquals,
        variantNotEquals: ex.variantNotEquals,
    });

    test("Comparisons", $ => {
        // Equality tests
        $(assert.equal(East.value(variant("none", null)), variant("none", null)));
        $(assert.equal(East.value(variant("some", 42n)), variant("some", 42n)));
        $(assert.notEqual(East.value(variant("some", 42n)), variant("some", 43n)));

        // Same tag, different values - ordering tests
        $(assert.less(East.value(variant("some", 10n)), variant("some", 20n)));
        $(assert.greater(East.value(variant("some", 20n)), variant("some", 10n)));

        // Less than or equal / Greater than or equal
        $(assert.lessEqual(East.value(variant("none", null)), variant("none", null)))
        $(assert.lessEqual(East.value(variant("some", 10n)), variant("some", 20n)))
        $(assert.greaterEqual(East.value(variant("some", 42n)), variant("some", 42n)))
        $(assert.greaterEqual(East.value(variant("some", 20n)), variant("some", 10n)))

        // East.is, East.equal, East.less methods
        $(assert.equal(East.is(East.value(variant("some", 42n)), variant("some", 42n)), true));
        $(assert.equal(East.is(East.value(variant("some", 42n)), variant("some", 43n)), false));
        $(assert.equal(East.equal(East.value(variant("some", 42n)), variant("some", 42n)), true));
        $(assert.equal(East.equal(East.value(variant("some", 42n)), variant("some", 43n)), false));
        $(assert.equal(East.notEqual(East.value(variant("some", 42n)), variant("some", 43n)), true));
        $(assert.equal(East.less(East.value(variant("some", 10n)), variant("some", 20n)), true));
        $(assert.equal(East.greater(East.value(variant("some", 20n)), variant("some", 10n)), true));
        $(assert.equal(East.lessEqual(East.value(variant("some", 10n)), variant("some", 20n)), true));
        $(assert.equal(East.greaterEqual(East.value(variant("some", 20n)), variant("some", 10n)), true));

        // Instance method tests
        $(assert.equal(East.value(variant("some", 42n)).equals(variant("some", 42n)), true));
        $(assert.equal(East.value(variant("some", 42n)).equals(variant("some", 43n)), false));
        $(assert.equal(East.value(variant("some", 42n)).notEquals(variant("some", 43n)), true));
        $(assert.equal(East.value(variant("some", 42n)).notEquals(variant("some", 42n)), false));

        // TODO: Add cross-type variant comparison tests once universal comparison functions are available
    });

    test("Equality method aliases", $ => {
        // Test short aliases (eq, ne)
        $(assert.equal(East.value(variant("some", 42n)).eq(variant("some", 42n)), true));
        $(assert.equal(East.value(variant("some", 42n)).eq(variant("some", 43n)), false));
        $(assert.equal(East.value(variant("some", 42n)).ne(variant("some", 43n)), true));
        $(assert.equal(East.value(variant("some", 42n)).ne(variant("some", 42n)), false));

        // Test medium aliases (equal, notEqual)
        $(assert.equal(East.value(variant("some", 42n)).equal(variant("some", 42n)), true));
        $(assert.equal(East.value(variant("some", 42n)).notEqual(variant("some", 43n)), true));
    });

    // ─── Deep-As narrow → wide variant coercion ───────────────────────────
    //
    // These regress the failure mode where an unannotated `{some(x)}` literal
    // flows into a wider container — e.g. a dict whose key type has an
    // OptionType field, or an array with OptionType elements. Before deep-As,
    // the inner Variant IR kept its narrow declared type, so at runtime
    // east-c (and JS, via the same IR path) computed `case_idx` relative to
    // the narrow sorted case list. When that value was later read against the
    // wider container type, the tag flipped silently (`some`→`none`).

    test("Deep-As: narrow variant coerces in dict struct key", $ => {
        const KeyType = StructType({
            tag: OptionType(StringType),
        });
        const d = $.let(new Map(), DictType(KeyType, IntegerType));
        $(d.insertOrUpdate({ tag: some("a") }, 1n));
        $(d.insertOrUpdate({ tag: some("b") }, 1n));
        $(d.insertOrUpdate({ tag: none }, 1n));
        $(assert.equal(d.size(), 3n));
        // Count `some`-tagged entries via matchTag. Before deep-As the tag is
        // silently read as `none` and this assertion fails.
        const some_count = $.let(0n);
        $.for(d, ($, _v, k) => $.matchTag(k.tag, "some", ($) =>
            $.assign(some_count, some_count.add(1n))
        ));
        $(assert.equal(some_count, 2n));
    });

    test("Deep-As: narrow variant coerces in array element (unannotated literal)", $ => {
        const a = $.let([some(1n), some(2n), none], ArrayType(OptionType(IntegerType)));
        $(assert.equal(a.length(), 3n));
        $(assert.equal(a.get(0n).unwrap("some", () => 0n), 1n));
        $(assert.equal(a.get(1n).unwrap("some", () => 0n), 2n));
        $(assert.equal(a.get(2n).unwrap("some", () => 99n), 99n));
    });

    test("Deep-As: narrow variant coerces in dict value", $ => {
        const d = $.let(new Map(), DictType(StringType, OptionType(IntegerType)));
        $(d.insert("x", some(1n)));
        $(d.insert("y", none));
        $(assert.equal(d.get("x").unwrap("some", () => 0n), 1n));
        $(assert.equal(d.get("y").unwrap("some", () => 99n), 99n));
    });

    test("Deep-As: nested struct{tag: some(x)} inside an array", $ => {
        const Row = StructType({ tag: OptionType(StringType) });
        const a = $.let([{ tag: some("A") }, { tag: none }, { tag: some("B") }], ArrayType(Row));
        $(assert.equal(a.length(), 3n));
        $(assert.equal(a.get(0n).tag.unwrap("some", () => ""), "A"));
        $(assert.equal(a.get(1n).tag.unwrap("some", () => "default"), "default"));
        $(assert.equal(a.get(2n).tag.unwrap("some", () => ""), "B"));
    });

    test("Deep-As: struct with narrow variant field coerces through multiple insertions", $ => {
        // Mirrors the aggregation-pattern: build a struct key with a
        // narrow-typed variant field from a conditional, flow it into a
        // wider-typed dict, repeat.
        const KeyType = StructType({
            day: IntegerType,
            tag: OptionType(StringType),
        });
        const d = $.let(new Map(), DictType(KeyType, IntegerType));
        // Loop over varying day + tag combinations; some with a tag, some none.
        const labels = $.const(["a", "b", "c"]);
        const day_count = $.const(4n);
        $.for(East.Array.range(0n, day_count), ($, day) => {
            $.for(labels, ($, label) => {
                $(d.insertOrUpdate({ day: day, tag: some(label) }, 1n,
                    ($, existing, incoming) => existing.add(incoming)));
            });
            // A `none`-keyed entry per day.
            $(d.insertOrUpdate({ day: day, tag: none }, 10n,
                ($, existing, incoming) => existing.add(incoming)));
        });
        // Total entries: days * (labels + 1 none) = 4 * (3 + 1) = 16
        $(assert.equal(d.size(), 16n));

        // Sum of `some` entries should be days*labels*1 = 12
        // Sum of `none` entries should be days*10 = 40
        const some_sum = $.let(0n);
        const none_sum = $.let(0n);
        $.for(d, ($, v, k) => $.match(k.tag, {
            some: ($, _label) => $.assign(some_sum, some_sum.add(v)),
            none: ($) => $.assign(none_sum, none_sum.add(v)),
        }));
        $(assert.equal(some_sum, 12n));
        $(assert.equal(none_sum, 40n));
    });

    test("Deep-As: beast2 round-trip preserves narrow→wide coerced tags", $ => {
        // Build a small dict whose key has a narrow→wide coerced Option field,
        // serialize to beast2 (headerless), round-trip, verify tags.
        const KeyType = StructType({ tag: OptionType(StringType) });
        const DT = DictType(KeyType, IntegerType);
        const d = $.let(new Map(), DT);
        $(d.insertOrUpdate({ tag: some("a") }, 1n));
        $(d.insertOrUpdate({ tag: none }, 2n));
        $(d.insertOrUpdate({ tag: some("b") }, 3n));

        // Round-trip via beast2 v2.
        const blob = $.let(East.Blob.encodeBeast(d, 'v2'));
        const restored = $.let(blob.decodeBeast(DT, 'v2'));
        $(assert.equal(restored.size(), 3n));
        // Tag counts must match post-decode.
        const some_count = $.let(0n);
        const none_count = $.let(0n);
        $.for(restored, ($, _v, k) => $.match(k.tag, {
            some: ($, _label) => $.assign(some_count, some_count.add(1n)),
            none: ($) => $.assign(none_count, none_count.add(1n)),
        }));
        $(assert.equal(some_count, 2n));
        $(assert.equal(none_count, 1n));
    });

    test("Deep-As: narrow Variant inside variant (recursive widening stops at leaf)", $ => {
        // Construct a variant wrapping another variant, narrow in both
        // positions — widened to Option<Option<T>> on $.let.
        const v = $.let(some(some(42n)), OptionType(OptionType(IntegerType)));
        // Outer is `some(some(42))`
        $(assert.equal(v.unwrap("some", () => none).unwrap("some", () => 0n), 42n));
    });

    test("Deep-As: $.let-bound narrow struct widens correctly when used in wider context (beast2 round-trip)", $ => {
        // The gap not covered by TS-side deep-As: the struct literal is bound
        // to a variable FIRST, then flowed into a wider-keyed dict. At the
        // $.let binding both sides are narrow (inferred), so TS can't rewrite
        // the inner Variant IR to wide. At the call site `coerce_to` sees a
        // Variable IR — not a Struct literal — and falls back to a single
        // outer As. The inner Variant value is therefore constructed under
        // the narrow VariantType({some: String}) with case_idx=0 against the
        // narrow sorted list [some]. If the beast2 encoder trusts that stored
        // case_idx against the wider OptionType sorted list [none, some], it
        // writes `.none` — silent tag swap. Fix: encoder looks up case_idx
        // by tag against the target type at encode time.
        const KeyType = StructType({ tag: OptionType(StringType) });
        const DT = DictType(KeyType, IntegerType);
        const d = $.let(new Map(), DT);
        // Bind via $.let FIRST, then pass as a variable — production pattern.
        const key_a = $.let({ tag: some("a") });
        const key_b = $.let({ tag: some("b") });
        const key_none = $.let({ tag: none });
        $(d.insertOrUpdate(key_a, 1n));
        $(d.insertOrUpdate(key_b, 1n));
        $(d.insertOrUpdate(key_none, 1n));

        // In-memory tags must be preserved even before serialisation.
        const inmem_some = $.let(0n);
        $.for(d, ($, _v, k) => $.matchTag(k.tag, "some", ($) =>
            $.assign(inmem_some, inmem_some.add(1n))
        ));
        $(assert.equal(inmem_some, 2n));

        // Beast2 round-trip must preserve the same tag counts. Before the
        // tag-first encoder fix, this encoded 0 .some / 3 .none.
        const blob = $.let(East.Blob.encodeBeast(d, 'v2'));
        const restored = $.let(blob.decodeBeast(DT, 'v2'));
        $(assert.equal(restored.size(), 3n));
        const roundtrip_some = $.let(0n);
        const roundtrip_none = $.let(0n);
        $.for(restored, ($, _v, k) => $.match(k.tag, {
            some: ($, _label) => $.assign(roundtrip_some, roundtrip_some.add(1n)),
            none: ($) => $.assign(roundtrip_none, roundtrip_none.add(1n)),
        }));
        $(assert.equal(roundtrip_some, 2n));
        $(assert.equal(roundtrip_none, 1n));
    });

    test("Deep-As: $.let-bound narrow variant field inside struct-key with volume (stress tag→idx hash)", $ => {
        // Heavier stress for the tag-lookup path: hundreds of keys all with
        // the same narrow-typed variant field, all `.some`. If encode misreads
        // any one of them as `.none`, the roundtrip some-count will mismatch.
        const KeyType = StructType({ day: IntegerType, tag: OptionType(StringType) });
        const DT = DictType(KeyType, IntegerType);
        const d = $.let(new Map(), DT);

        // 200 keys, all `.some`.
        $.for(East.Array.range(0n, 200n), ($, i) => {
            const key = $.let({ day: i, tag: some("X") });  // narrow struct via $.let
            $(d.insertOrUpdate(key, 1n));
        });
        $(assert.equal(d.size(), 200n));

        // Round-trip and count tags.
        const blob = $.let(East.Blob.encodeBeast(d, 'v2'));
        const restored = $.let(blob.decodeBeast(DT, 'v2'));
        const some_count = $.let(0n);
        const none_count = $.let(0n);
        $.for(restored, ($, _v, k) => $.match(k.tag, {
            some: ($, _l) => $.assign(some_count, some_count.add(1n)),
            none: ($) => $.assign(none_count, none_count.add(1n)),
        }));
        $(assert.equal(some_count, 200n));
        $(assert.equal(none_count, 0n));
    });

    test("Deep-As: set with narrow struct-variant key coerces correctly", $ => {
        const KeyType = StructType({ tag: OptionType(StringType) });
        const s = $.let(new Set([{ tag: some("a") }, { tag: none }]), SetType(KeyType));
        $(s.insert({ tag: some("b") }));
        // Re-inserting an equal key must be a no-op (verified via tryInsert
        // returning false), confirming narrow→wide coerced keys compare
        // equal to the stored ones.
        $(assert.equal(s.tryInsert({ tag: some("a") }), false));
        $(assert.equal(s.size(), 3n));
        const some_count = $.let(0n);
        $.for(s, ($, k) => $.matchTag(k.tag, "some", ($) =>
            $.assign(some_count, some_count.add(1n))
        ));
        $(assert.equal(some_count, 2n));
    });
});
