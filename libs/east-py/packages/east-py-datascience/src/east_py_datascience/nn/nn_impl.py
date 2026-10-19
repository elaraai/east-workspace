#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Neural networks as East data, run by torch (#1357): ``nn_init``,
``nn_train`` and ``nn_run`` over ``docs/neural-networks.md``.

The network is planned once per distinct value and its weights prepared once
per distinct weights (both kept in small caches), so a program calling
``nn_run`` thousands of times with one model converts and checks it once.
"""

from __future__ import annotations

import hashlib
import math
from collections import OrderedDict
from typing import Any

import numpy as np
from east import none, some
from east.runtime.platform import platform_function, platform_functions
from east.types.types import ArrayType, BooleanType, FloatType, IntegerType, StringType
from east.types.values import EastArray, EastDict, EastStruct, EastVariant, EastVector

from east_py_datascience.nn._plan import (
    NnError,
    ParamSpec,
    Plan,
    build_plan,
    collect_weights,
    decode,
)
from east_py_datascience.nn._torch import Interpreter, dtype_name, prepare_weights
from east_py_datascience.nn.types import (
    NetType,
    NnBatchType,
    NnRunConfigType,
    NnTrainConfigType,
    NnTrainHistoryType,
    NnTrainResultType,
    NnValueType,
    NnWeightsType,
    TensorType,
    _check_nn_support,
)

_PLANS: OrderedDict[str, Plan] = OrderedDict()
_WEIGHTS: OrderedDict[tuple[str, str, str], dict[str, Any]] = OrderedDict()
_PLAN_CACHE_SIZE = 16
_WEIGHT_CACHE_SIZE = 8

_ELEMENT_TYPES = {"float": FloatType, "integer": IntegerType, "boolean": BooleanType}
_NUMPY_DTYPES = {"float": np.float32, "integer": np.int64, "boolean": np.bool_}


# ============================================================================
# Preparation and caches
# ============================================================================


def _plan_for(net: Any, fn: str) -> tuple[str, Plan]:
    """The plan of a network, planned once per distinct value."""
    data = decode(net)
    key = repr(data)  # East dicts iterate in key order: one text per value
    plan = _PLANS.get(key)
    if plan is None:
        plan = build_plan(data, fn)
        _PLANS[key] = plan
        while len(_PLANS) > _PLAN_CACHE_SIZE:
            _PLANS.popitem(last=False)
    else:
        _PLANS.move_to_end(key)
    return key, plan


def _decode_weights(weights: Any) -> dict[str, tuple[tuple[int, ...], np.ndarray]]:
    out = {}
    for name, tensor in weights.items():
        shape = tuple(int(d) for d in tensor["shape"])
        out[name] = (shape, tensor["data"].to_numpy())
    return out


def _weights_key(decoded: dict[str, tuple[tuple[int, ...], np.ndarray]]) -> str:
    h = hashlib.blake2b(digest_size=16)
    for name in sorted(decoded):
        shape, data = decoded[name]
        h.update(name.encode("utf-8"))
        h.update(repr(shape).encode("utf-8"))
        h.update(np.ascontiguousarray(data).data)
    return h.hexdigest()


def _prepared_weights(plan_key: str, plan: Plan, weights: Any, device: Any, fn: str) -> dict[str, Any]:
    decoded = _decode_weights(weights)
    key = (plan_key, _weights_key(decoded), str(device))
    prepared = _WEIGHTS.get(key)
    if prepared is None:
        prepared = prepare_weights(plan, decoded, device, fn)
        _WEIGHTS[key] = prepared
        while len(_WEIGHTS) > _WEIGHT_CACHE_SIZE:
            _WEIGHTS.popitem(last=False)
    else:
        _WEIGHTS.move_to_end(key)
    return prepared


def _device(tag: str, fn: str) -> Any:
    import torch

    if tag == "cpu":
        return torch.device("cpu")
    if tag == "cuda":
        if not torch.cuda.is_available():
            raise NnError(f"{fn}: CUDA is not available")
        return torch.device("cuda")
    return torch.device("cuda" if torch.cuda.is_available() else "cpu")


def _to_torch(value: tuple[str, dict[str, Any]], device: Any, fn: str, name: str) -> Any:
    import torch

    tag, tensor = value
    shape = tuple(int(d) for d in tensor["shape"])
    data: np.ndarray = np.array(tensor["data"], dtype=_NUMPY_DTYPES[tag])  # a writable copy, torch's own
    count = int(math.prod(shape))
    if data.shape[0] != count:
        raise NnError(f"{fn}: '{name}' has {data.shape[0]} elements but its shape {list(shape)} holds {count}")
    return torch.from_numpy(data).reshape(shape).to(device)


def _from_torch(t: Any) -> EastVariant:
    tag = dtype_name(t)
    arr = t.detach().cpu().contiguous().reshape(-1).numpy()
    if tag == "float":
        arr = arr.astype(np.float64)
    return EastVariant(tag, _tensor_struct([int(d) for d in t.shape], arr, tag))


def _tensor_struct(shape: list[int], data: np.ndarray, tag: str = "float") -> EastStruct:
    return EastStruct(
        {"shape": EastArray(IntegerType, shape), "data": EastVector.from_numpy(data, _ELEMENT_TYPES[tag])}
    )


def _batch_tensors(batch: Any, device: Any, fn: str) -> dict[str, Any]:
    decoded = decode(batch)
    return {name: _to_torch(value, device, fn, name) for name, value in decoded.items()}


# ============================================================================
# nn_init
# ============================================================================


def _init_tensor(spec: ParamSpec, generator: Any) -> Any:
    import torch

    shape = list(spec.shape)
    if len(shape) >= 2:
        receptive = int(math.prod(shape[2:]))
        fan_in, fan_out = shape[1] * receptive, shape[0] * receptive
    elif len(shape) == 1:
        fan_in = fan_out = shape[0]
    else:
        fan_in = fan_out = 1
    fan_in, fan_out = max(fan_in, 1), max(fan_out, 1)
    kind, arg = spec.init, spec.init_arg
    f64 = torch.float64
    if kind == "zeros":
        return torch.zeros(shape, dtype=f64)
    if kind == "ones":
        return torch.ones(shape, dtype=f64)
    if kind == "constant":
        return torch.full(shape, float(arg or 0.0), dtype=f64)
    if kind == "normal":
        return torch.randn(shape, generator=generator, dtype=f64) * float(arg or 0.0)
    if kind == "uniform":
        return (torch.rand(shape, generator=generator, dtype=f64) * 2.0 - 1.0) * float(arg or 0.0)
    if kind == "xavier_uniform":
        bound = math.sqrt(6.0 / (fan_in + fan_out))
        return (torch.rand(shape, generator=generator, dtype=f64) * 2.0 - 1.0) * bound
    if kind == "xavier_normal":
        return torch.randn(shape, generator=generator, dtype=f64) * math.sqrt(2.0 / (fan_in + fan_out))
    if kind == "kaiming_uniform":
        bound = math.sqrt(6.0 / fan_in)
        return (torch.rand(shape, generator=generator, dtype=f64) * 2.0 - 1.0) * bound
    if kind == "kaiming_normal":
        return torch.randn(shape, generator=generator, dtype=f64) * math.sqrt(2.0 / fan_in)
    raise NnError(f"nn_init: unknown initialisation '{kind}'")


@platform_function(name="nn_init", inputs=[NetType, IntegerType], output=NnWeightsType)
def nn_init(net: EastStruct, seed: int) -> EastDict:
    """Draw a network's weights (``docs/neural-networks.md`` §5).

    Every weight the network reaches — its own parameters, each called
    module's under the call's prefix — in sorted name order from a generator
    seeded with ``seed``: deterministic for a seed, the shapes and the
    non-random initialisations the same on every runner.

    Args:
        net: ``NetType`` (``EastStruct``) - the network.
        seed: The generator's seed.

    Returns:
        ``NnWeightsType`` (``EastDict``): weight name → float tensor.
    """
    _check_nn_support()
    import torch

    fn = "nn_init"
    _, plan = _plan_for(net, fn)
    specs = collect_weights(plan, fn)
    generator = torch.Generator().manual_seed(int(seed))
    weights = {}
    for name in sorted(specs):
        t = _init_tensor(specs[name], generator)
        weights[name] = _tensor_struct(list(specs[name].shape), t.reshape(-1).numpy())
    return EastDict(StringType, TensorType, weights)


# ============================================================================
# nn_run
# ============================================================================


@platform_function(
    name="nn_run",
    inputs=[NetType, NnWeightsType, NnBatchType, ArrayType(StringType), NnRunConfigType],
    output=NnBatchType,
)
def nn_run(net: EastStruct, weights: EastDict, batch: EastDict, outputs: EastArray, config: EastStruct) -> EastDict:
    """Run a network on a batch and answer the outputs asked for (spec §5).

    Only the nodes those outputs need are evaluated. The network is planned
    and its weights prepared once per distinct value, so repeated calls with
    one model pay for the forward pass alone.

    Args:
        net: ``NetType`` (``EastStruct``) - the network.
        weights: ``NnWeightsType`` (``EastDict``) - its weights, by name.
        batch: ``NnBatchType`` (``EastDict``) - every input the network declares.
        outputs: ``Array<String>`` - names from the network's ``outputs``.
        config: ``NnRunConfigType`` (``EastStruct``) - ``device``, ``seed``, ``training``.

    Returns:
        ``NnBatchType`` (``EastDict``): each asked output by its name.
    """
    _check_nn_support()
    import torch

    fn = "nn_run"
    cfg = decode(config)
    device = _device(cfg["device"][0], fn)
    plan_key, plan = _plan_for(net, fn)
    names = [str(o) for o in outputs]
    for name in names:
        if name not in plan.outputs:
            raise NnError(f"{fn}: unknown output '{name}'")
    prepared = _prepared_weights(plan_key, plan, weights, device, fn)
    inputs = _batch_tensors(batch, device, fn)
    generator = torch.Generator(device=device).manual_seed(int(cfg["seed"]))
    interpreter = Interpreter(fn, device, bool(cfg["training"]), generator)
    with torch.no_grad():
        values = interpreter.run(plan, prepared, inputs, [plan.outputs[n] for n in names])
    return EastDict(StringType, NnValueType, {n: _from_torch(values[plan.outputs[n]]) for n in names})


# ============================================================================
# nn_train
# ============================================================================


def _learning_rate(schedule: tuple[str, Any], lr: float, step: int, total: int) -> float:
    tag, payload = schedule
    if tag == "constant":
        return lr
    warmup = int(payload["warmup_steps"])
    if step < warmup:
        return lr * (step + 1) / warmup
    if tag == "warmup_linear":
        return lr
    min_lr = float(payload["min_lr"])
    span = max(total - warmup, 1)
    progress = min((step - warmup) / span, 1.0)
    return min_lr + (lr - min_lr) * 0.5 * (1.0 + math.cos(math.pi * progress))


def _mean_scalar(interpreter: Interpreter, plan: Plan, weights: dict[str, Any], batches: list[dict[str, Any]],
                 operand: str, what: str, fn: str, autocast: Any) -> float:
    total = 0.0
    for inputs in batches:
        with autocast():
            value = interpreter.run(plan, weights, inputs, [operand])[operand]
        if value.dim() != 0:
            raise NnError(f"{fn}: the {what} output must be a scalar, got rank {value.dim()}")
        total += float(value.detach().cpu())
    return total / len(batches)


@platform_function(
    name="nn_train",
    inputs=[NetType, NnWeightsType, ArrayType(NnBatchType), ArrayType(NnBatchType), NnTrainConfigType],
    output=NnTrainResultType,
)
def nn_train(
    net: EastStruct, weights: EastDict, batches: EastArray, validation_batches: EastArray, config: EastStruct
) -> EastStruct:
    """Train a network's weights with torch (spec §5).

    Each epoch runs every batch once in training mode, minimising the scalar
    output ``config.loss`` by AdamW under the schedule, with gradient clipping
    and an exponential moving average of the weights when asked; the
    ``validation`` output, averaged over ``validation_batches`` in evaluation
    mode, drives early stopping with ``patience``. Answers the best epoch's
    weights (the EMA's when kept), one history entry per epoch run, and the
    best epoch.

    Args:
        net: ``NetType`` (``EastStruct``) - the network.
        weights: ``NnWeightsType`` (``EastDict``) - the starting weights (``nn_init``'s, or a checkpoint).
        batches: ``Array<NnBatchType>`` - the training batches, one step each.
        validation_batches: ``Array<NnBatchType>`` - the validation batches (may be empty).
        config: ``NnTrainConfigType`` (``EastStruct``).

    Returns:
        ``NnTrainResultType`` (``EastStruct``): ``weights``, ``history``, ``best_epoch``.
    """
    _check_nn_support()
    import torch

    fn = "nn_train"
    cfg = decode(config)
    device = _device(cfg["device"][0], fn)
    plan_key, plan = _plan_for(net, fn)
    del plan_key
    loss_out = cfg["loss"]
    if loss_out not in plan.outputs:
        raise NnError(f"{fn}: unknown output '{loss_out}'")
    validation_out = cfg["validation"]
    if validation_out is not None and validation_out not in plan.outputs:
        raise NnError(f"{fn}: unknown output '{validation_out}'")
    if len(batches) == 0:
        raise NnError(f"{fn}: there are no batches")
    epochs = int(cfg["epochs"])
    if epochs < 1:
        raise NnError(f"{fn}: epochs must be at least 1")

    specs = collect_weights(plan, fn)
    params = prepare_weights(plan, _decode_weights(weights), device, fn, trainable=True)
    trainable = [params[n] for n in sorted(specs) if specs[n].trainable]
    if not trainable:
        raise NnError(f"{fn}: the network has no trainable parameters")
    _, opt = cfg["optimizer"]
    lr = float(opt["lr"])
    optimizer = torch.optim.AdamW(
        trainable, lr=lr, betas=(float(opt["beta1"]), float(opt["beta2"])), eps=float(opt["eps"]),
        weight_decay=float(opt["weight_decay"]),
    )
    clip = cfg["clip_norm"]
    ema_decay = cfg["ema_decay"]
    ema = {n: p.detach().clone() for n, p in params.items()} if ema_decay is not None else None
    train_batches = [_batch_tensors(b, device, fn) for b in batches]
    val_batches = [_batch_tensors(b, device, fn) for b in validation_batches]
    total_steps = epochs * len(train_batches)
    bf16 = cfg["precision"][0] == "bf16"

    def autocast() -> Any:
        return torch.autocast(device_type=device.type, dtype=torch.bfloat16, enabled=bf16)

    generator = torch.Generator(device=device).manual_seed(int(cfg["seed"]))
    trainer = Interpreter(fn, device, True, generator, frozenset(cfg["recompute"]))
    evaluator = Interpreter(fn, device, False, generator)
    loss_operand = plan.outputs[loss_out]

    history: list[dict[str, Any]] = []
    best_value = math.inf
    best_epoch = 0
    best_weights: dict[str, np.ndarray] | None = None
    patience = cfg["patience"]
    stale = 0
    step = 0
    current_lr = lr
    for epoch in range(1, epochs + 1):
        total_loss = 0.0
        for inputs in train_batches:
            current_lr = _learning_rate(cfg["schedule"], lr, step, total_steps)
            for group in optimizer.param_groups:
                group["lr"] = current_lr
            with autocast():
                loss = trainer.run(plan, params, inputs, [loss_operand])[loss_operand]
            if loss.dim() != 0:
                raise NnError(f"{fn}: the loss output '{loss_out}' must be a scalar, got rank {loss.dim()}")
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            if clip is not None:
                torch.nn.utils.clip_grad_norm_(trainable, float(clip))
            optimizer.step()
            step += 1
            if ema is not None:
                with torch.no_grad():
                    for n, p in params.items():
                        ema[n].mul_(float(ema_decay)).add_(p.detach(), alpha=1.0 - float(ema_decay))
            total_loss += float(loss.detach().cpu())
        mean_loss = total_loss / len(train_batches)
        evaluated = ema if ema is not None else {n: p.detach() for n, p in params.items()}
        validation = None
        if validation_out is not None and val_batches:
            with torch.no_grad():
                validation = _mean_scalar(
                    evaluator, plan, evaluated, val_batches, plan.outputs[validation_out], "validation", fn, autocast
                )
        history.append({"epoch": epoch, "loss": mean_loss, "validation": validation, "learning_rate": current_lr})
        monitored = validation if validation is not None else mean_loss
        if monitored < best_value or best_weights is None:
            if monitored < best_value:
                stale = 0
            else:
                stale += 1
            best_value = min(best_value, monitored)
            best_epoch = epoch
            best_weights = {n: t.detach().cpu().double().reshape(-1).numpy() for n, t in evaluated.items()}
        else:
            stale += 1
        if patience is not None and stale >= int(patience):
            break

    assert best_weights is not None
    result_weights = {n: _tensor_struct(list(specs[n].shape), best_weights[n]) for n in sorted(specs)}
    entries: list[EastStruct] = [
        EastStruct(
            {
                "epoch": int(h["epoch"]),
                "loss": float(h["loss"]),
                "validation": none if h["validation"] is None else some(float(h["validation"])),
                "learning_rate": float(h["learning_rate"]),
            }
        )
        for h in history
    ]
    return EastStruct(
        {
            "weights": EastDict(StringType, TensorType, result_weights),
            "history": EastArray(NnTrainHistoryType, entries),
            "best_epoch": int(best_epoch),
        }
    )


nn_impl = platform_functions(__name__)

__all__ = ["nn_impl", "nn_init", "nn_run", "nn_train"]
