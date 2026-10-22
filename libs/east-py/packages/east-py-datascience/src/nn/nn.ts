/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Neural networks as East data (east-workspace#1357).
 *
 * A network is a value of {@link NetType}: its inputs, its parameters, the
 * sub-networks it holds, its nodes in dependency order and the outputs it
 * names. Its weights are a `Dict<String, TensorType>` stored like any other
 * dataset. {@link nn_init} draws weights, {@link nn_train} trains them and
 * {@link nn_run} runs the network, on the python runtime (torch) or on the C
 * runtime (`east-c-datascience`, on libtorch), CPU or CUDA by the torch build
 * linked: one definition, the same kernels, the same answers.
 *
 * The specification both interpreters follow — every operation's shapes and
 * conventions — is `docs/neural-networks.md` in this package.
 *
 * @module
 */

import {
    East,
    ArrayType,
    BlobType,
    BooleanType,
    DictType,
    FloatType,
    IntegerType,
    NullType,
    OptionType,
    RecursiveType,
    SetType,
    StringType,
    StructType,
    VariantType,
    VectorType,
    type RecursiveTypeMarker,
} from "@elaraai/east";

// ============================================================================
// Tensors
// ============================================================================

/**
 * An element type: `float` (f64 at rest, f32 in flight: the networks' working
 * precision), `float64` (f64 throughout: running sums, hazards and samplers
 * that need it), `integer` (i64) or `boolean`. A `float` and a `float64`
 * operand of one element-wise operation answer `float64`, as torch promotes.
 */
export const NnDTypeType = VariantType({ float: NullType, float64: NullType, integer: NullType, boolean: NullType });

/** A float tensor: its shape and its elements in row-major order (`shape: []` is a scalar). */
export const TensorType = StructType({ shape: ArrayType(IntegerType), data: VectorType(FloatType) });

/** An integer tensor: its shape and its elements in row-major order. */
export const IntegerTensorType = StructType({ shape: ArrayType(IntegerType), data: VectorType(IntegerType) });

/** A boolean tensor: its shape and its elements in row-major order. */
export const BooleanTensorType = StructType({ shape: ArrayType(IntegerType), data: VectorType(BooleanType) });

/** A tensor of any element type: what a batch holds and what {@link nn_run} answers (`float` and `float64` both carry f64 data at rest). */
export const NnValueType = VariantType({
    float: TensorType, float64: TensorType, integer: IntegerTensorType, boolean: BooleanTensorType,
});

/** Input name → tensor; also {@link nn_run}'s result, output name → tensor. */
export const NnBatchType = DictType(StringType, NnValueType);

/** Weight name → float tensor. A network's own parameter `w` is `w`; a module called with prefix `enc` has `enc.w`. */
export const NnWeightsType = DictType(StringType, TensorType);

// ============================================================================
// The network
// ============================================================================

/** What an input must be: its element type and rank. */
export const NnInputSpecType = StructType({ dtype: NnDTypeType, rank: IntegerType });

/**
 * How {@link nn_init} draws a parameter: `zeros`, `ones`, `constant c`,
 * `normal σ` (the standard deviation), `uniform b` (on `(-b, b)`),
 * `xavier_uniform`, `xavier_normal`, `kaiming_uniform` or `kaiming_normal`
 * (fan-in `shape[1]·∏shape[2:]`, fan-out `shape[0]·∏shape[2:]`).
 */
export const NnInitType = VariantType({
    zeros: NullType,
    ones: NullType,
    constant: FloatType,
    normal: FloatType,
    uniform: FloatType,
    xavier_uniform: NullType,
    xavier_normal: NullType,
    kaiming_uniform: NullType,
    kaiming_normal: NullType,
});

/**
 * A parameter: its shape, its initialisation, whether training moves it, and
 * `decay`, its multiplier of the optimiser's `weight_decay` (1 the full decay,
 * 0 none: biases, norms and embeddings usually take 0).
 */
export const NnParamSpecType = StructType({
    shape: ArrayType(IntegerType), init: NnInitType, trainable: BooleanType, decay: FloatType,
});

/**
 * Which keys each query of an `attention` may attend to: `none` every key;
 * `causal` keys `j ≤ i`; `segments { ids, causal }` the keys sharing the
 * query's segment id (`ids` an integer operand shaped like the tokens), and
 * `j ≤ i` too when `causal`; `key_sets { ptr, keys }` an explicit key list per
 * query in CSR form (`ptr` of `Tq + 1` offsets into `keys`). A query with no
 * allowed key outputs zeros.
 */
export const NnMaskType = VariantType({
    none: NullType,
    causal: NullType,
    segments: StructType({ ids: StringType, causal: BooleanType }),
    key_sets: StructType({ ptr: StringType, keys: StringType }),
});

/** A segment reduction: `sum`, `mean`, `max` or `min`; an empty segment is 0. */
export const NnReduceType = VariantType({ sum: NullType, mean: NullType, max: NullType, min: NullType });

/** How `pad` fills: `zeros` (0, `false`) or `replicate` (the edge element). */
export const NnPadModeType = VariantType({ zeros: NullType, replicate: NullType });

/** The GELU form: `exact` (`½x(1 + erf(x/√2))`) or `tanh` (the tanh approximation). */
export const NnGeluType = VariantType({ exact: NullType, tanh: NullType });

/** A `constant` node's value: a rank-0 tensor of its case's dtype. */
export const NnConstantType = VariantType({ float: FloatType, float64: FloatType, integer: IntegerType, boolean: BooleanType });

/**
 * How `rotary` pairs the dimensions it turns, per head: `halves` pairs
 * dimension `i` with `i + dh/2` (the first half with the second), `interleaved`
 * pairs `2i` with `2i + 1` (neighbours). Weights trained one way need the
 * other's query and key columns permuted.
 */
export const NnRotaryType = VariantType({ halves: NullType, interleaved: NullType });

/** How a `loop` ends: `fixed n` iterations, or `until { output, max }`, a boolean rank-0 body output, at most `max` times. */
export const NnStepsType = VariantType({
    fixed: IntegerType,
    until: StructType({ output: StringType, max: IntegerType }),
});

const Name = StringType;

/**
 * The operation variant of a network whose sub-networks are `self` — the
 * `op` of every node. Each `StringType` field but `module`, `prefix`,
 * `subscripts` and the keys of `inputs`/`carried` is an **operand**: the name
 * of an input, a parameter or an earlier node (`node.out` for one tensor of a
 * `call` or a `loop`). The families, with the shapes and conventions stated
 * in `docs/neural-networks.md` §4:
 *
 * - indexing and layout: `gather`, `take_along`, `mask_select`, `mask_indices`,
 *   `repeat`, `range`, `searchsorted`, `embedding_bag`, `segment_reduce`,
 *   `segment_softmax`, `segment_log_softmax`, `scatter_add`, `concat`, `split`,
 *   `slice`, `pad`, `reshape`, `permute`, `broadcast`, `where`, `constant`, `cast`;
 * - dense: `linear`, `einsum`, `conv1d`, `avg_pool1d`, `upsample_nearest`,
 *   `layer_norm`, `group_norm`;
 * - element-wise: `add`, `sub`, `mul`, `div`, `pow`, `remainder`, `neg`, `abs`,
 *   `floor`, `ceil`, `round`, `exp`, `log`, `log1p`, `sqrt`, `softplus`,
 *   `sigmoid`, `tanh`, `relu`, `gelu`, `silu`, `clamp`, `sin`, `cos`,
 *   `nan_to_num`, `is_nan`, `normal_cdf`, `log_normal_cdf`, `normal_quantile`,
 *   `log1mexp`, the comparisons `eq`, `ne`, `lt`, `le`, `gt`, `ge`, and
 *   `logical_not`, `logical_and`, `logical_or`;
 * - along an axis: `sum`, `mean`, `max`, `min`, `logsumexp`, `softmax`,
 *   `log_softmax`, `cumsum`, `cummax`, `cummin`, `argmax`;
 * - attention: `attention` (its `segments` and `key_sets` masks evaluated in
 *   memory proportional to the allowed pairs), `rotary` (halves or interleaved);
 * - training and noise: `dropout`, `stop_gradient`, `random_normal`, `random_uniform`
 *   (each draw a function of the seed, the node, the row's key and the
 *   element: the same on every runner and device, whatever the batching);
 * - structure: `call` (a module under a weight prefix), `loop` (a body network
 *   iterated over carried values).
 *
 * @param self - The recursive marker of {@link NetType}
 * @returns The variant type of a node's operation
 */
export function nnOpType(self: RecursiveTypeMarker) {
    const unary = StructType({ x: Name });
    const binary = StructType({ a: Name, b: Name });
    const axis = StructType({ x: Name, axis: IntegerType });
    return VariantType({
        // indexing and layout
        gather: StructType({ table: Name, index: Name }),
        take_along: StructType({ x: Name, index: Name, axis: IntegerType }),
        mask_select: StructType({ x: Name, mask: Name }),
        mask_indices: StructType({ mask: Name }),
        repeat: StructType({ x: Name, counts: Name }),
        range: StructType({ start: IntegerType, stop: Name, step: IntegerType }),
        searchsorted: StructType({ sorted: Name, values: Name, right: BooleanType }),
        embedding_bag: StructType({ table: Name, index: Name, weights: OptionType(Name), segments: Name, size: Name }),
        segment_reduce: StructType({ x: Name, segments: Name, size: Name, reduce: NnReduceType }),
        segment_softmax: StructType({ x: Name, segments: Name }),
        segment_log_softmax: StructType({ x: Name, segments: Name }),
        scatter_add: StructType({ x: Name, index: Name, size: Name }),
        concat: StructType({ inputs: ArrayType(Name), axis: IntegerType }),
        split: StructType({ x: Name, axis: IntegerType, sizes: ArrayType(IntegerType), part: IntegerType }),
        slice: StructType({ x: Name, axis: IntegerType, start: IntegerType, stop: OptionType(IntegerType) }),
        pad: StructType({ x: Name, axis: IntegerType, before: IntegerType, after: IntegerType, mode: NnPadModeType }),
        reshape: StructType({ x: Name, shape: ArrayType(IntegerType) }),
        permute: StructType({ x: Name, axes: ArrayType(IntegerType) }),
        broadcast: StructType({ x: Name, like: Name }),
        where: StructType({ cond: Name, a: Name, b: Name }),
        constant: StructType({ value: NnConstantType }),
        cast: StructType({ x: Name, dtype: NnDTypeType }),
        // dense
        linear: StructType({ x: Name, weight: Name, bias: OptionType(Name) }),
        einsum: StructType({ subscripts: StringType, inputs: ArrayType(Name) }),
        conv1d: StructType({
            x: Name, weight: Name, bias: OptionType(Name), stride: IntegerType, dilation: IntegerType, groups: IntegerType,
        }),
        avg_pool1d: StructType({ x: Name, kernel: IntegerType, stride: IntegerType }),
        upsample_nearest: StructType({ x: Name, scale: IntegerType }),
        layer_norm: StructType({ x: Name, weight: OptionType(Name), bias: OptionType(Name), eps: FloatType }),
        group_norm: StructType({ x: Name, groups: IntegerType, weight: OptionType(Name), bias: OptionType(Name), eps: FloatType }),
        // element-wise
        add: binary,
        sub: binary,
        mul: binary,
        div: binary,
        pow: binary,
        remainder: binary,
        neg: unary,
        abs: unary,
        floor: unary,
        ceil: unary,
        round: unary,
        exp: unary,
        log: unary,
        log1p: unary,
        sqrt: unary,
        softplus: unary,
        sigmoid: unary,
        tanh: unary,
        relu: unary,
        gelu: StructType({ x: Name, approximate: NnGeluType }),
        silu: unary,
        clamp: StructType({ x: Name, min: OptionType(FloatType), max: OptionType(FloatType) }),
        sin: unary,
        cos: unary,
        nan_to_num: StructType({ x: Name, nan: FloatType, posinf: FloatType, neginf: FloatType }),
        is_nan: unary,
        normal_cdf: unary,
        log_normal_cdf: unary,
        normal_quantile: unary,
        log1mexp: unary,
        eq: binary,
        ne: binary,
        lt: binary,
        le: binary,
        gt: binary,
        ge: binary,
        logical_not: unary,
        logical_and: binary,
        logical_or: binary,
        // along an axis
        sum: axis,
        mean: axis,
        max: axis,
        min: axis,
        logsumexp: axis,
        softmax: axis,
        log_softmax: axis,
        cumsum: axis,
        cummax: axis,
        cummin: axis,
        argmax: axis,
        // attention
        attention: StructType({
            q: Name, k: Name, v: Name, heads: IntegerType, mask: NnMaskType, bias: OptionType(Name), scale: OptionType(FloatType),
        }),
        rotary: StructType({ x: Name, positions: Name, heads: IntegerType, base: FloatType, convention: NnRotaryType }),
        // training and noise
        dropout: StructType({ x: Name, p: FloatType }),
        stop_gradient: unary,
        random_normal: StructType({ like: Name, keys: OptionType(Name) }),
        random_uniform: StructType({ like: Name, keys: OptionType(Name) }),
        // structure
        call: StructType({ module: StringType, prefix: StringType, inputs: DictType(StringType, Name) }),
        loop: StructType({
            body: self,
            carried: DictType(StringType, Name),
            inputs: DictType(StringType, Name),
            step: OptionType(StringType),
            steps: NnStepsType,
        }),
    });
}

/**
 * A network as data: `inputs` (name → element type and rank), `params`
 * (name → shape, initialisation, trainable), `modules` (name → sub-network,
 * applied by `call` under a weight prefix, or iterated by a `loop`), `nodes`
 * in dependency order (each a name and an operation of {@link nnOpType}) and
 * `outputs` (name → operand). Names of inputs, parameters and nodes share one
 * namespace and hold no `.`.
 */
export const NetType = RecursiveType(self => StructType({
    inputs: DictType(StringType, NnInputSpecType),
    params: DictType(StringType, NnParamSpecType),
    modules: DictType(StringType, self),
    nodes: ArrayType(StructType({ name: StringType, op: nnOpType(self) })),
    outputs: DictType(StringType, StringType),
}));

// ============================================================================
// Running and training
// ============================================================================

/** Where to run: `cpu`; `cuda`; `auto`, CUDA when the runtime's torch build finds a GPU, else the CPU. `cuda` is an error without one. */
export const NnDeviceType = VariantType({ cpu: NullType, cuda: NullType, auto: NullType });

/** {@link nn_run}'s configuration: the device, the seed of the random operations, whether dropout is on. */
export const NnRunConfigType = StructType({ device: NnDeviceType, seed: IntegerType, training: BooleanType });

/** The optimiser: AdamW with its learning rate, betas, epsilon and decoupled weight decay. */
export const NnOptimizerType = VariantType({
    adamw: StructType({ lr: FloatType, beta1: FloatType, beta2: FloatType, eps: FloatType, weight_decay: FloatType }),
});

/** What a schedule counts: `step` (every optimiser step, over `epochs × batches`) or `epoch` (the rate set at each epoch's start, over `epochs`). */
export const NnScheduleUnitType = VariantType({ step: NullType, epoch: NullType });

/** The learning-rate schedule: `constant`; `warmup_linear` (rises over `warmup_steps` of its `unit`, then holds); `warmup_cosine` (rises, then decays by a cosine to `min_lr`). */
export const NnScheduleType = VariantType({
    constant: NullType,
    warmup_cosine: StructType({ warmup_steps: IntegerType, min_lr: FloatType, unit: NnScheduleUnitType }),
    warmup_linear: StructType({ warmup_steps: IntegerType, unit: NnScheduleUnitType }),
});

/** What early stopping and the history read: the output `value`, summed over the validation batches and divided by the sum of `weight` (a rank-0 output; 1 per batch when `none`). */
export const NnValidationType = StructType({ value: StringType, weight: OptionType(StringType) });

/** An exponential moving average of the weights: its `decay`, and whether it warms up (`min(decay, (1 + s)/(10 + s))` after `s` steps). */
export const NnEmaType = StructType({ decay: FloatType, warmup: BooleanType });

/** The forward pass's precision while training: `f32`, or `bf16` under autocast with f32 master weights. */
export const NnPrecisionType = VariantType({ f32: NullType, bf16: NullType });

/**
 * {@link nn_train}'s configuration: the scalar output `loss` minimised; the
 * `validation` early stopping reads (a value and a weight output, Σ value /
 * Σ weight over the validation batches in evaluation mode; the training loss
 * when `none`); the optimiser and schedule; `clip_norm` and `ema` (options);
 * `shuffle`, whether each epoch runs the batches in a seeded permutation of
 * its own; `epochs`; `patience` (epochs without improvement before stopping;
 * `none` never stops early); `precision`, `seed`, `device`; `recompute`, the
 * modules whose calls are recomputed in the backward pass instead of keeping
 * their activations; and `progress`, a line on stderr every so many steps and
 * per epoch (`none` is silent).
 */
export const NnTrainConfigType = StructType({
    loss: StringType,
    validation: OptionType(NnValidationType),
    optimizer: NnOptimizerType,
    schedule: NnScheduleType,
    clip_norm: OptionType(FloatType),
    ema: OptionType(NnEmaType),
    shuffle: BooleanType,
    epochs: IntegerType,
    patience: OptionType(IntegerType),
    precision: NnPrecisionType,
    seed: IntegerType,
    device: NnDeviceType,
    recompute: SetType(StringType),
    progress: OptionType(IntegerType),
});

/** One epoch of {@link nn_train}: its number (1-based), mean loss, validation value when measured, and the learning rate at its last step. */
export const NnTrainHistoryType = StructType({
    epoch: IntegerType,
    loss: FloatType,
    validation: OptionType(FloatType),
    learning_rate: FloatType,
});

/** What {@link nn_train} answers: the best epoch's weights (the EMA's when kept), one history entry per epoch run, the best epoch. */
export const NnTrainResultType = StructType({
    weights: NnWeightsType,
    history: ArrayType(NnTrainHistoryType),
    best_epoch: IntegerType,
});

// ============================================================================
// Platform functions
// ============================================================================

/** Draw a network's weights from a seed: every weight it reaches, by name. */
export const nn_init = East.platform("nn_init", [NetType, IntegerType], NnWeightsType);

/** Train a network's weights with torch, on either runtime. */
export const nn_train = East.platform(
    "nn_train",
    [NetType, NnWeightsType, ArrayType(NnBatchType), ArrayType(NnBatchType), NnTrainConfigType],
    NnTrainResultType
);

/** Run a network on a batch and answer the outputs asked for, on either runtime. */
export const nn_run = East.platform(
    "nn_run",
    [NetType, NnWeightsType, NnBatchType, ArrayType(StringType), NnRunConfigType],
    NnBatchType
);

/**
 * Read a torch state dict (`torch.save`'s bytes) as weights: each tensor
 * under the weight name `names` maps its torch name to, or its torch name
 * when unmapped (`names`: weight name → torch name). Float tensors of any
 * precision; float32 arrives exactly.
 */
export const nn_import_torch = East.platform(
    "nn_import_torch",
    [BlobType, DictType(StringType, StringType)],
    NnWeightsType
);

/**
 * Write weights as a torch state dict (`torch.save`'s bytes, float32
 * tensors, each under `names`' torch name for the weight, or the weight's
 * own name) that python's `torch.load` and {@link nn_import_torch} read.
 */
export const nn_export_torch = East.platform(
    "nn_export_torch",
    [NnWeightsType, DictType(StringType, StringType)],
    BlobType
);

/** The neural-network types, under one name. */
export const NeuralNetTypes = {
    NnDTypeType,
    TensorType,
    IntegerTensorType,
    BooleanTensorType,
    NnValueType,
    NnBatchType,
    NnWeightsType,
    NnInputSpecType,
    NnInitType,
    NnParamSpecType,
    NnMaskType,
    NnReduceType,
    NnPadModeType,
    NnGeluType,
    NnConstantType,
    NnRotaryType,
    NnStepsType,
    NetType,
    NnDeviceType,
    NnRunConfigType,
    NnOptimizerType,
    NnScheduleUnitType,
    NnScheduleType,
    NnValidationType,
    NnEmaType,
    NnPrecisionType,
    NnTrainConfigType,
    NnTrainHistoryType,
    NnTrainResultType,
} as const;

/**
 * Neural networks as East data: one definition, run by torch and by east-c.
 *
 * Build a {@link NetType} value — a two-layer perceptron, a transformer over
 * ragged grouped sequences, a conditioned U-Net — and hand it to these
 * functions with its weights. Every operation's shapes and conventions are
 * in `docs/neural-networks.md`.
 */
export const NeuralNet = {
    /**
     * Draw a network's weights.
     *
     * Every weight the network reaches is drawn in sorted name order from a
     * generator seeded with `seed`, as each parameter's `init` says: the same
     * weights for a seed on either runtime.
     *
     * @param net - The network
     * @param seed - The generator's seed
     * @returns The weights, by name
     *
     * @example
     * ```ts
     * // A linear layer y = x·Wᵀ + b, its weight drawn Xavier-uniform, its bias zero
     * const net = $.let({
     *     inputs: new Map([["x", { dtype: variant("float", null), rank: 2n }]]),
     *     params: new Map([
     *         ["w", { shape: [3n, 2n], init: variant("xavier_uniform", null), trainable: true, decay: 1.0 }],
     *         ["b", { shape: [3n], init: variant("zeros", null), trainable: true, decay: 0.0 }],
     *     ]),
     *     modules: new Map(),
     *     nodes: [{ name: "y", op: variant("linear", { x: "x", weight: "w", bias: some("b") }) }],
     *     outputs: new Map([["y", "y"]]),
     * }, NeuralNet.Types.NetType);
     * const weights = $.let(NeuralNet.init(net, 7n));
     * // weights.get("w").shape is [3, 2]; weights.get("b").data is three zeros
     * ```
     */
    init: nn_init,

    /**
     * Train a network's weights with torch, on either runtime.
     *
     * Each epoch runs every batch once (in order, or in a seeded permutation
     * of its own with `shuffle`) in training mode, minimising the scalar
     * output `config.loss` by AdamW under the schedule, each parameter's
     * weight decay scaled by its `decay`; the `validation` value, summed over
     * the validation batches and divided by the summed weights, drives early
     * stopping. Answers the best epoch's weights, the history and the best
     * epoch.
     *
     * @param net - The network, with a rank-0 float output to minimise
     * @param weights - The starting weights ({@link nn_init}'s, or a checkpoint)
     * @param batches - The training batches, one optimiser step each
     * @param validation_batches - The validation batches (may be empty)
     * @param config - The training configuration
     * @returns The trained weights, one history entry per epoch, the best epoch
     *
     * @example
     * ```ts
     * const config = $.let({
     *     loss: "loss", validation: none,
     *     optimizer: variant("adamw", { lr: 0.01, beta1: 0.9, beta2: 0.999, eps: 1e-8, weight_decay: 0.0 }),
     *     schedule: variant("constant", null),
     *     clip_norm: some(1.0), ema: none, shuffle: false,
     *     epochs: 50n, patience: none,
     *     precision: variant("f32", null), seed: 0n, device: variant("cpu", null),
     *     recompute: new Set<string>(), progress: none,
     * }, NeuralNet.Types.NnTrainConfigType);
     * const result = $.let(NeuralNet.train(net, NeuralNet.init(net, 0n), batches, [], config));
     * // result.history.get(49n).loss is below result.history.get(0n).loss
     * ```
     */
    train: nn_train,

    /**
     * Run a network on a batch and answer the outputs asked for.
     *
     * Only the nodes those outputs need are evaluated. The network is
     * prepared once per distinct value and weights, so a program calling it
     * thousands of times pays for the forward pass alone. `cuda` needs a torch
     * build with CUDA and a GPU on the host; `auto` falls back to the CPU.
     *
     * @param net - The network
     * @param weights - Its weights, by name
     * @param batch - Every input the network declares
     * @param outputs - Names from the network's `outputs`
     * @param config - The device, the seed of the random operations, whether dropout is on
     * @returns Each asked output by its name
     *
     * @example
     * ```ts
     * const batch = $.let(new Map([
     *     ["x", variant("float", { shape: [2n, 2n], data: new Float64Array([1.0, 2.0, 3.0, 4.0]) })],
     * ]), NeuralNet.Types.NnBatchType);
     * const config = $.let({ device: variant("cpu", null), seed: 0n, training: false }, NeuralNet.Types.NnRunConfigType);
     * const out = $.let(NeuralNet.run(net, weights, batch, ["y"], config));
     * // out.get("y") is variant("float", { shape: [2, 3], data: … })
     * ```
     */
    run: nn_run,

    /**
     * Read a torch state dict as weights.
     *
     * The blob is `torch.save`'s bytes (a state dict of float tensors); each
     * tensor becomes the weight `names` maps its torch name to, or keeps its
     * torch name. A torch-trained model runs here once its names are mapped
     * onto the network's parameters.
     *
     * @param blob - `torch.save`'s bytes
     * @param names - Weight name → torch name (a torch name not mapped keeps itself)
     * @returns The weights, by name
     */
    importTorch: nn_import_torch,

    /**
     * Write weights as a torch state dict.
     *
     * The bytes are `torch.save`'s, float32 tensors under `names`' torch
     * name for each weight (or the weight's own name), so python's
     * `torch.load` reads them and {@link nn_import_torch} reads them back
     * exactly.
     *
     * @param weights - The weights, by name
     * @param names - Weight name → torch name
     * @returns `torch.save`'s bytes
     */
    exportTorch: nn_export_torch,

    /** The neural-network types. */
    Types: NeuralNetTypes,
} as const;
