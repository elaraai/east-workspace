/**
 * east-c-wasm unit tests.
 *
 * Tests the WASM API: compileFromBeast2, decodeBeast2, platform functions.
 *
 * Usage: pnpm run test:unit
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    East,
    IntegerType,
    StringType,
    BooleanType,
    FloatType,
    NullType,
    ArrayType,
    SetType,
    DictType,
    StructType,
    VariantType,
    FunctionType,
    OptionType,
    RecursiveType,
    variant,
} from '@elaraai/east';
import type { PlatformFunction } from '@elaraai/east/internal';
import { encodeBeast2For, IRType } from '@elaraai/east/internal';

import { createEastWasm } from '../src/index.js';

// ── Helpers ──────────────────────────────────────────────────────────

function compileBeast2(fn: ReturnType<typeof East.function>) {
    const ir = fn.toIR();
    const encoder = encodeBeast2For(IRType);
    return new Uint8Array(encoder(ir.ir));
}

function encodeBeast2<T>(type: any, value: T): Uint8Array {
    return new Uint8Array(encodeBeast2For(type)(value));
}

// ── compileFromBeast2 ────────────────────────────────────────────────

describe('compileFromBeast2', () => {
    test('integer', async () => {
        const wasm = await createEastWasm();
        const bytes = compileBeast2(East.function([], IntegerType, $ => $.const(42n)));
        const fn = wasm.compileFromBeast2(bytes);
        assert.equal(fn(), 42n);
        fn.free();
    });

    test('string', async () => {
        const wasm = await createEastWasm();
        const bytes = compileBeast2(East.function([], StringType, $ => $.const('hello')));
        const fn = wasm.compileFromBeast2(bytes);
        assert.equal(fn(), 'hello');
        fn.free();
    });

    test('boolean', async () => {
        const wasm = await createEastWasm();
        const bytes = compileBeast2(East.function([], BooleanType, $ => $.const(true)));
        const fn = wasm.compileFromBeast2(bytes);
        assert.equal(fn(), true);
        fn.free();
    });

    test('float', async () => {
        const wasm = await createEastWasm();
        const bytes = compileBeast2(East.function([], FloatType, $ => $.const(3.14)));
        const fn = wasm.compileFromBeast2(bytes);
        assert.ok(Math.abs((fn() as number) - 3.14) < 0.001);
        fn.free();
    });

    test('array', async () => {
        const wasm = await createEastWasm();
        const bytes = compileBeast2(East.function([], ArrayType(IntegerType), $ =>
            $.const([1n, 2n, 3n], ArrayType(IntegerType))));
        const fn = wasm.compileFromBeast2(bytes);
        assert.deepEqual(fn(), [1n, 2n, 3n]);
        fn.free();
    });

    test('struct', async () => {
        const wasm = await createEastWasm();
        const T = StructType({ x: IntegerType, y: StringType });
        const bytes = compileBeast2(East.function([], T, $ =>
            $.const({ x: 10n, y: 'hello' }, T)));
        const fn = wasm.compileFromBeast2(bytes);
        const result = fn() as any;
        assert.equal(result.x, 10n);
        assert.equal(result.y, 'hello');
        fn.free();
    });

    test('variant', async () => {
        const wasm = await createEastWasm();
        const T = OptionType(IntegerType);
        const bytes = compileBeast2(East.function([], T, $ =>
            $.const(variant('some', 42n), T)));
        const fn = wasm.compileFromBeast2(bytes);
        const result = fn() as any;
        assert.equal(result.type, 'some');
        assert.equal(result.value, 42n);
        fn.free();
    });

    test('recursive type', async () => {
        const wasm = await createEastWasm();
        const TreeType = RecursiveType(self => VariantType({
            leaf: IntegerType,
            node: StructType({ left: self, right: self }),
        }));
        const bytes = compileBeast2(East.function([], TreeType, $ =>
            $.const(variant('node', {
                left: variant('leaf', 1n),
                right: variant('leaf', 2n),
            }), TreeType)));
        const fn = wasm.compileFromBeast2(bytes);
        const result = fn() as any;
        assert.equal(result.type, 'node');
        assert.equal(result.value.left.type, 'leaf');
        assert.equal(result.value.left.value, 1n);
        assert.equal(result.value.right.value, 2n);
        fn.free();
    });

    test('function with arguments', async () => {
        const wasm = await createEastWasm();
        const bytes = compileBeast2(East.function([IntegerType, IntegerType], IntegerType, ($, a, b) =>
            a.add(b)));
        const fn = wasm.compileFromBeast2(bytes);
        assert.equal(fn(10n, 32n), 42n);
        fn.free();
    });

    test('function with loop', async () => {
        const wasm = await createEastWasm();
        const bytes = compileBeast2(East.function([IntegerType], IntegerType, ($, n) => {
            const sum = $.let(0n, IntegerType);
            const i = $.let(1n, IntegerType);
            $.while(East.lessEqual(i, n), $ => {
                $.assign(sum, sum.add(i));
                $.assign(i, i.add(1n));
            });
            return sum;
        }));
        const fn = wasm.compileFromBeast2(bytes);
        assert.equal(fn(10n), 55n);
        fn.free();
    });
});

// ── decodeBeast2 ─────────────────────────────────────────────────────

describe('decodeBeast2', () => {
    test('integer', async () => {
        const wasm = await createEastWasm();
        assert.equal(wasm.decodeBeast2(encodeBeast2(IntegerType, 42n)), 42n);
    });

    test('string', async () => {
        const wasm = await createEastWasm();
        assert.equal(wasm.decodeBeast2(encodeBeast2(StringType, 'hello')), 'hello');
    });

    test('boolean', async () => {
        const wasm = await createEastWasm();
        assert.equal(wasm.decodeBeast2(encodeBeast2(BooleanType, true)), true);
        assert.equal(wasm.decodeBeast2(encodeBeast2(BooleanType, false)), false);
    });

    test('null', async () => {
        const wasm = await createEastWasm();
        assert.equal(wasm.decodeBeast2(encodeBeast2(NullType, null)), null);
    });

    test('float', async () => {
        const wasm = await createEastWasm();
        const result = wasm.decodeBeast2(encodeBeast2(FloatType, 3.14)) as number;
        assert.ok(Math.abs(result - 3.14) < 0.001);
    });

    test('array', async () => {
        const wasm = await createEastWasm();
        assert.deepEqual(
            wasm.decodeBeast2(encodeBeast2(ArrayType(IntegerType), [1n, 2n, 3n])),
            [1n, 2n, 3n],
        );
    });

    test('struct', async () => {
        const wasm = await createEastWasm();
        const T = StructType({ name: StringType, age: IntegerType });
        const result = wasm.decodeBeast2(encodeBeast2(T, { name: 'Alice', age: 30n })) as any;
        assert.equal(result.name, 'Alice');
        assert.equal(result.age, 30n);
    });

    test('variant', async () => {
        const wasm = await createEastWasm();
        const T = OptionType(IntegerType);
        const some = wasm.decodeBeast2(encodeBeast2(T, variant('some', 42n))) as any;
        assert.equal(some.type, 'some');
        assert.equal(some.value, 42n);
        const none = wasm.decodeBeast2(encodeBeast2(T, variant('none', null))) as any;
        assert.equal(none.type, 'none');
    });

    test('dict', async () => {
        const wasm = await createEastWasm();
        const T = DictType(StringType, IntegerType);
        const result = wasm.decodeBeast2(encodeBeast2(T, new Map([['a', 1n], ['b', 2n]]))) as Map<string, bigint>;
        assert.equal(result.get('a'), 1n);
        assert.equal(result.get('b'), 2n);
    });

    test('set', async () => {
        const wasm = await createEastWasm();
        const T = SetType(IntegerType);
        const result = wasm.decodeBeast2(encodeBeast2(T, new Set([1n, 2n, 3n]))) as Set<bigint>;
        assert.equal(result.size, 3);
        assert.ok(result.has(1n));
    });

    test('recursive type', async () => {
        const wasm = await createEastWasm();
        const TreeType = RecursiveType(self => VariantType({
            leaf: IntegerType,
            node: StructType({ left: self, right: self }),
        }));
        const tree = variant('node', {
            left: variant('leaf', 1n),
            right: variant('node', {
                left: variant('leaf', 2n),
                right: variant('leaf', 3n),
            }),
        });
        const result = wasm.decodeBeast2(encodeBeast2(TreeType, tree)) as any;
        assert.equal(result.type, 'node');
        assert.equal(result.value.left.value, 1n);
        assert.equal(result.value.right.type, 'node');
        assert.equal(result.value.right.value.right.value, 3n);
    });
});

// ── Platform functions ───────────────────────────────────────────────

describe('platform functions', () => {
    test('call platform function from compiled IR', async () => {
        const wasm = await createEastWasm();

        let called = false;
        const doubleIt = East.platform('testDouble', [IntegerType], IntegerType);
        const impl: PlatformFunction[] = [
            doubleIt.implement((x: bigint) => { called = true; return x * 2n; }),
        ];

        const bytes = compileBeast2(East.function([], IntegerType, $ => doubleIt(21n)));
        const fn = wasm.compileFromBeast2(bytes, impl);
        assert.equal(fn(), 42n);
        assert.ok(called);
        fn.free();
    });

    test('platform function with string', async () => {
        const wasm = await createEastWasm();

        const greet = East.platform('testGreet', [StringType], StringType);
        const impl: PlatformFunction[] = [
            greet.implement((name: string) => `Hello, ${name}!`),
        ];

        const bytes = compileBeast2(East.function([], StringType, $ => greet('World')));
        const fn = wasm.compileFromBeast2(bytes, impl);
        assert.equal(fn(), 'Hello, World!');
        fn.free();
    });

    test('platform function called multiple times', async () => {
        const wasm = await createEastWasm();

        let count = 0;
        const counter = East.platform('testCounter', [], IntegerType);
        const impl: PlatformFunction[] = [
            counter.implement(() => { count++; return BigInt(count); }),
        ];

        const bytes = compileBeast2(East.function([], ArrayType(IntegerType), $ => {
            return $.const([counter(), counter(), counter()], ArrayType(IntegerType));
        }));
        const fn = wasm.compileFromBeast2(bytes, impl);
        const result = fn() as bigint[];
        assert.equal(result.length, 3);
        assert.equal(count, 3);
        fn.free();
    });
});

// ── Function values in results ───────────────────────────────────────

describe('function values in results', () => {
    test('returned closure is callable', async () => {
        const wasm = await createEastWasm();
        // Function that returns a zero-arg closure
        const bytes = compileBeast2(East.function([], FunctionType([], IntegerType), $ => {
            return East.function([], IntegerType, $ => $.const(42n, IntegerType));
        }));
        const fn = wasm.compileFromBeast2(bytes);
        const closure = fn() as (...args: unknown[]) => unknown;
        assert.equal(typeof closure, 'function');
        const result = closure();
        assert.equal(result, 42n);
        fn.free();
    });
});

// ── Error handling ───────────────────────────────────────────────────

describe('error handling', () => {
    test('invalid beast2 bytes throws on decode', async () => {
        const wasm = await createEastWasm();
        assert.throws(() => wasm.decodeBeast2(new Uint8Array([1, 2, 3, 4])));
    });

    test('invalid beast2 bytes throws on compile', async () => {
        const wasm = await createEastWasm();
        assert.throws(() => wasm.compileFromBeast2(new Uint8Array([1, 2, 3, 4])));
    });
});
