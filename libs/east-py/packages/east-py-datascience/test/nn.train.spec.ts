/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * nn_train (east-workspace#1357): on both runners — the python interpreter and
 * east-c-datascience on libtorch, the same optimiser and kernels.
 */
import { variant, some, none } from "@elaraai/east";
import { describeEast, Assert } from "@elaraai/east-node-std";
import { NeuralNet, NetType, NnBatchType, NnTrainConfigType } from "@elaraai/east-py-datascience";
import * as ex from "./nn.examples.js";

describeEast("NeuralNet training", test => {
    Assert.examples(test, { nnTrain: ex.nnTrain });

    test("nn_train minimises the loss, keeps a history and stops early on patience", $ => {
        // y = 2x + 1 through a linear layer with a bias, the loss the mean squared error
        const net = $.let({
            inputs: new Map([
                ["x", { dtype: variant("float", null), rank: 2n }],
                ["target", { dtype: variant("float", null), rank: 2n }],
            ]),
            params: new Map([
                ["w", { shape: [1n, 1n], init: variant("constant", 0.0), trainable: true }],
                ["b", { shape: [1n], init: variant("zeros", null), trainable: true }],
                ["frozen", { shape: [1n], init: variant("constant", 7.0), trainable: false }],
            ]),
            modules: new Map(),
            nodes: [
                { name: "pred", op: variant("linear", { x: "x", weight: "w", bias: some("b") }) },
                { name: "err", op: variant("sub", { a: "pred", b: "target" }) },
                { name: "sq", op: variant("mul", { a: "err", b: "err" }) },
                { name: "flat", op: variant("reshape", { x: "sq", shape: [-1n] }) },
                { name: "loss", op: variant("mean", { x: "flat", axis: 0n }) },
            ],
            outputs: new Map([["loss", "loss"], ["pred", "pred"]]),
        }, NetType);
        const batch = $.let(new Map([
            ["x", variant("float", { shape: [4n, 1n], data: new Float64Array([0.0, 1.0, 2.0, 3.0]) })],
            ["target", variant("float", { shape: [4n, 1n], data: new Float64Array([1.0, 3.0, 5.0, 7.0]) })],
        ]), NnBatchType);
        const config = $.let({
            loss: "loss",
            validation: some("loss"),
            optimizer: variant("adamw", { lr: 0.1, beta1: 0.9, beta2: 0.999, eps: 1e-8, weight_decay: 0.0 }),
            schedule: variant("warmup_linear", { warmup_steps: 5n }),
            clip_norm: some(10.0),
            ema_decay: none,
            epochs: 400n,
            patience: some(30n),
            precision: variant("f32", null),
            seed: 1n,
            device: variant("cpu", null),
            recompute: new Set<string>(),
        }, NnTrainConfigType);

        const result = $.let(NeuralNet.train(net, NeuralNet.init(net, 0n), [batch], [batch], config));

        // the loss fell by orders of magnitude, early stopping ended the run, the best epoch is on record
        const n = $.let(result.history.length());
        $(Assert.greater(n, 30n));
        $(Assert.less(n, 400n));
        $(Assert.less(result.history.get(n.subtract(1n)).loss, result.history.get(0n).loss.divide(100.0)));
        // the validation is measured after the epoch's steps, so it already trails the training loss
        $(Assert.less(result.history.get(0n).validation.unwrap(), result.history.get(0n).loss));
        $(Assert.greater(result.best_epoch, 0n));
        $(Assert.lessEqual(result.best_epoch, n));
        $(Assert.less(result.weights.get("w").data.get(0n).subtract(2.0).abs(), 0.2));
        $(Assert.less(result.weights.get("b").data.get(0n).subtract(1.0).abs(), 0.3));
        // a frozen parameter comes back as it went in
        $(Assert.equal(result.weights.get("frozen").data, new Float64Array([7.0])));
        // the warmup: the first epoch's rate is a fifth of the full rate
        $(Assert.less(result.history.get(0n).learning_rate.subtract(0.02).abs(), 1e-9));
    });

    test("nn_train keeps an exponential moving average when asked, and refuses a non-scalar loss", $ => {
        const net = $.let({
            inputs: new Map([["x", { dtype: variant("float", null), rank: 2n }], ["target", { dtype: variant("float", null), rank: 2n }]]),
            params: new Map([["w", { shape: [1n, 1n], init: variant("constant", 0.0), trainable: true }]]),
            modules: new Map(),
            nodes: [
                { name: "pred", op: variant("linear", { x: "x", weight: "w", bias: none }) },
                { name: "err", op: variant("sub", { a: "pred", b: "target" }) },
                { name: "sq", op: variant("mul", { a: "err", b: "err" }) },
                { name: "flat", op: variant("reshape", { x: "sq", shape: [-1n] }) },
                { name: "loss", op: variant("mean", { x: "flat", axis: 0n }) },
            ],
            outputs: new Map([["loss", "loss"], ["sq", "sq"]]),
        }, NetType);
        const batch = $.let(new Map([
            ["x", variant("float", { shape: [2n, 1n], data: new Float64Array([1.0, 2.0]) })],
            ["target", variant("float", { shape: [2n, 1n], data: new Float64Array([2.0, 4.0]) })],
        ]), NnBatchType);
        const base = {
            validation: none,
            optimizer: variant("adamw", { lr: 0.1, beta1: 0.9, beta2: 0.999, eps: 1e-8, weight_decay: 0.0 }),
            schedule: variant("constant", null),
            clip_norm: none,
            patience: none,
            precision: variant("f32", null),
            seed: 1n,
            device: variant("cpu", null),
            recompute: new Set<string>(),
        };
        const ema = $.let({ ...base, loss: "loss", ema_decay: some(0.5), epochs: 20n }, NnTrainConfigType);
        const plain = $.let({ ...base, loss: "loss", ema_decay: none, epochs: 20n }, NnTrainConfigType);
        const withEma = $.let(NeuralNet.train(net, NeuralNet.init(net, 0n), [batch], [], ema));
        const without = $.let(NeuralNet.train(net, NeuralNet.init(net, 0n), [batch], [], plain));
        // the average lags the raw weights toward the start
        $(Assert.less(withEma.weights.get("w").data.get(0n), without.weights.get("w").data.get(0n)));
        $(Assert.greater(withEma.weights.get("w").data.get(0n), 0.0));
        const bad = $.let({ ...base, loss: "sq", ema_decay: none, epochs: 1n }, NnTrainConfigType);
        $(Assert.throws(NeuralNet.train(net, NeuralNet.init(net, 0n), [batch], [], bad), /nn_train: the loss output 'sq' must be a scalar, got rank 2/));
    });
}, { exportOnly: true });
