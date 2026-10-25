/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { variant } from '../containers/variant.js';
import { SortedMap } from '../containers/sortedmap.js';
import { SortedSet } from '../containers/sortedset.js';
import { diffFor } from './diff.js';
import { applyFor } from './apply.js';
import { composeFor } from './compose.js';
import { invertFor } from './invert.js';
import { PatchType } from './index.js';
import { alignArrays } from './types.js';
import { ArrayType, BooleanType, DictType, FloatType, IntegerType, NullType, SetType, StringType, StructType, VariantType, isTypeEqual } from '../types.js';
import { compareFor, equalFor } from '../comparison.js';
import { generateFuzzTestCases } from './fuzz.js';

describe('Patch system for EAST values', () => {
    describe('Primitives', () => {
        test('should diff identical integers as unchanged', () => {
            const diff = diffFor(IntegerType);
            const result = diff(42n, 42n);
            assert.deepEqual(result, variant('unchanged', null));
        });

        test('should diff different integers as replace', () => {
            const diff = diffFor(IntegerType);
            const result = diff(42n, 100n);
            assert.deepEqual(result, variant('replace', { before: 42n, after: 100n }));
        });

        test('should diff identical floats as unchanged', () => {
            const diff = diffFor(FloatType);
            const result = diff(3.14, 3.14);
            assert.deepEqual(result, variant('unchanged', null));
        });

        test('should diff different floats as replace', () => {
            const diff = diffFor(FloatType);
            const result = diff(3.14, 2.71);
            assert.deepEqual(result, variant('replace', { before: 3.14, after: 2.71 }));
        });

        test('should diff identical strings as unchanged', () => {
            const diff = diffFor(StringType);
            const result = diff("hello", "hello");
            assert.deepEqual(result, variant('unchanged', null));
        });

        test('should diff different strings as replace', () => {
            const diff = diffFor(StringType);
            const result = diff("hello", "world");
            assert.deepEqual(result, variant('replace', { before: "hello", after: "world" }));
        });

        test('should diff identical booleans as unchanged', () => {
            const diff = diffFor(BooleanType);
            const result = diff(true, true);
            assert.deepEqual(result, variant('unchanged', null));
        });

        test('should diff different booleans as replace', () => {
            const diff = diffFor(BooleanType);
            const result = diff(true, false);
            assert.deepEqual(result, variant('replace', { before: true, after: false }));
        });

        test('should apply unchanged patch to primitive', () => {
            const apply = applyFor(IntegerType);
            const patch = variant('unchanged', null);
            const result = apply(42n, patch);
            assert.equal(result, 42n);
        });

        test('should apply replace patch to primitive', () => {
            const apply = applyFor(IntegerType);
            const patch = variant('replace', { before: 42n, after: 100n });
            const result = apply(42n, patch);
            assert.equal(result, 100n);
        });

        test('should invert unchanged patch', () => {
            const invert = invertFor(IntegerType);
            const patch = variant('unchanged', null);
            const result = invert(patch);
            assert.deepEqual(result, variant('unchanged', null));
        });

        test('should invert replace patch', () => {
            const invert = invertFor(IntegerType);
            const patch = variant('replace', { before: 42n, after: 100n });
            const result = invert(patch);
            assert.deepEqual(result, variant('replace', { before: 100n, after: 42n }));
        });

        test('should compose unchanged patches', () => {
            const compose = composeFor(IntegerType);
            const first = variant('unchanged', null);
            const second = variant('unchanged', null);
            const result = compose(first, second);
            assert.deepEqual(result, variant('unchanged', null));
        });

        test('should compose replace then unchanged', () => {
            const compose = composeFor(IntegerType);
            const first = variant('replace', { before: 1n, after: 2n });
            const second = variant('unchanged', null);
            const result = compose(first, second);
            assert.deepEqual(result, variant('replace', { before: 1n, after: 2n }));
        });

        test('should compose unchanged then replace', () => {
            const compose = composeFor(IntegerType);
            const first = variant('unchanged', null);
            const second = variant('replace', { before: 1n, after: 2n });
            const result = compose(first, second);
            assert.deepEqual(result, variant('replace', { before: 1n, after: 2n }));
        });

        test('should compose two replace patches', () => {
            const compose = composeFor(IntegerType);
            const first = variant('replace', { before: 1n, after: 2n });
            const second = variant('replace', { before: 2n, after: 3n });
            const result = compose(first, second);
            assert.deepEqual(result, variant('replace', { before: 1n, after: 3n }));
        });
    });

    describe('Arrays', () => {
        const type = ArrayType(IntegerType);

        test('should diff identical arrays as unchanged', () => {
            const diff = diffFor(type);
            const result = diff([1n, 2n, 3n], [1n, 2n, 3n]);
            assert.deepEqual(result, variant('unchanged', null));
        });

        test('should diff different arrays with insert', () => {
            const diff = diffFor(type);
            const result = diff([1n, 3n], [1n, 2n, 3n]);
            assert.equal(result.type, 'patch');
            // Check patch has operations
            assert(Array.isArray(result.value));
        });

        test('should diff different arrays with delete', () => {
            const diff = diffFor(type);
            const result = diff([1n, 2n, 3n], [1n, 3n]);
            assert.equal(result.type, 'patch');
            assert(Array.isArray(result.value));
        });

        test('should diff different arrays with update', () => {
            const diff = diffFor(type);
            const result = diff([1n, 2n, 3n], [1n, 99n, 3n]);
            assert.equal(result.type, 'patch');
            assert(Array.isArray(result.value));
        });

        test('should apply unchanged patch to array', () => {
            const apply = applyFor(type);
            const patch = variant('unchanged', null);
            const result = apply([1n, 2n, 3n], patch);
            assert.deepEqual(result, [1n, 2n, 3n]);
        });

        test('should apply replace patch to array', () => {
            const apply = applyFor(type);
            const before = [1n, 2n, 3n];
            const after = [4n, 5n, 6n];
            const patch = variant('replace', { before, after });
            const result = apply(before, patch);
            assert.deepEqual(result, after);
        });

        test('should round-trip diff and apply for arrays', () => {
            const diff = diffFor(type);
            const apply = applyFor(type);
            const before = [1n, 2n, 3n];
            const after = [1n, 99n, 3n, 4n];
            const patch = diff(before, after);
            const result = apply(before, patch);
            assert.deepEqual(result, after);
        });

        test('should invert and round-trip simple array insert', () => {
            const diff = diffFor(type);
            const apply = applyFor(type);
            const invert = invertFor(type);
            const before = [1n, 2n];
            const after = [1n, 2n, 3n];
            const patch = diff(before, after);
            const inverted = invert(patch);
            const result = apply(after, inverted);
            assert.deepEqual(result, before);
        });

        test('should invert and round-trip simple array delete', () => {
            const diff = diffFor(type);
            const apply = applyFor(type);
            const invert = invertFor(type);
            const before = [1n, 2n, 3n];
            const after = [1n, 3n];
            const patch = diff(before, after);
            const inverted = invert(patch);
            const result = apply(after, inverted);
            assert.deepEqual(result, before);
        });
    });

    describe('Array alignment', () => {
        // An Array's diff, counted and never timed (#1425): each case is held to
        // the bound the issue gives it — the trim's p + s + 2, Myers'
        // (2D + 1)·min(m′, n′), and min(m′, n′) more when the middle is paired
        // by position — by an element equality that counts its calls and throws
        // once past it, so a regression to a table over the whole of both
        // arrays fails at once rather than running. The table the diff used to
        // fill made about 10^10 comparisons for each 100,000-element case.
        //
        // The assertions compare counts and a few positions, never a whole
        // array of 100,000 positions: assert's message for two such arrays
        // that differ diffs them line by line, and that diff outgrows the
        // memory of the machine before it reports. A regression fails here
        // with a short message instead.
        const intEqual = equalFor(IntegerType);
        const N = 100_000;
        const range = (from: number, to: number): bigint[] => Array.from({ length: to - from }, (_, i) => BigInt(from + i));
        // [0, …, 99,999] with every x where x mod `period` is `phase` made -x.
        const negated = (period: number, phase: number): bigint[] =>
            Array.from({ length: N }, (_, x) => BigInt(x % period === phase ? -x : x));

        function align<T>(before: readonly T[], after: readonly T[], equal: (a: T, b: T) => boolean, bound: number) {
            let compares = 0;
            const alignment = alignArrays(before, after, (a: T, b: T) => {
                compares++;
                if (compares > bound) throw new Error(`past the bound of ${bound} comparisons`);
                return equal(a, b);
            });
            return { ...alignment, compares };
        }

        // Whether each match keeps a position of `before` as the same position
        // of `after`: the middle paired by position.
        const pairedByPosition = (a: { beforeIndices: number[]; afterIndices: number[] }): boolean =>
            a.beforeIndices.length === a.afterIndices.length && a.beforeIndices.every((x, k) => x === a.afterIndices[k]);

        test('one change in 100,000 elements: the trim leaves one pair, which does not match', () => {
            const after = range(0, N);
            after[50000] = -1n;
            const a = align(range(0, N), after, intEqual, 100_006);
            assert.deepEqual([a.start, a.end, a.beforeIndices.length, a.afterIndices.length], [50000, 49999, 0, 0]);
        });

        test('one removed, one inserted, appended and prepended: the trim alone', () => {
            const removed = [...range(0, 50000), ...range(50001, N)];
            const inserted = [...range(0, 50000), -1n, ...range(50000, N)];
            const removal = align(range(0, N), removed, intEqual, 100_001);
            assert.deepEqual([removal.start, removal.end, removal.beforeIndices.length], [50000, 49999, 0]);
            const insertion = align(range(0, N), inserted, intEqual, 100_002);
            assert.deepEqual([insertion.start, insertion.end, insertion.beforeIndices.length], [50000, 50000, 0]);
            const appended = align(range(0, N), range(0, N + 1), intEqual, 100_002);
            assert.deepEqual([appended.start, appended.end], [N, 0]);
            const prepended = align(range(0, N), [-1n, ...range(0, N)], intEqual, 100_002);
            assert.deepEqual([prepended.start, prepended.end], [0, N]);
        });

        test('two changes far apart: a script of 4 edits over a 99,980-element middle', () => {
            const after = range(0, N);
            after[10] = -1n;
            after[99989] = -2n;
            const a = align(range(0, N), after, intEqual, 899_842);
            assert.deepEqual([a.start, a.end, a.beforeIndices.length], [10, 10, 99_978]);
            assert.deepEqual([a.beforeIndices[0], a.afterIndices[0], a.beforeIndices.at(-1), a.afterIndices.at(-1)], [11, 11, 99_988, 99_988]);
        });

        test('a moved element: a script of 2 edits keeps the 99,980 elements it was moved over', () => {
            const after = [...range(0, 10), ...range(11, 99991), 10n, ...range(99991, N)];
            const a = align(range(0, N), after, intEqual, 499_926);
            assert.deepEqual([a.start, a.end, a.beforeIndices.length], [10, 9, 99_980]);
            assert.deepEqual([a.beforeIndices[0], a.afterIndices[0], a.beforeIndices.at(-1), a.afterIndices.at(-1)], [11, 10, 99_990, 99_989]);
        });

        test('a nested struct field: the rows compare whole, as many times as integers would', () => {
            const Row = StructType({ id: IntegerType, name: StringType });
            const rows = Array.from({ length: N }, (_, i) => ({ id: BigInt(i), name: `row ${i}` }));
            const after = rows.slice();
            after[50000] = { id: 50000n, name: "renamed" };
            const a = align(rows, after, equalFor(Row), 100_006);
            assert.deepEqual([a.start, a.end, a.beforeIndices.length], [50000, 49999, 0]);
        });

        test('a shift: a script of 3 edits keeps 4,094 of 4,096', () => {
            const a = align(range(0, 4096), [-1n, ...range(0, 4094)], intEqual, 28_667);
            assert.deepEqual([a.start, a.end, a.beforeIndices.length], [0, 0, 4094]);
            assert.deepEqual([a.beforeIndices[0], a.afterIndices[0], a.beforeIndices.at(-1), a.afterIndices.at(-1)], [0, 1, 4093, 4094]);
        });

        test('at the bound the search finds a shortest script, and past it pairs by position', () => {
            // At the bound: 41 negated and element 50,000 moved to 50,010. The
            // middle is 99,601 a side, bound ⌊2^24 / 199,202⌋ = 84, script 84.
            const changed = negated(2490, 100);
            const at = [...changed.slice(0, 50000), ...changed.slice(50001, 50011), changed[50000]!, ...changed.slice(50011)];
            const myers = align(range(0, N), at, intEqual, 16_832_970);
            assert.deepEqual([myers.start, myers.end, myers.beforeIndices.length], [100, 299, (99_601 * 2 - 84) / 2]);
            // Past it: element 99,800 removed too. The middle is 99,701 by
            // 99,700, bound still 84, script 85: paired by position, every
            // position equal but the 41 negated and the 11 the move shifted.
            const past = [...at.slice(0, 99800), ...at.slice(99801)];
            const byPosition = align(range(0, N), past, intEqual, 16_949_301);
            assert.deepEqual([byPosition.start, byPosition.end, byPosition.beforeIndices.length], [100, 199, 99_700 - 41 - 11]);
            assert.ok(pairedByPosition(byPosition), 'the middle is paired by position');
        });

        test('many scattered changes pair by position past the bound', () => {
            // 1,000 negated: the middle is 99,901 a side, bound 83, script 2,000.
            const a = align(range(0, N), negated(100, 50), intEqual, 16_783_469);
            assert.deepEqual([a.start, a.end, a.beforeIndices.length], [50, 49, 99_901 - 1000]);
            assert.ok(pairedByPosition(a), 'the middle is paired by position');
        });

        test('a tie, an unchanged copy', () => {
            const tie = align([1n, 1n], [1n], intEqual, 3);
            assert.deepEqual([tie.start, tie.end, tie.beforeIndices.length], [1, 0, 0]);
            const copy = align(range(0, N), range(0, N), intEqual, 100_002);
            assert.deepEqual([copy.start, copy.end, copy.beforeIndices.length], [N, 0, 0]);
        });

        test('within the bound the alignment keeps as many pairs as a longest common subsequence', () => {
            // A seeded stream of small arrays over small alphabets — the inputs
            // where pairs can be matched more than one way.
            let seed = 0x1425;
            const next = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
            for (let trial = 0; trial < 2000; trial++) {
                const alphabet = 1 + next(4);
                const before = Array.from({ length: next(12) }, () => BigInt(next(alphabet)));
                const after = Array.from({ length: next(12) }, () => BigInt(next(alphabet)));
                const { start, end, beforeIndices, afterIndices } = alignArrays(before, after, intEqual);
                // The longest common subsequence's length, by the table.
                const table = Array.from({ length: before.length + 1 }, () => new Array<number>(after.length + 1).fill(0));
                for (let i = 1; i <= before.length; i++) {
                    for (let j = 1; j <= after.length; j++) {
                        table[i]![j] = intEqual(before[i - 1]!, after[j - 1]!)
                            ? table[i - 1]![j - 1]! + 1
                            : Math.max(table[i - 1]![j]!, table[i]![j - 1]!);
                    }
                }
                assert.equal(start + end + beforeIndices.length, table[before.length]![after.length]!);
                for (let k = 0; k < beforeIndices.length; k++) {
                    assert.ok(intEqual(before[beforeIndices[k]!]!, after[afterIndices[k]!]!));
                    if (k > 0) assert.ok(beforeIndices[k]! > beforeIndices[k - 1]! && afterIndices[k]! > afterIndices[k - 1]!);
                }
            }
        });
    });

    describe('Sets', () => {
        const type = SetType(IntegerType);
        const compare = (a: bigint, b: bigint) => a < b ? -1 : a > b ? 1 : 0;
        const createSet = (values: bigint[]) => new SortedSet(values, compare);

        test('should diff identical sets as unchanged', () => {
            const diff = diffFor(type);
            const result = diff(createSet([1n, 2n, 3n]), createSet([1n, 2n, 3n]));
            assert.deepEqual(result, variant('unchanged', null));
        });

        test('should diff different sets with insert', () => {
            const diff = diffFor(type);
            const result = diff(createSet([1n, 3n]), createSet([1n, 2n, 3n]));
            assert.equal(result.type, 'patch');
        });

        test('should diff different sets with delete', () => {
            const diff = diffFor(type);
            const result = diff(createSet([1n, 2n, 3n]), createSet([1n, 3n]));
            assert.equal(result.type, 'patch');
        });

        test('should round-trip diff and apply for sets', () => {
            const diff = diffFor(type);
            const apply = applyFor(type);
            const before = createSet([1n, 2n, 3n]);
            const after = createSet([1n, 3n, 4n]);
            const patch = diff(before, after);
            const result = apply(before, patch);
            assert.deepEqual([...result], [1n, 3n, 4n]);
        });
    });

    describe('Dicts', () => {
        const type = DictType(StringType, IntegerType);
        const cmp = compareFor(StringType);

        test('should diff identical dicts as unchanged', () => {
            const diff = diffFor(type);
            const result = diff(
                new SortedMap([["a", 1n], ["b", 2n]], cmp),
                new SortedMap([["a", 1n], ["b", 2n]], cmp),
            );
            assert.deepEqual(result, variant('unchanged', null));
        });

        test('should diff different dicts with insert', () => {
            const diff = diffFor(type);
            const result = diff(
                new SortedMap([["a", 1n]], cmp),
                new SortedMap([["a", 1n], ["b", 2n]], cmp),
            );
            assert.equal(result.type, 'patch');
        });

        test('should diff different dicts with update', () => {
            const diff = diffFor(type);
            const result = diff(
                new SortedMap([["a", 1n], ["b", 2n]], cmp),
                new SortedMap([["a", 1n], ["b", 99n]], cmp),
            );
            assert.equal(result.type, 'patch');
        });

        test('should round-trip diff and apply for dicts', () => {
            const diff = diffFor(type);
            const apply = applyFor(type);
            const before = new SortedMap<string, bigint>([["a", 1n], ["b", 2n]], cmp);
            const after  = new SortedMap<string, bigint>([["a", 10n], ["c", 3n]], cmp);
            const patch = diff(before, after);
            const result = apply(before, patch);
            assert.deepEqual([...result.entries()], [["a", 10n], ["c", 3n]]);
        });

        test('should compose update-then-delete into delete of the original value', () => {
            const diff = diffFor(type);
            const apply = applyFor(type);
            const compose = composeFor(type);
            const invert = invertFor(type);
            const patchEqual = equalFor(PatchType(type));
            const v1 = new SortedMap<string, bigint>([["a", 1n], ["b", 9n]], cmp);
            const v2 = new SortedMap<string, bigint>([["a", 2n], ["b", 9n]], cmp);
            const v3 = new SortedMap<string, bigint>([["b", 9n]], cmp);
            const composed = compose(diff(v1, v2), diff(v2, v3));
            // The composed delete records the ORIGINAL value, so
            // compose(diff(v1,v2), diff(v2,v3)) == diff(v1,v3).
            assert.equal(patchEqual(composed, diff(v1, v3)), true);
            assert.deepEqual([...apply(v1, composed).entries()], [["b", 9n]]);
            // And it inverts back to v1.
            assert.deepEqual([...apply(v3, invert(composed)).entries()], [["a", 1n], ["b", 9n]]);
        });
    });

    describe('Structs', () => {
        const type = StructType({ x: IntegerType, y: StringType });

        test('should diff identical structs as unchanged', () => {
            const diff = diffFor(type);
            const result = diff({ x: 1n, y: "hello" }, { x: 1n, y: "hello" });
            assert.deepEqual(result, variant('unchanged', null));
        });

        test('should diff different structs with replace', () => {
            const diff = diffFor(type);
            const result = diff({ x: 1n, y: "hello" }, { x: 2n, y: "world" });
            // For structs with changes, we get a patch
            assert.equal(result.type, 'patch');
        });

        test('should round-trip diff and apply for structs', () => {
            const diff = diffFor(type);
            const apply = applyFor(type);
            const before = { x: 1n, y: "hello" };
            const after = { x: 99n, y: "world" };
            const patch = diff(before, after);
            const result = apply(before, patch);
            assert.deepEqual(result, after);
        });
    });

    describe('Variants', () => {
        const type = VariantType({ num: IntegerType, str: StringType });

        test('should diff identical variants as unchanged', () => {
            const diff = diffFor(type);
            const result = diff(variant('num', 42n), variant('num', 42n));
            assert.deepEqual(result, variant('unchanged', null));
        });

        test('should diff same-tag variants with different data as patch', () => {
            const diff = diffFor(type);
            const result = diff(variant('num', 42n), variant('num', 100n));
            assert.equal(result.type, 'patch');
        });

        test('should diff different-tag variants as replace', () => {
            const diff = diffFor(type);
            const result = diff(variant('num', 42n), variant('str', "hello"));
            assert.equal(result.type, 'replace');
        });

        test('should round-trip diff and apply for variants', () => {
            const diff = diffFor(type);
            const apply = applyFor(type);
            const before = variant('num', 42n);
            const after = variant('num', 100n);
            const patch = diff(before, after);
            const result = apply(before, patch);
            assert.deepEqual(result, after);
        });
    });

    describe('PatchType constructor', () => {
        test('should create correct patch type for primitives', () => {
            const expected = VariantType({
                unchanged: NullType,
                replace: StructType({ before: IntegerType, after: IntegerType }),
            });
            assert.ok(isTypeEqual(PatchType(IntegerType), expected));
        });

        test('should create correct patch type for arrays', () => {
            const elementPatchType = VariantType({
                unchanged: NullType,
                replace: StructType({ before: IntegerType, after: IntegerType }),
            });
            const operationType = VariantType({
                delete: IntegerType,
                insert: IntegerType,
                update: elementPatchType,
            });
            const entryType = StructType({
                key: IntegerType,
                offset: IntegerType,
                operation: operationType,
            });
            const expected = VariantType({
                unchanged: NullType,
                replace: StructType({ before: ArrayType(IntegerType), after: ArrayType(IntegerType) }),
                patch: ArrayType(entryType),
            });
            assert.ok(isTypeEqual(PatchType(ArrayType(IntegerType)), expected));
        });

        test('should create correct patch type for sets', () => {
            const operationType = VariantType({
                delete: NullType,
                insert: NullType,
            });
            const expected = VariantType({
                unchanged: NullType,
                replace: StructType({ before: SetType(IntegerType), after: SetType(IntegerType) }),
                patch: DictType(IntegerType, operationType),
            });
            assert.ok(isTypeEqual(PatchType(SetType(IntegerType)), expected));
        });

        test('should create correct patch type for dicts', () => {
            const valuePatchType = VariantType({
                unchanged: NullType,
                replace: StructType({ before: IntegerType, after: IntegerType }),
            });
            const operationType = VariantType({
                delete: IntegerType,
                insert: IntegerType,
                update: valuePatchType,
            });
            const expected = VariantType({
                unchanged: NullType,
                replace: StructType({ before: DictType(StringType, IntegerType), after: DictType(StringType, IntegerType) }),
                patch: DictType(StringType, operationType),
            });
            assert.ok(isTypeEqual(PatchType(DictType(StringType, IntegerType)), expected));
        });

        test('should create correct patch type for structs', () => {
            const xPatchType = VariantType({
                unchanged: NullType,
                replace: StructType({ before: IntegerType, after: IntegerType }),
            });
            const yPatchType = VariantType({
                unchanged: NullType,
                replace: StructType({ before: StringType, after: StringType }),
            });
            const expected = VariantType({
                unchanged: NullType,
                replace: StructType({
                    before: StructType({ x: IntegerType, y: StringType }),
                    after: StructType({ x: IntegerType, y: StringType })
                }),
                patch: StructType({ x: xPatchType, y: yPatchType }),
            });
            assert.ok(isTypeEqual(PatchType(StructType({ x: IntegerType, y: StringType })), expected));
        });

        test('should create correct patch type for variants', () => {
            const numPatchType = VariantType({
                unchanged: NullType,
                replace: StructType({ before: IntegerType, after: IntegerType }),
            });
            const strPatchType = VariantType({
                unchanged: NullType,
                replace: StructType({ before: StringType, after: StringType }),
            });
            const expected = VariantType({
                unchanged: NullType,
                replace: StructType({
                    before: VariantType({ num: IntegerType, str: StringType }),
                    after: VariantType({ num: IntegerType, str: StringType })
                }),
                patch: VariantType({ num: numPatchType, str: strPatchType }),
            });
            assert.ok(isTypeEqual(PatchType(VariantType({ num: IntegerType, str: StringType })), expected));
        });
    });

    describe('Fuzz testing', () => {
        // Generate test cases upfront using shared fuzz configuration
        const fuzzTestCases = generateFuzzTestCases({ numTypes: 100, numSamples: 10 });

        for (const tc of fuzzTestCases) {
            describe(`Type: ${tc.typeName}`, () => {
                const diff = diffFor(tc.type);
                const apply = applyFor(tc.type);
                const invert = invertFor(tc.type);
                const compose = composeFor(tc.type);
                const equal = equalFor(tc.type);
                const patchEqual = equalFor(PatchType(tc.type));

                test('should round-trip diff and apply', () => {
                    for (const { before, after } of tc.pairs) {
                        // Diff identical values should give unchanged
                        const selfPatch = diff(before, before);
                        assert.strictEqual(selfPatch.type, 'unchanged', 'Diff of identical values should be unchanged');

                        // Apply unchanged patch should give same value
                        const appliedSelf = apply(before, selfPatch);
                        assert.ok(equal(appliedSelf, before), 'Applying unchanged patch should give same value');

                        // Diff and apply round trip
                        const patch = diff(before, after);
                        const result = apply(before, patch);
                        assert.ok(equal(result, after), 'Applying diff(a, b) to a should give b');
                    }
                });

                test('should round-trip diff, apply, invert', () => {
                    for (const { before, after } of tc.pairs) {
                        const patch = diff(before, after);
                        const result = apply(before, patch);
                        assert.ok(equal(result, after), 'Applying diff(a, b) to a should give b');

                        // Invert and apply should give back before
                        const invertedPatch = invert(patch);
                        const reversed = apply(after, invertedPatch);
                        assert.ok(equal(reversed, before), 'Applying inverted patch to b should give a');
                    }
                });

                test('should compose patches correctly', () => {
                    for (const { v1, v2, v3 } of tc.triplets) {
                        // Create patches a->b and b->c
                        const patchAB = diff(v1, v2);
                        const patchBC = diff(v2, v3);

                        // Compose them
                        const patchAC = compose(patchAB, patchBC);

                        // Apply composed patch should give same result as sequential application
                        const directResult = apply(apply(v1, patchAB), patchBC);
                        const composedResult = apply(v1, patchAC);

                        assert.ok(equal(composedResult, directResult), 'Composed patch result should match sequential application');
                        assert.ok(equal(composedResult, v3), 'Composed patch should transform a to c');
                    }
                });

                test('should double invert to identity', () => {
                    for (const { before, after } of tc.pairs) {
                        const patch = diff(before, after);

                        // Double invert should give original patch
                        const doubleInverted = invert(invert(patch));
                        assert.ok(patchEqual(doubleInverted, patch), 'Double inversion should give original patch');
                    }
                });
            });
        }
    });
});
