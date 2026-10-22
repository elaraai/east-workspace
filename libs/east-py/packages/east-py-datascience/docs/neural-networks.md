# Neural networks as East data

A neural network is a value of `NetType`: its inputs, its parameters, the
sub-networks it holds, its nodes in dependency order and the outputs it names.
Weights are a `Dict<String, TensorType>` like any other dataset. Three platform
functions run it — `nn_init`, `nn_train`, `nn_run` — on the python runtime
(torch) and on the C runtime (`east-c-datascience`, on libtorch, PyTorch's C++
library), on the CPU or on CUDA by the torch build each is linked against.
This document is the specification both interpreters are written to: the
types, every operation's shapes and conventions, and what each function does,
so that a network built once gives the same answers wherever it runs. Both
interpreters call the same ATen kernels, so they agree to rounding.

The TypeScript types live in `src/nn/nn.ts` (`NeuralNet.Types`), the python
twins in `east_py_datascience/nn/types.py`; `test/nn.spec.ts` holds every
operation to this document on both runners.

## 1. Types

```ts
NnDTypeType     = VariantType({ float: NullType, float64: NullType, integer: NullType, boolean: NullType })
NnInputSpecType = StructType({ dtype: NnDTypeType, rank: IntegerType })
NnInitType      = VariantType({ zeros, ones, constant: FloatType, normal: FloatType /* std */,
                                uniform: FloatType /* bound: U(-b, b) */, xavier_uniform, xavier_normal,
                                kaiming_uniform, kaiming_normal })
NnParamSpecType = StructType({ shape: ArrayType(IntegerType), init: NnInitType, trainable: BooleanType,
                               decay: FloatType /* the multiplier of the optimiser's weight_decay */ })

TensorType        = StructType({ shape: ArrayType(IntegerType), data: VectorType(FloatType) })    // row-major
IntegerTensorType = StructType({ shape: ArrayType(IntegerType), data: VectorType(IntegerType) })
BooleanTensorType = StructType({ shape: ArrayType(IntegerType), data: VectorType(BooleanType) })
NnValueType       = VariantType({ float: TensorType, float64: TensorType, integer: IntegerTensorType, boolean: BooleanTensorType })
NnBatchType       = DictType(StringType, NnValueType)     // input name → tensor; also nn_run's result
NnWeightsType     = DictType(StringType, TensorType)      // weight name → tensor

NetType = RecursiveType(self => StructType({
  inputs:  DictType(StringType, NnInputSpecType),
  params:  DictType(StringType, NnParamSpecType),
  modules: DictType(StringType, self),
  nodes:   ArrayType(StructType({ name: StringType, op: OpType(self) })),
  outputs: DictType(StringType, StringType),              // output name → operand
}))
```

A tensor's `data` holds `shape`'s product of elements in row-major order; a
rank-0 tensor has `shape: []` and one element. The product of a shape of
zeros is zero: an empty tensor is allowed wherever its operation allows it.

Every `StringType` field of an operation, and every value of `outputs`, is an
**operand**: the name of an input, of a parameter, or of a node defined
earlier in `nodes`. A `call` or `loop` node holds several tensors; `node.name`
selects the module's output `name` (a call) or the carried value `name` (a
loop); the bare node name selects its one tensor when it holds exactly one.
Names of inputs, parameters and nodes may not contain `.`, and no name is
defined twice in one network (inputs, parameters and nodes share one
namespace).

Weights are named by the **call prefixes** on the way to a parameter: a
network's own parameter `w` is weight `w`; the parameter `w` of a module called
with prefix `enc` is `enc.w`; called from inside that module with prefix
`attn`, `enc.attn.w`. A loop body adds no prefix: its parameters are named as
the enclosing network's are, and a module it calls is named by the call's
prefix alone, so a sampler's loop reuses the weights the training path
trained. The same module called twice with the same prefix shares weights.

## 2. Element types

