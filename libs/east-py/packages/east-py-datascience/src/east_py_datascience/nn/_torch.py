#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The torch interpreter of a network plan (``docs/neural-networks.md`` §4).

Every operation is evaluated in f32 (or under autocast when ``nn_train`` asks
for bf16) with torch's own kernels, so the whole network differentiates for
``nn_train``; shapes are checked here, element types by the plan. Nothing
here touches East values: ``nn_impl`` converts at the boundary.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from typing import TYPE_CHECKING, Any

from east_py_datascience.nn._plan import (
    AXIS_OPS,
    NnError,
    Node,
    Plan,
    collect_weights,
    needed_nodes,
    operands_of,
    split_operand,
)

if TYPE_CHECKING:
    pass

_TORCH_DTYPES = {"float": "float32", "float64": "float64", "integer": "int64", "boolean": "bool"}

# How many (query, key) pairs a key_sets attention gathers at once (spec §4,
# Attention): bounds the working memory of a pairwise pass to a few tens of MB.
KEY_SET_CHUNK = 16384

# The draws' arithmetic (spec §4, Training and noise): SplitMix64's finaliser
# over the seed, the step, the path of calls and loops to the drawing node, the
# row's key and the element's position — the same on every runner and device.
_MASK64 = (1 << 64) - 1
_GAMMA = 0x9E3779B97F4A7C15
_MIX1 = 0xBF58476D1CE4E5B9
_MIX2 = 0x94D049BB133111EB
_SEED_SALT = 0x6A09E667F3BCC909
_M53 = (1 << 53) - 1


def mix64(z: int) -> int:
    """SplitMix64's finaliser, unsigned 64-bit."""
    z &= _MASK64
    z = ((z ^ (z >> 30)) * _MIX1) & _MASK64
    z = ((z ^ (z >> 27)) * _MIX2) & _MASK64
    return z ^ (z >> 31)


def _signed(u: int) -> int:
    """An unsigned 64-bit value as the int64 torch holds it."""
    return u - (1 << 64) if u >= (1 << 63) else u


def _lsr(z: Any, k: int) -> Any:
    """A logical right shift of an int64 tensor."""
    return (z >> k) & ((1 << (64 - k)) - 1)


def mix64_tensor(z: Any) -> Any:
    """SplitMix64's finaliser over an int64 tensor (wrapping arithmetic)."""
    z = (z ^ _lsr(z, 30)) * _signed(_MIX1)
    z = (z ^ _lsr(z, 27)) * _signed(_MIX2)
    return z ^ _lsr(z, 31)


def draw(stream: int, keys: Any, row_elements: int, normal: bool) -> Any:
    """The draws of a node whose stream is `stream` (spec §4): one row per key,
    `row_elements` each, uniform on [0, 1) or standard normal, as f64 on the
    CPU (the caller casts and moves them)."""
    import torch

    n = keys.shape[0]
    if n == 0 or row_elements == 0:
        return torch.zeros((n, row_elements), dtype=torch.float64)
    p = torch.arange(1, row_elements + 1, dtype=torch.int64).unsqueeze(0)
    z = mix64_tensor(keys.to(torch.int64).cpu().unsqueeze(1) * _signed(_MIX1) + p * _signed(_MIX2) + _signed(stream))
    top = _lsr(z, 11)
    if not normal:
        return top.to(torch.float64) * 2.0**-53
    u1 = (top + 1).to(torch.float64) * 2.0**-53
    u2 = _lsr(mix64_tensor(z), 11).to(torch.float64) * 2.0**-53
    return torch.sqrt(-2.0 * torch.log(u1)) * torch.cos(2.0 * math.pi * u2)


def torch_dtype(dtype: str) -> Any:
    import torch

    return getattr(torch, _TORCH_DTYPES[dtype])


def dtype_name(t: Any) -> str:
    """``float``, ``float64``, ``integer`` or ``boolean`` for a tensor (any other floating type is ``float``)."""
    import torch

    if t.dtype == torch.float64:
        return "float64"
    if t.dtype.is_floating_point:
        return "float"
    if t.dtype == torch.bool:
        return "boolean"
    return "integer"


