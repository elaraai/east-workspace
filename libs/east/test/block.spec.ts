/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import {
    East,
    ArrayType,
    IntegerType,
    NullType,
    BooleanType,
    FloatType,
    StringType,
    DateTimeType,
    BlobType,
    SetType,
    DictType,
    StructType,
    VariantType,
    OptionType,
    FunctionType,
    variant,
    some,
    none,
    type ArrayExpr,
    type BooleanExpr,
    type ExprType,
    type IntegerExpr,
    type StringExpr,
    type option,
} from "../src/index.js";
import { describeEast as describe, assertEast as assert } from "./platforms.spec.js";
import * as ex from "./block.examples.js";

await describe("Block", (test) => {
    assert.examples(test, { blockConst: ex.blockConst, blockLet: ex.blockLet, blockAssign: ex.blockAssign });

    test("const() with null", $ => {
        const x = $.const(null);
        $(assert.equal(x, null));
    });

    test("const() with null and type", $ => {
        const x = $.const(null, NullType);
        $(assert.equal(x, null));
    });

    test("const() with boolean", $ => {
        const x = $.const(true);
        $(assert.equal(x, true));
        const y = $.const(false);
        $(assert.equal(y, false));
    });

    test("const() with boolean and type", $ => {
        const x = $.const(true, BooleanType);
        $(assert.equal(x, true));
        const y = $.const(false, BooleanType);
        $(assert.equal(y, false));
    });

    test("const() with integer", $ => {
        const x = $.const(42n);
        $(assert.equal(x, 42n));
    });

    test("const() with integer and type", $ => {
        const x = $.const(42n, IntegerType);
        $(assert.equal(x, 42n));
    });

    test("const() with float", $ => {
        const x = $.const(3.14);
        $(assert.equal(x, 3.14));
    });

    test("const() with float and type", $ => {
        const x = $.const(3.14, FloatType);
        $(assert.equal(x, 3.14));
    });

    test("const() with string", $ => {
        const x = $.const("hello");
        $(assert.equal(x, "hello"));
    });

    test("const() with string and type", $ => {
        const x = $.const("hello", StringType);
        $(assert.equal(x, "hello"));
    });

    test("const() with datetime", $ => {
        const date = new Date("2025-01-01T00:00:00Z");
        const x = $.const(date);
        $(assert.equal(x, date));
    });

    test("const() with datetime and type", $ => {
        const date = new Date("2025-01-01T00:00:00Z");
        const x = $.const(date, DateTimeType);
        $(assert.equal(x, date));
    });

    test("const() with blob", $ => {
        const blob = new Uint8Array([1, 2, 3, 4]);
        const x = $.const(blob);
        $(assert.equal(x, blob));
    });

    test("const() with blob and type", $ => {
        const blob = new Uint8Array([1, 2, 3, 4]);
        const x = $.const(blob, BlobType);
        $(assert.equal(x, blob));
    });

    test("const() with array", $ => {
        const arr = [1n, 2n, 3n];
        const x = $.const(arr);
        $(assert.equal(x, arr));
    });

    test("const() with array and type", $ => {
        const arr = [1n, 2n, 3n];
        const x = $.const(arr, ArrayType(IntegerType));
        $(assert.equal(x, arr));
    });

    test("const() with set", $ => {
        const set = new Set([1n, 2n, 3n]);
        const x = $.const(set);
        $(assert.equal(x, set));
    });

    test("const() with set and type", $ => {
        const set = new Set([1n, 2n, 3n]);
        const x = $.const(set, SetType(IntegerType));
        $(assert.equal(x, set));
    });

    test("const() with dict", $ => {
        const dict = new Map([["a", 1n], ["b", 2n]]);
        const x = $.const(dict);
        $(assert.equal(x, dict));
    });

    test("const() with dict and type", $ => {
        const dict = new Map([["a", 1n], ["b", 2n]]);
        const x = $.const(dict, DictType(StringType, IntegerType));
        $(assert.equal(x, dict));
    });

    test("const() with struct", $ => {
        const struct = { x: 10n, y: 20n };
        const x = $.const(struct);
        $(assert.equal(x, struct));
    });

    test("const() with struct and type", $ => {
        const struct = { x: 10n, y: 20n };
        const x = $.const(struct, StructType({ x: IntegerType, y: IntegerType }));
        $(assert.equal(x, struct));
    });

    test("const() with variant", $ => {
        const v = variant("success", 42n);
        const x = $.const(v, VariantType({ success: IntegerType, failure: StringType }));
        $(assert.equal(x, v));
    });

    test("const() with expression", $ => {
        const x = $.const(East.value(42n));
        $(assert.equal(x, 42n));
    });

    test("let() with null", $ => {
        const x = $.let(null);
        $(assert.equal(x, null));
    });

    test("let() with null and type", $ => {
        const x = $.let(null, NullType);
        $(assert.equal(x, null));
    });

    test("let() with boolean", $ => {
        const x = $.let(true);
        $(assert.equal(x, true));
        const y = $.let(false);
        $(assert.equal(y, false));
    });

    test("let() with boolean and type", $ => {
        const x = $.let(true, BooleanType);
        $(assert.equal(x, true));
        const y = $.let(false, BooleanType);
        $(assert.equal(y, false));
    });

    test("let() with integer", $ => {
        const x = $.let(42n);
        $(assert.equal(x, 42n));
    });

    test("let() with integer and type", $ => {
        const x = $.let(42n, IntegerType);
        $(assert.equal(x, 42n));
    });

    test("let() with float", $ => {
        const x = $.let(3.14);
        $(assert.equal(x, 3.14));
    });

    test("let() with float and type", $ => {
        const x = $.let(3.14, FloatType);
        $(assert.equal(x, 3.14));
    });

    test("let() with string", $ => {
        const x = $.let("hello");
        $(assert.equal(x, "hello"));
    });

    test("let() with string and type", $ => {
        const x = $.let("hello", StringType);
        $(assert.equal(x, "hello"));
    });

    test("let() with datetime", $ => {
        const date = new Date("2025-01-01T00:00:00Z");
        const x = $.let(date);
        $(assert.equal(x, date));
    });

    test("let() with datetime and type", $ => {
        const date = new Date("2025-01-01T00:00:00Z");
        const x = $.let(date, DateTimeType);
        $(assert.equal(x, date));
    });

    test("let() with blob", $ => {
        const blob = new Uint8Array([1, 2, 3, 4]);
        const x = $.let(blob);
        $(assert.equal(x, blob));
    });

    test("let() with blob and type", $ => {
        const blob = new Uint8Array([1, 2, 3, 4]);
        const x = $.let(blob, BlobType);
        $(assert.equal(x, blob));
    });

    test("let() with array", $ => {
        const arr = [1n, 2n, 3n];
        const x = $.let(arr);
        $(assert.equal(x, arr));
    });

    test("let() with array and type", $ => {
        const arr = [1n, 2n, 3n];
        const x = $.let(arr, ArrayType(IntegerType));
        $(assert.equal(x, arr));
    });

    test("let() with set", $ => {
        const set = new Set([1n, 2n, 3n]);
        const x = $.let(set);
        $(assert.equal(x, set));
    });

    test("let() with set and type", $ => {
        const set = new Set([1n, 2n, 3n]);
        const x = $.let(set, SetType(IntegerType));
        $(assert.equal(x, set));
    });

    test("let() with dict", $ => {
        const dict = new Map([["a", 1n], ["b", 2n]]);
        const x = $.let(dict);
        $(assert.equal(x, dict));
    });

    test("let() with dict and type", $ => {
        const dict = new Map([["a", 1n], ["b", 2n]]);
        const x = $.let(dict, DictType(StringType, IntegerType));
        $(assert.equal(x, dict));
    });

    test("let() with struct", $ => {
        const struct = { x: 10n, y: 20n };
        const x = $.let(struct);
        $(assert.equal(x, struct));
    });

    test("let() with struct and type", $ => {
        const struct = { x: 10n, y: 20n };
        const x = $.let(struct, StructType({ x: IntegerType, y: IntegerType }));
        $(assert.equal(x, struct));
    });

    test("let() with variant", $ => {
        const v = variant("success", 42n);
        const x = $.let(v, VariantType({ success: IntegerType, failure: StringType }));
        $(assert.equal(x, v));
    });

    test("let() allows reassignment", $ => {
        const x = $.let(42n);
        $.assign(x, 43n);
        $(assert.equal(x, 43n));
    });

    test("assign() with null", $ => {
        const x = $.let(null);
        $.assign(x, null);
        $(assert.equal(x, null));
    });

    test("assign() with boolean", $ => {
        const x = $.let(true);
        $.assign(x, false);
        $(assert.equal(x, false));
        $.assign(x, true);
        $(assert.equal(x, true));
    });

    test("assign() with integer", $ => {
        const x = $.let(0n);
        $.assign(x, 5n);
        $(assert.equal(x, 5n));
        $.assign(x, 10n);
        $(assert.equal(x, 10n));
    });

    test("assign() with float", $ => {
        const x = $.let(0.0);
        $.assign(x, 3.14);
        $(assert.equal(x, 3.14));
        $.assign(x, 2.71);
        $(assert.equal(x, 2.71));
    });

    test("assign() with string", $ => {
        const x = $.let("hello");
        $.assign(x, "world");
        $(assert.equal(x, "world"));
        $.assign(x, "goodbye");
        $(assert.equal(x, "goodbye"));
    });

    test("assign() with datetime", $ => {
        const date1 = new Date("2025-01-01T00:00:00Z");
        const date2 = new Date("2025-12-31T23:59:59Z");
        const x = $.let(date1);
        $.assign(x, date2);
        $(assert.equal(x, date2));
    });

    test("assign() with blob", $ => {
        const blob1 = new Uint8Array([1, 2, 3]);
        const blob2 = new Uint8Array([4, 5, 6]);
        const x = $.let(blob1);
        $.assign(x, blob2);
        $(assert.equal(x, blob2));
    });

    test("assign() with array", $ => {
        const arr1 = [1n, 2n, 3n];
        const arr2 = [4n, 5n, 6n];
        const x = $.let(arr1);
        $.assign(x, arr2);
        $(assert.equal(x, arr2));
    });

    test("assign() with set", $ => {
        const set1 = new Set([1n, 2n, 3n]);
        const set2 = new Set([4n, 5n, 6n]);
        const x = $.let(set1);
        $.assign(x, set2);
        $(assert.equal(x, set2));
    });

    test("assign() with dict", $ => {
        const dict1 = new Map([["a", 1n], ["b", 2n]]);
        const dict2 = new Map([["c", 3n], ["d", 4n]]);
        const x = $.let(dict1);
        $.assign(x, dict2);
        $(assert.equal(x, dict2));
    });

    test("assign() with struct", $ => {
        const struct1 = { x: 10n, y: 20n };
        const struct2 = { x: 30n, y: 40n };
        const x = $.let(struct1);
        $.assign(x, struct2);
        $(assert.equal(x, struct2));
    });

    test("assign() with variant", $ => {
        const v1 = variant("success", 42n);
        const v2 = variant("failure", "error");
        const x = $.let(v1, VariantType({ success: IntegerType, failure: StringType }));
        $.assign(x, v2);
        $(assert.equal(x, v2));
    });

    test("assign() with expression", $ => {
        const x = $.let(5n);
        const y = $.let(10n);
        $.assign(x, x.add(y));
        $(assert.equal(x, 15n));
    });

    test("assign() with an error raises it", $ => {
        // An error is a value of Never: it stands where the Integer goes, uncast.
        const fn = East.function([BooleanType], IntegerType, ($, fail) => {
            const x = $.let(1n);
            $.if(fail, $ => {
                $.assign(x, East.error("boom"));
            });
            return x;
        });
        $(assert.equal(fn(false), 1n));
        $(assert.throws(fn(true), /boom/));
    });

    assert.examples(test, { blockIf: ex.blockIf, blockIfElse: ex.blockIfElse, blockIfElseIf: ex.blockIfElseIf });

    test("if() with true condition", $ => {
        const result = $.let(0n);
        $.if(true, $ => {
            $.assign(result, 42n);
        });
        $(assert.equal(result, 42n));
    });

    test("if() with false condition", $ => {
        const result = $.let(0n);
        $.if(false, $ => {
            $.assign(result, 42n);
        });
        $(assert.equal(result, 0n));
    });

    test("if().else()", $ => {
        const result = $.let(0n);
        $.if(false, $ => {
            $.assign(result, 42n);
        }).else($ => {
            $.assign(result, 99n);
        });
        $(assert.equal(result, 99n));
    });

    test("if().elseIf().else()", $ => {
        const result = $.let(0n);
        const x = $.const(5n);
        $.if(East.equal(x, 0n), $ => {
            $.assign(result, 1n);
        }).elseIf(East.equal(x, 5n), $ => {
            $.assign(result, 2n);
        }).else($ => {
            $.assign(result, 3n);
        });
        $(assert.equal(result, 2n));
    });

    assert.examples(test, { blockWhile: ex.blockWhile, blockWhileBreak: ex.blockWhileBreak, blockWhileContinue: ex.blockWhileContinue });

    test("while() loop", $ => {
        const i = $.let(0n);
        $.while(East.less(i, 5n), ($) => {
            $.assign(i, i.add(1n));
        });
        $(assert.equal(i, 5n));
    });

    test("while() with break", $ => {
        const i = $.let(0n);
        $.while(true, ($, label) => {
            $.assign(i, i.add(1n));
            $.if(East.equal(i, 3n), $ => {
                $.break(label);
            });
        });
        $(assert.equal(i, 3n));
    });

    test("while() with continue", $ => {
        const i = $.let(0n);
        const sum = $.let(0n);
        $.while(East.less(i, 5n), ($, label) => {
            $.assign(i, i.add(1n));
            $.if(East.equal(i, 3n), $ => {
                $.continue(label);
            });
            $.assign(sum, sum.add(i));
        });
        $(assert.equal(sum, 12n)); // 1 + 2 + 4 + 5 = 12
    });

    assert.examples(test, { blockForArray: ex.blockForArray, blockForSet: ex.blockForSet, blockForDict: ex.blockForDict, blockForBreak: ex.blockForBreak, blockForContinue: ex.blockForContinue });

    test("for() over array", $ => {
        const arr = $.const([1n, 2n, 3n]);
        const sum = $.let(0n);
        $.for(arr, ($, value, _key, _label) => {
            $.assign(sum, sum.add(value));
        });
        $(assert.equal(sum, 6n));
    });

    test("for() over array with index", $ => {
        const arr = $.const([10n, 20n, 30n]);
        const result = $.let([], ArrayType(IntegerType));
        $.for(arr, ($, _value, key) => {
            $(result.pushLast(key));
        });
        $(assert.equal(result, [0n, 1n, 2n]));
    });

    test("for() over set", $ => {
        const set = $.const(new Set([1n, 2n, 3n]));
        const sum = $.let(0n);
        $.for(set, ($, key) => {
            $.assign(sum, sum.add(key));
        });
        $(assert.equal(sum, 6n));
    });

    test("for() over dict", $ => {
        const dict = $.const(new Map([["a", 1n], ["b", 2n], ["c", 3n]]));
        const sum = $.let(0n);
        $.for(dict, ($, value) => {
            $.assign(sum, sum.add(value));
        });
        $(assert.equal(sum, 6n));
    });

    test("for() with break", $ => {
        const arr = $.const([1n, 2n, 3n, 4n, 5n]);
        const sum = $.let(0n);
        $.for(arr, ($, value, _key, label) => {
            $.if(East.equal(value, 3n), $ => {
                $.break(label);
            });
            $.assign(sum, sum.add(value));
        });
        $(assert.equal(sum, 3n)); // 1 + 2 = 3
    });

    test("for() with continue", $ => {
        const arr = $.const([1n, 2n, 3n, 4n, 5n]);
        const sum = $.let(0n);
        $.for(arr, ($, value, _key, label) => {
            $.if(East.equal(value, 3n), $ => {
                $.continue(label);
            });
            $.assign(sum, sum.add(value));
        });
        $(assert.equal(sum, 12n)); // 1 + 2 + 4 + 5 = 12
    });

    // =========================================================================
    // Nested loop break/continue tests - these test that break/continue with
    // labels work correctly when called from nested loops
    // =========================================================================

    test("break outer loop from inner loop", $ => {
        const outer = $.const([1n, 2n, 3n]);
        const inner = $.const([10n, 20n, 30n]);
        const sum = $.let(0n);

        $.for(outer, ($, o, _oi, outer_label) => {
            $.for(inner, ($, i) => {
                $.if(East.equal(o, 2n).bitAnd(East.equal(i, 20n)), $ => {
                    $.break(outer_label); // Break outer loop from inner
                });
                $.assign(sum, sum.add(i));
            });
            $.assign(sum, sum.add(o));
        });
        // o=1: inner adds 10+20+30=60, outer adds 1 -> 61
        // o=2: inner adds 10, then breaks outer
        $(assert.equal(sum, 71n));
    });

    test("continue outer loop from inner loop", $ => {
        const outer = $.const([1n, 2n, 3n]);
        const inner = $.const([10n, 20n, 30n]);
        const sum = $.let(0n);

        $.for(outer, ($, o, _oi, outer_label) => {
            $.for(inner, ($, i) => {
                $.if(East.equal(o, 2n).bitAnd(East.equal(i, 20n)), $ => {
                    $.continue(outer_label); // Continue outer loop from inner
                });
                $.assign(sum, sum.add(i));
            });
            $.assign(sum, sum.add(o));
        });
        // o=1: inner adds 10+20+30=60, outer adds 1 -> 61
        // o=2: inner adds 10, then continues outer (skips rest of inner and outer body)
        // o=3: inner adds 10+20+30=60, outer adds 3 -> 134
        $(assert.equal(sum, 134n));
    });

    test("continue outer loop from deeply nested scope", $ => {
        const arr = $.const([1n, 2n, 3n, 4n, 5n]);
        const sum = $.let(0n);

        $.for(arr, ($, value, _key, outer_label) => {
            // Nested $.if inside $.if
            $.if(East.greater(value, 0n), $ => {
                $.if(East.equal(value, 3n), $ => {
                    $.continue(outer_label); // Skip 3
                });
            });
            $.assign(sum, sum.add(value));
        });
        $(assert.equal(sum, 12n)); // 1 + 2 + 4 + 5 = 12
    });

    assert.examples(test, { blockReturn: ex.blockReturn });

    test("return() from function", $ => {
        const fn = East.function([IntegerType], IntegerType, ($, x) => {
            $.if(East.equal(x, 0n), $ => {
                $.return(1n);
            });
            return x.multiply(2n);
        });
        $(assert.equal(fn(0n), 1n));
        $(assert.equal(fn(5n), 10n));
    });

    assert.examples(test, { blockTryCatch: ex.blockTryCatch, blockTryFinally: ex.blockTryFinally, blockTryCatchFinally: ex.blockTryCatchFinally });

    test("try-catch with no error", $ => {
        const result = $.let(0n);
        $.try($ => {
            $.assign(result, 42n);
        }).catch(($, _message, _stack) => {
            $.assign(result, -1n);
        });
        $(assert.equal(result, 42n));
    });

    test("try-catch with error", $ => {
        const result = $.let(0n);
        const arr = $.const([1n, 2n, 3n]);
        $.try($ => {
            $(arr.get(10n));  // Out of bounds error
            $.assign(result, 42n);
        }).catch(($, _message, _stack) => {
            $.assign(result, -1n);
        });
        $(assert.equal(result, -1n));
    });

    test("try-catch returns correct type on success", $ => {
        const arr = $.const([1n, 2n, 3n]);
        const result = $.let(0n);
        $.try($ => {
            $.assign(result, arr.get(0n));
        }).catch(($, _message, _stack) => {
            $.assign(result, -1n);
        });
        $(assert.equal(result, 1n));
    });

    test("try-catch returns correct type on error", $ => {
        const arr = $.const([1n, 2n, 3n]);
        const result = $.let(0n);
        $.try($ => {
            $.assign(result, arr.get(10n));  // Out of bounds
        }).catch(($, _message, _stack) => {
            $.assign(result, -1n);
        });
        $(assert.equal(result, -1n));
    });

    test("try-finally executes finally on success", $ => {
        const result = $.let(0n);
        const finallyExecuted = $.let(false);
        $.try($ => {
            $.assign(result, 42n);
        }).finally($ => {
            $.assign(finallyExecuted, true);
        });
        $(assert.equal(result, 42n));
        $(assert.equal(finallyExecuted, true));
    });

    test("try-finally executes finally on error", $ => {
        const finallyExecuted = $.let(false);
        const arr = $.const([1n, 2n, 3n]);
        $.try($ => {
            $(arr.get(10n));  // Out of bounds error - will throw
        }).catch((_$, _message, _stack) => {
            // Catch the error so test doesn't fail
        }).finally($ => {
            $.assign(finallyExecuted, true);
        });
        $(assert.equal(finallyExecuted, true));
    });

    test("try-catch-finally all execute correctly", $ => {
        const result = $.let(0n);
        const finallyExecuted = $.let(false);
        $.try($ => {
            $.assign(result, 42n);
        }).catch(($, _message, _stack) => {
            $.assign(result, -1n);
        }).finally($ => {
            $.assign(finallyExecuted, true);
        });
        $(assert.equal(result, 42n));
        $(assert.equal(finallyExecuted, true));
    });

    test("try-catch-finally executes finally after catch", $ => {
        const result = $.let(0n);
        const finallyExecuted = $.let(false);
        const arr = $.const([1n, 2n, 3n]);
        $.try($ => {
            $(arr.get(10n));  // Out of bounds error
            $.assign(result, 42n);
        }).catch(($, _message, _stack) => {
            $.assign(result, -1n);
        }).finally($ => {
            $.assign(finallyExecuted, true);
        });
        $(assert.equal(result, -1n));
        $(assert.equal(finallyExecuted, true));
    });

    test("finally executes on early return from try", $ => {
        const finallyExecuted = $.let(false);
        const fn = East.function([IntegerType], IntegerType, ($, x) => {
            $.try($ => {
                $.if(East.equal(x, 0n), $ => {
                    $.return(1n);
                });
                $.return(x.multiply(2n));
            }).finally($ => {
                $.assign(finallyExecuted, true);
            });
            return 999n;  // Should not reach here
        });
        $(assert.equal(fn(0n), 1n));
        $(assert.equal(finallyExecuted, true));
    });

    test("finally executes on early return from catch", $ => {
        const finallyExecuted = $.let(false);
        const arr = $.const([1n, 2n, 3n]);
        const fn = East.function([], IntegerType, ($) => {
            $.try($ => {
                $(arr.get(10n));  // Out of bounds error
                $.return(42n);
            }).catch(($, _message, _stack) => {
                $.return(-1n);
            }).finally($ => {
                $.assign(finallyExecuted, true);
            });
            return 999n;  // Should not reach here
        });
        $(assert.equal(fn(), -1n));
        $(assert.equal(finallyExecuted, true));
    });

    test("finally can modify variables but not affect return value", $ => {
        const sideEffect = $.let(0n);
        const fn = East.function([], IntegerType, ($) => {
            $.try($ => {
                $.return(42n);
            }).finally($ => {
                $.assign(sideEffect, 100n);  // Side effect
            });
            return 999n;  // Should not reach here
        });
        const result = fn();
        $(assert.equal(result, 42n));  // Return value unaffected
        $(assert.equal(sideEffect, 100n));  // Side effect executed
    });

    test("finally block with multiple statements", $ => {
        const counter = $.let(0n);
        $.try($ => {
            $.assign(counter, 1n);
        }).finally($ => {
            $.assign(counter, counter.add(1n));
            $.assign(counter, counter.add(1n));
            $.assign(counter, counter.add(1n));
        });
        $(assert.equal(counter, 4n));
    });

    test("nested try-finally blocks", $ => {
        const outer = $.let(false);
        const inner = $.let(false);
        $.try($ => {
            $.try(_$ => {
                // Inner try
            }).finally($ => {
                $.assign(inner, true);
            });
        }).finally($ => {
            $.assign(outer, true);
        });
        $(assert.equal(inner, true));
        $(assert.equal(outer, true));
    });

    // =========================================================================
    // Control flow through every kind of statement: a continue or break naming
    // an outer loop through inner loops of every kind, a return out of loops,
    // match arms and try/catch, loops that await, a control statement in an
    // expression whose value is used, and recursion. Each test counts what
    // ran, so a continue, break or return that went unheeded, or that a loop
    // it does not name took, gives other counts.
    // =========================================================================

    test("continue names an outer While through a ForArray, a ForSet and a ForDict", $ => {
        const rows = $.const([100n, 200n, 300n]);
        const keys = $.const(new Set([10n, 20n, 30n]));
        const words = $.const(new Map([["a", 1n], ["b", 2n], ["c", 3n]]));
        const pass = $.let(0n);
        const innermost = $.let(0n);
        const ends = $.let(0n);
        $.while(East.less(pass, 3n), ($, outer) => {
            $.assign(pass, pass.add(1n));
            $.for(rows, ($) => {
                $.for(keys, ($) => {
                    $.for(words, ($, n) => {
                        // The second pass goes round again at its second innermost row
                        $.if(East.equal(pass, 2n).and(() => East.equal(n, 2n)), $ => { $.continue(outer); });
                        $.assign(innermost, innermost.add(1n));
                    });
                });
            });
            $.assign(ends, ends.add(1n));
        });
        // Passes 1 and 3 run all 27 innermost rows and reach their ends; pass 2 runs one, and not its end
        $(assert.equal(innermost, 55n));
        $(assert.equal(ends, 2n));
        $(assert.equal(pass, 3n));
    });

    test("break names an outer ForDict through a ForSet, a While and a ForArray", $ => {
        const rows = $.const(new Map([["a", 1n], ["b", 2n], ["c", 3n]]));
        const keys = $.const(new Set([10n, 20n]));
        const cells = $.const([100n, 200n, 300n]);
        const innermost = $.let(0n);
        const ends = $.let(0n);
        const after = $.let(0n);
        $.for(rows, ($, n, _key, outer) => {
            $.for(keys, ($) => {
                const j = $.let(0n);
                $.while(East.less(j, 2n), ($) => {
                    $.assign(j, j.add(1n));
                    $.for(cells, ($, cell) => {
                        // Row 2's first cell of 200 stops every loop
                        $.if(East.equal(n, 2n).and(() => East.equal(cell, 200n)), $ => { $.break(outer); });
                        $.assign(innermost, innermost.add(1n));
                    });
                });
            });
            $.assign(ends, ends.add(1n));
        });
        $.assign(after, after.add(1n));
        // Row 1 runs 2 keys × 2 passes × 3 cells = 12 and its end; row 2 runs one cell; row 3 never runs
        $(assert.equal(innermost, 13n));
        $(assert.equal(ends, 1n));
        $(assert.equal(after, 1n));
    });

    test("continue names an outer ForSet through a ForDict, a ForArray and a While", $ => {
        const keys = $.const(new Set([1n, 2n, 3n]));
        const words = $.const(new Map([["a", 10n], ["b", 20n]]));
        const cells = $.const([100n, 200n]);
        const innermost = $.let(0n);
        const ends = $.let(0n);
        $.for(keys, ($, k, outer) => {
            $.for(words, ($) => {
                $.for(cells, ($) => {
                    const j = $.let(0n);
                    $.while(East.less(j, 3n), ($) => {
                        $.assign(j, j.add(1n));
                        // Key 2 goes on to key 3 at the second pass of its first While
                        $.if(East.equal(k, 2n).and(() => East.equal(j, 2n)), $ => { $.continue(outer); });
                        $.assign(innermost, innermost.add(1n));
                    });
                });
            });
            $.assign(ends, ends.add(1n));
        });
        // Keys 1 and 3 run 2 words × 2 cells × 3 passes = 12 and their ends; key 2 runs one pass
        $(assert.equal(innermost, 25n));
        $(assert.equal(ends, 2n));
    });

    test("break names an outer ForArray through a While, a ForDict and a ForSet", $ => {
        const rows = $.const([1n, 2n, 3n]);
        const words = $.const(new Map([["a", 10n], ["b", 20n]]));
        const keys = $.const(new Set([100n, 200n, 300n]));
        const innermost = $.let(0n);
        const ends = $.let(0n);
        $.for(rows, ($, r, _i, outer) => {
            const j = $.let(0n);
            $.while(East.less(j, 2n), ($) => {
                $.assign(j, j.add(1n));
                $.for(words, ($, w) => {
                    $.for(keys, ($, k) => {
                        // Row 2's second pass stops every loop at word 20's key 300
                        $.if(East.equal(r, 2n).and(() => East.equal(j, 2n)).and(() => East.equal(w, 20n)).and(() => East.equal(k, 300n)), $ => { $.break(outer); });
                        $.assign(innermost, innermost.add(1n));
                    });
                });
            });
            $.assign(ends, ends.add(1n));
        });
        // Row 1 runs 2 passes × 2 words × 3 keys = 12 and its end; row 2 runs 11 before the break
        $(assert.equal(innermost, 23n));
        $(assert.equal(ends, 1n));
    });

    test("return leaves nested loops, a match arm and a try whose catch never sees it", $ => {
        const finallies = $.let(0n);
        const find = East.function([ArrayType(OptionType(IntegerType)), IntegerType], IntegerType, ($, xs, target) => {
            const visited = $.let(0n);
            $.try($ => {
                $.for(xs, ($, x) => {
                    $.match(x, {
                        none: ($) => { $.assign(visited, visited.add(1n)); },
                        some: ($, v) => {
                            const j = $.let(0n);
                            $.while(East.less(j, v), ($) => {
                                $.assign(j, j.add(1n));
                                $.if(East.equal(j, target), ($) => { $.return(visited.multiply(100n).add(j)); });
                            });
                            $.assign(visited, visited.add(1n));
                        },
                    });
                });
            }).catch(($, _message) => {
                $.return(-1n);
            }).finally(($) => {
                $.assign(finallies, finallies.add(1n));
            });
            return -2n;
        });
        const xs = $.const([none, some(1n), some(3n), none], ArrayType(OptionType(IntegerType)));
        // Found in the third row's second pass, two rows visited before it
        $(assert.equal(find(xs, 2n), 202n));
        // Never found: the loops end, and so does the try, then the function
        $(assert.equal(find(xs, 5n), -2n));
        $(assert.equal(finallies, 2n));
    });

    test("continue from a match arm and an if/else branch, in every kind of loop", $ => {
        const opts = $.const([some(1n), none, some(2n), some(3n), none, some(4n)], ArrayType(OptionType(IntegerType)));
        const keys = $.const(new Set([1n, 2n, 3n, 4n, 5n, 6n]));
        const byKey = $.const(new Map<bigint, option<bigint>>([[1n, some(1n)], [2n, none], [3n, some(2n)], [4n, some(3n)], [5n, none], [6n, some(4n)]]), DictType(IntegerType, OptionType(IntegerType)));
        // Each loop adds the odd payloads and counts the rows reaching its end: a none
        // continues from a match arm, an even payload from an else branch

        const arraySum = $.let(0n);
        const arrayEnds = $.let(0n);
        $.for(opts, ($, x, _i, label) => {
            $.match(x, {
                none: ($) => { $.continue(label); },
                some: ($, v) => {
                    $.if(East.equal(v.remainder(2n), 1n), ($) => { $.assign(arraySum, arraySum.add(v)); })
                        .else(($) => { $.continue(label); });
                },
            });
            $.assign(arrayEnds, arrayEnds.add(1n));
        });
        $(assert.equal(arraySum, 4n));
        $(assert.equal(arrayEnds, 2n));

        const whileSum = $.let(0n);
        const whileEnds = $.let(0n);
        const i = $.let(0n);
        $.while(East.less(i, opts.size()), ($, label) => {
            const x = $.const(opts.get(i));
            $.assign(i, i.add(1n));
            $.match(x, {
                none: ($) => { $.continue(label); },
                some: ($, v) => {
                    $.if(East.equal(v.remainder(2n), 1n), ($) => { $.assign(whileSum, whileSum.add(v)); })
                        .else(($) => { $.continue(label); });
                },
            });
            $.assign(whileEnds, whileEnds.add(1n));
        });
        $(assert.equal(whileSum, 4n));
        $(assert.equal(whileEnds, 2n));

        const setSum = $.let(0n);
        const setEnds = $.let(0n);
        $.for(keys, ($, k, label) => {
            $.match(byKey.get(k), {
                none: ($) => { $.continue(label); },
                some: ($, v) => {
                    $.if(East.equal(v.remainder(2n), 1n), ($) => { $.assign(setSum, setSum.add(v)); })
                        .else(($) => { $.continue(label); });
                },
            });
            $.assign(setEnds, setEnds.add(1n));
        });
        $(assert.equal(setSum, 4n));
        $(assert.equal(setEnds, 2n));

        const dictSum = $.let(0n);
        const dictEnds = $.let(0n);
        $.for(byKey, ($, x, _k, label) => {
            $.match(x, {
                none: ($) => { $.continue(label); },
                some: ($, v) => {
                    $.if(East.equal(v.remainder(2n), 1n), ($) => { $.assign(dictSum, dictSum.add(v)); })
                        .else(($) => { $.continue(label); });
                },
            });
            $.assign(dictEnds, dictEnds.add(1n));
        });
        $(assert.equal(dictSum, 4n));
        $(assert.equal(dictEnds, 2n));
    });

    test("continue, break and return in every kind of loop that awaits", $ => {
        const same = $.const(East.asyncFunction([IntegerType], IntegerType, (_$, x) => x));
        const opts = $.const([some(1n), none, some(2n), some(3n), none, some(4n)], ArrayType(OptionType(IntegerType)));
        const keys = $.const(new Set([1n, 2n, 3n, 4n, 5n, 6n]));
        const byKey = $.const(new Map<bigint, option<bigint>>([[1n, some(1n)], [2n, none], [3n, some(2n)], [4n, some(3n)], [5n, none], [6n, some(4n)]]), DictType(IntegerType, OptionType(IntegerType)));

        // Each pass awaits; a none continues from a match arm, an even payload from an else branch
        const arraySum = $.let(0n);
        const arrayEnds = $.let(0n);
        $.for(opts, ($, x, _i, label) => {
            $.match(x, {
                none: ($) => { $.continue(label); },
                some: ($, v) => {
                    const w = $.const(same(v));
                    $.if(East.equal(w.remainder(2n), 1n), ($) => { $.assign(arraySum, arraySum.add(w)); })
                        .else(($) => { $.continue(label); });
                },
            });
            $.assign(arrayEnds, arrayEnds.add(1n));
        });
        $(assert.equal(arraySum, 4n));
        $(assert.equal(arrayEnds, 2n));

        const setSum = $.let(0n);
        const setEnds = $.let(0n);
        $.for(keys, ($, k, label) => {
            const awaited = $.const(same(k));
            $.match(byKey.get(awaited), {
                none: ($) => { $.continue(label); },
                some: ($, v) => {
                    $.if(East.equal(v.remainder(2n), 1n), ($) => { $.assign(setSum, setSum.add(v)); })
                        .else(($) => { $.continue(label); });
                },
            });
            $.assign(setEnds, setEnds.add(1n));
        });
        $(assert.equal(setSum, 4n));
        $(assert.equal(setEnds, 2n));

        // A break stops a While that awaits, and one an outer ForDict names stops it through an inner ForArray
        const count = $.let(0n);
        const i = $.let(0n);
        $.while(true, ($, label) => {
            const v = $.const(same(i));
            $.assign(i, i.add(1n));
            $.if(East.equal(v, 3n), ($) => { $.break(label); });
            $.assign(count, count.add(1n));
        });
        $(assert.equal(count, 3n));
        $(assert.equal(i, 4n));

        const reached = $.let(0n);
        const rows = $.const([10n, 20n, 30n]);
        $.for(byKey, ($, _x, k, outer) => {
            $.for(rows, ($, r) => {
                const w = $.const(same(r.add(k)));
                $.if(East.equal(w, 22n), ($) => { $.break(outer); });
                $.assign(reached, reached.add(1n));
            });
        });
        // Key 1 reaches 3 rows; key 2 reaches row 10, and stops every loop at row 20
        $(assert.equal(reached, 4n));

        // A return leaves a ForDict and a While that await, out of an async function
        const firstOver = East.asyncFunction([DictType(IntegerType, OptionType(IntegerType)), IntegerType], IntegerType, ($, entries, limit) => {
            const call = $.const(same);
            $.for(entries, ($, x, k) => {
                $.match(x, {
                    some: ($, v) => {
                        const j = $.let(0n);
                        $.while(East.less(j, v), ($) => {
                            $.assign(j, call(j.add(1n)));
                            $.if(East.greater(k.multiply(10n).add(j), limit), ($) => { $.return(k.multiply(10n).add(j)); });
                        });
                    },
                });
            });
            return -1n;
        });
        $(assert.equal(firstOver(byKey, 32n), 41n));
        $(assert.equal(firstOver(byKey, 99n), -1n));
    });

    test("continue and break leave a try inside their loop, uncaught, its finally run", $ => {
        const rows = $.const([1n, 2n, 3n, 4n, 5n]);
        const counted = $.let(0n);
        const caught = $.let(0n);
        const finallies = $.let(0n);
        $.for(rows, ($, r, _i, label) => {
            $.try(($) => {
                $.if(East.equal(r, 2n), ($) => { $.continue(label); });
                $.if(East.equal(r, 4n), ($) => { $.break(label); });
                $.assign(counted, counted.add(1n));
            }).catch(($) => {
                $.assign(caught, caught.add(1n));
            }).finally(($) => {
                $.assign(finallies, finallies.add(1n));
            });
        });
        // Rows 1 and 3 are counted, 2 continues and 4 breaks, each through the try: row 5 never runs
        $(assert.equal(counted, 2n));
        $(assert.equal(caught, 0n));
        $(assert.equal(finallies, 4n));
    });

    test("continue and break in a match whose value is bound, assigned, or an argument", $ => {
        const opts = $.const([some(1n), none, some(2n), none, some(3n)], ArrayType(OptionType(IntegerType)));
        // A continue arm is typed as giving nothing, though it gives Never: each match is an Integer

        const bound = $.let(0n);
        $.for(opts, ($, x, _i, label) => {
            const v = $.const(x.match({ none: ($) => $.continue(label), some: (_$, v) => v }) as unknown as IntegerExpr);
            $.assign(bound, bound.add(v));
        });
        $(assert.equal(bound, 6n));

        const assigned = $.let(0n);
        $.for(opts, ($, x, _i, label) => {
            const v = $.let(0n);
            $.assign(v, x.match({ none: ($) => $.continue(label), some: (_$, v) => v }) as unknown as IntegerExpr);
            $.assign(assigned, assigned.add(v));
        });
        $(assert.equal(assigned, 6n));

        // A builtin's argument
        const added = $.let(0n);
        $.for(opts, ($, x, _i, label) => {
            $.assign(added, added.add(x.match({ none: ($) => $.continue(label), some: (_$, v) => v }) as unknown as IntegerExpr));
        });
        $(assert.equal(added, 6n));

        // A function's argument: the first none stops the loop
        const double = $.const(East.function([IntegerType], IntegerType, (_$, x) => x.multiply(2n)));
        const doubled = $.let(0n);
        $.for(opts, ($, x, _i, label) => {
            $.assign(doubled, doubled.add(double(x.match({ none: ($) => $.break(label), some: (_$, v) => v }) as unknown as IntegerExpr)));
        });
        $(assert.equal(doubled, 2n));
    });

    test("continue and break in what a statement evaluates: a predicate, a variant matched, a loop's collection, a return's value, an error's message", $ => {
        const opts = $.const([some(1n), none, some(2n), none, some(3n)], ArrayType(OptionType(IntegerType)));
        // A continue or break arm is typed as giving nothing, though it gives Never: each match is of its other arm's type

        // An if's predicate
        const big = $.let(0n);
        $.for(opts, ($, x, _i, label) => {
            $.if(x.match({ none: ($) => $.continue(label), some: (_$, v) => East.greater(v, 1n) }) as unknown as BooleanExpr, ($) => {
                $.assign(big, big.add(1n));
            });
        });
        $(assert.equal(big, 2n));

        // A variant matched
        const matched = $.let(0n);
        $.for(opts, ($, x, _i, label) => {
            const shifted = x.match({ none: ($) => $.continue(label), some: (_$, v) => East.value(some(v.add(10n)), OptionType(IntegerType)) });
            $.match(shifted as unknown as ExprType<OptionType<IntegerType>>, {
                some: ($, v) => { $.assign(matched, matched.add(v)); },
            });
        });
        $(assert.equal(matched, 36n));

        // A loop's collection, which continues the loop around it
        const nested = $.let(0n);
        $.for(opts, ($, x, _i, outer) => {
            const cells = x.match({ none: ($) => $.continue(outer), some: (_$, v) => East.Array.range(East.value(0n), v, 1n) });
            $.for(cells as unknown as ArrayExpr<IntegerType>, ($) => {
                $.assign(nested, nested.add(1n));
            });
            $.assign(nested, nested.add(100n));
        });
        // Each some runs its payload's cells and its 100; each none continues before both
        $(assert.equal(nested, 306n));

        // A While's predicate, which breaks the loop around it
        const passes = $.let(0n);
        $.for(opts, ($, x, _i, outer) => {
            const j = $.let(0n);
            $.while(x.match({ none: ($) => $.break(outer), some: (_$, v) => East.less(j, v) }) as unknown as BooleanExpr, ($) => {
                $.assign(j, j.add(1n));
                $.assign(passes, passes.add(1n));
            });
        });
        // The first row runs one pass; the second, a none, stops both loops
        $(assert.equal(passes, 1n));

        // A return's value, which breaks the loop around the return
        const fourth = East.function([ArrayType(OptionType(IntegerType))], IntegerType, ($, xs) => {
            const seen = $.let(0n);
            $.for(xs, ($, x, _i, label) => {
                $.assign(seen, seen.add(1n));
                $.if(East.equal(seen, 4n), ($) => {
                    $.return(x.match({ none: ($) => $.break(label), some: (_$, v) => v }) as unknown as IntegerExpr);
                });
            });
            return seen.negate();
        });
        // The fourth row is a none: the loop stops, and the function goes on past it
        $(assert.equal(fourth(opts), -4n));
        $(assert.equal(fourth([none, none, none, some(9n)]), 9n));

        // An error's message, which continues the loop: only the somes raise
        const raised = $.let(0n);
        $.for(opts, ($, x, _i, label) => {
            $.try(($) => {
                $.error(x.match({ none: ($) => $.continue(label), some: (_$, v) => East.print(v) }) as unknown as StringExpr);
            }).catch(($) => {
                $.assign(raised, raised.add(1n));
            });
        });
        $(assert.equal(raised, 3n));
    });

    test("return out of a loop in a recursive function, at every depth", $ => {
        // The steps from n to 1 of the Collatz sequence, each step found by a loop over the two parities that returns
        const steps = $.let(East.function([IntegerType], IntegerType, (_$, _n) => 0n), FunctionType([IntegerType], IntegerType));
        $.assign(steps, East.function([IntegerType], IntegerType, ($, n) => {
            $.if(East.equal(n, 1n), ($) => { $.return(0n); });
            $.for(East.Array.range(East.value(0n), 2n, 1n), ($, parity) => {
                $.if(East.equal(n.remainder(2n), parity), ($) => {
                    $.return(East.equal(parity, 0n).ifElse(() => steps(n.divide(2n)), () => steps(n.multiply(3n).add(1n))).add(1n));
                });
            });
            return -1n;
        }));
        // 6 3 10 5 16 8 4 2 1
        $(assert.equal(steps(6n), 8n));
        $(assert.equal(steps(27n), 111n));
    });

    test("return early from the function a builtin calls for each element", $ => {
        const xs = $.const([3n, -1n, 4n, -1n, 5n]);
        const scale = $.const(East.function([IntegerType, IntegerType], IntegerType, ($, x, _i) => {
            $.if(East.less(x, 0n), ($) => { $.return(0n); });
            return x.multiply(10n);
        }));
        const scaled = $.let(xs.map(scale));
        $(assert.equal(scaled, [30n, 0n, 40n, 0n, 50n]));
    });
});