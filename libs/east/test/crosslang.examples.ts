/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The cross-language compliance stem (#628): every program here is authored
 * again, construct for construct, in python
 * (`libs/east-py/packages/east-py/tests/conformance/test_cross_language_stem.py`),
 * which asserts the two builders produce the same normalized IR and the
 * same results on east-c. One construct family per example, no platform
 * calls, no host-side constants — exactly what both surfaces spell.
 */

import {
    East, example, variant, some,
    ArrayType, DictType, FloatType, IntegerType, OptionType, SetType, StringType, StructType, VariantType,
} from "@elaraai/east";

export const crosslangArithmetic = example({
    keywords: ["cross-language", "python", "arithmetic", "toFloat"],
    description: "Integer and float arithmetic — the same builtins from either language",
    fn: East.function([IntegerType, FloatType], FloatType, ($, n, x) =>
        n.multiply(2n).add(1n).toFloat().multiply(x).subtract(0.5)),
    inputs: [4n, 1.5],
    returns: 13.0,
});

export const crosslangStatements = example({
    keywords: ["cross-language", "python", "let", "assign", "for", "if"],
    description: "let / assign / for / if statements — the $ and b block surfaces agree",
    fn: East.function([ArrayType(IntegerType)], IntegerType, ($, xs) => {
        const total = $.let(0n);
        $.for(xs, ($, x) => {
            $.if(East.greater(x, 2n), $ => { $.assign(total, total.add(x)); });
        });
        return total;
    }),
    inputs: [[1n, 2n, 3n, 4n]],
    returns: 7n,
});

export const crosslangCallbacks = example({
    keywords: ["cross-language", "python", "filter", "map", "reduce", "callback"],
    description: "filter / map / reduce callbacks — bodies taking the block first in both languages",
    fn: East.function([ArrayType(IntegerType)], IntegerType, ($, xs) =>
        xs.filter(($, x) => East.equal(x.remainder(2n), 0n))
            .map(($, x) => x.multiply(x))
            .reduce(($, acc, x) => acc.add(x), 0n)),
    inputs: [[1n, 2n, 3n, 4n]],
    returns: 20n,
});

const Person = StructType({ name: StringType, age: IntegerType });

export const crosslangStructIfElse = example({
    keywords: ["cross-language", "python", "struct", "ifElse", "concat"],
    description: "Struct fields and a conditional expression",
    fn: East.function([Person], StringType, ($, p) =>
        East.less(p.age, 18n).ifElse($ => p.name.concat(" (minor)"), $ => p.name)),
    inputs: [{ name: "Ann", age: 12n }],
    returns: "Ann (minor)",
});

const Shape = VariantType({ circle: FloatType, square: FloatType });

export const crosslangVariantMatch = example({
    keywords: ["cross-language", "python", "variant", "match"],
    description: "A match expression over a variant",
    fn: East.function([Shape], FloatType, ($, s) => s.match({
        circle: ($, r) => r.multiply(r).multiply(3.0),
        square: ($, w) => w.multiply(w),
    })),
    inputs: [variant("square", 3.0)],
    returns: 9.0,
});

export const crosslangDictSet = example({
    keywords: ["cross-language", "python", "dict", "set", "get", "reduce"],
    description: "Dict lookups with a default callback, folded over a set",
    fn: East.function([DictType(StringType, IntegerType), SetType(StringType)], IntegerType, ($, d, keys) =>
        keys.reduce(($, acc, k) => acc.add(d.get(k, ($, _k) => 0n)), 0n)),
    inputs: [new Map([["a", 1n], ["b", 2n]]), new Set(["a", "c"])],
    returns: 1n,
});

export const crosslangStringsDatetime = example({
    keywords: ["cross-language", "python", "string", "datetime", "upperCase", "getYear"],
    description: "String and datetime builtins from either language",
    fn: East.function([StringType, IntegerType], IntegerType, ($, s, ms) =>
        s.upperCase().length().add(East.DateTime.fromEpochMilliseconds(ms).getYear())),
    inputs: ["hello", 1700000000000n],
    returns: 2028n,
});

export const crosslangTryCatch = example({
    keywords: ["cross-language", "python", "try", "catch", "error"],
    description: "A try / catch statement recovering from an out-of-bounds get",
    fn: East.function([ArrayType(IntegerType)], IntegerType, ($, xs) => {
        const r = $.let(0n);
        $.try($ => { $.assign(r, xs.get(99n)); }).catch(($, _message, _stack) => { $.assign(r, -1n); });
        return r;
    }),
    inputs: [[1n]],
    returns: -1n,
});

export const crosslangWhile = example({
    keywords: ["cross-language", "python", "while", "continue", "label"],
    description: "A while loop with a labelled continue",
    fn: East.function([IntegerType], IntegerType, ($, n) => {
        const i = $.let(0n);
        const acc = $.let(0n);
        $.while(East.less(i, n), ($, label) => {
            $.assign(i, i.add(1n));
            $.if(East.equal(i, 3n), $ => { $.continue(label); });
            $.assign(acc, acc.add(i));
        });
        return acc;
    }),
    inputs: [5n],
    returns: 12n,
});

export const crosslangUnwrapMerge = example({
    keywords: ["cross-language", "python", "unwrap", "merge", "error", "Never"],
    description: "unwrap and a dict merge with the default missing-key handler — the diverging error arms are Never-typed in both languages",
    fn: East.function([DictType(StringType, IntegerType), OptionType(IntegerType)], IntegerType, ($, d, o) => {
        const m = $.let(d.copy());
        $(m.merge("k", o.unwrap(), ($, old, v, _k) => old.add(v)));
        return m.get("k");
    }),
    inputs: [new Map([["k", 1n]]), some(2n)],
    returns: 3n,
});
