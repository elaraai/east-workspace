/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, BooleanType, DictType, StringType, variant, some, none, example } from "@elaraai/east";
import { NeuralNet } from "@elaraai/east-py-datascience";

export const nnInit = example({
    keywords: ["neural network", "nn_init", "NeuralNet", "init", "weights", "xavier", "parameters", "NetType"],
    description: "Draw the weights of a network stated as data: a linear layer with a Xavier-uniform weight and a zero bias",
    fn: East.function([], BooleanType, ($) => {
        // y = x·Wᵀ + b over two features into three: the network is a value, its
        // weights a Dict<String, TensorType> drawn from a seed.
        const net = $.let({
            inputs: new Map([["x", { dtype: variant("float", null), rank: 2n }]]),
            params: new Map([
                ["w", { shape: [3n, 2n], init: variant("xavier_uniform", null), trainable: true, decay: 1.0 }],
                ["b", { shape: [3n], init: variant("zeros", null), trainable: true, decay: 1.0 }],
            ]),
            modules: new Map(),
            nodes: [{ name: "y", op: variant("linear", { x: "x", weight: "w", bias: some("b") }) }],
            outputs: new Map([["y", "y"]]),
        }, NeuralNet.Types.NetType);

        const weights = $.let(NeuralNet.init(net, 7n));

        // the bias is its three zeros; the weight has its six draws, each within the Xavier bound √(6/5)
        const w = $.let(weights.get("w"));
        const b = $.let(weights.get("b"));
        return b.data.sum().equal(0.0)
            .and(() => w.data.length().equal(6n))
            .and(() => w.data.map(($, v) => v.abs()).max().lessEqual(1.0954451150103321));
    }),
    inputs: [],
    returns: true,
});

export const nnRun = example({
    keywords: ["neural network", "nn_run", "NeuralNet", "run", "inference", "MLP", "relu", "linear", "batch"],
    description: "Run a two-layer perceptron stated as data on a batch, with given weights, and read its output",
    fn: East.function([], BooleanType, ($) => {
        // h = relu(x·W₁ᵀ + b₁), y = h·W₂ᵀ + b₂: two inputs, two hidden units, one output
        const net = $.let({
            inputs: new Map([["x", { dtype: variant("float", null), rank: 2n }]]),
            params: new Map([
                ["w1", { shape: [2n, 2n], init: variant("xavier_uniform", null), trainable: true, decay: 1.0 }],
                ["b1", { shape: [2n], init: variant("zeros", null), trainable: true, decay: 1.0 }],
                ["w2", { shape: [1n, 2n], init: variant("xavier_uniform", null), trainable: true, decay: 1.0 }],
                ["b2", { shape: [1n], init: variant("zeros", null), trainable: true, decay: 1.0 }],
            ]),
            modules: new Map(),
            nodes: [
                { name: "h0", op: variant("linear", { x: "x", weight: "w1", bias: some("b1") }) },
                { name: "h", op: variant("relu", { x: "h0" }) },
                { name: "y", op: variant("linear", { x: "h", weight: "w2", bias: some("b2") }) },
            ],
            outputs: new Map([["y", "y"], ["hidden", "h"]]),
        }, NeuralNet.Types.NetType);

        // The weights are data too: here the identity, a bias of [0, -1], and a sum
        const weights = $.let(new Map([
            ["w1", { shape: [2n, 2n], data: new Float64Array([1.0, 0.0, 0.0, 1.0]) }],
            ["b1", { shape: [2n], data: new Float64Array([0.0, -1.0]) }],
            ["w2", { shape: [1n, 2n], data: new Float64Array([1.0, 1.0]) }],
            ["b2", { shape: [1n], data: new Float64Array([0.5]) }],
        ]), NeuralNet.Types.NnWeightsType);

        const batch = $.let(new Map([
            ["x", variant("float", { shape: [2n, 2n], data: new Float64Array([1.0, 2.0, 3.0, 4.0]) })],
        ]), NeuralNet.Types.NnBatchType);
        const config = $.let({ device: variant("cpu", null), seed: 0n, training: false }, NeuralNet.Types.NnRunConfigType);

        // only the nodes "y" needs are evaluated
        const out = $.let(NeuralNet.run(net, weights, batch, ["y"], config));
        const y = $.let(out.get("y").unwrap("float"));

        // rows [1, 2] → relu([1, 1]) → 2.5; [3, 4] → relu([3, 3]) → 6.5
        return y.data.get(0n).equal(2.5).and(() => y.data.get(1n).equal(6.5));
    }),
    inputs: [],
    returns: true,
});

