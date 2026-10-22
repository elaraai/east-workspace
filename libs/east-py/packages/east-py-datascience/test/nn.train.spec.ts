/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * nn_train (east-workspace#1357): on both runners — the python interpreter and
 * east-c-datascience on libtorch, the same optimiser and kernels. The weight
 * decay per parameter, the EMA's warm-up, the seeded shuffle, the weighted
 * validation, the epoch-stepped schedules and recompute are R18–R23.
 */
import { variant, some, none, type ValueTypeOf } from "@elaraai/east";
import { describeEast, Assert } from "@elaraai/east-node-std";
import { NeuralNet, NetType, NnBatchType, NnWeightsType, NnRunConfigType, NnTrainConfigType } from "@elaraai/east-py-datascience";
import * as ex from "./nn.examples.js";
import * as ref from "./nn.reference.generated.js";
import * as train from "./nn.train.reference.generated.js";

type Config = ValueTypeOf<typeof NnTrainConfigType>;
type Net = ValueTypeOf<typeof NetType>;
type ParamSpec = ValueTypeOf<typeof NeuralNet.Types.NnParamSpecType>;

/** A configuration from the defaults: AdamW at `lr`, no decay, constant, f32, the CPU, seed 1. */
const config = (over: Partial<Config> & { loss: string }): Config => ({
    validation: none,
    optimizer: variant("adamw", { lr: 0.1, beta1: 0.9, beta2: 0.999, eps: 1e-8, weight_decay: 0.0 }),
    schedule: variant("constant", null),
    clip_norm: none,
    ema: none,
    shuffle: false,
    epochs: 1n,
    patience: none,
    precision: variant("f32", null),
    seed: 1n,
    device: variant("cpu", null),
    recompute: new Set<string>(),
    progress: none,
    ...over,
});

/** y = x·w (+ b) through a linear layer, the loss the mean squared error; `vsum` its sum, `w` a rank-0 weight input. */
const regression = (bias: boolean, extra: Net["nodes"] = [], outputs: [string, string][] = []): Net => {
    const params: [string, ParamSpec][] = [
        ["weight", { shape: [1n, 1n], init: variant("constant", 0.0), trainable: true, decay: 1.0 }],
        ["frozen", { shape: [1n], init: variant("constant", 7.0), trainable: false, decay: 1.0 }],
    ];
    if (bias) params.push(["b", { shape: [1n], init: variant("zeros", null), trainable: true, decay: 0.0 }]);
    return {
    inputs: new Map([
        ["x", { dtype: variant("float", null), rank: 2n }],
        ["target", { dtype: variant("float", null), rank: 2n }],
        ["w", { dtype: variant("float", null), rank: 0n }],
    ]),
    params: new Map(params),
    modules: new Map(),
    nodes: [
        { name: "pred", op: variant("linear", { x: "x", weight: "weight", bias: bias ? some("b") : none }) },
        { name: "err", op: variant("sub", { a: "pred", b: "target" }) },
        { name: "sq", op: variant("mul", { a: "err", b: "err" }) },
        { name: "flat", op: variant("reshape", { x: "sq", shape: [-1n] }) },
        { name: "loss", op: variant("mean", { x: "flat", axis: 0n }) },
        { name: "vsum", op: variant("sum", { x: "flat", axis: 0n }) },
        ...extra,
    ],
    outputs: new Map([["loss", "loss"], ["pred", "pred"], ["vsum", "vsum"], ["w", "w"], ["sq", "sq"], ...outputs]),
    };
};
const sample = (xs: number[], targets: number[], weight: number): ValueTypeOf<typeof NnBatchType> => new Map([
    ["x", variant("float", { shape: [BigInt(xs.length), 1n], data: new Float64Array(xs) })],
    ["target", variant("float", { shape: [BigInt(targets.length), 1n], data: new Float64Array(targets) })],
    ["w", variant("float", { shape: [], data: new Float64Array([weight]) })],
]);

describeEast("NeuralNet training", test => {
    Assert.examples(test, { nnTrain: ex.nnTrain });

    test("nn_train minimises the loss, keeps a history and stops early on patience", $ => {
        const net = $.let(regression(true), NetType);
        const batch = $.let(sample([0, 1, 2, 3], [1, 3, 5, 7], 1.0), NnBatchType);
        const cfg = $.let(config({
            loss: "loss",
            validation: some({ value: "loss", weight: none }),
            schedule: variant("warmup_linear", { warmup_steps: 5n, unit: variant("step", null) }),
            clip_norm: some(10.0),
            epochs: 400n,
            patience: some(30n),
        }), NnTrainConfigType);

        const result = $.let(NeuralNet.train(net, NeuralNet.init(net, 0n), [batch], [batch], cfg));

        // the loss fell by orders of magnitude, early stopping ended the run, the best epoch is on record
        const n = $.let(result.history.length());
        $(Assert.greater(n, 30n));
        $(Assert.less(n, 400n));
        $(Assert.less(result.history.get(n.subtract(1n)).loss, result.history.get(0n).loss.divide(100.0)));
        // the validation is measured after the epoch's steps, so it already trails the training loss
        $(Assert.less(result.history.get(0n).validation.unwrap(), result.history.get(0n).loss));
        $(Assert.greater(result.best_epoch, 0n));
        $(Assert.lessEqual(result.best_epoch, n));
        $(Assert.less(result.weights.get("weight").data.get(0n).subtract(2.0).abs(), 0.2));
        $(Assert.less(result.weights.get("b").data.get(0n).subtract(1.0).abs(), 0.3));
        // a frozen parameter comes back as it went in
        $(Assert.equal(result.weights.get("frozen").data, new Float64Array([7.0])));
        // the warmup: the first epoch's rate is a fifth of the full rate
        $(Assert.less(result.history.get(0n).learning_rate.subtract(0.02).abs(), 1e-9));
    });

    test("nn_train keeps an exponential moving average when asked, and refuses a non-scalar loss", $ => {
        const net = $.let(regression(false), NetType);
        const batch = $.let(sample([1, 2], [2, 4], 1.0), NnBatchType);
        const ema = $.let(config({ loss: "loss", ema: some({ decay: 0.5, warmup: false }), epochs: 20n }), NnTrainConfigType);
        const plain = $.let(config({ loss: "loss", epochs: 20n }), NnTrainConfigType);
        const withEma = $.let(NeuralNet.train(net, NeuralNet.init(net, 0n), [batch], [], ema));
        const without = $.let(NeuralNet.train(net, NeuralNet.init(net, 0n), [batch], [], plain));
        // the average lags the raw weights toward the start
        $(Assert.less(withEma.weights.get("weight").data.get(0n), without.weights.get("weight").data.get(0n)));
        $(Assert.greater(withEma.weights.get("weight").data.get(0n), 0.0));
        const bad = $.let(config({ loss: "sq" }), NnTrainConfigType);
        $(Assert.throws(NeuralNet.train(net, NeuralNet.init(net, 0n), [batch], [], bad), /nn_train: the loss output 'sq' must be a scalar, got rank 2/));
    });

    // ========================================================================
    // R18: a weight decay per parameter
    // ========================================================================

    test("one AdamW step with a weight decay per parameter group answers what torch's optimiser answers", $ => {
        const net = $.let(train.mlp, NetType);
        const initial = $.let(train.initial, NnWeightsType);
        const cfg = $.let(config({
            loss: "loss",
            optimizer: variant("adamw", { lr: 0.05, beta1: 0.9, beta2: 0.999, eps: 1e-8, weight_decay: 0.1 }),
            seed: 0n,
        }), NnTrainConfigType);
        const result = $.let(NeuralNet.train(net, initial, [$.let(train.stepBatch, NnBatchType)], [], cfg));
        const want = $.let(train.stepped, NnWeightsType);
        for (const name of ["w1", "b1", "w2"]) {
            const got = $.let(result.weights.get(name).data);
            const expected = $.let(want.get(name).data);
            $(Assert.lessEqual(got.map(($, v, i) => v.subtract(expected.get(i)).abs()).max(), 1e-6));
        }
        // the groups matter: a non-decaying bias moves as the gradient alone moves it, a decaying matrix less
        const undecayed = $.let(NeuralNet.train(net, initial, [$.let(train.stepBatch, NnBatchType)], [],
            $.let(config({ loss: "loss", optimizer: variant("adamw", { lr: 0.05, beta1: 0.9, beta2: 0.999, eps: 1e-8, weight_decay: 0.0 }), seed: 0n }), NnTrainConfigType)));
        $(Assert.lessEqual(undecayed.weights.get("b1").data.map(($, v, i) => v.subtract(result.weights.get("b1").data.get(i)).abs()).max(), 1e-6));
        $(Assert.greater(undecayed.weights.get("w1").data.map(($, v, i) => v.subtract(result.weights.get("w1").data.get(i)).abs()).max(), 1e-4));
    });

    // ========================================================================
    // R19: the average's warm-up
    // ========================================================================

    test("the EMA warms up as min(decay, (1 + s)/(10 + s)) and otherwise moves by its decay", $ => {
        const net = $.let(regression(false), NetType);
        const batch = $.let(sample([1, 2], [2, 4], 1.0), NnBatchType);
        const w0 = $.let(NeuralNet.init(net, 0n));
        // the raw trajectory: the weights after 1, 2 and 3 steps (one batch an epoch, a constant rate)
        const raw = (epochs: bigint) => $.let(NeuralNet.train(net, w0, [batch], [], $.let(config({ loss: "loss", epochs }), NnTrainConfigType)).weights.get("weight").data.get(0n));
        const w1 = raw(1n), w2 = raw(2n), w3 = raw(3n);
        const start = $.let(w0.get("weight").data.get(0n));
        for (const [warmup, d1, d2, d3] of [[true, 0.1, 2 / 11, 0.25], [false, 0.9, 0.9, 0.9]] as const) {
            const e1 = $.let(start.multiply(d1).add(w1.multiply(1 - d1)));
            const e2 = $.let(e1.multiply(d2).add(w2.multiply(1 - d2)));
            const e3 = $.let(e2.multiply(d3).add(w3.multiply(1 - d3)));
            const result = $.let(NeuralNet.train(net, w0, [batch], [], $.let(config({ loss: "loss", epochs: 3n, ema: some({ decay: 0.9, warmup }) }), NnTrainConfigType)));
            $(Assert.lessEqual(result.weights.get("weight").data.get(0n).subtract(e3).abs(), 1e-5));
        }
    });

    // ========================================================================
    // R20: the seeded shuffle
    // ========================================================================

    test("an epoch run in the seeded shuffle's order answers the pinned weights, on every runner", $ => {
        const net = $.let(train.mlp, NetType);
        const initial = $.let(train.initial, NnWeightsType);
        const batches = train.epochBatches.map(b => $.let(b, NnBatchType));
        const optimizer = variant("adamw", { lr: 0.05, beta1: 0.9, beta2: 0.999, eps: 1e-8, weight_decay: 0.1 });
        const shuffled = $.let(NeuralNet.train(net, initial, batches, [], $.let(config({ loss: "loss", optimizer, shuffle: true, seed: 3n }), NnTrainConfigType)));
        const want = $.let(train.shuffled, NnWeightsType);
        for (const name of ["w1", "b1", "w2"]) {
            const got = $.let(shuffled.weights.get(name).data);
            const expected = $.let(want.get(name).data);
            $(Assert.lessEqual(got.map(($, v, i) => v.subtract(expected.get(i)).abs()).max(), 1e-6));
        }
        // the order matters: the same epoch in the batches' own order ends elsewhere
        const ordered = $.let(NeuralNet.train(net, initial, batches, [], $.let(config({ loss: "loss", optimizer, shuffle: false, seed: 3n }), NnTrainConfigType)));
        $(Assert.greater(ordered.weights.get("w1").data.map(($, v, i) => v.subtract(shuffled.weights.get("w1").data.get(i)).abs()).max(), 1e-4));
    });

    // ========================================================================
    // R21: the validation as a value and a weight
    // ========================================================================

    test("the validation is the summed value over the summed weight, batches of unequal weight included", $ => {
        const net = $.let(regression(false), NetType);
        const batch = $.let(sample([1, 2], [2, 4], 1.0), NnBatchType);
        const small = $.let(sample([3], [5], 1.0), NnBatchType);
        const large = $.let(sample([1, 2, 3], [2, 4, 7], 3.0), NnBatchType);
        const weighted = $.let(NeuralNet.train(net, NeuralNet.init(net, 0n), [batch], [small, large],
            $.let(config({ loss: "loss", validation: some({ value: "vsum", weight: some("w") }), epochs: 2n }), NnTrainConfigType)));
        // what each validation batch answers on the epoch's weights
        const runCfg = $.let({ device: variant("cpu", null), seed: 1n, training: false }, NnRunConfigType);
        const vsum = (b: typeof small) => $.let(NeuralNet.run(net, weighted.weights, b, ["vsum"], runCfg).get("vsum").unwrap("float").data.get(0n));
        const s = vsum(small), l = vsum(large);
        const last = $.let(weighted.history.get(1n).validation.unwrap());
        $(Assert.lessEqual(last.subtract(s.add(l).divide(4.0)).abs(), 1e-5));
        // without a weight each batch counts once: the mean of the values
        const mean = $.let(NeuralNet.train(net, NeuralNet.init(net, 0n), [batch], [small, large],
            $.let(config({ loss: "loss", validation: some({ value: "vsum", weight: none }), epochs: 2n }), NnTrainConfigType)));
        const s2 = $.let(NeuralNet.run(net, mean.weights, small, ["vsum"], runCfg).get("vsum").unwrap("float").data.get(0n));
        const l2 = $.let(NeuralNet.run(net, mean.weights, large, ["vsum"], runCfg).get("vsum").unwrap("float").data.get(0n));
        $(Assert.lessEqual(mean.history.get(1n).validation.unwrap().subtract(s2.add(l2).divide(2.0)).abs(), 1e-5));
        $(Assert.greater(last.subtract(mean.history.get(1n).validation.unwrap()).abs(), 1e-6));
    });

    // ========================================================================
    // R23: epoch-stepped schedules, and recompute
    // ========================================================================

    test("a schedule counts steps or epochs as its unit says", $ => {
        const net = $.let(regression(false), NetType);
        const batches = [sample([1], [2], 1.0), sample([2], [4], 1.0), sample([3], [6], 1.0)].map(b => $.let(b, NnBatchType));
        const byEpoch = $.let(NeuralNet.train(net, NeuralNet.init(net, 0n), batches, [],
            $.let(config({ loss: "loss", schedule: variant("warmup_linear", { warmup_steps: 2n, unit: variant("epoch", null) }), epochs: 4n }), NnTrainConfigType)));
        const rates = $.let(byEpoch.history.map(($, h) => h.learning_rate));
        $(Assert.equal(rates.length(), 4n));
        for (const [i, want] of [[0, 0.05], [1, 0.1], [2, 0.1], [3, 0.1]] as const) $(Assert.lessEqual(rates.get(BigInt(i)).subtract(want).abs(), 1e-9));
        // by step, the same warm-up is over within the first epoch's three steps: its last step runs at the full rate
        const byStep = $.let(NeuralNet.train(net, NeuralNet.init(net, 0n), batches, [],
            $.let(config({ loss: "loss", schedule: variant("warmup_linear", { warmup_steps: 2n, unit: variant("step", null) }), epochs: 2n }), NnTrainConfigType)));
        $(Assert.lessEqual(byStep.history.get(0n).learning_rate.subtract(0.1).abs(), 1e-9));
        // a cosine over epochs: the rate at each epoch's start — warm for one epoch, then the cosine from the
        // full rate toward min_lr over what is left (progress (i − warmup)/(epochs − warmup): 0, then ½)
        const cosine = $.let(NeuralNet.train(net, NeuralNet.init(net, 0n), batches, [],
            $.let(config({ loss: "loss", schedule: variant("warmup_cosine", { warmup_steps: 1n, min_lr: 0.01, unit: variant("epoch", null) }), epochs: 3n }), NnTrainConfigType)));
        for (const [i, want] of [[0, 0.1], [1, 0.1], [2, 0.01 + 0.09 * 0.5 * (1 + Math.cos(Math.PI * 0.5))]] as const)
            $(Assert.lessEqual(cosine.history.get(BigInt(i)).learning_rate.subtract(want).abs(), 1e-9));
    });

    test("a module recomputed in the backward pass trains to the same weights", $ => {
        const family = ref.conditionedUnet;
        const net = $.let(family.net, NetType);
        const weights = $.let(family.weights, NnWeightsType);
        const batch = $.let(family.batch, NnBatchType);
        const optimizer = variant("adamw", { lr: 3e-3, beta1: 0.9, beta2: 0.999, eps: 1e-8, weight_decay: 0.01 });
        const kept = $.let(NeuralNet.train(net, weights, [batch], [], $.let(config({ loss: "loss", optimizer, epochs: 2n, seed: 0n }), NnTrainConfigType)));
        const recomputed = $.let(NeuralNet.train(net, weights, [batch], [], $.let(config({ loss: "loss", optimizer, epochs: 2n, seed: 0n, recompute: new Set(["unet", "film"]) }), NnTrainConfigType)));
        $(Assert.lessEqual(kept.history.get(1n).loss.subtract(recomputed.history.get(1n).loss).abs(), 1e-6));
        for (const name of ["unet.wt", "unet.down1.conv_w", "unet.out_w", "cond.wf"]) {
            const a = $.let(kept.weights.get(name).data);
            const b = $.let(recomputed.weights.get(name).data);
            $(Assert.lessEqual(a.map(($, v, i) => v.subtract(b.get(i)).abs()).max(), 1e-5));
        }
    });
}, { exportOnly: true });
