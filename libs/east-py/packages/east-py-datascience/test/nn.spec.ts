/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Neural networks as East data (east-workspace#1357): every operation of
 * docs/neural-networks.md held to its stated shapes and conventions, nn_init
 * and nn_run, the specification's refusals, and the reference families
 * (test/nn.reference.generated.ts) held to what hand-written torch answered —
 * on both runners, the python interpreter and east-c-datascience, which run on
 * the same torch kernels. The selection, expansion and grid operations, the
 * float64 element type, the rotary conventions and the pair-proportional
 * attention paths are east-workspace#1357's R13–R17.
 */
import { East, variant, some, none, type BlockBuilder, type NullType, type ValueTypeOf } from "@elaraai/east";
import { describeEast, Assert } from "@elaraai/east-node-std";
import { NeuralNet, NetType, NnBatchType, NnWeightsType, NnRunConfigType } from "@elaraai/east-py-datascience";
import * as ex from "./nn.examples.js";
import * as ref from "./nn.reference.generated.js";

type Block = BlockBuilder<NullType>;
type Net = ValueTypeOf<typeof NetType>;
type Batch = ValueTypeOf<typeof NnBatchType>;
type Weights = ValueTypeOf<typeof NnWeightsType>;
type InputSpec = ValueTypeOf<typeof NeuralNet.Types.NnInputSpecType>;

// ---- builders ---------------------------------------------------------------

const F = (rank: number): InputSpec => ({ dtype: variant("float", null), rank: BigInt(rank) });
const I = (rank: number): InputSpec => ({ dtype: variant("integer", null), rank: BigInt(rank) });
const Bo = (rank: number): InputSpec => ({ dtype: variant("boolean", null), rank: BigInt(rank) });
const F64 = (rank: number): InputSpec => ({ dtype: variant("float64", null), rank: BigInt(rank) });
const ft = (shape: number[], data: number[]) =>
    variant("float", { shape: shape.map(BigInt), data: new Float64Array(data) });
const f64t = (shape: number[], data: number[]) =>
    variant("float64", { shape: shape.map(BigInt), data: new Float64Array(data) });
const it = (shape: number[], data: number[]) =>
    variant("integer", { shape: shape.map(BigInt), data: new BigInt64Array(data.map(BigInt)) });
const bt = (shape: number[], data: boolean[]) =>
    variant("boolean", { shape: shape.map(BigInt), data: new Uint8ClampedArray(data.map(b => b ? 1 : 0)) });
const tensor = (shape: number[], data: number[]) => ({ shape: shape.map(BigInt), data: new Float64Array(data) });
const param = (shape: number[], init = variant("ones", null) as ValueTypeOf<typeof NeuralNet.Types.NnInitType>) =>
    ({ shape: shape.map(BigInt), init, trainable: true });

/** A network of one node `y`, from inputs (and params) through `op`, after `pre`. */
const net1 = (
    inputs: Record<string, InputSpec>,
    op: Net["nodes"][number]["op"],
    params: Record<string, ReturnType<typeof param>> = {},
    pre: Net["nodes"] = [],
): Net => ({
    inputs: new Map(Object.entries(inputs)),
    params: new Map(Object.entries(params)),
    modules: new Map(),
    nodes: [...pre, { name: "y", op }],
    outputs: new Map([["y", "y"]]),
});

const batch = (entries: Record<string, Batch extends Map<string, infer V> ? V : never>): Batch =>
    new Map(Object.entries(entries));

const run = ($: Block, net: Net, b: Batch, weights: Weights = new Map(), outputs: string[] = ["y"], seed = 0n, training = false) => {
    const n = $.let(net, NetType);
    const bb = $.let(b, NnBatchType);
    const w = $.let(weights, NnWeightsType);
    const c = $.let({ device: variant("cpu", null), seed, training }, NnRunConfigType);
    return $.let(NeuralNet.run(n, w, bb, outputs, c));
};

const expectFloat = ($: Block, got: ReturnType<typeof run>, name: string, shape: bigint[], data: Float64Array, tol = 1e-5) => {
    const t = $.let(got.get(name).unwrap("float"));
    $(Assert.equal(t.shape, shape));
    $(Assert.equal(t.data.length(), BigInt(data.length)));
    if (data.length > 0) {
        const want = $.let(data);
        $(Assert.lessEqual(t.data.map(($, x, i) => x.subtract(want.get(i)).abs()).max(), tol));
    }
};
const expectFloat64 = ($: Block, got: ReturnType<typeof run>, name: string, shape: bigint[], data: Float64Array, tol = 1e-12) => {
    const t = $.let(got.get(name).unwrap("float64"));
    $(Assert.equal(t.shape, shape));
    $(Assert.equal(t.data.length(), BigInt(data.length)));
    if (data.length > 0) {
        const want = $.let(data);
        $(Assert.lessEqual(t.data.map(($, x, i) => x.subtract(want.get(i)).abs()).max(), tol));
    }
};
const expectInteger = ($: Block, got: ReturnType<typeof run>, name: string, shape: bigint[], data: BigInt64Array) => {
    const t = $.let(got.get(name).unwrap("integer"));
    $(Assert.equal(t.shape, shape));
    $(Assert.equal(t.data, data));
};
const expectBoolean = ($: Block, got: ReturnType<typeof run>, name: string, shape: bigint[], data: Uint8ClampedArray) => {
    const t = $.let(got.get(name).unwrap("boolean"));
    $(Assert.equal(t.shape, shape));
    $(Assert.equal(t.data, data));
};
const f64 = (...xs: number[]) => new Float64Array(xs);
const i64 = (...xs: number[]) => new BigInt64Array(xs.map(BigInt));
const bools = (...xs: boolean[]) => new Uint8ClampedArray(xs.map(b => b ? 1 : 0));
const sh = (...xs: number[]) => xs.map(BigInt);
/** A Park–Miller stream: data both runners see as the same literals. */
const stream = (seed: number) => {
    let x = seed;
    return () => {
        x = (x * 48271) % 2147483647;
        return x / 2147483647;
    };
};
/** `n` floats in (−1, 1) from `seed`. */
const floats = (n: number, seed: number) => {
    const r = stream(seed);
    return Array.from({ length: n }, () => r() * 2 - 1);
};
/** `n` integers in `0 .. k−1` from `seed`. */
const ints = (n: number, k: number, seed: number) => {
    const r = stream(seed);
    return Array.from({ length: n }, () => Math.floor(r() * k) % k);
};

describeEast("NeuralNet platform functions", test => {
    Assert.examples(test, { nnInit: ex.nnInit, nnRun: ex.nnRun });

    // ========================================================================
    // Indexing and layout
    // ========================================================================

    test("gather takes rows of a table by index", $ => {
        const net = net1({ table: F(2), index: I(1) }, variant("gather", { table: "table", index: "index" }));
        const out = run($, net, batch({ table: ft([3, 2], [1, 2, 3, 4, 5, 6]), index: it([2], [2, 0]) }));
        expectFloat($, out, "y", sh(2, 2), f64(5, 6, 1, 2));
    });

    test("gather by a rank-0 index answers one row, and refuses an index outside the table", $ => {
        const net = net1({ table: F(2), index: I(0) }, variant("gather", { table: "table", index: "index" }));
        const out = run($, net, batch({ table: ft([3, 2], [1, 2, 3, 4, 5, 6]), index: it([], [1]) }));
        expectFloat($, out, "y", sh(2), f64(3, 4));
        const n = $.let(net, NetType);
        const b = $.let(batch({ table: ft([3, 2], [1, 2, 3, 4, 5, 6]), index: it([], [3]) }), NnBatchType);
        const c = $.let({ device: variant("cpu", null), seed: 0n, training: false }, NnRunConfigType);
        $(Assert.throws(NeuralNet.run(n, new Map(), b, ["y"], c), /nn_run: node 'y': gather: index 3 is outside 0 \.\. 2/));
    });

    test("embedding_bag sums weighted rows per segment, an empty segment zeros", $ => {
        const net = net1(
            { table: F(2), index: I(1), w: F(1), seg: I(1), sz: I(1) },
            variant("embedding_bag", { table: "table", index: "index", weights: some("w"), segments: "seg", size: "sz" }),
        );
        const out = run($, net, batch({
            table: ft([3, 2], [1, 0, 0, 1, 2, 2]), index: it([3], [0, 1, 2]), w: ft([3], [1, 2, 0.5]),
            seg: it([3], [0, 0, 2]), sz: it([3], [0, 0, 0]),
        }));
        expectFloat($, out, "y", sh(3, 2), f64(1, 2, 0, 0, 1, 1));
    });

    test("embedding_bag without weights sums the rows", $ => {
        const net = net1(
            { table: F(2), index: I(1), seg: I(1), sz: I(1) },
            variant("embedding_bag", { table: "table", index: "index", weights: none, segments: "seg", size: "sz" }),
        );
        const out = run($, net, batch({
            table: ft([2, 2], [1, 2, 3, 4]), index: it([2], [0, 1]), seg: it([2], [1, 1]), sz: it([2], [0, 0]),
        }));
        expectFloat($, out, "y", sh(2, 2), f64(0, 0, 4, 6));
    });

    test("segment_reduce sums, averages, maxes and mins per segment, an empty segment 0", $ => {
        const b = batch({ x: ft([4, 1], [1, 2, 3, 4]), seg: it([4], [0, 0, 2, 2]), sz: ft([3], [0, 0, 0]) });
        for (const [reduce, want] of [["sum", [3, 0, 7]], ["mean", [1.5, 0, 3.5]], ["max", [2, 0, 4]], ["min", [1, 0, 3]]] as const) {
            const net = net1(
                { x: F(2), seg: I(1), sz: F(1) },
                variant("segment_reduce", { x: "x", segments: "seg", size: "sz", reduce: variant(reduce, null) }),
            );
            expectFloat($, run($, net, b), "y", sh(3, 1), f64(...want));
        }
    });

    test("segment_reduce on integers keeps integers", $ => {
        const net = net1(
            { x: I(1), seg: I(1), sz: I(1) },
            variant("segment_reduce", { x: "x", segments: "seg", size: "sz", reduce: variant("max", null) }),
        );
        const out = run($, net, batch({ x: it([3], [5, -2, 7]), seg: it([3], [1, 1, 0]), sz: it([2], [0, 0]) }));
        expectInteger($, out, "y", sh(2), i64(7, 5));
    });

    test("segment_softmax and segment_log_softmax normalise within each segment", $ => {
        const b = batch({ x: ft([4], [1, 1, 2, 5]), seg: it([4], [0, 0, 1, 1]) });
        const soft = net1({ x: F(1), seg: I(1) }, variant("segment_softmax", { x: "x", segments: "seg" }));
        expectFloat($, run($, soft, b), "y", sh(4), f64(0.5, 0.5, 0.04742587357759476, 0.9525741338729858));
        const logs = net1({ x: F(1), seg: I(1) }, variant("segment_log_softmax", { x: "x", segments: "seg" }));
        expectFloat($, run($, logs, b), "y", sh(4), f64(Math.log(0.5), Math.log(0.5), -3.0485873222351074, -0.04858732968568802));
    });

    test("scatter_add adds rows at their index into zeros", $ => {
        const net = net1({ x: F(2), index: I(1), sz: F(1) }, variant("scatter_add", { x: "x", index: "index", size: "sz" }));
        const out = run($, net, batch({ x: ft([3, 2], [1, 2, 3, 4, 5, 6]), index: it([3], [1, 1, 0]), sz: ft([2], [0, 0]) }));
        expectFloat($, out, "y", sh(2, 2), f64(5, 6, 4, 6));
    });

    test("concat joins along an axis, split takes a part, slice takes a window", $ => {
        const cat0 = net1({ a: F(2), b: F(2) }, variant("concat", { inputs: ["a", "b"], axis: 0n }));
        expectFloat($, run($, cat0, batch({ a: ft([1, 2], [1, 2]), b: ft([1, 2], [3, 4]) })), "y", sh(2, 2), f64(1, 2, 3, 4));
        const cat1 = net1({ a: F(2), b: F(2) }, variant("concat", { inputs: ["a", "b"], axis: 1n }));
        expectFloat($, run($, cat1, batch({ a: ft([1, 2], [1, 2]), b: ft([1, 2], [3, 4]) })), "y", sh(1, 4), f64(1, 2, 3, 4));
        const split = net1({ x: F(1) }, variant("split", { x: "x", axis: 0n, sizes: [2n, 3n], part: 1n }));
        expectFloat($, run($, split, batch({ x: ft([5], [1, 2, 3, 4, 5]) })), "y", sh(3), f64(3, 4, 5));
        const sl1 = net1({ x: F(1) }, variant("slice", { x: "x", axis: 0n, start: 1n, stop: some(-1n) }));
        expectFloat($, run($, sl1, batch({ x: ft([5], [1, 2, 3, 4, 5]) })), "y", sh(3), f64(2, 3, 4));
        const sl2 = net1({ x: F(1) }, variant("slice", { x: "x", axis: 0n, start: -2n, stop: none }));
        expectFloat($, run($, sl2, batch({ x: ft([5], [1, 2, 3, 4, 5]) })), "y", sh(2), f64(4, 5));
    });

    test("pad fills with zeros or replicates the edges", $ => {
        const zeros = net1({ x: F(1) }, variant("pad", { x: "x", axis: 0n, before: 1n, after: 2n, mode: variant("zeros", null) }));
        expectFloat($, run($, zeros, batch({ x: ft([2], [1, 2]) })), "y", sh(5), f64(0, 1, 2, 0, 0));
        const rep = net1({ x: F(2) }, variant("pad", { x: "x", axis: 1n, before: 1n, after: 2n, mode: variant("replicate", null) }));
        expectFloat($, run($, rep, batch({ x: ft([1, 2], [1, 2]) })), "y", sh(1, 5), f64(1, 1, 2, 2, 2));
    });

    test("reshape infers one dimension, permute reorders axes, broadcast follows another operand", $ => {
        const rs = net1({ x: F(1) }, variant("reshape", { x: "x", shape: [2n, -1n] }));
        expectFloat($, run($, rs, batch({ x: ft([6], [1, 2, 3, 4, 5, 6]) })), "y", sh(2, 3), f64(1, 2, 3, 4, 5, 6));
        const pm = net1({ x: F(2) }, variant("permute", { x: "x", axes: [1n, 0n] }));
        expectFloat($, run($, pm, batch({ x: ft([2, 3], [1, 2, 3, 4, 5, 6]) })), "y", sh(3, 2), f64(1, 4, 2, 5, 3, 6));
        const bc = net1({ x: F(2), like: F(2) }, variant("broadcast", { x: "x", like: "like" }));
        expectFloat($, run($, bc, batch({ x: ft([2, 1], [1, 2]), like: ft([2, 3], [0, 0, 0, 0, 0, 0]) })), "y", sh(2, 3), f64(1, 1, 1, 2, 2, 2));
    });

    test("where picks by a boolean condition, broadcasting", $ => {
        const net = net1({ c: Bo(1), a: F(1), b: F(1) }, variant("where", { cond: "c", a: "a", b: "b" }));
        const out = run($, net, batch({ c: bt([3], [true, false, true]), a: ft([3], [1, 2, 3]), b: ft([1], [10]) }));
        expectFloat($, out, "y", sh(3), f64(1, 10, 3));
    });

    test("constant is a rank-0 tensor of its case, and cast moves between element types", $ => {
        const cf = net1({}, variant("constant", { value: variant("float", 2.5) }));
        expectFloat($, run($, cf, new Map()), "y", sh(), f64(2.5));
        const ci = net1({}, variant("constant", { value: variant("integer", 3n) }));
        expectInteger($, run($, ci, new Map()), "y", sh(), i64(3));
        const toInt = net1({ x: F(1) }, variant("cast", { x: "x", dtype: variant("integer", null) }));
        expectInteger($, run($, toInt, batch({ x: ft([3], [1.7, -1.7, 2.0]) })), "y", sh(3), i64(1, -1, 2));
        const toFloat = net1({ x: Bo(1) }, variant("cast", { x: "x", dtype: variant("float", null) }));
        expectFloat($, run($, toFloat, batch({ x: bt([2], [true, false]) })), "y", sh(2), f64(1, 0));
        const toBool = net1({ x: I(1) }, variant("cast", { x: "x", dtype: variant("boolean", null) }));
        expectBoolean($, run($, toBool, batch({ x: it([2], [0, 2]) })), "y", sh(2), bools(false, true));
    });

    test("mask_select takes the rows a mask picks, mask_indices their indices, repeat expands rows by counts", $ => {
        const sel = net1({ x: F(2), m: Bo(1) }, variant("mask_select", { x: "x", mask: "m" }));
        const x = ft([3, 2], [1, 2, 3, 4, 5, 6]);
        expectFloat($, run($, sel, batch({ x, m: bt([3], [true, false, true]) })), "y", sh(2, 2), f64(1, 2, 5, 6));
        expectFloat($, run($, sel, batch({ x, m: bt([3], [false, false, false]) })), "y", sh(0, 2), f64());
        const isel = net1({ x: I(1), m: Bo(1) }, variant("mask_select", { x: "x", mask: "m" }));
        expectInteger($, run($, isel, batch({ x: it([3], [7, 8, 9]), m: bt([3], [false, true, true]) })), "y", sh(2), i64(8, 9));
        const idx = net1({ m: Bo(1) }, variant("mask_indices", { mask: "m" }));
        expectInteger($, run($, idx, batch({ m: bt([4], [true, false, false, true]) })), "y", sh(2), i64(0, 3));
        expectInteger($, run($, idx, batch({ m: bt([2], [false, false]) })), "y", sh(0), i64());
        const rep = net1({ x: F(2), c: I(1) }, variant("repeat", { x: "x", counts: "c" }));
        expectFloat($, run($, rep, batch({ x, c: it([3], [2, 0, 1]) })), "y", sh(3, 2), f64(1, 2, 1, 2, 5, 6));
        const cfg = $.let({ device: variant("cpu", null), seed: 0n, training: false }, NnRunConfigType);
        const w0 = $.let(new Map(), NnWeightsType);
        const negative = $.let(batch({ x, c: it([3], [2, -1, 1]) }), NnBatchType);
        $(Assert.throws(NeuralNet.run($.let(rep, NetType), w0, negative, ["y"], cfg), /nn_run: node 'y': repeat: counts must not be negative/));
        const short = $.let(batch({ x, m: bt([2], [true, false]) }), NnBatchType);
        $(Assert.throws(NeuralNet.run($.let(sel, NetType), w0, short, ["y"], cfg),
            /nn_run: node 'y': mask_select: mask is a boolean vector with one entry per row of x/));
    });

    test("range builds an integer grid short of a rank-0 stop, in either direction", $ => {
        const up = net1({ n: I(0) }, variant("range", { start: 1n, stop: "n", step: 2n }));
        expectInteger($, run($, up, batch({ n: it([], [8]) })), "y", sh(4), i64(1, 3, 5, 7));
        const down = net1({ n: I(0) }, variant("range", { start: 5n, stop: "n", step: -2n }));
        expectInteger($, run($, down, batch({ n: it([], [0]) })), "y", sh(3), i64(5, 3, 1));
        const empty = net1({ n: I(0) }, variant("range", { start: 3n, stop: "n", step: 1n }));
        expectInteger($, run($, empty, batch({ n: it([], [3]) })), "y", sh(0), i64());
        // a grid following a constant length, cast and scaled: a position channel
        const grid = net1({}, variant("div", { a: "t", b: "Lf" }), {}, [
            { name: "L", op: variant("constant", { value: variant("integer", 4n) }) },
            { name: "g", op: variant("range", { start: 0n, stop: "L", step: 1n }) },
            { name: "t", op: variant("cast", { x: "g", dtype: variant("float", null) }) },
            { name: "Lf", op: variant("cast", { x: "L", dtype: variant("float", null) }) },
        ]);
        expectFloat($, run($, grid, new Map()), "y", sh(4), f64(0, 0.25, 0.5, 0.75));
        const cfg = $.let({ device: variant("cpu", null), seed: 0n, training: false }, NnRunConfigType);
        const zero = $.let(net1({ n: I(0) }, variant("range", { start: 0n, stop: "n", step: 0n })), NetType);
        const b = $.let(batch({ n: it([], [3]) }), NnBatchType);
        $(Assert.throws(NeuralNet.run(zero, $.let(new Map(), NnWeightsType), b, ["y"], cfg), /nn_run: node 'y': range: step must not be zero/));
    });

    test("floor, ceil and round (halves to even) follow torch, and remainder takes the divisor's sign", $ => {
        const un = (op: "floor" | "ceil" | "round") => net1({ x: F(1) }, variant(op, { x: "x" }));
        const x = ft([6], [-1.5, -0.5, 0.5, 1.5, 2.5, 2.7]);
        expectFloat($, run($, un("floor"), batch({ x })), "y", sh(6), f64(-2, -1, 0, 1, 2, 2));
        expectFloat($, run($, un("ceil"), batch({ x })), "y", sh(6), f64(-1, 0, 1, 2, 3, 3));
        expectFloat($, run($, un("round"), batch({ x })), "y", sh(6), f64(-2, 0, 0, 2, 2, 3));
        const rem = net1({ a: F(1), b: F(1) }, variant("remainder", { a: "a", b: "b" }));
        expectFloat($, run($, rem, batch({ a: ft([3], [-7, 7, 7.5]), b: ft([3], [3, -3, 2]) })), "y", sh(3), f64(2, -2, 1.5));
        const irem = net1({ a: I(1), b: I(1) }, variant("remainder", { a: "a", b: "b" }));
        expectInteger($, run($, irem, batch({ a: it([3], [-7, 7, 9]), b: it([3], [3, -3, 3]) })), "y", sh(3), i64(2, -2, 0));
        // a float remainder by zero is NaN; an integer one is refused
        const byZero = net1({ a: F(1), b: F(1) }, variant("is_nan", { x: "r" }), {}, [{ name: "r", op: variant("remainder", { a: "a", b: "b" }) }]);
        expectBoolean($, run($, byZero, batch({ a: ft([2], [1, 1]), b: ft([2], [0, 1]) })), "y", sh(2), bools(true, false));
        const cfg = $.let({ device: variant("cpu", null), seed: 0n, training: false }, NnRunConfigType);
        const b = $.let(batch({ a: it([1], [1]), b: it([1], [0]) }), NnBatchType);
        $(Assert.throws(NeuralNet.run($.let(irem, NetType), $.let(new Map(), NnWeightsType), b, ["y"], cfg),
            /nn_run: node 'y': remainder: integer division by zero/));
    });

    test("searchsorted finds insertion points on either side, take_along gathers along an axis", $ => {
        const left = net1({ s: F(1), v: F(1) }, variant("searchsorted", { sorted: "s", values: "v", right: false }));
        const b = batch({ s: ft([4], [1, 2, 2, 4]), v: ft([4], [0, 2, 3, 5]) });
        expectInteger($, run($, left, b), "y", sh(4), i64(0, 1, 3, 4));
        const right = net1({ s: F(1), v: F(1) }, variant("searchsorted", { sorted: "s", values: "v", right: true }));
        expectInteger($, run($, right, b), "y", sh(4), i64(0, 3, 3, 4));
        const ileft = net1({ s: I(1), v: I(2) }, variant("searchsorted", { sorted: "s", values: "v", right: false }));
        expectInteger($, run($, ileft, batch({ s: it([3], [10, 20, 30]), v: it([1, 2], [15, 30]) })), "y", sh(1, 2), i64(1, 2));
        const along = net1({ x: F(2), i: I(2) }, variant("take_along", { x: "x", index: "i", axis: 1n }));
        const x = ft([2, 3], [1, 2, 3, 4, 5, 6]);
        expectFloat($, run($, along, batch({ x, i: it([2, 2], [2, 0, 1, 1]) })), "y", sh(2, 2), f64(3, 1, 5, 5));
        const along0 = net1({ x: F(2), i: I(2) }, variant("take_along", { x: "x", index: "i", axis: 0n }));
        expectFloat($, run($, along0, batch({ x, i: it([1, 3], [1, 0, 1]) })), "y", sh(1, 3), f64(4, 2, 6));
        const cfg = $.let({ device: variant("cpu", null), seed: 0n, training: false }, NnRunConfigType);
        const w0 = $.let(new Map(), NnWeightsType);
        const outside = $.let(batch({ x, i: it([2, 2], [3, 0, 1, 1]) }), NnBatchType);
        $(Assert.throws(NeuralNet.run($.let(along, NetType), w0, outside, ["y"], cfg), /nn_run: node 'y': take_along: index 3 is outside 0 \.\. 2/));
        const offAxis = $.let(batch({ x, i: it([1, 2], [0, 1]) }), NnBatchType);
        $(Assert.throws(NeuralNet.run($.let(along, NetType), w0, offAxis, ["y"], cfg),
            /nn_run: node 'y': take_along: index is shaped \[1, 2\] but x is \[2, 3\]: they differ off the axis/));
    });

    // ========================================================================
    // Dense
    // ========================================================================

    test("linear is x·Wᵀ + b", $ => {
        const net = net1({ x: F(2) }, variant("linear", { x: "x", weight: "w", bias: some("b") }), { w: param([3, 2]), b: param([3]) });
        const weights: Weights = new Map([["w", tensor([3, 2], [1, 0, 0, 1, 1, 1])], ["b", tensor([3], [0.5, 0, -1])]]);
        expectFloat($, run($, net, batch({ x: ft([1, 2], [1, 2]) }), weights), "y", sh(1, 3), f64(1.5, 2, 2));
    });

    test("einsum contracts by explicit subscripts", $ => {
        const mm = net1({ a: F(2), b: F(2) }, variant("einsum", { subscripts: "ij,jk->ik", inputs: ["a", "b"] }));
        expectFloat($, run($, mm, batch({ a: ft([2, 2], [1, 2, 3, 4]), b: ft([2, 2], [0, 1, 1, 0]) })), "y", sh(2, 2), f64(2, 1, 4, 3));
        const dot = net1({ a: F(1), b: F(1) }, variant("einsum", { subscripts: "i,i->", inputs: ["a", "b"] }));
        expectFloat($, run($, dot, batch({ a: ft([3], [1, 2, 3]), b: ft([3], [4, 5, 6]) })), "y", sh(), f64(32));
        const outer = net1({ a: F(1), b: F(1) }, variant("einsum", { subscripts: "i,j->ji", inputs: ["a", "b"] }));
        expectFloat($, run($, outer, batch({ a: ft([2], [1, 2]), b: ft([3], [1, 10, 100]) })), "y", sh(3, 2), f64(1, 2, 10, 20, 100, 200));
    });

    test("conv1d is a cross-correlation with stride, dilation and groups, and no padding", $ => {
        const x = ft([1, 1, 5], [1, 2, 3, 4, 5]);
        const w: Weights = new Map([["w", tensor([1, 1, 2], [1, 1])]]);
        const conv = (stride: number, dilation: number) => net1(
            { x: F(3) }, variant("conv1d", { x: "x", weight: "w", bias: none, stride: BigInt(stride), dilation: BigInt(dilation), groups: 1n }),
            { w: param([1, 1, 2]) },
        );
        expectFloat($, run($, conv(1, 1), batch({ x }), w), "y", sh(1, 1, 4), f64(3, 5, 7, 9));
        expectFloat($, run($, conv(2, 1), batch({ x }), w), "y", sh(1, 1, 2), f64(3, 7));
        expectFloat($, run($, conv(1, 2), batch({ x }), w), "y", sh(1, 1, 3), f64(4, 6, 8));
        const grouped = net1(
            { x: F(3) }, variant("conv1d", { x: "x", weight: "g", bias: some("b"), stride: 1n, dilation: 1n, groups: 2n }),
            { g: param([2, 1, 1]), b: param([2]) },
        );
        const gw: Weights = new Map([["g", tensor([2, 1, 1], [10, 100])], ["b", tensor([2], [1, 2])]]);
        expectFloat($, run($, grouped, batch({ x: ft([1, 2, 2], [1, 2, 3, 4]) }), gw), "y", sh(1, 2, 2), f64(11, 21, 302, 402));
    });

    test("avg_pool1d averages windows and upsample_nearest repeats elements", $ => {
        const pool = net1({ x: F(3) }, variant("avg_pool1d", { x: "x", kernel: 2n, stride: 2n }));
        expectFloat($, run($, pool, batch({ x: ft([1, 1, 5], [1, 2, 3, 4, 5]) })), "y", sh(1, 1, 2), f64(1.5, 3.5));
        const up = net1({ x: F(3) }, variant("upsample_nearest", { x: "x", scale: 2n }));
        expectFloat($, run($, up, batch({ x: ft([1, 1, 3], [1, 2, 3]) })), "y", sh(1, 1, 6), f64(1, 1, 2, 2, 3, 3));
    });

    test("layer_norm normalises the last axis and group_norm each group of channels", $ => {
        const ln = net1({ x: F(2) }, variant("layer_norm", { x: "x", weight: none, bias: none, eps: 0.0 }));
        expectFloat($, run($, ln, batch({ x: ft([1, 3], [1, 2, 3]) })), "y", sh(1, 3), f64(-1.2247448713915890, 0, 1.2247448713915890));
        const lnw = net1({ x: F(2) }, variant("layer_norm", { x: "x", weight: some("w"), bias: some("b"), eps: 0.0 }), { w: param([3]), b: param([3]) });
        const wb: Weights = new Map([["w", tensor([3], [2, 2, 2])], ["b", tensor([3], [1, 1, 1])]]);
        expectFloat($, run($, lnw, batch({ x: ft([1, 3], [1, 2, 3]) }), wb), "y", sh(1, 3), f64(-1.449489742783178, 1, 3.449489742783178));
        const gn1 = net1({ x: F(3) }, variant("group_norm", { x: "x", groups: 1n, weight: none, bias: none, eps: 0.0 }));
        expectFloat($, run($, gn1, batch({ x: ft([1, 2, 2], [1, 3, 2, 4]) })), "y", sh(1, 2, 2),
            f64(-1.3416407864998738, 0.4472135954999579, -0.4472135954999579, 1.3416407864998738));
        const gn2 = net1({ x: F(3) }, variant("group_norm", { x: "x", groups: 2n, weight: none, bias: none, eps: 0.0 }));
        expectFloat($, run($, gn2, batch({ x: ft([1, 2, 2], [1, 3, 2, 4]) })), "y", sh(1, 2, 2), f64(-1, 1, -1, 1));
    });

    // ========================================================================
    // Element-wise
    // ========================================================================

    test("binary arithmetic broadcasts", $ => {
        const bin = (op: "add" | "sub" | "mul" | "div" | "pow") => net1({ a: F(1), b: F(1) }, variant(op, { a: "a", b: "b" }));
        expectFloat($, run($, bin("add"), batch({ a: ft([2], [1, 2]), b: ft([1], [10]) })), "y", sh(2), f64(11, 12));
        expectFloat($, run($, bin("sub"), batch({ a: ft([2], [1, 2]), b: ft([2], [3, 1]) })), "y", sh(2), f64(-2, 1));
        expectFloat($, run($, bin("mul"), batch({ a: ft([2], [1.5, 2]), b: ft([2], [2, 3]) })), "y", sh(2), f64(3, 6));
        expectFloat($, run($, bin("div"), batch({ a: ft([2], [1, 2]), b: ft([2], [2, 4]) })), "y", sh(2), f64(0.5, 0.5));
        expectFloat($, run($, bin("pow"), batch({ a: ft([2], [2, 3]), b: ft([1], [2]) })), "y", sh(2), f64(4, 9));
        const iadd = net1({ a: I(2), b: I(1) }, variant("add", { a: "a", b: "b" }));
        expectInteger($, run($, iadd, batch({ a: it([2, 2], [1, 2, 3, 4]), b: it([2], [10, 20]) })), "y", sh(2, 2), i64(11, 22, 13, 24));
    });

    test("unary functions follow their conventions", $ => {
        const un = (op: string) => net1({ x: F(1) }, variant(op as "exp", { x: "x" }));
        const check = (op: string, x: number[], want: number[], tol = 1e-5) =>
            expectFloat($, run($, un(op), batch({ x: ft([x.length], x) })), "y", sh(x.length), f64(...want), tol);
        check("neg", [1, -2], [-1, 2]);
        check("abs", [-1.5, 2], [1.5, 2]);
        check("exp", [0, 1], [1, Math.E]);
        check("log", [1, Math.E], [0, 1]);
        check("log1p", [0, Math.E - 1], [0, 1]);
        check("sqrt", [4, 9], [2, 3]);
        check("softplus", [0, 30], [Math.log(2), 30]);
        check("sigmoid", [0], [0.5]);
        check("tanh", [0], [0]);
        check("relu", [-1, 2], [0, 2]);
        check("silu", [1], [0.7310585786300049]);
        check("sin", [0, Math.PI / 2], [0, 1]);
        check("cos", [0], [1]);
        check("normal_cdf", [0, 1.96], [0.5, 0.9750021048517795]);
        check("log_normal_cdf", [0, -10], [Math.log(0.5), -53.23128515051248], 1e-3);
        check("normal_quantile", [0.5, 0.975], [0, 1.959963984540054]);
        check("log1mexp", [-0.1, -3], [-2.3521684610440907, -0.05106918094270159]);
    });

    test("gelu has its exact and tanh forms, clamp its optional sides, nan_to_num its three replacements", $ => {
        const exact = net1({ x: F(1) }, variant("gelu", { x: "x", approximate: variant("exact", null) }));
        expectFloat($, run($, exact, batch({ x: ft([1], [1]) })), "y", sh(1), f64(0.8413447460685429));
        const tanh = net1({ x: F(1) }, variant("gelu", { x: "x", approximate: variant("tanh", null) }));
        expectFloat($, run($, tanh, batch({ x: ft([1], [1]) })), "y", sh(1), f64(0.8411919906082768));
        const clamp = net1({ x: F(1) }, variant("clamp", { x: "x", min: some(-1.0), max: some(1.0) }));
        expectFloat($, run($, clamp, batch({ x: ft([3], [-2, 0.5, 3]) })), "y", sh(3), f64(-1, 0.5, 1));
        const lower = net1({ x: F(1) }, variant("clamp", { x: "x", min: some(0.0), max: none }));
        expectFloat($, run($, lower, batch({ x: ft([2], [-2, 3]) })), "y", sh(2), f64(0, 3));
        const n2n = net1({ x: F(1) }, variant("nan_to_num", { x: "x", nan: 0.0, posinf: 9.0, neginf: -9.0 }));
        expectFloat($, run($, n2n, batch({ x: ft([4], [NaN, Infinity, -Infinity, 1]) })), "y", sh(4), f64(0, 9, -9, 1));
        const isnan = net1({ x: F(1) }, variant("is_nan", { x: "x" }));
        expectBoolean($, run($, isnan, batch({ x: ft([2], [NaN, 1]) })), "y", sh(2), bools(true, false));
    });

    test("comparisons answer booleans and the logical operations combine them", $ => {
        const cmp = (op: "eq" | "ne" | "lt" | "le" | "gt" | "ge") => net1({ a: F(1), b: F(1) }, variant(op, { a: "a", b: "b" }));
        const b = batch({ a: ft([3], [1, 2, 3]), b: ft([3], [2, 2, 2]) });
        expectBoolean($, run($, cmp("eq"), b), "y", sh(3), bools(false, true, false));
        expectBoolean($, run($, cmp("ne"), b), "y", sh(3), bools(true, false, true));
        expectBoolean($, run($, cmp("lt"), b), "y", sh(3), bools(true, false, false));
        expectBoolean($, run($, cmp("le"), b), "y", sh(3), bools(true, true, false));
        expectBoolean($, run($, cmp("gt"), b), "y", sh(3), bools(false, false, true));
        expectBoolean($, run($, cmp("ge"), b), "y", sh(3), bools(false, true, true));
        const ieq = net1({ a: I(1), b: I(1) }, variant("eq", { a: "a", b: "b" }));
        expectBoolean($, run($, ieq, batch({ a: it([2], [1, 2]), b: it([1], [2]) })), "y", sh(2), bools(false, true));
        const lb = batch({ a: bt([2], [true, false]), b: bt([2], [true, true]) });
        expectBoolean($, run($, net1({ a: Bo(1), b: Bo(1) }, variant("logical_and", { a: "a", b: "b" })), lb), "y", sh(2), bools(true, false));
        expectBoolean($, run($, net1({ a: Bo(1), b: Bo(1) }, variant("logical_or", { a: "a", b: "b" })), lb), "y", sh(2), bools(true, true));
        expectBoolean($, run($, net1({ a: Bo(1) }, variant("logical_not", { x: "a" })), batch({ a: bt([2], [true, false]) })), "y", sh(2), bools(false, true));
    });

    // ========================================================================
    // float64 (docs/neural-networks.md §2)
    // ========================================================================

    test("float64 is an element type of its own: inputs, cast and constant, promoted with float", $ => {
        const add = net1({ a: F64(1), b: F(1) }, variant("add", { a: "a", b: "b" }));
        // 0.2 as a float is 0.20000000298…: the sum is taken in double, of the float's value
        expectFloat64($, run($, add, batch({ a: f64t([1], [0.1]), b: ft([1], [0.2]) })), "y", sh(1), f64(0.1 + Math.fround(0.2)));
        const keep = net1({ a: F64(1), b: F64(1) }, variant("mul", { a: "a", b: "b" }));
        expectFloat64($, run($, keep, batch({ a: f64t([2], [1e-300, 2.5]), b: f64t([2], [1e-10, 4]) })), "y", sh(2), f64(1e-310, 10));
        const cast = net1({ x: F(1) }, variant("cast", { x: "x", dtype: variant("float64", null) }));
        expectFloat64($, run($, cast, batch({ x: ft([1], [0.1]) })), "y", sh(1), f64(Math.fround(0.1)));
        const back = net1({ x: F64(1) }, variant("cast", { x: "x", dtype: variant("float", null) }));
        expectFloat($, run($, back, batch({ x: f64t([1], [0.1]) })), "y", sh(1), f64(Math.fround(0.1)), 0);
        const c = net1({}, variant("constant", { value: variant("float64", 0.1) }));
        expectFloat64($, run($, c, new Map()), "y", sh(), f64(0.1));
        const toInt = net1({ x: F64(1) }, variant("cast", { x: "x", dtype: variant("integer", null) }));
        expectInteger($, run($, toInt, batch({ x: f64t([2], [12345678901234.7, -2.9]) })), "y", sh(2), i64(12345678901234, -2));
        const where = net1({ c: Bo(1), a: F(1), b: F64(1) }, variant("where", { cond: "c", a: "a", b: "b" }));
        expectFloat64($, run($, where, batch({ c: bt([2], [true, false]), a: ft([2], [1, 1]), b: f64t([2], [0.1, 0.1]) })), "y", sh(2), f64(1, 0.1));
        const lt = net1({ a: F(1), b: F64(1) }, variant("lt", { a: "a", b: "b" }));
        expectBoolean($, run($, lt, batch({ a: ft([2], [0.1, 0.1]), b: f64t([2], [0.1, 0.2]) })), "y", sh(2), bools(false, true));
        const cfg = $.let({ device: variant("cpu", null), seed: 0n, training: false }, NnRunConfigType);
        const w0 = $.let(new Map(), NnWeightsType);
        const mixed = $.let(net1({ a: F64(1), b: I(1) }, variant("add", { a: "a", b: "b" })), NetType);
        const mixedBatch = $.let(batch({ a: f64t([1], [1]), b: it([1], [1]) }), NnBatchType);
        $(Assert.throws(NeuralNet.run(mixed, w0, mixedBatch, ["y"], cfg),
            /nn_run: node 'y': add: takes float or integer operands of one type, got float64 and integer/));
        const declared = $.let(net1({ x: F64(1) }, variant("neg", { x: "x" })), NetType);
        const given = $.let(batch({ x: ft([1], [1]) }), NnBatchType);
        $(Assert.throws(NeuralNet.run(declared, w0, given, ["y"], cfg), /nn_run: input 'x' is float but the network declares float64/));
        const dense = $.let(net1({ x: F64(2) }, variant("linear", { x: "x", weight: "w", bias: none }), { w: param([1, 1]) }), NetType);
        const row = $.let(batch({ x: f64t([1, 1], [1]) }), NnBatchType);
        $(Assert.throws(NeuralNet.run(dense, w0, row, ["y"], cfg), /nn_run: node 'y': linear: x must be float/));
    });

    test("the cumsum of a million values of 1e-3 is within 1e-9 relative of its sum in float64, and is not in float", $ => {
        const cum = (dtype: InputSpec): Net => net1({ x: dtype }, variant("slice", { x: "c", axis: 0n, start: -1n, stop: none }), {}, [
            { name: "c", op: variant("cumsum", { x: "x", axis: 0n }) },
        ]);
        const cfg = $.let({ device: variant("cpu", null), seed: 0n, training: false }, NnRunConfigType);
        const w0 = $.let(new Map(), NnWeightsType);
        const n64 = $.let(cum(F64(1)), NetType);
        const b64 = $.let(new Map([["x", variant("float64", { shape: [1000000n], data: East.Vector.fill(1000000n, 1e-3) })]]), NnBatchType);
        const last64 = $.let(NeuralNet.run(n64, w0, b64, ["y"], cfg).get("y").unwrap("float64").data.get(0n));
        $(Assert.lessEqual(last64.subtract(1000.0).abs(), 1e-6));
        const n32 = $.let(cum(F(1)), NetType);
        const b32 = $.let(new Map([["x", variant("float", { shape: [1000000n], data: East.Vector.fill(1000000n, 1e-3) })]]), NnBatchType);
        const last32 = $.let(NeuralNet.run(n32, w0, b32, ["y"], cfg).get("y").unwrap("float").data.get(0n));
        $(Assert.greater(last32.subtract(1000.0).abs(), 1e-6));
    });

    // ========================================================================
    // Along an axis
    // ========================================================================

    test("reductions remove the axis and the scans keep it", $ => {
        const ax = (op: string, axis: number) => net1({ x: F(2) }, variant(op as "sum", { x: "x", axis: BigInt(axis) }));
        const b = batch({ x: ft([2, 3], [1, 2, 3, 4, 5, 6]) });
        expectFloat($, run($, ax("sum", 1), b), "y", sh(2), f64(6, 15));
        expectFloat($, run($, ax("sum", 0), b), "y", sh(3), f64(5, 7, 9));
        expectFloat($, run($, ax("mean", -1), b), "y", sh(2), f64(2, 5));
        expectFloat($, run($, ax("max", 1), b), "y", sh(2), f64(3, 6));
        expectFloat($, run($, ax("min", 0), b), "y", sh(3), f64(1, 2, 3));
        expectFloat($, run($, ax("cumsum", 1), b), "y", sh(2, 3), f64(1, 3, 6, 4, 9, 15));
        expectFloat($, run($, ax("logsumexp", 1), batch({ x: ft([1, 2], [0, 0]) })), "y", sh(1), f64(Math.log(2)));
        expectFloat($, run($, ax("softmax", 1), batch({ x: ft([1, 2], [0, Math.log(3)]) })), "y", sh(1, 2), f64(0.25, 0.75));
        expectFloat($, run($, ax("log_softmax", 1), batch({ x: ft([1, 2], [0, 0]) })), "y", sh(1, 2), f64(-Math.log(2), -Math.log(2)));
        expectFloat($, run($, ax("cummax", 1), batch({ x: ft([1, 3], [1, 3, 2]) })), "y", sh(1, 3), f64(1, 3, 3));
        expectFloat($, run($, ax("cummin", 1), batch({ x: ft([1, 3], [3, 1, 2]) })), "y", sh(1, 3), f64(3, 1, 1));
        const am = net1({ x: F(2) }, variant("argmax", { x: "x", axis: 1n }));
        expectInteger($, run($, am, batch({ x: ft([2, 3], [1, 5, 2, 7, 0, 7]) })), "y", sh(2), i64(1, 0));
        const isum = net1({ x: I(2) }, variant("sum", { x: "x", axis: 0n }));
        expectInteger($, run($, isum, batch({ x: it([2, 2], [1, 2, 3, 4]) })), "y", sh(2), i64(4, 6));
    });

    // ========================================================================
    // Attention
    // ========================================================================

    test("attention softmaxes scaled scores over the allowed keys", $ => {
        const attn = (mask: ValueTypeOf<typeof NeuralNet.Types.NnMaskType>, scale: number | null, extra: Record<string, InputSpec> = {}, bias: string | null = null) => net1(
            { q: F(2), k: F(2), v: F(2), ...extra },
            variant("attention", { q: "q", k: "k", v: "v", heads: 1n, mask, bias: bias === null ? none : some(bias), scale: scale === null ? none : some(scale) }),
        );
        const qkv = { q: ft([2, 2], [1, 0, 0, 1]), k: ft([2, 2], [1, 0, 0, 1]), v: ft([2, 2], [1, 2, 3, 4]) };
        expectFloat($, run($, attn(variant("none", null), 1.0), batch(qkv)), "y", sh(2, 2),
            f64(1.5378828427399902, 2.5378828427399904, 2.46211715726001, 3.4621171572600096));
        expectFloat($, run($, attn(variant("causal", null), 1.0), batch(qkv)), "y", sh(2, 2),
            f64(1, 2, 2.46211715726001, 3.4621171572600096));
        expectFloat($, run($, attn(variant("segments", { ids: "ids", causal: false }), 1.0, { ids: I(1) }), batch({ ...qkv, ids: it([2], [0, 1]) })),
            "y", sh(2, 2), f64(1, 2, 3, 4));
        expectFloat($, run($, attn(variant("key_sets", { ptr: "ptr", keys: "keys" }), 1.0, { ptr: I(1), keys: I(1) }),
            batch({ ...qkv, ptr: it([3], [0, 0, 2]), keys: it([2], [0, 1]) })), "y", sh(2, 2), f64(0, 0, 2.46211715726001, 3.4621171572600096));
        expectFloat($, run($, attn(variant("none", null), 1.0, { bias: F(3) }, "bias"), batch({ ...qkv, bias: ft([1, 2, 2], [0, 1000, 0, 1000]) })),
            "y", sh(2, 2), f64(3, 4, 3, 4));
        // the default scale is 1/√dh: with dh = 2 the scores halve their difference
        const p = Math.exp(Math.SQRT1_2) / (1 + Math.exp(Math.SQRT1_2));
        expectFloat($, run($, attn(variant("none", null), null), batch(qkv)), "y", sh(2, 2),
            f64(p + 3 * (1 - p), 2 * p + 4 * (1 - p), (1 - p) + 3 * p, 2 * (1 - p) + 4 * p));
    });

    test("attention splits d across heads and handles a batch dimension", $ => {
        // two heads of one dimension each: head 0 sees columns 0, head 1 columns 1, with a causal mask
        const net = net1({ q: F(3), k: F(3), v: F(3) }, variant("attention", { q: "q", k: "k", v: "v", heads: 2n, mask: variant("causal", null), bias: none, scale: some(1.0) }));
        const q = ft([1, 2, 2], [1, 0, 1, 0]);
        const k = ft([1, 2, 2], [1, 0, 0, 0]);
        const v = ft([1, 2, 2], [1, 10, 2, 20]);
        // row 0 attends key 0 only: [1, 10]; row 1: head 0 scores [1, 0] → p = [e/(1+e), 1/(1+e)]; head 1 scores [0, 0] → uniform
        const e = Math.E;
        expectFloat($, run($, net, batch({ q, k, v })), "y", sh(1, 2, 2), f64(1, 10, (e * 1 + 2) / (1 + e), 15));
    });

    test("attention over a segments mask answers the dense mask's answer, ids in any order and batched", $ => {
        const T = 40, d = 8, heads = 2;
        type Mask = ValueTypeOf<typeof NeuralNet.Types.NnMaskType>;
        const attn = (mask: Mask, rank: number, extra: Record<string, InputSpec>, bias: string | null) => net1(
            { q: F(rank), k: F(rank), v: F(rank), ...extra },
            variant("attention", { q: "q", k: "k", v: "v", heads: BigInt(heads), mask, bias: bias === null ? none : some(bias), scale: none }),
        );
        for (const [lead, causal, seed] of [[0, false, 11], [0, true, 12], [2, false, 13], [2, true, 14]] as const) {
            const B = Math.max(lead, 1);
            const shape = lead ? [B, T, d] : [T, d];
            const q = ft(shape, floats(B * T * d, seed));
            const k = ft(shape, floats(B * T * d, seed + 100));
            const v = ft(shape, floats(B * T * d, seed + 200));
            // ids out of order, from six values, with one token alone under its own id
            const ids = ints(B * T, 6, seed + 300);
            for (let b = 0; b < B; b++) ids[b * T] = 9;
            // the dense answer: the same mask as an additive bias over `none`
            const bias = new Array<number>(B * T * T).fill(-1e30);
            for (let b = 0; b < B; b++)
                for (let i = 0; i < T; i++)
                    for (let j = 0; j < T; j++)
                        if (ids[b * T + i] === ids[b * T + j] && (!causal || j <= i)) bias[(b * T + i) * T + j] = 0;
            const dense = run($, attn(variant("none", null), lead ? 3 : 2, { bias: F(lead ? 4 : 3) }, "bias"),
                batch({ q, k, v, bias: ft(lead ? [B, 1, T, T] : [1, T, T], bias) }));
            const want = $.let(dense.get("y").unwrap("float"));
            const structured = run($, attn(variant("segments", { ids: "ids", causal }), lead ? 3 : 2, { ids: I(lead ? 2 : 1) }, null),
                batch({ q, k, v, ids: it(lead ? [B, T] : [T], ids) }));
            const got = $.let(structured.get("y").unwrap("float"));
            $(Assert.equal(got.shape, want.shape));
            $(Assert.lessEqual(got.data.map(($, x, i) => x.subtract(want.data.get(i)).abs()).max(), 1e-5));
        }
    });

    test("attention over a key_sets mask answers the dense mask's answer, and refuses a key listed twice", $ => {
        const Tq = 30, Tk = 20, d = 8, heads = 2;
        type Mask = ValueTypeOf<typeof NeuralNet.Types.NnMaskType>;
        const attn = (mask: Mask, extra: Record<string, InputSpec>, bias: string | null) => net1(
            { q: F(2), k: F(2), v: F(2), ...extra },
            variant("attention", { q: "q", k: "k", v: "v", heads: BigInt(heads), mask, bias: bias === null ? none : some(bias), scale: none }),
        );
        const q = ft([Tq, d], floats(Tq * d, 21));
        const k = ft([Tk, d], floats(Tk * d, 22));
        const v = ft([Tk, d], floats(Tk * d, 23));
        const r = stream(24);
        const ptr: number[] = [0];
        const keys: number[] = [];
        for (let i = 0; i < Tq; i++) {
            const chosen = new Set<number>();
            const count = 1 + Math.floor(r() * 6);
            while (chosen.size < count) chosen.add(Math.floor(r() * Tk) % Tk);
            keys.push(...[...chosen].sort((a, b) => a - b));
            ptr.push(keys.length);
        }
        const bias = new Array<number>(Tq * Tk).fill(-1e30);
        for (let i = 0; i < Tq; i++)
            for (let p = ptr[i] ?? 0; p < (ptr[i + 1] ?? 0); p++) bias[i * Tk + (keys[p] ?? 0)] = 0;
        const dense = run($, attn(variant("none", null), { bias: F(3) }, "bias"), batch({ q, k, v, bias: ft([1, Tq, Tk], bias) }));
        const want = $.let(dense.get("y").unwrap("float"));
        const structured = run($, attn(variant("key_sets", { ptr: "ptr", keys: "keys" }), { ptr: I(1), keys: I(1) }, null),
            batch({ q, k, v, ptr: it([Tq + 1], ptr), keys: it([keys.length], keys) }));
        const got = $.let(structured.get("y").unwrap("float"));
        $(Assert.equal(got.shape, want.shape));
        $(Assert.lessEqual(got.data.map(($, x, i) => x.subtract(want.data.get(i)).abs()).max(), 1e-5));
        const cfg = $.let({ device: variant("cpu", null), seed: 0n, training: false }, NnRunConfigType);
        const n = $.let(attn(variant("key_sets", { ptr: "ptr", keys: "keys" }), { ptr: I(1), keys: I(1) }, null), NetType);
        const twice = $.let(batch({
            q: ft([2, d], floats(2 * d, 25)), k: ft([2, d], floats(2 * d, 26)), v: ft([2, d], floats(2 * d, 27)),
            ptr: it([3], [0, 2, 2]), keys: it([2], [1, 1]),
        }), NnBatchType);
        $(Assert.throws(NeuralNet.run(n, $.let(new Map(), NnWeightsType), twice, ["y"], cfg),
            /nn_run: node 'y': attention: the mask lists key 1 twice for query 0/));
    });

    test("rotary turns each head's halves by the position's angle", $ => {
        const net = net1({ x: F(2), pos: I(1) }, variant("rotary", { x: "x", positions: "pos", heads: 1n, base: 10000.0, convention: variant("halves", null) }));
        const out = run($, net, batch({ x: ft([2, 2], [1, 0, 1, 0]), pos: it([2], [0, 1]) }));
        expectFloat($, out, "y", sh(2, 2), f64(1, 0, 0.5403023058681398, 0.8414709848078965));
    });

    // ========================================================================
    // Training and noise
    // ========================================================================

    test("dropout is the identity outside training, stop_gradient always", $ => {
        const drop = net1({ x: F(1) }, variant("dropout", { x: "x", p: 0.5 }));
        expectFloat($, run($, drop, batch({ x: ft([3], [1, 2, 3]) })), "y", sh(3), f64(1, 2, 3));
        const sg = net1({ x: F(1) }, variant("stop_gradient", { x: "x" }));
        expectFloat($, run($, sg, batch({ x: ft([2], [1, 2]) })), "y", sh(2), f64(1, 2));
    });

    test("dropout in training keeps each element with probability 1 - p, scaled", $ => {
        const drop = net1({ x: F(1) }, variant("dropout", { x: "x", p: 0.5 }));
        const x = new Array(2000).fill(1.0);
        const out = run($, drop, batch({ x: ft([2000], x) }), new Map(), ["y"], 3n, true);
        const y = $.let(out.get("y").unwrap("float").data);
        // every kept element is 2, every dropped one 0, and about half are kept
        $(Assert.equal(y.map(($, v) => v.multiply(v.subtract(2.0)).abs()).max(), 0.0));
        $(Assert.between(y.sum(), 1600.0, 2400.0));
    });

    test("random_normal and random_uniform draw tensors shaped like an operand", $ => {
        const like = ft([2000], new Array(2000).fill(0));
        const normal = net1({ like: F(1) }, variant("random_normal", { like: "like" }));
        const n = $.let(run($, normal, batch({ like }), new Map(), ["y"], 1n).get("y").unwrap("float"));
        $(Assert.equal(n.shape, sh(2000)));
        $(Assert.between(n.data.sum().divide(2000.0), -0.15, 0.15));
        $(Assert.between(n.data.map(($, v) => v.multiply(v)).sum().divide(2000.0), 0.8, 1.2));
        const uniform = net1({ like: F(1) }, variant("random_uniform", { like: "like" }));
        const u = $.let(run($, uniform, batch({ like }), new Map(), ["y"], 1n).get("y").unwrap("float"));
        $(Assert.greaterEqual(u.data.min(), 0.0));
        $(Assert.less(u.data.max(), 1.0));
        $(Assert.between(u.data.sum().divide(2000.0), 0.4, 0.6));
    });

    // ========================================================================
    // Structure
    // ========================================================================

    test("call runs a module under a weight prefix, and nn_init names its weights by it", $ => {
        const net: Net = {
            inputs: new Map([["x", F(1)]]),
            params: new Map(),
            modules: new Map([["scale", {
                inputs: new Map([["x", F(1)]]),
                params: new Map([["s", param([1], variant("constant", 3.0))]]),
                modules: new Map(),
                nodes: [{ name: "y", op: variant("mul", { a: "x", b: "s" }) }],
                outputs: new Map([["y", "y"], ["twice", "y"]]),
            }]]),
            nodes: [
                { name: "a", op: variant("call", { module: "scale", prefix: "first", inputs: new Map([["x", "x"]]) }) },
                { name: "b", op: variant("call", { module: "scale", prefix: "second", inputs: new Map([["x", "a.y"]]) }) },
                { name: "y", op: variant("add", { a: "b.y", b: "b.twice" }) },
            ],
            outputs: new Map([["y", "y"], ["a", "a.y"]]),
        };
        const n = $.let(net, NetType);
        const w = $.let(NeuralNet.init(n, 0n));
        $(Assert.equal(w.keys(), new Set(["first.s", "second.s"])));
        $(Assert.equal(w.get("first.s").data, f64(3)));
        const weights: Weights = new Map([["first.s", tensor([1], [2])], ["second.s", tensor([1], [5])]]);
        const out = run($, net, batch({ x: ft([2], [1, 2]) }), weights, ["y", "a"]);
        expectFloat($, out, "a", sh(2), f64(2, 4));
        expectFloat($, out, "y", sh(2), f64(20, 40));
    });

    test("loop carries values for fixed steps, feeds the step, and stops on a boolean output", $ => {
        const body = (nodes: Net["nodes"], outputs: [string, string][], extraInputs: [string, InputSpec][] = []): Net => ({
            inputs: new Map([["x", F(1)], ...extraInputs]),
            params: new Map(),
            modules: new Map(),
            nodes,
            outputs: new Map(outputs),
        });
        const doubling: Net = net1({ x0: F(1) }, variant("loop", {
            body: body([{ name: "two", op: variant("constant", { value: variant("float", 2.0) }) }, { name: "x2", op: variant("mul", { a: "x", b: "two" }) }], [["x", "x2"]]),
            carried: new Map([["x", "x0"]]), inputs: new Map(), step: none, steps: variant("fixed", 3n),
        }));
        expectFloat($, run($, doubling, batch({ x0: ft([1], [1]) })), "y", sh(1), f64(8));
        const stepping: Net = net1({ x0: F(1) }, variant("loop", {
            body: body([
                { name: "fs", op: variant("cast", { x: "step", dtype: variant("float", null) }) },
                { name: "x2", op: variant("add", { a: "x", b: "fs" }) },
            ], [["x", "x2"]], [["step", I(0)]]),
            carried: new Map([["x", "x0"]]), inputs: new Map(), step: some("step"), steps: variant("fixed", 4n),
        }));
        expectFloat($, run($, stepping, batch({ x0: ft([1], [0]) })), "y", sh(1), f64(6));
        const until: Net = net1({ x0: F(1), limit: F(1) }, variant("loop", {
            body: body([
                { name: "one", op: variant("constant", { value: variant("float", 1.0) }) },
                { name: "x2", op: variant("add", { a: "x", b: "one" }) },
                { name: "ge", op: variant("ge", { a: "x2", b: "limit" }) },
                { name: "done", op: variant("reshape", { x: "ge", shape: [] }) },
            ], [["x", "x2"], ["done", "done"]], [["limit", F(1)]]),
            carried: new Map([["x", "x0"]]), inputs: new Map([["limit", "limit"]]), step: none, steps: variant("until", { output: "done", max: 100n }),
        }));
        expectFloat($, run($, until, batch({ x0: ft([1], [0]), limit: ft([1], [5]) })), "y", sh(1), f64(5));
    });

    test("nn_run evaluates only what the asked outputs need", $ => {
        // the unasked output divides by zero on an integer path that would fail: never evaluated
        const net: Net = {
            inputs: new Map([["x", F(1)], ["idx", I(1)]]), params: new Map(), modules: new Map(),
            nodes: [{ name: "bad", op: variant("gather", { table: "x", index: "idx" }) }, { name: "y", op: variant("neg", { x: "x" }) }],
            outputs: new Map([["y", "y"], ["bad", "bad"]]),
        };
        const out = run($, net, batch({ x: ft([2], [1, 2]), idx: it([1], [9]) }));
        expectFloat($, out, "y", sh(2), f64(-1, -2));
    });

    // ========================================================================
    // nn_init
    // ========================================================================

    test("nn_init draws every parameter's shape by its initialisation", $ => {
        const net: Net = {
            inputs: new Map([["x", F(2)]]),
            params: new Map([
                ["z", param([2, 3], variant("zeros", null))],
                ["o", param([4], variant("ones", null))],
                ["c", param([], variant("constant", -1.5))],
                ["n", param([50, 50], variant("normal", 0.1))],
                ["u", param([100], variant("uniform", 0.25))],
                ["xu", param([3, 2], variant("xavier_uniform", null))],
                ["xn", param([3, 2], variant("xavier_normal", null))],
                ["ku", param([3, 2], variant("kaiming_uniform", null))],
                ["kn", param([3, 2], variant("kaiming_normal", null))],
            ]),
            modules: new Map(),
            nodes: [{ name: "y", op: variant("neg", { x: "x" }) }],
            outputs: new Map([["y", "y"]]),
        };
        const n0 = $.let(net, NetType);
        const w = $.let(NeuralNet.init(n0, 42n));
        $(Assert.equal(w.get("z").shape, sh(2, 3)));
        $(Assert.equal(w.get("z").data, f64(0, 0, 0, 0, 0, 0)));
        $(Assert.equal(w.get("o").data, f64(1, 1, 1, 1)));
        $(Assert.equal(w.get("c").shape, sh()));
        $(Assert.equal(w.get("c").data, f64(-1.5)));
        const n = $.let(w.get("n").data);
        $(Assert.equal(n.length(), 2500n));
        $(Assert.between(n.map(($, v) => v.multiply(v)).sum().divide(2500.0), 0.007, 0.013));
        const u = $.let(w.get("u").data);
        $(Assert.lessEqual(u.map(($, v) => v.abs()).max(), 0.25));
        $(Assert.greater(u.map(($, v) => v.abs()).max(), 0.1));
        $(Assert.lessEqual(w.get("xu").data.map(($, v) => v.abs()).max(), 1.0954451150103321));
        $(Assert.lessEqual(w.get("ku").data.map(($, v) => v.abs()).max(), 1.7320508075688772));
        $(Assert.equal(w.get("xn").shape, sh(3, 2)));
        $(Assert.greater(w.get("kn").data.map(($, v) => v.abs()).max(), 0.0));
        // the same seed draws the same weights
        const n1 = $.let(net, NetType);
        const again = $.let(NeuralNet.init(n1, 42n));
        $(Assert.equal(again.get("n").data, w.get("n").data));
    });

    // ========================================================================
    // Refusals (docs/neural-networks.md §6)
    // ========================================================================

    test("the specification's refusals are worded the same on every runner", $ => {
        const cfg = $.let({ device: variant("cpu", null), seed: 0n, training: false }, NnRunConfigType);
        const w0 = $.let(new Map(), NnWeightsType);
        const bx = $.let(batch({ x: ft([2], [1, 2]) }), NnBatchType);
        const attempt = (net: Net, b = bx, w = w0, outputs = ["y"]) => {
            const n = $.let(net, NetType);
            return NeuralNet.run(n, w, b, outputs, cfg);
        };

        $(Assert.throws(attempt(net1({ x: F(1) }, variant("add", { a: "x", b: "q" }))), /nn_run: node 'y' names an unknown operand 'q'/));
        $(Assert.throws(attempt(net1({ x: F(1) }, variant("add", { a: "x", b: "z" }), {}, [])), /names an unknown operand 'z'/));
        const forward: Net = {
            inputs: new Map([["x", F(1)]]), params: new Map(), modules: new Map(),
            nodes: [{ name: "y", op: variant("neg", { x: "z" }) }, { name: "z", op: variant("neg", { x: "x" }) }],
            outputs: new Map([["y", "y"]]),
        };
        $(Assert.throws(attempt(forward), /nn_run: node 'y' uses 'z' before it is defined/));
        $(Assert.throws(attempt(net1({ x: F(1), y: F(1) }, variant("neg", { x: "x" }))), /nn_run: 'y' is defined twice/));
        $(Assert.throws(attempt(net1({ x: F(1) }, variant("neg", { x: "x" })), bx, w0, ["z"]), /nn_run: unknown output 'z'/));
        $(Assert.throws(attempt(net1({ x: F(1), m: F(1) }, variant("add", { a: "x", b: "m" }))), /nn_run: the batch has no input 'm'/));
        $(Assert.throws(attempt(net1({ x: F(2) }, variant("neg", { x: "x" }))), /nn_run: input 'x' has rank 1 but the network declares rank 2/));
        $(Assert.throws(attempt(net1({ x: I(1) }, variant("neg", { x: "x" }))), /nn_run: input 'x' is float but the network declares integer/));
        $(Assert.throws(attempt(net1({ x: F(1) }, variant("mul", { a: "x", b: "w" }), { w: param([2]) })), /nn_run: the weights have no parameter 'w'/));
        const wrong = $.let(new Map([["w", tensor([3], [1, 1, 1])]]), NnWeightsType);
        $(Assert.throws(attempt(net1({ x: F(1) }, variant("mul", { a: "x", b: "w" }), { w: param([2]) }), bx, wrong),
            /nn_run: parameter 'w' has shape \[3\] but the network declares \[2\]/));
        const lin = $.let(new Map([["w", tensor([2, 3], [1, 1, 1, 1, 1, 1])]]), NnWeightsType);
        const bRow = $.let(batch({ x: ft([1, 2], [1, 2]) }), NnBatchType);
        $(Assert.throws(attempt(net1({ x: F(2) }, variant("linear", { x: "x", weight: "w", bias: none }), { w: param([2, 3]) }),
            bRow, lin), /nn_run: node 'y': linear: x has 2 columns but weight has 3/));
        $(Assert.throws(attempt(net1({ x: F(1), i: I(1) }, variant("add", { a: "x", b: "i" }))),
            /nn_run: node 'y': add: takes float or integer operands of one type, got float and integer/));
        const several: Net = {
            inputs: new Map([["x", F(1)]]),
            params: new Map(),
            modules: new Map([["m", { inputs: new Map([["x", F(1)]]), params: new Map(), modules: new Map(),
                nodes: [{ name: "n", op: variant("neg", { x: "x" }) }], outputs: new Map([["a", "n"], ["b", "x"]]) }]]),
            nodes: [{ name: "c", op: variant("call", { module: "m", prefix: "m", inputs: new Map([["x", "x"]]) }) },
                { name: "y", op: variant("neg", { x: "c" }) }],
            outputs: new Map([["y", "y"]]),
        };
        $(Assert.throws(attempt(several), /nn_run: 'c' holds several tensors: name one as 'c\.<name>'/));
        $(Assert.throws(attempt(net1({ x: F(1) }, variant("reshape", { x: "x", shape: [3n] }))), /nn_run: node 'y': reshape: cannot reshape \[2\] to \[3\]/));
    });

    // ========================================================================
    // The reference families: what hand-written torch answered (f32)
    // ========================================================================

    for (const [label, family] of [
        ["the ragged grouped transformer", ref.raggedTransformer],
        ["the conditioned 1-D U-Net", ref.conditionedUnet],
        ["the head on the events a mask selects, written back by their indices", ref.headSelection],
        ["the time grid from range into a sinusoidal embedding", ref.timeGrid],
        ["rotary under both pairing conventions", ref.rotaryConventions],
    ] as const) {
        test(`${label} answers what torch answered, to tolerance`, $ => {
            const net = $.let(family.net, NetType);
            const weights = $.let(family.weights, NnWeightsType);
            const b = $.let(family.batch, NnBatchType);
            const cfg = $.let({ device: variant("cpu", null), seed: 0n, training: false }, NnRunConfigType);
            const names = [...family.outputs.keys()];
            const out = $.let(NeuralNet.run(net, weights, b, names, cfg));
            for (const [name, want] of family.outputs) {
                if (want.type === "float") {
                    expectFloat($, out, name, want.value.shape, want.value.data as Float64Array, 1e-4);
                } else if (want.type === "integer") {
                    expectInteger($, out, name, want.value.shape, want.value.data as BigInt64Array);
                }
            }
        });
    }

    test("the U-Net's SDE sampler answers a finite sample of the data's shape on every runner", $ => {
        const family = ref.conditionedUnet;
        const net = $.let(family.net, NetType);
        const weights = $.let(family.weights, NnWeightsType);
        const b = $.let(family.batch, NnBatchType);
        const cfg = $.let({ device: variant("cpu", null), seed: 5n, training: false }, NnRunConfigType);
        const out = $.let(NeuralNet.run(net, weights, b, ["sde_sample"], cfg));
        const t = $.let(out.get("sde_sample").unwrap("float"));
        $(Assert.equal(t.shape, sh(2, 2, 8)));
        $(Assert.less(t.data.map(($, v) => v.abs()).max(), 100.0));
    });
}, { exportOnly: true });
