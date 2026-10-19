# Neural networks as East data

A neural network is a value of `NetType`: its inputs, its parameters, the
sub-networks it holds, its nodes in dependency order and the outputs it names.
Weights are a `Dict<String, TensorType>` like any other dataset. Three platform
functions run it — `nn_init`, `nn_train`, `nn_run` — on the python runtime
(torch, CPU or GPU) and, for `nn_init` and `nn_run`, on the C runtime
(`east-c-datascience`, CPU). This document is the specification both
interpreters are written to: the types, every operation's shapes and
conventions, and what each function does, so that a network built once gives
the same answers wherever it runs, within floating-point tolerance.

The TypeScript types live in `src/nn/nn.ts` (`NeuralNet.Types`), the python
twins in `east_py_datascience/nn/types.py`; `test/nn.spec.ts` holds every
operation to this document on both runners.

## 1. Types

```ts
NnDTypeType     = VariantType({ float: NullType, integer: NullType, boolean: NullType })
NnInputSpecType = StructType({ dtype: NnDTypeType, rank: IntegerType })
NnInitType      = VariantType({ zeros, ones, constant: FloatType, normal: FloatType /* std */,
                                uniform: FloatType /* bound: U(-b, b) */, xavier_uniform, xavier_normal,
                                kaiming_uniform, kaiming_normal })
NnParamSpecType = StructType({ shape: ArrayType(IntegerType), init: NnInitType, trainable: BooleanType })

TensorType        = StructType({ shape: ArrayType(IntegerType), data: VectorType(FloatType) })    // row-major
IntegerTensorType = StructType({ shape: ArrayType(IntegerType), data: VectorType(IntegerType) })
BooleanTensorType = StructType({ shape: ArrayType(IntegerType), data: VectorType(BooleanType) })
NnValueType       = VariantType({ float: TensorType, integer: IntegerTensorType, boolean: BooleanTensorType })
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

Node dtypes are inferred from the operands' before anything runs:

| operation | operands | result |
|---|---|---|
| `add`, `sub`, `mul` | both float, or both integer | the same |
| `div`, `pow` | float | float |
| `neg`, `abs` | float or integer | the same |
| `exp` … `log1mexp`, `gelu`, `clamp`, `nan_to_num`, `softplus`, `sigmoid`, `tanh`, `relu`, `silu`, `sin`, `cos` | float | float |
| `is_nan` | float | boolean |
| `eq`, `ne` | both of one dtype | boolean |
| `lt`, `le`, `gt`, `ge` | both float or both integer | boolean |
| `logical_not`, `logical_and`, `logical_or` | boolean | boolean |
| `where` | `cond` boolean; `a` and `b` of one dtype | that dtype |
| `cast` | any | the named dtype |
| `constant` | — | its case |
| `gather`, `concat`, `split`, `slice`, `pad`, `reshape`, `permute`, `broadcast` | any (`index` integer; `concat`'s inputs of one dtype) | the operand's |
| `embedding_bag`, `segment_softmax`, `segment_log_softmax` | float (`index`, `segments` integer) | float |
| `segment_reduce` (`sum`, `max`, `min`), `scatter_add` | float or integer | the same |
| `segment_reduce` (`mean`) | float | float |
| `linear`, `einsum`, `conv1d`, `avg_pool1d`, `upsample_nearest`, `layer_norm`, `group_norm`, `attention`, `rotary`, `dropout` | float | float |
| `sum`, `max`, `min`, `cumsum`, `cummax`, `cummin` | float or integer | the same |
| `mean`, `logsumexp`, `softmax`, `log_softmax` | float | float |
| `argmax` | float or integer | integer |
| `stop_gradient` | any | the same |
| `random_normal`, `random_uniform` | `like` any | float |

Casts: integer → float exactly up to 2⁵³; float → integer truncates toward
zero (a non-finite float is an error); boolean → integer or float gives 0 and
1; integer or float → boolean is `≠ 0`.

Float arithmetic is IEEE double on the C runtime and single on torch (`bf16`
inside `nn_train` when configured): two runners agree to tolerance, not bit
for bit. Integer arithmetic is 64-bit, exact, and the same on both.

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
- `constant { value }` — a rank-0 tensor of its case's dtype.
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

`add`, `sub`, `mul`, `div`, `pow { a, b }` and the unary `neg`, `abs`, `exp`,
`log`, `log1p`, `sqrt`, `softplus`, `sigmoid`, `tanh`, `relu`, `silu`, `sin`,
`cos`, `is_nan`, `normal_cdf`, `log_normal_cdf`, `normal_quantile`,
`log1mexp { x }` are IEEE where the function is; `log` of a negative is NaN,
`div` by zero ±∞ or NaN, as in torch. Conventions:

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

  A query with no allowed key outputs zeros. Where a mask is structured the
  python interpreter may evaluate it blockwise rather than through a dense
  `Tq × Tk` mask; the answer is the same.
- `rotary { x, positions, heads, base }` — `x` `[…, T, d]`, `positions`
  integer `[…, T]`, `dh = d/heads` even: per head the halves `x₁ = x[:dh/2]`,
  `x₂ = x[dh/2:]` turn by `θᵢ = positions · base^(−2i/dh)` (`i` in
  `0 .. dh/2−1`): `(x₁cos θ − x₂sin θ, x₂cos θ + x₁sin θ)`.

### Training and noise

- `dropout { x, p }` — in training each element is kept with probability
  `1 − p` and scaled by `1/(1 − p)`; outside training the identity.
- `stop_gradient { x }` — the identity; no gradient flows through it.
- `random_normal { like }`, `random_uniform { like }` — a float tensor shaped
  like `like`, standard normal or uniform on `[0, 1)`, from the runner's
  generator seeded by the call's `seed` (and the training step).

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
`shape[0]` for rank 1, 1 for rank 0. The draws are deterministic for a seed on
one runner; torch's and east-c's generators differ, so the two runners agree
on every shape and on the non-random initialisations, not on random values.

### `nn_train(net, weights, batches, validation_batches, config) → result`

```ts
NnDeviceType = VariantType({ cpu: NullType, cuda: NullType, auto: NullType })   // auto: cuda when available
NnTrainConfigType = StructType({
  loss: StringType, validation: OptionType(StringType),
  optimizer: VariantType({ adamw: StructType({ lr, beta1, beta2, eps, weight_decay: FloatType }) }),
  schedule: VariantType({ constant: NullType, warmup_cosine: StructType({ warmup_steps: IntegerType, min_lr: FloatType }),
                          warmup_linear: StructType({ warmup_steps: IntegerType }) }),
  clip_norm: OptionType(FloatType), ema_decay: OptionType(FloatType),
  epochs: IntegerType, patience: OptionType(IntegerType),
  precision: VariantType({ f32: NullType, bf16: NullType }), seed: IntegerType, device: NnDeviceType,
  recompute: SetType(StringType),
})
NnTrainResultType = StructType({
  weights: NnWeightsType,
  history: ArrayType(StructType({ epoch: IntegerType, loss: FloatType, validation: OptionType(FloatType), learning_rate: FloatType })),
  best_epoch: IntegerType,
})
```

Python only. Each epoch runs every batch once, in order, in training mode
(dropout on): the output `loss` — a float rank-0 tensor — is minimised by
AdamW over the trainable weights, gradients clipped to `clip_norm` when given,
the learning rate following `schedule` per step over `epochs × batches` steps
(`warmup_linear` rises from 0 over `warmup_steps` then holds; `warmup_cosine`
rises then decays by a cosine to `min_lr`). With `ema_decay` an exponential
moving average of the weights is kept, evaluated and returned instead of the
raw weights. After each epoch the `validation` output, when named, is averaged
over `validation_batches` in evaluation mode; the monitored value is the
validation when there is one, else the epoch's mean loss, and `patience`
epochs without improvement stop training. `history` has one entry per epoch
run; `weights` are the best epoch's (`best_epoch`, 1-based). `precision: bf16`
runs the forward pass under autocast with f32 master weights. `recompute`
names modules whose calls are recomputed in the backward pass instead of
keeping their activations.

### `nn_run(net, weights, batch, outputs, config) → outputs`

```ts
NnRunConfigType = StructType({ device: NnDeviceType, seed: IntegerType, training: BooleanType })
```

Evaluates only the nodes the named outputs need and answers them as a batch
(`NnBatchType`), each output by its name. `training` enables dropout; `seed`
seeds the random operations. An input's dtype and rank are checked against
the network's declaration, a weight's shape against its parameter's.

Both runners keep a network's prepared form between calls, keyed by the
network and its weights, so a program calling `nn_run` thousands of times with
one model prepares it once. The C runtime runs on the CPU; a `cuda` device is
an error there (`auto` is the CPU).

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