export const nnTrain = example({
    keywords: ["neural network", "nn_train", "NeuralNet", "train", "AdamW", "loss", "history", "fit"],
    description: "Train a network stated as data with torch: fit y = 2x by least squares and watch the loss fall",
    fn: East.function([], BooleanType, ($) => {
        // One weight, no bias: pred = x·w, the loss its mean squared error against the target.
        const net = $.let({
            inputs: new Map([
                ["x", { dtype: variant("float", null), rank: 2n }],
                ["target", { dtype: variant("float", null), rank: 2n }],
            ]),
            params: new Map([["w", { shape: [1n, 1n], init: variant("constant", 0.1), trainable: true, decay: 1.0 }]]),
            modules: new Map(),
            nodes: [
                { name: "pred", op: variant("linear", { x: "x", weight: "w", bias: none }) },
                { name: "err", op: variant("sub", { a: "pred", b: "target" }) },
                { name: "sq", op: variant("mul", { a: "err", b: "err" }) },
                { name: "flat", op: variant("reshape", { x: "sq", shape: [-1n] }) },
                { name: "loss", op: variant("mean", { x: "flat", axis: 0n }) },
            ],
            outputs: new Map([["loss", "loss"], ["pred", "pred"]]),
        }, NeuralNet.Types.NetType);

        const batch = $.let(new Map([
            ["x", variant("float", { shape: [3n, 1n], data: new Float64Array([1.0, 2.0, 3.0]) })],
            ["target", variant("float", { shape: [3n, 1n], data: new Float64Array([2.0, 4.0, 6.0]) })],
        ]), NeuralNet.Types.NnBatchType);

        const config = $.let({
            loss: "loss",
            validation: none,
            optimizer: variant("adamw", { lr: 0.05, beta1: 0.9, beta2: 0.999, eps: 1e-8, weight_decay: 0.0 }),
            schedule: variant("constant", null),
            clip_norm: none,
            ema: none,
            shuffle: false,
            epochs: 60n,
            patience: none,
            precision: variant("f32", null),
            seed: 0n,
            device: variant("cpu", null),
            recompute: new Set<string>(),
            progress: none,
        }, NeuralNet.Types.NnTrainConfigType);

        const result = $.let(NeuralNet.train(net, NeuralNet.init(net, 0n), [batch], [], config));

        // sixty epochs, the loss falling, the weight approaching 2
        const first = $.let(result.history.get(0n).loss);
        const last = $.let(result.history.get(59n).loss);
        const w = $.let(result.weights.get("w").data.get(0n));
        return result.history.length().equal(60n)
            .and(() => last.less(first))
            .and(() => w.subtract(2.0).abs().less(0.3));
    }),
    inputs: [],
    returns: true,
});

export const nnTorchStateDict = example({
    keywords: ["neural network", "nn_export_torch", "nn_import_torch", "NeuralNet", "torch", "state dict", "weights", "exchange"],
    description: "Write a network's weights as a torch state dict and read them back: float32 tensors under torch's names, exact once at that precision",
    fn: East.function([], BooleanType, ($) => {
        // One linear layer; torch names its parameters `0.weight` and `0.bias`.
        const net = $.let({
            inputs: new Map([["x", { dtype: variant("float", null), rank: 2n }]]),
            params: new Map([
                ["w", { shape: [3n, 2n], init: variant("xavier_uniform", null), trainable: true, decay: 1.0 }],
                ["b", { shape: [3n], init: variant("zeros", null), trainable: true, decay: 0.0 }],
            ]),
            modules: new Map(),
            nodes: [{ name: "y", op: variant("linear", { x: "x", weight: "w", bias: some("b") }) }],
            outputs: new Map([["y", "y"]]),
        }, NeuralNet.Types.NetType);
        const weights = $.let(NeuralNet.init(net, 7n));
        // weight name → torch name; the blob is torch.save's bytes, which torch.load reads
        const names = $.let(new Map([["w", "0.weight"], ["b", "0.bias"]]), DictType(StringType, StringType));
        const blob = $.let(NeuralNet.exportTorch(weights, names));
        const once = $.let(NeuralNet.importTorch(blob, names));
        // the state dict holds float32 tensors: the init's f64 weights come back at that precision
        // (within 1e-7 relative), and a round trip of a float32 weight is exact
        const w = $.let(weights.get("w").data);
        const rounding = $.let(once.get("w").data.map(($, v, i) => v.subtract(w.get(i)).abs().divide(w.get(i).abs().add(1e-30))).max());
        const twice = $.let(NeuralNet.importTorch(NeuralNet.exportTorch(once, names), names));
        const exact = $.let(twice.get("w").data.map(($, v, i) => v.subtract(once.get("w").data.get(i)).abs()).max());
        return rounding.less(1e-7).and(() => exact.equal(0.0)).and(() => once.get("b").shape.equal(weights.get("b").shape));
    }),
    inputs: [],
    returns: true,
});