`float` and `float64` are the two **float kinds**: `float` is IEEE single in
flight (the networks' working precision; `bf16` under `nn_train`'s autocast),
`float64` IEEE double throughout (running sums, hazards and samplers that
single precision cannot carry); both are f64 East data at rest. Parameters are
`float`. An operation that takes a float kind keeps it; one that takes two
answers `float64` when either operand is `float64`, as torch promotes ("the
wider" below). Node dtypes are inferred from the operands' before anything
runs:

| operation | operands | result |
|---|---|---|
| `add`, `sub`, `mul`, `remainder` | both of a float kind, or both integer | the wider float kind, or integer |
| `div`, `pow` | float kinds | the wider |
| `neg`, `abs` | a float kind or integer | the same |
| `floor`, `ceil`, `round`, `exp` … `log1mexp`, `gelu`, `clamp`, `nan_to_num`, `softplus`, `sigmoid`, `tanh`, `relu`, `silu`, `sin`, `cos` | a float kind | the same |
| `is_nan` | a float kind | boolean |
| `eq`, `ne` | both of one dtype, or both of a float kind | boolean |
| `lt`, `le`, `gt`, `ge` | both of a float kind, or both integer | boolean |
| `logical_not`, `logical_and`, `logical_or` | boolean | boolean |
| `where` | `cond` boolean; `a` and `b` of one dtype, or both of a float kind | that dtype, or the wider float kind |
| `cast` | any | the named dtype |
| `constant` | — | its case |
| `gather`, `take_along`, `mask_select`, `repeat`, `concat`, `split`, `slice`, `pad`, `reshape`, `permute`, `broadcast` | any (`index`, `counts` integer; `mask` boolean; `concat`'s inputs of one dtype) | the operand's |
| `mask_indices`, `range`, `searchsorted` | `mask` boolean; `stop` integer; `sorted` and `values` of one dtype, not boolean | integer |
| `embedding_bag`, `segment_softmax`, `segment_log_softmax` | float (`index`, `segments` integer) | float |
| `segment_reduce` (`sum`, `max`, `min`), `scatter_add` | a float kind or integer | the same |
| `segment_reduce` (`mean`) | a float kind | the same |
| `linear`, `einsum`, `conv1d`, `avg_pool1d`, `upsample_nearest`, `layer_norm`, `group_norm`, `attention`, `rotary`, `dropout` | float | float |
| `sum`, `max`, `min`, `cumsum`, `cummax`, `cummin` | a float kind or integer | the same |
| `mean`, `logsumexp`, `softmax`, `log_softmax` | a float kind | the same |
| `argmax` | a float kind or integer | integer |
| `stop_gradient` | any | the same |
| `random_normal`, `random_uniform` | `like` any | float |

Casts: integer → `float64` exactly up to 2⁵³, integer → `float` exactly up to
2²⁴ and rounded to nearest beyond; `float` ↔ `float64` as IEEE converts; a
float kind → integer truncates toward zero (a non-finite float is an error);
boolean → integer or a float kind gives 0 and 1; integer or a float kind →
boolean is `≠ 0`.

Float arithmetic is IEEE single on both runtimes for `float` (`bf16` inside
`nn_train` when configured, which leaves `float64` alone) and IEEE double for
`float64`, through the same torch kernels; a float tensor of either kind at
rest is f64 East data and is converted at the boundary. Integer arithmetic is
64-bit and exact.

## 3. Shapes and broadcasting

Binary element-wise operations (`add` … `pow`, the comparisons, `logical_*`,
`where`) broadcast as numpy does: shapes are aligned from the right, a 1
stretches, and any other difference is an error. Negative axes count from the
end everywhere an `axis` is taken. An axis outside the rank is an error.

## 4. The operations

Every case names its operands by name; the other fields are the operation's
own. `name` below is an operand.

### Indexing and layout

- `gather { table, index }` — rows of `table` by `index`: `table` `[N, …R]`,
  `index` integer of any shape `[…I]` → `[…I, …R]`. An index outside
  `0 .. N-1` is an error.
- `take_along { x, index, axis }` — `x` of any rank, `index` integer of the
  same rank with `x`'s extents but along `axis` → shaped like `index`:
  `out[…, i, …] = x[…, index[…, i, …], …]` along the axis. An index outside
  `0 .. x.shape[axis]−1` is an error.
- `mask_select { x, mask }` — the rows of `x` where `mask` is true, in order:
  `x` `[N, …R]`, `mask` boolean `[N]` → `[K, …R]`, `K` the number of true
  entries.
- `mask_indices { mask }` — the indices where `mask` is true, increasing:
  `mask` boolean `[N]` → integer `[K]`.
- `repeat { x, counts }` — row `i` of `x` repeated `counts[i]` times, in
  order: `x` `[N, …R]`, `counts` integer `[N]` with every entry ≥ 0 →
  `[Σ counts, …R]`.
- `range { start, stop, step }` — the integers `start, start + step, …` short
  of `stop`: `start` and `step` are the node's own (`step ≠ 0`), `stop` an
  integer rank-0 operand (a `constant`, or an input carrying a size) →
  integer `[max(0, ⌈(stop − start)/step⌉)]`.
- `searchsorted { sorted, values, right }` — for each of `values` the position
  in `sorted` that keeps it sorted: `sorted` a non-decreasing vector `[N]` of
  `values`' dtype → integer shaped like `values`, the first `i` with
  `sorted[i] ≥ v` (`right: false`) or `sorted[i] > v` (`right: true`), `N`
  when there is none.
- `embedding_bag { table, index, weights, segments, size }` — a weighted sum of
  gathered rows per segment: `table` `[N, …R]`, `index` and `segments` integer
  `[M]`, `weights` an option of a float `[M]` (1 for every row when `none`),
  `size` any operand whose **first dimension** is the number of segments `S`
  → `[S, …R]`, `out[s] = Σ_{i: segments[i]=s} weights[i]·table[index[i]]`. A
  segment id outside `0 .. S-1` is an error; an empty segment is zeros.
- `segment_reduce { x, segments, size, reduce }` — `x` `[M, …R]`, `segments`
  integer `[M]`, `size` as above → `[S, …R]`; `reduce` is `sum`, `mean`,
  `max` or `min`. An empty segment is 0 for every reduction (a mean of
  nothing is 0, not NaN).
- `segment_softmax { x, segments }`, `segment_log_softmax` — `x` `[M, …R]`,
  `segments` integer `[M]` → the same shape; a softmax along the first axis
  over the elements sharing a segment id, for each trailing position; one
  element alone is 1 (0 for the log).
- `scatter_add { x, index, size }` — `x` `[M, …R]`, `index` integer `[M]`,
  `size` as above → `[S, …R]` of zeros with `out[index[i]] += x[i]`. An index
  outside `0 .. S-1` is an error.
- `concat { inputs, axis }` — along `axis`; every input has the same shape
  elsewhere. `inputs` is non-empty.
- `split { x, axis, sizes, part }` — `sizes` sum to `x`'s extent along `axis`;
  the result is part `part` (0-based).
- `slice { x, axis, start, stop }` — `start` and `stop` as python's, negative
  counting from the end, `stop` exclusive and `none` the end; an empty slice
  is allowed.
- `pad { x, axis, before, after, mode }` — `before` and `after` ≥ 0 elements
  along `axis`; `zeros` pads with 0 (`false`), `replicate` repeats the edge
  element (an empty axis cannot be replicated).
- `reshape { x, shape }` — row-major, the same element count; at most one `-1`
  is inferred.
- `permute { x, axes }` — a permutation of `0 .. rank-1`.
- `broadcast { x, like }` — `x` broadcast to the shape of `like` (§3).
- `where { cond, a, b }` — `cond ? a : b`, all three broadcast together.
- `constant { value }` — a rank-0 tensor of its case's dtype (`float64`'s
  payload is the same East float as `float`'s; the case names the dtype).
- `cast { x, dtype }` — §2.

### Dense

- `linear { x, weight, bias }` — `x` `[…, in]`, `weight` `[out, in]`, `bias`
  an option of `[out]` → `[…, out]`, `x·Wᵀ + b`.
- `einsum { subscripts, inputs }` — explicit subscripts, `"ij,jk->ik"`: one
  lowercase letter per axis, every operand's letters, `->` and the output's
  letters, which are a subset of the operands' with no repeats; a letter
  repeated inside one operand is not allowed (no diagonals); no `...`. Each
  letter has one extent across the operands (a 1 does not broadcast). Letters
  not in the output are summed.
- `conv1d { x, weight, bias, stride, dilation, groups }` — cross-correlation:
  `x` `[N, C_in, L]`, `weight` `[C_out, C_in/groups, K]`, `bias` an option of
  `[C_out]`, `stride` and `dilation` ≥ 1, `C_in` and `C_out` multiples of
  `groups` → `[N, C_out, L']`, `L' = ⌊(L − dilation·(K−1) − 1)/stride⌋ + 1`,
  which must be ≥ 0. There is no padding field: `pad` first.
- `avg_pool1d { x, kernel, stride }` — `x` `[N, C, L]` → `[N, C, ⌊(L−kernel)/stride⌋+1]`,
  the mean of each window.
- `upsample_nearest { x, scale }` — every element along the last axis repeated
  `scale` times.
- `layer_norm { x, weight, bias, eps }` — over the last axis: `(x − mean)/√(var + eps)`
  with the biased variance, then `· weight + bias` (options of `[d]`).
- `group_norm { x, groups, weight, bias, eps }` — `x` `[N, C, …]`, `C` a
  multiple of `groups`: each `(n, group)` normalised over its channels and
  every trailing position with the biased variance, then `· weight[c] + bias[c]`
  (options of `[C]`).

### Element-wise

`add`, `sub`, `mul`, `div`, `pow`, `remainder { a, b }` and the unary `neg`,
`abs`, `floor`, `ceil`, `round`, `exp`, `log`, `log1p`, `sqrt`, `softplus`,
`sigmoid`, `tanh`, `relu`, `silu`, `sin`, `cos`, `is_nan`, `normal_cdf`,
`log_normal_cdf`, `normal_quantile`, `log1mexp { x }` are IEEE where the
function is; `log` of a negative is NaN, `div` by zero ±∞ or NaN, as in
torch. Conventions:

- `remainder(a, b)` has the divisor's sign (python's `%`, torch's):
  `remainder(−7, 3) = 2`, `remainder(7, −3) = −2`; for a float kind it is
  `a − b·⌊a/b⌋`, NaN for `b = 0`; for integers `b = 0` is an error.
- `floor`, `ceil` as IEEE; `round` is to the nearest integer, halves to even
  (`round(0.5) = 0`, `round(1.5) = round(2.5) = 2`).
- `softplus(x) = log(1 + eˣ)`, and `x` itself above 20.
- `sigmoid(x) = 1/(1 + e⁻ˣ)`; `silu(x) = x·sigmoid(x)`.
- `gelu { x, approximate }` — `exact`: `½x(1 + erf(x/√2))`; `tanh`:
  `½x(1 + tanh(√(2/π)(x + 0.044715x³)))`.
- `clamp { x, min, max }` — options; `none` leaves that side open.
- `nan_to_num { x, nan, posinf, neginf }` — the three replacements, all given.
- `normal_cdf(x) = Φ(x)`; `log_normal_cdf(x) = log Φ(x)`, evaluated stably
  into the lower tail (not `log(Φ(x))` rounded to −∞); `normal_quantile(p) =
  Φ⁻¹(p)`, ±∞ at 0 and 1, NaN outside; `log1mexp(x) = log(1 − eˣ)` for
  `x < 0`, stable near 0 (`log(−expm1 x)` above −ln 2, `log1p(−eˣ)` below),
  NaN for `x ≥ 0` … except exactly 0, which is −∞.
- `eq`, `ne`, `lt`, `le`, `gt`, `ge { a, b }`; `logical_not { x }`,
  `logical_and`, `logical_or { a, b }`.

### Along an axis

`sum`, `mean`, `max`, `min`, `logsumexp`, `softmax`, `log_softmax`, `cumsum`,
`cummax`, `cummin`, `argmax { x, axis }`. The reductions (`sum` … `logsumexp`,
`argmax`) remove the axis; the others keep the shape. `max`, `min` and
`argmax` of an empty axis are errors; `sum` of one is 0 and `mean` 0.
`softmax` and `logsumexp` subtract the maximum first. `argmax` is the first
index of the maximum. `cummax`/`cummin` are the running maximum/minimum.

### Attention

- `attention { q, k, v, heads, mask, bias, scale }` — `q` `[…, Tq, d]`, `k` and
  `v` `[…, Tk, d]`, `d` a multiple of `heads`, `dh = d/heads` → `[…, Tq, d]`.
  Per head, `scores = q·kᵀ · scale` (`scale` an option, `1/√dh` when `none`),
  plus `bias` when given (an option of a float broadcastable to
  `[…, heads, Tq, Tk]`), masked, softmaxed over the keys, applied to `v`. The
  mask names which keys each query may attend to:
  - `none` — every key;
  - `causal` — key `j ≤ i` (so `Tq = Tk`);
  - `segments { ids, causal }` — `ids` integer `[…, T]` with `Tq = Tk = T`:
    key `j` if `ids[j] = ids[i]`, and `j ≤ i` when `causal`;
  - `key_sets { ptr, keys }` — for unbatched `q`, `k`, `v` (`[T, d]`): `ptr`
    integer `[Tq + 1]` non-decreasing from 0, `keys` integer `[ptr[Tq]]` with
    every entry in `0 .. Tk-1`; query `i` attends to `keys[ptr[i] .. ptr[i+1])`.

  A query with no allowed key outputs zeros. The keys of one query in a
  `key_sets` mask are distinct: a key listed twice for a query is an error.

  Both interpreters evaluate `none`, `causal` and any attention given a
  `bias` through dense `Tq × Tk` scores. They evaluate a `segments` or a
  `key_sets` mask without a bias **in memory proportional to the allowed
  pairs**, and answer what the dense mask answers, to rounding: `segments`
  groups the tokens by id (in any order, across any leading dimensions),
  buckets the groups by length to the next power of two (so padding is at
  most 2×) and attends within each bucket through the fused kernel;
  `key_sets` scores each listed pair by a gathered dot product (in chunks of
  pairs), normalises the scores by segment operations over the query and sums
  the values by index. While training, the gathered values of a `key_sets`
  attention are kept for the backward pass, so its memory is the pairs times
  the width.
- `rotary { x, positions, heads, base, convention }` — `x` `[…, T, d]`,
  `positions` integer `[…, T]`, `dh = d/heads` even: per head, `dh/2` pairs
  of dimensions each turn by `θᵢ = positions · base^(−2i/dh)` (`i` in
  `0 .. dh/2−1`): a pair `(a, b)` becomes `(a cos θᵢ − b sin θᵢ, b cos θᵢ +
  a sin θᵢ)`. The inverse frequencies `base^(−2i/dh)` are computed in double
  (`(−i × 2) / dh`, then the power) and rounded to the tensor's `float`, so
  every head dimension gives one value on every runner, not only the powers
  of two whose `2/dh` a float holds exactly. `convention` names the pairs: `halves` pairs `x[i]` with
  `x[i + dh/2]` (the first half with the second), `interleaved` pairs `x[2i]`
  with `x[2i + 1]` (neighbours). Weights trained under one convention serve
  under the other once the query and key projections' output columns are
  permuted accordingly.

### Training and noise

- `dropout { x, p }` — in training each element is kept with probability
  `1 − p` (its draw below `≥ p`) and scaled by `1/(1 − p)`; outside training
  the identity.
- `stop_gradient { x }` — the identity; no gradient flows through it.
- `random_normal { like, keys }`, `random_uniform { like, keys }` — a float
  tensor shaped like `like`, standard normal or uniform on `[0, 1)`. `keys` is
  an option of an integer `[N]`, one key per row of `like` along its leading
  axis (`N = like.shape[0]`; 1 row when `like` has rank 0); `none` keys the
  rows by position `0 .. N−1`.

  **Every draw is a function of the seed, the node, the row's key and the
  element's position in its row**, on every runner and device, whatever the
  batching: a row keyed `k` draws the same values in a batch of one or of a
  thousand. The draws are computed on the CPU in 64-bit integer arithmetic
  and moved to the device. With `mix(z)` SplitMix64's finaliser
  (`z ⊕= z ≫ 30; z ×= 0xBF58476D1CE4E5B9; z ⊕= z ≫ 27; z ×= 0x94D049BB133111EB;
  z ⊕= z ≫ 31`, unsigned 64-bit, logical shifts) and `γ = 0x9E3779B97F4A7C15`:
  - the call's stream is `s = mix(mix(seed ⊕ 0x6A09E667F3BCC909) + (step + 1)·γ)`,
    `step` the training step from 1 (`nn_train`) or 0 (`nn_run`, the
    validation pass);
  - each enclosing `call` node of ordinal `c` (its position in its network's
    `nodes`) refines it, `s ← mix(s + (c + 1)·γ)`, and each enclosing `loop`
    node of ordinal `l` at iteration `i` (from 0) twice, `s ← mix(mix(s +
    (l + 1)·γ) + (i + 1)·γ)`; the drawing node of ordinal `n` makes
    `t = mix(s + (n + 1)·γ)`;
  - the element at position `p` (from 0, row-major within the row) of the row
    keyed `k` has `z = mix(t + k·0xBF58476D1CE4E5B9 + (p + 1)·0x94D049BB133111EB)`:
    its uniform is `(z ≫ 11)·2⁻⁵³`; its normal is Box–Muller's
    `√(−2 ln u₁)·cos(2π u₂)` with `u₁ = ((z ≫ 11) + 1)·2⁻⁵³` and
    `u₂ = (mix(z) ≫ 11)·2⁻⁵³`, in double, then rounded to the tensor's `float`.

  So uniforms are bit-identical across runners and hosts; normals pass
  through `ln` and `cos`, and agree to 1e-6 relative. `dropout` draws its
  keep mask the same way (`uniform ≥ p`), the rows keyed by position.

### Structure

- `call { module, prefix, inputs }` — runs the module named `module`, looked
  up in this network's `modules`, then the enclosing networks' (a loop body
  sees its parents'), with `inputs` binding each module input to an operand
  (every module input, nothing else), its parameters read from the weights
  under `prefix` (§1). The node holds the module's outputs: `node.out`.
- `loop { body, carried, inputs, step, steps }` — `body` is a network;
  `carried` binds some of its inputs to their initial operands and `inputs`
  the rest to operands fixed across iterations (together every body input but
  `step`); `step`, an option, names a body input the loop feeds the iteration
  index as an integer rank-0 tensor. Each iteration evaluates the body and
  carries its output of each carried name into the next. `steps` is
  `fixed: n` (`n ≥ 0` iterations) or `until { output, max }`: iterate until
  the body's boolean rank-0 output `output` is true after an iteration, at
  most `max` times. The node holds the final carried values: `node.name`.

## 5. The platform functions

### `nn_init(net, seed) → weights`

Every weight reachable from the network (§1), drawn in sorted name order from
a generator seeded with `seed`: `zeros`, `ones`, `constant c`; `normal σ`;
`uniform b` on `(−b, b)`; `xavier_uniform` `U(±√(6/(fan_in + fan_out)))`,
`xavier_normal` `N(0, 2/(fan_in + fan_out))`, `kaiming_uniform`
`U(±√(6/fan_in))`, `kaiming_normal` `N(0, 2/fan_in)`, with `fan_in =
shape[1]·∏shape[2:]` and `fan_out = shape[0]·∏shape[2:]` for rank ≥ 2, both
`shape[0]` for rank 1, 1 for rank 0. Both runtimes draw from torch's CPU
generator seeded with `seed`, in the same order and precision, so a seed gives
the same weights on either.

### `nn_train(net, weights, batches, validation_batches, config) → result`

```ts
NnDeviceType = VariantType({ cpu: NullType, cuda: NullType, auto: NullType })   // auto: cuda when available
NnScheduleUnitType = VariantType({ step: NullType, epoch: NullType })
NnTrainConfigType = StructType({
  loss: StringType,
  validation: OptionType(StructType({ value: StringType, weight: OptionType(StringType) })),
  optimizer: VariantType({ adamw: StructType({ lr, beta1, beta2, eps, weight_decay: FloatType }) }),
  schedule: VariantType({ constant: NullType,
                          warmup_cosine: StructType({ warmup_steps: IntegerType, min_lr: FloatType, unit: NnScheduleUnitType }),
                          warmup_linear: StructType({ warmup_steps: IntegerType, unit: NnScheduleUnitType }) }),
  clip_norm: OptionType(FloatType),
  ema: OptionType(StructType({ decay: FloatType, warmup: BooleanType })),
  shuffle: BooleanType,
  epochs: IntegerType, patience: OptionType(IntegerType),
  precision: VariantType({ f32: NullType, bf16: NullType }), seed: IntegerType, device: NnDeviceType,
  recompute: SetType(StringType),
  progress: OptionType(IntegerType),
})
NnTrainResultType = StructType({
  weights: NnWeightsType,
  history: ArrayType(StructType({ epoch: IntegerType, loss: FloatType, validation: OptionType(FloatType), learning_rate: FloatType })),
  best_epoch: IntegerType,
})
```

On both runtimes, the same way:

- **Epochs and steps.** Each epoch runs every batch once in training mode
  (dropout on), one optimiser step each: in order, or with `shuffle` in the
  epoch's own permutation (below). The output `loss` — a float rank-0 tensor —
  is minimised by AdamW over the trainable weights, gradients clipped to
  `clip_norm` when given.
- **Weight decay per parameter.** The trainable weights form one AdamW
  parameter group per distinct `decay` of their parameters (§1), each group's
  decoupled weight decay `weight_decay × decay`: `decay: 1` the optimiser's
  own, `0` none.
- **The schedule** sets the learning rate before each step (`unit: step`, over
  `epochs × batches` steps) or before each epoch (`unit: epoch`, over `epochs`),
  by the index `i` of the step or epoch from 0: `warmup_linear` rises as
  `lr·(i + 1)/warmup_steps` over `warmup_steps` of its unit then holds;
  `warmup_cosine` rises the same way then decays by a cosine to `min_lr` over
  what is left. The history records the rate of the epoch's last step.
- **The shuffle.** With `shuffle`, epoch `e` (from 1) runs the batches in the
  permutation Fisher–Yates draws over the indices `0 .. n−1` from SplitMix64
  seeded with the state `seed + e × 0x9E3779B97F4A7C15` (`seed` as unsigned
  64-bit), in unsigned 64-bit arithmetic: for `i` from `n−1` down to 1, the
  next output `z` (state `+= 0x9E3779B97F4A7C15`; `z = state`; `z = (z ⊕ (z ≫ 30))
  × 0xBF58476D1CE4E5B9`; `z = (z ⊕ (z ≫ 27)) × 0x94D049BB133111EB`; `z ⊕= z ≫ 31`)
  swaps positions `i` and `z mod (i + 1)`. The same permutation on both runners.
- **The average.** With `ema` an exponential moving average of the weights is
  kept, moved after each step as `ema ← d·ema + (1 − d)·w` with `d = decay`,
  or when `warmup` `d = min(decay, (1 + s)/(10 + s))` with `s` the steps taken
  before that one (0 at the first); it is evaluated and returned instead of
  the raw weights.
- **Validation.** After each epoch, when `validation` is given, the output
  `value` is summed over `validation_batches` in evaluation mode and divided
  by the sum of the rank-0 output `weight` (1 per batch when `none`, so a mean
  of the values; a sum of 0 is an error); the random operations of each pass
  draw from a generator seeded afresh with `seed`, so every pass sees the same
  noise. The monitored value is the validation when there is one, else the
  epoch's mean loss, and `patience` epochs without improvement stop training.
- **Batches** are decoded on the host and each moves to the device as its step
  (or its validation pass) comes, so the device holds one batch at a time
  however many there are.
- `history` has one entry per epoch run; `weights` are the best epoch's
  (`best_epoch`, 1-based). `precision: bf16` runs the forward pass under
  autocast with f32 master weights (`float64` tensors are left alone).
  `recompute` names modules whose calls are recomputed in the backward pass
  instead of keeping their activations, on both runtimes (a memory choice,
  never a different answer: the recomputation replays the call's draws).
- **Progress.** With `progress: some(n)` the runtime writes a line to stderr
  every `n` steps — `nn_train: epoch E step S/T loss L` — and one per epoch —
  `nn_train: epoch E/N loss L validation V lr R` (`V` the value or `none`),
  floats printed as python prints them.

### `nn_run(net, weights, batch, outputs, config) → outputs`

```ts
NnRunConfigType = StructType({ device: NnDeviceType, seed: IntegerType, training: BooleanType })
```

Evaluates only the nodes the named outputs need and answers them as a batch
(`NnBatchType`), each output by its name. `training` enables dropout; `seed`
is what every draw's stream starts from (§4, Training and noise, with the
step 0). An input's dtype and rank are checked against
the network's declaration, a weight's shape against its parameter's.

Both runners keep a network's prepared form between calls, keyed by the
network and by the weights' **identity**, not their bytes: each weight's name,
shape and the address and length of its data vector. A Vector is immutable,
so the same vector at the same address holds the same elements, and the cache
retains every vector it keys on so no address is reused while its entry
lives; a weights value built from other vectors (a trained result, a changed
weight) is prepared afresh. So a program calling `nn_run` thousands of times
with one model — a task input read once, or a value kept across calls — pays
the preparation once and O(weights), not O(elements), per call after. `cuda`
is an error on a runtime whose torch build has no CUDA or whose host has no
GPU; `auto` falls back to the CPU.

### `nn_import_torch(blob, names) → weights`, `nn_export_torch(weights, names) → blob`

A torch state dict as weights, and back. `blob` is `torch.save`'s bytes
holding a state dict of float tensors (any float precision; float32 arrives
exactly, the weights at rest being f64); `names` maps a **weight name to its
torch name**. Import gives each tensor to the weights `names` map to its
torch name (a torch name no entry maps keeps itself as the weight name), and
refuses a mapped torch name the state dict lacks, a non-tensor entry and a
non-float tensor. Export writes each weight as a float32 tensor under
`names`' torch name for it (or its own name; two weights mapped to one torch
name are refused), as bytes `torch.load` and `nn_import_torch` read on either
runtime: the python runtime through `torch.save`/`torch.load`, the C runtime
through libtorch's `pickle_save`/`pickle_load`, which read each other's
bytes. float32 → f64 → float32 is exact, so an export of an import holds the
same tensors; an f64 weight that no float32 holds is rounded by the export.

## 6. Errors

Every error names the platform function, then the node where there is one:
`nn_run: node 'h': linear: x has 3 columns but weight has 4`. Both runners
word these the same:

- `'{name}' is defined twice`, `node '{n}' names an unknown operand '{o}'`,
  `node '{n}' uses '{o}' before it is defined`, `unknown output '{o}'`,
  `'{o}' holds several tensors: name one as '{o}.<name>'`;
- `the batch has no input '{i}'`, `input '{i}' has rank {r} but the network
  declares rank {d}`, `input '{i}' is {t} but the network declares {d}`;
- `the weights have no parameter '{w}'`, `parameter '{w}' has shape {s} but
  the network declares {d}`;
- a shape or dtype rule above, broken: `node '{n}': {op}: {what}`.