class Interpreter:
    """Evaluates plans over torch tensors.

    Args:
        fn: The platform function's name, for error messages.
        device: The torch device every tensor lives on.
        training: Whether ``dropout`` drops.
        seed: What every draw's stream starts from (spec §4, Training and noise).
        recompute: Module names whose calls are checkpointed (recomputed in the
            backward pass) while training.
        step: The training step from 1, or 0 outside training; settable between steps.
    """

    def __init__(self, fn: str, device: Any, training: bool, seed: int, recompute: frozenset[str] = frozenset(), step: int = 0):
        self.fn = fn
        self.device = device
        self.training = training
        self.seed = int(seed)
        self.recompute = recompute
        self.weights: dict[str, Any] = {}
        self.demand: dict[int, dict[str, set[str | None]]] = {}
        self.path = 0
        self.step = step

    @property
    def step(self) -> int:
        return self._step

    @step.setter
    def step(self, value: int) -> None:
        """The step the draws' streams are refined by; resets the path to the call's root."""
        self._step = int(value)
        self.path = mix64(mix64((self.seed & _MASK64) ^ _SEED_SALT) + (self._step + 1) * _GAMMA)

    def _draw(self, plan: Plan, node: Node, like: Any, keys: Any, normal: bool, bad: Callable[[str], NnError]) -> Any:
        """A tensor shaped like `like` of the node's draws (spec §4, Training and noise)."""
        import torch

        rows = like.shape[0] if like.dim() >= 1 else 1
        row_elements = int(math.prod(like.shape[1:])) if like.dim() >= 1 else 1
        if keys is None:
            keys = torch.arange(rows, dtype=torch.int64)
        elif keys.dim() != 1 or keys.shape[0] != rows:
            raise bad(f"keys must be an integer vector of {rows} entries, one per row of like")
        stream = mix64(self.path + (plan.index[node.name] + 1) * _GAMMA)
        values = draw(stream, keys, row_elements, normal)
        return values.reshape(like.shape).to(dtype=torch.float32, device=like.device)

    # ------------------------------------------------------------------ entry

    def run(self, plan: Plan, weights: dict[str, Any], inputs: dict[str, Any], operands: list[str]) -> dict[str, Any]:
        """The tensors the operands name, given the batch's inputs (checked
        against the plan) and the prepared weights."""
        self.weights = weights
        for name, spec in plan.inputs.items():
            if name not in inputs:
                raise NnError(f"{self.fn}: the batch has no input '{name}'")
            t = inputs[name]
            if dtype_name(t) != spec.dtype:
                raise NnError(f"{self.fn}: input '{name}' is {dtype_name(t)} but the network declares {spec.dtype}")
            if t.dim() != spec.rank:
                raise NnError(f"{self.fn}: input '{name}' has rank {t.dim()} but the network declares rank {spec.rank}")
        return self._eval(plan, inputs, "", operands)

    # ------------------------------------------------------------- evaluation

    def _eval(self, plan: Plan, bound: dict[str, Any], prefix: str, operands: list[str]) -> dict[str, Any]:
        env: dict[str, Any] = dict(bound)
        for name in plan.params:
            full = prefix + name
            if full not in self.weights:
                raise NnError(f"{self.fn}: the weights have no parameter '{full}'")
            env[name] = self.weights[full]
        wanted = self._wanted(plan, operands)
        for node in needed_nodes(plan, operands):
            env[node.name] = self._node(plan, node, env, prefix, wanted.get(node.name, set()))
        return {operand: self._get(env, operand) for operand in operands}

    @staticmethod
    def _wanted(plan: Plan, operands: list[str]) -> dict[str, set[str | None]]:
        """Which tensors of each many-tensor node are demanded (``None``: its one)."""
        wanted: dict[str, set[str | None]] = {}
        stack = list(operands)
        seen: set[str] = set()
        while stack:
            operand = stack.pop()
            head, sub = split_operand(operand)
            if head not in plan.index:
                continue
            wanted.setdefault(head, set()).add(sub)
            if head in seen:
                continue
            seen.add(head)
            stack.extend(operands_of(plan.nodes[plan.index[head]]))
        return wanted

    def _get(self, env: dict[str, Any], operand: str) -> Any:
        head, sub = split_operand(operand)
        value = env[head]
        if isinstance(value, dict):
            if sub is None:
                if len(value) == 1:
                    return next(iter(value.values()))
                raise NnError(f"{self.fn}: '{head}' holds several tensors: name one as '{head}.<name>'")
            return value[sub]
        return value

    # ------------------------------------------------------------------- nodes

    def _node(self, plan: Plan, node: Node, env: dict[str, Any], prefix: str, wanted: set[str | None]) -> Any:
        import torch
        import torch.nn.functional as F

        op, a = node.op, node.args

        def bad(what: str) -> NnError:
            return NnError(f"{self.fn}: node '{node.name}': {op}: {what}")

        def g(field_name: str) -> Any:
            return self._get(env, a[field_name])

        def opt(field_name: str) -> Any:
            return None if a[field_name] is None else self._get(env, a[field_name])

        def axis_of(t: Any, axis: int) -> int:
            if not -t.dim() <= axis < t.dim():
                raise bad(f"axis {axis} is outside a rank of {t.dim()}")
            return axis % t.dim()

        if op == "call":
            return self._call(plan, node, env, prefix, wanted, bad)
        if op == "loop":
            return self._loop(plan, node, env, prefix, bad)

        # ---- indexing and layout
        if op == "gather":
            table, index = g("table"), g("index")
            if table.dim() == 0:
                raise bad("table must have a first dimension")
            self._check_index(index, table.shape[0], bad, "index")
            return table[index]
        if op == "take_along":
            x, index = g("x"), g("index")
            if x.dim() == 0:
                raise bad("x must have an axis")
            axis = axis_of(x, a["axis"])
            if index.dim() != x.dim():
                raise bad(f"index has rank {index.dim()} but x has rank {x.dim()}")
            for k in range(x.dim()):
                if k != axis and index.shape[k] != x.shape[k]:
                    raise bad(f"index is shaped {list(index.shape)} but x is {list(x.shape)}: they differ off the axis")
            self._check_index(index, x.shape[axis], bad, "index")
            return torch.gather(x, axis, index)
        if op == "mask_select":
            x, mask = g("x"), g("mask")
            if x.dim() < 1 or mask.dim() != 1 or mask.shape[0] != x.shape[0]:
                raise bad("mask is a boolean vector with one entry per row of x")
            return x[mask]
        if op == "mask_indices":
            mask = g("mask")
            if mask.dim() != 1:
                raise bad("mask is a boolean vector")
            return torch.nonzero(mask).reshape(-1)
        if op == "repeat":
            x, counts = g("x"), g("counts")
            if x.dim() < 1 or counts.dim() != 1 or counts.shape[0] != x.shape[0]:
                raise bad("counts is an integer vector with one entry per row of x")
            if counts.numel() > 0 and bool((counts < 0).any()):
                raise bad("counts must not be negative")
            return torch.repeat_interleave(x, counts, dim=0)
        if op == "range":
            stop = g("stop")
            if stop.dim() != 0:
                raise bad("stop must be an integer of rank 0")
            return torch.arange(int(a["start"]), int(stop.item()), int(a["step"]), dtype=torch.int64, device=self.device)
        if op == "searchsorted":
            sorted_t, values = g("sorted"), g("values")
            if sorted_t.dim() != 1:
                raise bad("sorted is a vector")
            return torch.searchsorted(sorted_t, values, right=bool(a["right"]))
        if op == "embedding_bag":
            table, index, segments, size = g("table"), g("index"), g("segments"), g("size")
            weights = opt("weights")
            if table.dim() < 1 or index.dim() != 1 or segments.dim() != 1:
                raise bad("table has a first dimension, index and segments are vectors")
            if index.shape[0] != segments.shape[0]:
                raise bad(f"index has {index.shape[0]} entries but segments has {segments.shape[0]}")
            if weights is not None and tuple(weights.shape) != (index.shape[0],):
                raise bad(f"weights must have {index.shape[0]} entries")
            n_seg = self._segments(size, bad)
            self._check_index(index, table.shape[0], bad, "index")
            self._check_index(segments, n_seg, bad, "segments")
            rows = table[index]
            if weights is not None:
                rows = rows * weights.reshape(-1, *([1] * (rows.dim() - 1)))
            out = torch.zeros((n_seg, *table.shape[1:]), dtype=table.dtype, device=table.device)
            return out.index_add(0, segments, rows)
        if op == "segment_reduce":
            x, segments, size = g("x"), g("segments"), g("size")
            reduce = a["reduce"][0]
            if x.dim() < 1 or segments.dim() != 1 or segments.shape[0] != x.shape[0]:
                raise bad("segments is a vector with one id per row of x")
            n_seg = self._segments(size, bad)
            self._check_index(segments, n_seg, bad, "segments")
            out = torch.zeros((n_seg, *x.shape[1:]), dtype=x.dtype, device=x.device)
            if reduce == "sum":
                return out.index_add(0, segments, x)
            if reduce == "mean":
                total = out.index_add(0, segments, x)
                counts = torch.bincount(segments, minlength=n_seg).to(x.dtype).clamp(min=1)
                return total / counts.reshape(-1, *([1] * (x.dim() - 1)))
            idx = segments.reshape(-1, *([1] * (x.dim() - 1))).expand_as(x)
            return out.scatter_reduce(0, idx, x, reduce="amax" if reduce == "max" else "amin", include_self=False)
        if op in ("segment_softmax", "segment_log_softmax"):
            x, segments = g("x"), g("segments")
            if x.dim() < 1 or segments.dim() != 1 or segments.shape[0] != x.shape[0]:
                raise bad("segments is a vector with one id per row of x")
            if x.shape[0] == 0:
                return x
            if bool((segments < 0).any()):
                raise bad("a segment id is negative")
            n_seg = int(segments.max().item()) + 1
            idx = segments.reshape(-1, *([1] * (x.dim() - 1))).expand_as(x)
            seg_max = torch.zeros((n_seg, *x.shape[1:]), dtype=x.dtype, device=x.device).scatter_reduce(
                0, idx, x.detach(), reduce="amax", include_self=False
            )
            shifted = x - seg_max[segments]
            e = torch.exp(shifted)
            seg_sum = torch.zeros((n_seg, *x.shape[1:]), dtype=x.dtype, device=x.device).index_add(0, segments, e)
            if op == "segment_softmax":
                return e / seg_sum[segments]
            return shifted - torch.log(seg_sum[segments])
        if op == "scatter_add":
            x, index, size = g("x"), g("index"), g("size")
            if x.dim() < 1 or index.dim() != 1 or index.shape[0] != x.shape[0]:
                raise bad("index is a vector with one entry per row of x")
            n_seg = self._segments(size, bad)
            self._check_index(index, n_seg, bad, "index")
            out = torch.zeros((n_seg, *x.shape[1:]), dtype=x.dtype, device=x.device)
            return out.index_add(0, index, x)
        if op == "concat":
            xs = [self._get(env, name) for name in a["inputs"]]
            ranks = {x.dim() for x in xs}
            if len(ranks) != 1:
                raise bad("inputs must have one rank")
            axis = axis_of(xs[0], a["axis"])
            for x in xs[1:]:
                if [d for i, d in enumerate(x.shape) if i != axis] != [d for i, d in enumerate(xs[0].shape) if i != axis]:
                    raise bad("inputs must agree in every dimension but the axis")
            return torch.cat(xs, axis)
        if op == "split":
            x = g("x")
            axis = axis_of(x, a["axis"])
            sizes = [int(s) for s in a["sizes"]]
            if sum(sizes) != x.shape[axis]:
                raise bad(f"sizes sum to {sum(sizes)} but the axis has {x.shape[axis]}")
            return torch.split(x, sizes, axis)[int(a["part"])]
        if op == "slice":
            x = g("x")
            axis = axis_of(x, a["axis"])
            window: list[Any] = [slice(None)] * x.dim()
            window[axis] = slice(int(a["start"]), None if a["stop"] is None else int(a["stop"]))
            return x[tuple(window)]
        if op == "pad":
            x = g("x")
            axis = axis_of(x, a["axis"])
            before, after = int(a["before"]), int(a["after"])
            if a["mode"][0] == "zeros":
                pads = [0, 0] * (x.dim() - 1 - axis) + [before, after]
                if x.dtype == torch.bool:
                    return F.pad(x.to(torch.uint8), pads).bool()
                return F.pad(x, pads)
            n = x.shape[axis]
            if n == 0:
                raise bad("an empty axis cannot be replicated")
            index_t = torch.arange(-before, n + after, device=x.device).clamp(0, n - 1)
            return x.index_select(axis, index_t)
        if op == "reshape":
            x = g("x")
            try:
                return x.reshape([int(d) for d in a["shape"]])
            except RuntimeError as e:
                raise bad(f"cannot reshape {list(x.shape)} to {list(a['shape'])}") from e
        if op == "permute":
            x = g("x")
            if len(a["axes"]) != x.dim():
                raise bad(f"axes has {len(a['axes'])} entries but the rank is {x.dim()}")
            return x.permute([int(d) for d in a["axes"]])
        if op == "broadcast":
            x, like = g("x"), g("like")
            try:
                return torch.broadcast_to(x, like.shape)
            except RuntimeError as e:
                raise bad(f"cannot broadcast {list(x.shape)} to {list(like.shape)}") from e
        if op == "where":
            return self._broadcast3(torch.where, g("cond"), g("a"), g("b"), bad)
        if op == "constant":
            tag, value = a["value"]
            return torch.tensor(value, dtype=torch_dtype(tag), device=self.device)
        if op == "cast":
            x = g("x")
            target = a["dtype"][0]
            if target == "boolean":
                return x != 0
            if target == "integer" and x.dtype.is_floating_point:
                if not bool(torch.isfinite(x).all()):
                    raise bad("cannot cast a non-finite float to integer")
                return x.trunc().to(torch.int64)
            return x.to(torch_dtype(target))

        # ---- dense
        if op == "linear":
            x, w, b = g("x"), g("weight"), opt("bias")
            if x.dim() < 1 or w.dim() != 2:
                raise bad("x has a last dimension and weight is a matrix [out, in]")
            if x.shape[-1] != w.shape[1]:
                raise bad(f"x has {x.shape[-1]} columns but weight has {w.shape[1]}")
            if b is not None and tuple(b.shape) != (w.shape[0],):
                raise bad(f"bias must have {w.shape[0]} entries")
            return F.linear(x, w, b)
        if op == "einsum":
            xs = [self._get(env, name) for name in a["inputs"]]
            try:
                return torch.einsum(a["subscripts"], *xs)
            except RuntimeError as e:
                raise bad(str(e).splitlines()[0]) from e
        if op == "conv1d":
            x, w, b = g("x"), g("weight"), opt("bias")
            if x.dim() != 3 or w.dim() != 3:
                raise bad("x is [N, C_in, L] and weight is [C_out, C_in/groups, K]")
            groups = int(a["groups"])
            if x.shape[1] != w.shape[1] * groups or w.shape[0] % groups:
                raise bad(f"x has {x.shape[1]} channels but weight takes {w.shape[1]} × {groups} groups")
            length = (x.shape[2] - int(a["dilation"]) * (w.shape[2] - 1) - 1) // int(a["stride"]) + 1
            if length < 0:
                raise bad(f"the kernel does not fit a length of {x.shape[2]}")
            return F.conv1d(x, w, b, stride=int(a["stride"]), dilation=int(a["dilation"]), groups=groups)
        if op == "avg_pool1d":
            x = g("x")
            if x.dim() != 3:
                raise bad("x is [N, C, L]")
            if x.shape[2] < int(a["kernel"]):
                raise bad(f"the kernel does not fit a length of {x.shape[2]}")
            return F.avg_pool1d(x, int(a["kernel"]), int(a["stride"]))
        if op == "upsample_nearest":
            x = g("x")
            if x.dim() < 1:
                raise bad("x has a last dimension")
            return x.repeat_interleave(int(a["scale"]), dim=-1)
        if op == "layer_norm":
            x, w, b = g("x"), opt("weight"), opt("bias")
            if x.dim() < 1:
                raise bad("x has a last dimension")
            d = x.shape[-1]
            for name, t in (("weight", w), ("bias", b)):
                if t is not None and tuple(t.shape) != (d,):
                    raise bad(f"{name} must have {d} entries")
            return F.layer_norm(x, (d,), w, b, float(a["eps"]))
        if op == "group_norm":
            x, w, b = g("x"), opt("weight"), opt("bias")
            if x.dim() < 2:
                raise bad("x is [N, C, ...]")
            groups = int(a["groups"])
            if x.shape[1] % groups:
                raise bad(f"{x.shape[1]} channels are not a multiple of {groups} groups")
            for name, t in (("weight", w), ("bias", b)):
                if t is not None and tuple(t.shape) != (x.shape[1],):
                    raise bad(f"{name} must have {x.shape[1]} entries")
            return F.group_norm(x, groups, w, b, float(a["eps"]))

        # ---- element-wise
        if op in ("add", "sub", "mul", "div", "pow", "eq", "ne", "lt", "le", "gt", "ge", "logical_and", "logical_or"):
            fns: dict[str, Callable[..., Any]] = {
                "add": torch.add, "sub": torch.sub, "mul": torch.mul, "div": torch.div, "pow": torch.pow,
                "eq": torch.eq, "ne": torch.ne, "lt": torch.lt, "le": torch.le, "gt": torch.gt, "ge": torch.ge,
                "logical_and": torch.logical_and, "logical_or": torch.logical_or,
            }
            return self._broadcast2(fns[op], g("a"), g("b"), bad)
        if op == "remainder":
            x, y = g("a"), g("b")
            if not x.dtype.is_floating_point and y.numel() > 0 and bool((y == 0).any()):
                raise bad("integer division by zero")
            return self._broadcast2(torch.remainder, x, y, bad)
        if op == "neg":
            return -g("x")
        if op == "abs":
            return g("x").abs()
        if op == "floor":
            return torch.floor(g("x"))
        if op == "ceil":
            return torch.ceil(g("x"))
        if op == "round":
            return torch.round(g("x"))
        if op == "exp":
            return torch.exp(g("x"))
        if op == "log":
            return torch.log(g("x"))
        if op == "log1p":
            return torch.log1p(g("x"))
        if op == "sqrt":
            return torch.sqrt(g("x"))
        if op == "softplus":
            return F.softplus(g("x"))
        if op == "sigmoid":
            return torch.sigmoid(g("x"))
        if op == "tanh":
            return torch.tanh(g("x"))
        if op == "relu":
            return F.relu(g("x"))
        if op == "gelu":
            return F.gelu(g("x"), approximate="tanh" if a["approximate"][0] == "tanh" else "none")
        if op == "silu":
            return F.silu(g("x"))
        if op == "clamp":
            return torch.clamp(g("x"), min=a["min"], max=a["max"])
        if op == "sin":
            return torch.sin(g("x"))
        if op == "cos":
            return torch.cos(g("x"))
        if op == "nan_to_num":
            return torch.nan_to_num(g("x"), nan=float(a["nan"]), posinf=float(a["posinf"]), neginf=float(a["neginf"]))
        if op == "is_nan":
            return torch.isnan(g("x"))
        if op == "normal_cdf":
            return torch.special.ndtr(g("x"))
        if op == "log_normal_cdf":
            return torch.special.log_ndtr(g("x"))
        if op == "normal_quantile":
            return torch.special.ndtri(g("x"))
        if op == "log1mexp":
            x = g("x")
            return torch.where(x > -math.log(2.0), torch.log(-torch.expm1(x)), torch.log1p(-torch.exp(x)))
        if op == "logical_not":
            return torch.logical_not(g("x"))

        # ---- along an axis
        if op in AXIS_OPS:
            x = g("x")
            if x.dim() == 0:
                raise bad("x must have an axis")
            axis = axis_of(x, a["axis"])
            if op in ("max", "min", "argmax") and x.shape[axis] == 0:
                raise bad("the axis is empty")
            if op == "sum":
                return x.sum(axis)
            if op == "mean":
                return x.mean(axis) if x.shape[axis] > 0 else x.sum(axis)
            if op == "max":
                return x.amax(axis)
            if op == "min":
                return x.amin(axis)
            if op == "logsumexp":
                return torch.logsumexp(x, axis)
            if op == "softmax":
                return torch.softmax(x, axis)
            if op == "log_softmax":
                return torch.log_softmax(x, axis)
            if op == "cumsum":
                return x.cumsum(axis)
            if op == "cummax":
                return x.cummax(axis).values
            if op == "cummin":
                return x.cummin(axis).values
            if op == "argmax":
                return x.argmax(axis)

        # ---- attention
        if op == "attention":
            return self._attention(a, env, bad)
        if op == "rotary":
            x, positions = g("x"), g("positions")
            heads = int(a["heads"])
            if x.dim() < 2:
                raise bad("x is [..., T, d]")
            d = x.shape[-1]
            if d % heads:
                raise bad(f"d = {d} is not a multiple of heads = {heads}")
            dh = d // heads
            if dh % 2:
                raise bad(f"the head dimension {dh} is odd")
            if tuple(positions.shape) != tuple(x.shape[:-1]):
                raise bad(f"positions must be shaped {list(x.shape[:-1])}")
            half = dh // 2
            inv = float(a["base"]) ** (-torch.arange(half, device=x.device, dtype=x.dtype) * 2.0 / dh)
            angle = positions.to(x.dtype).unsqueeze(-1) * inv
            cos = angle.cos().unsqueeze(-2)
            sin = angle.sin().unsqueeze(-2)
            xh = x.reshape(*x.shape[:-1], heads, dh)
            if a["convention"][0] == "interleaved":
                pairs = xh.reshape(*x.shape[:-1], heads, half, 2)
                x1, x2 = pairs[..., 0], pairs[..., 1]
                out = torch.stack([x1 * cos - x2 * sin, x2 * cos + x1 * sin], -1)
                return out.reshape(x.shape)
            x1, x2 = xh[..., :half], xh[..., half:]
            out = torch.cat([x1 * cos - x2 * sin, x2 * cos + x1 * sin], -1)
            return out.reshape(x.shape)

        # ---- training and noise
        if op == "dropout":
            x = g("x")
            if not self.training:
                return x
            p = float(a["p"])
            keep = self._draw(plan, node, x, None, False, bad) >= p
            return x * keep.to(x.dtype) / (1.0 - p)
        if op == "stop_gradient":
            return g("x").detach()
        if op in ("random_normal", "random_uniform"):
            like = g("like")
            return self._draw(plan, node, like, opt("keys"), op == "random_normal", bad)
        raise bad("unknown operation")

    # ---------------------------------------------------------------- helpers

    def _check_index(self, index: Any, n: int, bad: Callable[[str], NnError], what: str) -> None:
        if index.numel() == 0:
            return
        lo, hi = int(index.min().item()), int(index.max().item())
        if lo < 0 or hi >= n:
            raise bad(f"{what} {lo if lo < 0 else hi} is outside 0 .. {n - 1}")

    @staticmethod
    def _segments(size: Any, bad: Callable[[str], NnError]) -> int:
        if size.dim() == 0:
            raise bad("size must have a first dimension: the number of segments")
        return int(size.shape[0])

    @staticmethod
    def _broadcast2(f: Callable[..., Any], x: Any, y: Any, bad: Callable[[str], NnError]) -> Any:
        try:
            return f(x, y)
        except RuntimeError as e:
            raise bad(f"cannot broadcast {list(x.shape)} with {list(y.shape)}") from e

    @staticmethod
    def _broadcast3(f: Callable[..., Any], x: Any, y: Any, z: Any, bad: Callable[[str], NnError]) -> Any:
        try:
            return f(x, y, z)
        except RuntimeError as e:
            raise bad(f"cannot broadcast {list(x.shape)}, {list(y.shape)} and {list(z.shape)}") from e

    def _attention(self, a: dict[str, Any], env: dict[str, Any], bad: Callable[[str], NnError]) -> Any:
        import torch

        q, k, v = self._get(env, a["q"]), self._get(env, a["k"]), self._get(env, a["v"])
        heads = int(a["heads"])
        bias = None if a["bias"] is None else self._get(env, a["bias"])
        if q.dim() < 2 or k.dim() != q.dim() or v.dim() != q.dim():
            raise bad("q, k and v have one rank of at least 2")
        d = q.shape[-1]
        if d % heads:
            raise bad(f"d = {d} is not a multiple of heads = {heads}")
        if k.shape[-1] != d or v.shape[-1] != d:
            raise bad("q, k and v share their last dimension")
        if k.shape[-2] != v.shape[-2]:
            raise bad("k and v have the same number of keys")
        if tuple(q.shape[:-2]) != tuple(k.shape[:-2]) or tuple(q.shape[:-2]) != tuple(v.shape[:-2]):
            raise bad("q, k and v share their leading dimensions")
        dh = d // heads
        lead, tq, tk = tuple(q.shape[:-2]), q.shape[-2], k.shape[-2]
        scale = 1.0 / math.sqrt(dh) if a["scale"] is None else float(a["scale"])
        mask = a["mask"]
        tag = None if mask is None else mask[0]
        payload = None if mask is None else mask[1]

        # The structured masks without a bias run in memory proportional to the
        # allowed pairs (spec §4, Attention); everything else through dense scores.
        if tag == "segments" and bias is None:
            ids = self._segment_ids(payload, env, lead, tq, tk, bad)
            return self._attention_segments(q, k, v, heads, dh, ids, bool(payload["causal"]), scale)
        if tag == "key_sets" and bias is None:
            ptr, keys = self._key_sets(payload, env, lead, tq, tk, bad)
            return self._attention_key_sets(q, k, v, heads, dh, ptr, keys, scale)

        allowed = self._mask(tag, payload, env, lead, tq, tk, q.device, bad)
        qh = q.reshape(*lead, tq, heads, dh).transpose(-3, -2)
        kh = k.reshape(*lead, tk, heads, dh).transpose(-3, -2)
        vh = v.reshape(*lead, tk, heads, dh).transpose(-3, -2)
        scores = torch.matmul(qh, kh.transpose(-1, -2)) * scale
        if bias is not None:
            try:
                scores = scores + bias
            except RuntimeError as e:
                raise bad(f"cannot broadcast the bias {list(bias.shape)} to {list(scores.shape)}") from e
        if allowed is not None:
            any_allowed = allowed.any(-1)
            blocked = torch.logical_not(allowed) & any_allowed.unsqueeze(-1)
            scores = scores.masked_fill(blocked.unsqueeze(-3), float("-inf"))
        probs = torch.softmax(scores, -1)
        out = torch.matmul(probs, vh)
        if allowed is not None:
            out = out * any_allowed.unsqueeze(-2).unsqueeze(-1).to(out.dtype)
        return out.transpose(-3, -2).reshape(*lead, tq, d)

    def _segment_ids(
        self, payload: Any, env: dict[str, Any], lead: tuple[int, ...], tq: int, tk: int, bad: Callable[[str], NnError],
    ) -> Any:
        """A segments mask's ids, checked: shaped like the tokens, with Tq = Tk."""
        ids = self._get(env, payload["ids"])
        if tuple(ids.shape) != (*lead, tq) or tq != tk:
            raise bad(f"the mask's ids must be shaped {[*lead, tq]} with Tq = Tk")
        return ids

    def _key_sets(
        self, payload: Any, env: dict[str, Any], lead: tuple[int, ...], tq: int, tk: int, bad: Callable[[str], NnError],
    ) -> tuple[Any, Any]:
        """A key_sets mask's ptr and keys, checked: unbatched, CSR from 0, every
        key in range and no key listed twice for one query."""
        import torch

        ptr, keys = self._get(env, payload["ptr"]), self._get(env, payload["keys"])
        if lead:
            raise bad("a key_sets mask takes unbatched q, k and v")
        if ptr.dim() != 1 or ptr.shape[0] != tq + 1:
            raise bad(f"the mask's ptr must have {tq + 1} entries")
        if tq > 0 and (int(ptr[0].item()) != 0 or bool((ptr[1:] < ptr[:-1]).any())):
            raise bad("the mask's ptr must start at 0 and not decrease")
        total = int(ptr[-1].item()) if tq > 0 else 0
        if keys.dim() != 1 or keys.shape[0] != total:
            raise bad(f"the mask's keys must have {total} entries, ptr's last")
        self._check_index(keys, tk, bad, "the mask's key")
        if total > 1:
            qi = torch.repeat_interleave(torch.arange(tq, device=keys.device), ptr[1:] - ptr[:-1])
            pairs = torch.sort(qi * tk + keys).values
            twice = pairs[1:] == pairs[:-1]
            if bool(twice.any()):
                p = int(pairs[1:][twice][0].item())
                raise bad(f"the mask lists key {p % tk} twice for query {p // tk}")
        return ptr, keys

    def _mask(
        self, tag: str | None, payload: Any, env: dict[str, Any], lead: tuple[int, ...], tq: int, tk: int, device: Any,
        bad: Callable[[str], NnError],
    ) -> Any:
        """The dense boolean mask `[…, Tq, Tk]` (`None` for every key)."""
        import torch

        if tag is None or tag == "none":
            return None
        if tag == "causal":
            if tq != tk:
                raise bad("a causal mask needs Tq = Tk")
            return torch.ones(tq, tk, dtype=torch.bool, device=device).tril()
        if tag == "segments":
            ids = self._segment_ids(payload, env, lead, tq, tk, bad)
            allowed = ids.unsqueeze(-1) == ids.unsqueeze(-2)
            if payload["causal"]:
                allowed = allowed & torch.ones(tq, tk, dtype=torch.bool, device=device).tril()
            return allowed
        if tag == "key_sets":
            ptr, keys = self._key_sets(payload, env, lead, tq, tk, bad)
            allowed = torch.zeros(tq, tk, dtype=torch.bool, device=device)
            if keys.shape[0] > 0:
                qi = torch.repeat_interleave(torch.arange(tq, device=device), ptr[1:] - ptr[:-1])
                allowed[qi, keys] = True
            return allowed
        raise bad(f"unknown mask '{tag}'")

    @staticmethod
    def _attention_segments(q: Any, k: Any, v: Any, heads: int, dh: int, ids: Any, causal: bool, scale: float) -> Any:
        """Attention within the groups of equal ids (in any order, across any
        leading dimensions), each bucket of groups padded to the next power of
        two and run through the fused kernel: what the dense mask answers, in
        memory proportional to the allowed pairs (spec §4, Attention)."""
        import torch
        import torch.nn.functional as F

        t, d = q.shape[-2], q.shape[-1]
        qf, kf, vf = q.reshape(-1, d), k.reshape(-1, d), v.reshape(-1, d)
        n = qf.shape[0]
        if n == 0:
            return torch.zeros_like(q)
        device = q.device
        arange = torch.arange(n, device=device)
        # one group per (leading index, id): the ids shifted to be non-negative
        # so a group key orders by the leading index first
        flat_ids = ids.reshape(-1)
        shifted = flat_ids - flat_ids.min()
        key = (arange // t) * (int(shifted.max().item()) + 1) + shifted
        _, group = torch.unique(key, return_inverse=True)
        counts = torch.bincount(group)
        order = torch.argsort(group, stable=True)  # tokens by group, each group in token order
        starts = torch.cumsum(counts, 0) - counts
        group_in_order = group[order]
        pos = arange - starts[group_in_order]
        # each group's bucket: its length rounded up to a power of two
        buckets = {}
        for length in set(counts.tolist()):
            width = 1
            while width < length:
                width *= 2
            buckets.setdefault(width, []).append(length)
        local_of_group = torch.full((counts.shape[0],), -1, dtype=torch.int64, device=device)
        indices, rows = [], []
        for width, lengths in sorted(buckets.items()):
            in_bucket = torch.zeros_like(counts, dtype=torch.bool)
            for length in lengths:
                in_bucket |= counts == length
            groups = torch.nonzero(in_bucket).reshape(-1)
            local_of_group.fill_(-1)
            local_of_group[groups] = torch.arange(groups.shape[0], device=device)
            local = local_of_group[group_in_order]
            sel = local >= 0
            padded = torch.full((groups.shape[0], width), -1, dtype=torch.int64, device=device)
            padded[local[sel], pos[sel]] = order[sel]
            valid = padded >= 0
            safe = padded.clamp(min=0)
            qp = qf[safe].reshape(groups.shape[0], width, heads, dh).transpose(1, 2)
            kp = kf[safe].reshape(groups.shape[0], width, heads, dh).transpose(1, 2)
            vp = vf[safe].reshape(groups.shape[0], width, heads, dh).transpose(1, 2)
            attend = valid[:, None, None, :]
            if causal:
                attend = attend & torch.ones(width, width, dtype=torch.bool, device=device).tril()[None, None]
            # a padded query attends everywhere (finite, then dropped) so no row is empty
            attend = attend | torch.logical_not(valid)[:, None, :, None]
            out = F.scaled_dot_product_attention(qp, kp, vp, attn_mask=attend, scale=scale)
            rows.append(out.transpose(1, 2).reshape(groups.shape[0], width, d)[valid])
            indices.append(padded[valid])
        back = torch.argsort(torch.cat(indices))
        return torch.cat(rows)[back].reshape(q.shape)

    @staticmethod
    def _attention_key_sets(q: Any, k: Any, v: Any, heads: int, dh: int, ptr: Any, keys: Any, scale: float) -> Any:
        """Attention over the listed (query, key) pairs: each pair scored by a
        gathered dot product in chunks, the softmax by segment operations over
        the query, the values summed by index — what the dense mask answers,
        in memory proportional to the pairs (spec §4, Attention)."""
        import torch

        tq, d = q.shape
        tk = k.shape[0]
        total = keys.shape[0]
        out = torch.zeros(tq, heads, dh, dtype=q.dtype, device=q.device)
        if total == 0:
            return out.reshape(tq, d)
        qi = torch.repeat_interleave(torch.arange(tq, device=q.device), ptr[1:] - ptr[:-1])
        qh, kh, vh = q.reshape(tq, heads, dh), k.reshape(tk, heads, dh), v.reshape(tk, heads, dh)
        chunks = range(0, total, KEY_SET_CHUNK)
        scores = torch.empty(total, heads, dtype=q.dtype, device=q.device)
        for c in chunks:
            scores[c:c + KEY_SET_CHUNK] = (qh[qi[c:c + KEY_SET_CHUNK]] * kh[keys[c:c + KEY_SET_CHUNK]]).sum(-1) * scale
        seg_max = torch.zeros(tq, heads, dtype=q.dtype, device=q.device).scatter_reduce(
            0, qi.unsqueeze(-1).expand(-1, heads), scores.detach(), reduce="amax", include_self=False
        )
        if torch.is_grad_enabled():
            e = torch.exp(scores - seg_max[qi])
            seg_sum = torch.zeros(tq, heads, dtype=q.dtype, device=q.device).index_add(0, qi, e)
            probs = e / seg_sum[qi]
        else:
            # inference: the softmax in place, so two [pairs, heads] tensors live at most
            scores.sub_(seg_max[qi]).exp_()
            seg_sum = torch.zeros(tq, heads, dtype=q.dtype, device=q.device).index_add(0, qi, scores)
            probs = scores.div_(seg_sum[qi])
        for c in chunks:
            weighted = probs[c:c + KEY_SET_CHUNK].unsqueeze(-1) * vh[keys[c:c + KEY_SET_CHUNK]]
            out = out.index_add(0, qi[c:c + KEY_SET_CHUNK], weighted)
        return out.reshape(tq, d)

    def _call(
        self, plan: Plan, node: Node, env: dict[str, Any], prefix: str, wanted: set[str | None],
        bad: Callable[[str], NnError],
    ) -> dict[str, Any]:
        import torch

        a = node.args
        module = plan.find_module(a["module"])
        assert module is not None
        bound = {}
        for name, operand in a["inputs"].items():
            t = self._get(env, operand)
            spec = module.inputs[name]
            if t.dim() != spec.rank:
                raise bad(f"input '{name}' has rank {t.dim()} but the module declares rank {spec.rank}")
            bound[name] = t
        outputs = list(module.outputs) if None in wanted or not wanted else [s for s in wanted if s is not None]
        for out in outputs:
            if out not in module.outputs:
                raise bad(f"the module has no output '{out}'")
        operands = [module.outputs[out] for out in outputs]
        sub_prefix = prefix + a["prefix"] + "."
        # the call refines the draws' stream for everything inside it (spec §4)
        outer = self.path
        inner = mix64(outer + (plan.index[node.name] + 1) * _GAMMA)
        try:
            if self.training and a["module"] in self.recompute and torch.is_grad_enabled():
                from torch.utils.checkpoint import checkpoint

                names = list(bound)

                def recomputed(*tensors: Any) -> tuple[Any, ...]:
                    saved = self.path
                    self.path = inner
                    try:
                        values = self._eval(module, dict(zip(names, tensors, strict=True)), sub_prefix, operands)
                    finally:
                        self.path = saved
                    return tuple(values[o] for o in operands)

                results = checkpoint(recomputed, *[bound[n] for n in names], use_reentrant=False)
                return dict(zip(outputs, results, strict=True))
            self.path = inner
            values = self._eval(module, bound, sub_prefix, operands)
        finally:
            self.path = outer
        return {out: values[module.outputs[out]] for out in outputs}

    def _loop(self, plan: Plan, node: Node, env: dict[str, Any], prefix: str, bad: Callable[[str], NnError]) -> dict[str, Any]:
        import torch

        a = node.args
        body: Plan = a["body"]
        carried = {name: self._get(env, operand) for name, operand in a["carried"].items()}
        fixed = {name: self._get(env, operand) for name, operand in a["inputs"].items()}
        for name, t in list(carried.items()) + list(fixed.items()):
            if t.dim() != body.inputs[name].rank:
                raise bad(f"input '{name}' has rank {t.dim()} but the body declares rank {body.inputs[name].rank}")
        step_name = a["step"]
        tag, payload = a["steps"]
        stop_operand = body.outputs[payload["output"]] if tag == "until" else None
        operands = [body.outputs[name] for name in carried]
        if stop_operand is not None and stop_operand not in operands:
            operands = [*operands, stop_operand]
        limit = int(payload) if tag == "fixed" else int(payload["max"])
        outer = self.path
        loop_stream = mix64(outer + (plan.index[node.name] + 1) * _GAMMA)
        for i in range(limit):
            bound = {**carried, **fixed}
            if step_name is not None:
                bound[step_name] = torch.tensor(i, dtype=torch.int64, device=self.device)
            # each iteration refines the draws' stream (spec §4)
            self.path = mix64(loop_stream + (i + 1) * _GAMMA)
            try:
                values = self._eval(body, bound, prefix, operands)
            finally:
                self.path = outer
            for name in carried:
                t = values[body.outputs[name]]
                if t.dim() != body.inputs[name].rank:
                    raise bad(f"the body answers '{name}' with rank {t.dim()} but declares rank {body.inputs[name].rank}")
                carried[name] = t
            if stop_operand is not None:
                stop = values[stop_operand]
                if stop.dim() != 0:
                    raise bad(f"the stop output '{payload['output']}' must have rank 0")
                if bool(stop.item()):
                    break
        return carried


# ============================================================================
# Preparation
# ============================================================================


def prepare_weights(plan: Plan, weights: dict[str, Any], device: Any, fn: str, trainable: bool = False) -> dict[str, Any]:
    """Every weight the plan reaches as an f32 tensor on ``device``, its shape
    checked against the parameter's; ``trainable`` marks the trainable ones
    as requiring a gradient."""
    import numpy as np
    import torch

    specs = collect_weights(plan, fn)
    prepared: dict[str, Any] = {}
    for name in sorted(specs):
        spec = specs[name]
        if name not in weights:
            raise NnError(f"{fn}: the weights have no parameter '{name}'")
        shape, data = weights[name]
        if shape != spec.shape:
            raise NnError(f"{fn}: parameter '{name}' has shape {list(shape)} but the network declares {list(spec.shape)}")
        t = torch.from_numpy(np.array(data, dtype=np.float32)).reshape(shape).to(device)
        if trainable and spec.trainable:
            t = t.clone().requires_grad_(True)
        prepared[name] = t
    return prepared
