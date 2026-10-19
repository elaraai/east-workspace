#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""A network's plan: its structure resolved and checked before anything runs.

``build_plan`` turns a ``NetType`` value into python-native ``Plan``s (one per
network, module and loop body), resolving every operand, inferring every
node's element type by the rules of ``docs/neural-networks.md`` §2 and
refusing what the specification refuses, with its wording. The torch
interpreter evaluates a plan; the C runtime does the same work in C++.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np
from east.types.values import (
    EastArray,
    EastDict,
    EastNull,
    EastSet,
    EastStruct,
    EastVariant,
    EastVector,
)

DTYPES = ("float", "integer", "boolean")

# The operands each operation names: a plain field, "?f" an option, "*f" an
# array of names, "+f" a dict whose values are names.
_UNARY = ["x"]
_BINARY = ["a", "b"]
OPERAND_FIELDS: dict[str, list[str]] = {
    "gather": ["table", "index"],
    "embedding_bag": ["table", "index", "?weights", "segments", "size"],
    "segment_reduce": ["x", "segments", "size"],
    "segment_softmax": ["x", "segments"],
    "segment_log_softmax": ["x", "segments"],
    "scatter_add": ["x", "index", "size"],
    "concat": ["*inputs"],
    "split": _UNARY,
    "slice": _UNARY,
    "pad": _UNARY,
    "reshape": _UNARY,
    "permute": _UNARY,
    "broadcast": ["x", "like"],
    "where": ["cond", "a", "b"],
    "constant": [],
    "cast": _UNARY,
    "linear": ["x", "weight", "?bias"],
    "einsum": ["*inputs"],
    "conv1d": ["x", "weight", "?bias"],
    "avg_pool1d": _UNARY,
    "upsample_nearest": _UNARY,
    "layer_norm": ["x", "?weight", "?bias"],
    "group_norm": ["x", "?weight", "?bias"],
    "attention": ["q", "k", "v", "?bias"],
    "rotary": ["x", "positions"],
    "dropout": _UNARY,
    "stop_gradient": _UNARY,
    "random_normal": ["like"],
    "random_uniform": ["like"],
    "call": ["+inputs"],
    "loop": ["+carried", "+inputs"],
}
for _op in ("add", "sub", "mul", "div", "pow", "eq", "ne", "lt", "le", "gt", "ge", "logical_and", "logical_or"):
    OPERAND_FIELDS[_op] = _BINARY
for _op in (
    "neg", "abs", "exp", "log", "log1p", "sqrt", "softplus", "sigmoid", "tanh", "relu", "gelu", "silu",
    "clamp", "sin", "cos", "nan_to_num", "is_nan", "normal_cdf", "log_normal_cdf", "normal_quantile",
    "log1mexp", "logical_not", "sum", "mean", "max", "min", "logsumexp", "softmax", "log_softmax",
    "cumsum", "cummax", "cummin", "argmax",
):
    OPERAND_FIELDS[_op] = _UNARY

FLOAT_UNARY = {
    "exp", "log", "log1p", "sqrt", "softplus", "sigmoid", "tanh", "relu", "gelu", "silu", "clamp", "sin",
    "cos", "nan_to_num", "normal_cdf", "log_normal_cdf", "normal_quantile", "log1mexp",
}
AXIS_OPS = {"sum", "mean", "max", "min", "logsumexp", "softmax", "log_softmax", "cumsum", "cummax", "cummin", "argmax"}


class NnError(RuntimeError):
    """A refusal worded as the specification words it."""


@dataclass(frozen=True)
class InputSpec:
    dtype: str
    rank: int


@dataclass(frozen=True)
class ParamSpec:
    shape: tuple[int, ...]
    init: str
    init_arg: float | None
    trainable: bool


@dataclass
class Node:
    name: str
    op: str
    args: dict[str, Any]
    # The inferred element type: a dtype, or output name → dtype for a call or a loop.
    dtype: Any = None


@dataclass
class Plan:
    inputs: dict[str, InputSpec]
    params: dict[str, ParamSpec]
    modules: dict[str, Plan]
    nodes: list[Node]
    outputs: dict[str, str]
    parent: Plan | None = None
    index: dict[str, int] = field(default_factory=dict)

    def find_module(self, name: str) -> Plan | None:
        """The module ``name`` in this network or an enclosing one."""
        scope: Plan | None = self
        while scope is not None:
            if name in scope.modules:
                return scope.modules[name]
            scope = scope.parent
        return None


# ============================================================================
# East → python natives
# ============================================================================


def decode(value: Any) -> Any:
    """An East value as python natives: structs and dicts to ``dict``, arrays
    to ``list``, sets to ``set``, vectors to numpy, options to the payload or
    ``None``, other variants to ``(case, payload)``."""
    if isinstance(value, EastStruct):
        return {k: decode(value[k]) for k in value}
    if isinstance(value, EastVariant):
        if value.type == "none":
            return None
        if value.type == "some":
            return decode(value.value)
        return (value.type, decode(value.value))
    if isinstance(value, EastDict):
        return {decode(k): decode(v) for k, v in value.items()}
    if isinstance(value, EastArray):
        return [decode(v) for v in value]
    if isinstance(value, EastSet):
        return {decode(v) for v in value}
    if isinstance(value, EastVector):
        return value.to_numpy()
    if isinstance(value, EastNull):
        return None
    return value


# ============================================================================
# Building
# ============================================================================


def build_plan(net: Any, fn: str) -> Plan:
    """The plan of a decoded or East ``NetType`` value, every operand resolved
    and every node's element type inferred; raises ``NnError`` as the
    specification's §6 words it."""
    data = decode(net) if not isinstance(net, dict) else net
    plan = _build(data, fn, None)
    _infer(plan, fn)
    return plan


def _build(data: dict[str, Any], fn: str, parent: Plan | None) -> Plan:
    inputs = {name: InputSpec(spec["dtype"][0], int(spec["rank"])) for name, spec in data["inputs"].items()}
    params = {}
    for name, spec in data["params"].items():
        init_tag, init_arg = spec["init"]
        params[name] = ParamSpec(
            tuple(int(d) for d in spec["shape"]),
            init_tag,
            None if init_arg is None else float(init_arg),
            bool(spec["trainable"]),
        )
    plan = Plan(inputs, params, {}, [], dict(data["outputs"]), parent)
    for name, module in data["modules"].items():
        plan.modules[name] = _build(module, fn, plan)
    later = {entry["name"] for entry in data["nodes"]}
    seen: set[str] = set()
    for name in list(inputs) + list(params):
        if name in seen:
            raise NnError(f"{fn}: '{name}' is defined twice")
        _check_name(name, fn)
        seen.add(name)
    for entry in data["nodes"]:
        name = entry["name"]
        if name in seen:
            raise NnError(f"{fn}: '{name}' is defined twice")
        _check_name(name, fn)
        op, args = entry["op"]
        args = dict(args)
        if op == "loop":
            args["body"] = _build(args["body"], fn, plan)
        node = Node(name, op, args)
        for operand in operands_of(node):
            _resolve(plan, operand, fn, name, later)
        _check_static(plan, node, fn)
        plan.index[name] = len(plan.nodes)
        plan.nodes.append(node)
        seen.add(name)
    for out, operand in plan.outputs.items():
        _check_name(out, fn)
        _resolve(plan, operand, fn, None, set())
    return plan


def _check_name(name: str, fn: str) -> None:
    if "." in name or name == "":
        raise NnError(f"{fn}: '{name}' is not a valid name: names are non-empty and hold no '.'")


def operands_of(node: Node) -> list[str]:
    """Every operand a node names, in field order."""
    names: list[str] = []
    for spec in OPERAND_FIELDS[node.op]:
        if spec.startswith("?"):
            v = node.args[spec[1:]]
            if v is not None:
                names.append(v)
        elif spec.startswith("*"):
            names.extend(node.args[spec[1:]])
        elif spec.startswith("+"):
            names.extend(node.args[spec[1:]].values())
        else:
            names.append(node.args[spec])
    if node.op == "attention":
        mask = node.args["mask"]
        if mask is not None:
            tag, payload = mask
            if tag == "segments":
                names.append(payload["ids"])
            elif tag == "key_sets":
                names.extend([payload["ptr"], payload["keys"]])
    return names


def split_operand(operand: str) -> tuple[str, str | None]:
    """``"node.out"`` → ``("node", "out")``; a bare name → ``(name, None)``."""
    if "." in operand:
        head, _, sub = operand.partition(".")
        return head, sub
    return operand, None


def _resolve(plan: Plan, operand: str, fn: str, node_name: str | None, later: set[str]) -> None:
    """An operand names an input, a parameter or a node defined earlier; a
    node defined later, or nothing, is refused."""
    head, _ = split_operand(operand)
    where = f"node '{node_name}'" if node_name is not None else "an output"
    if head in plan.inputs or head in plan.params or head in plan.index:
        return
    if head in later:
        raise NnError(f"{fn}: {where} uses '{operand}' before it is defined")
    raise NnError(f"{fn}: {where} names an unknown operand '{operand}'")


def _check_static(plan: Plan, node: Node, fn: str) -> None:
    """The fields that need no shapes: counts, permutations, the structure of calls and loops."""
    a = node.args
    op = node.op

    def bad(what: str) -> NnError:
        return NnError(f"{fn}: node '{node.name}': {op}: {what}")

    if op == "concat" and len(a["inputs"]) == 0:
        raise bad("inputs is empty")
    if op == "split":
        if any(s < 0 for s in a["sizes"]):
            raise bad("sizes must not be negative")
        if not 0 <= a["part"] < len(a["sizes"]):
            raise bad(f"part {a['part']} is outside 0 .. {len(a['sizes']) - 1}")
    if op == "pad" and (a["before"] < 0 or a["after"] < 0):
        raise bad("before and after must not be negative")
    if op == "reshape" and sum(1 for d in a["shape"] if d == -1) > 1:
        raise bad("at most one dimension may be -1")
    if op == "reshape" and any(d < -1 for d in a["shape"]):
        raise bad("a dimension must be -1 or non-negative")
    if op == "permute" and sorted(a["axes"]) != list(range(len(a["axes"]))):
        raise bad(f"axes {list(a['axes'])} is not a permutation of 0 .. {len(a['axes']) - 1}")
    if op == "einsum":
        parse_einsum(a["subscripts"], len(a["inputs"]), bad)
    if op == "conv1d" and (a["stride"] < 1 or a["dilation"] < 1 or a["groups"] < 1):
        raise bad("stride, dilation and groups are at least 1")
    if op == "avg_pool1d" and (a["kernel"] < 1 or a["stride"] < 1):
        raise bad("kernel and stride are at least 1")
    if op == "upsample_nearest" and a["scale"] < 1:
        raise bad("scale is at least 1")
    if op == "group_norm" and a["groups"] < 1:
        raise bad("groups is at least 1")
    if op in ("attention", "rotary") and a["heads"] < 1:
        raise bad("heads is at least 1")
    if op == "dropout" and not 0.0 <= a["p"] < 1.0:
        raise bad(f"p must be in [0, 1), got {a['p']}")
    if op == "call":
        module = plan.find_module(a["module"])
        if module is None:
            raise bad(f"unknown module '{a['module']}'")
        _check_binding(set(a["inputs"]), set(module.inputs), bad, "the module's inputs")
    if op == "loop":
        body: Plan = a["body"]
        bound = set(a["carried"]) | set(a["inputs"])
        if set(a["carried"]) & set(a["inputs"]):
            raise bad("a body input is both carried and fixed")
        step = a["step"]
        if step is not None:
            if step not in body.inputs:
                raise bad(f"step names '{step}', which is not a body input")
            if body.inputs[step] != InputSpec("integer", 0):
                raise bad(f"the step input '{step}' must be an integer of rank 0")
            bound.add(step)
        _check_binding(bound, set(body.inputs), bad, "the body's inputs")
        for name in a["carried"]:
            if name not in body.outputs:
                raise bad(f"the body has no output '{name}' to carry")
        tag, payload = a["steps"]
        if tag == "fixed" and payload < 0:
            raise bad("fixed steps must not be negative")
        if tag == "until":
            if payload["output"] not in body.outputs:
                raise bad(f"the body has no output '{payload['output']}' to stop on")
            if payload["max"] < 0:
                raise bad("max must not be negative")


def _check_binding(given: set[str], declared: set[str], bad: Any, what: str) -> None:
    missing = sorted(declared - given)
    extra = sorted(given - declared)
    if missing:
        raise bad(f"{what} {missing} are not bound")
    if extra:
        raise bad(f"{extra} are not among {what}")


def parse_einsum(subscripts: str, n_inputs: int, bad: Any) -> tuple[list[str], str]:
    """``"ij,jk->ik"`` → (``["ij", "jk"]``, ``"ik"``), checked as §4 states."""
    if "->" not in subscripts:
        raise bad("subscripts need an explicit '->'")
    lhs, rhs = subscripts.split("->", 1)
    terms = lhs.split(",")
    if len(terms) != n_inputs:
        raise bad(f"subscripts name {len(terms)} operands but there are {n_inputs} inputs")
    letters: set[str] = set()
    for term in terms:
        if not term or not all(c.isalpha() and c.islower() for c in term):
            raise bad(f"'{term}' is not a run of lowercase letters")
        if len(set(term)) != len(term):
            raise bad(f"'{term}' repeats a letter: diagonals are not supported")
        letters.update(term)
    if len(set(rhs)) != len(rhs) or not set(rhs) <= letters:
        raise bad(f"the output '{rhs}' must name distinct letters of the operands")
    return terms, rhs


# ============================================================================
# Element types
# ============================================================================


def _infer(plan: Plan, fn: str) -> None:
    for node in plan.nodes:
        node.dtype = _node_dtype(plan, node, fn)


def dtype_of(plan: Plan, operand: str, fn: str, node_name: str | None = None) -> str:
    """The element type an operand holds, or the one tensor of a many-tensor node."""
    head, sub = split_operand(operand)
    if head in plan.inputs:
        return plan.inputs[head].dtype
    if head in plan.params:
        return "float"
    node = plan.nodes[plan.index[head]]
    if isinstance(node.dtype, dict):
        if sub is None:
            if len(node.dtype) == 1:
                return next(iter(node.dtype.values()))
            raise NnError(f"{fn}: '{head}' holds several tensors: name one as '{head}.<name>'")
        if sub not in node.dtype:
            raise NnError(f"{fn}: '{head}' has no tensor '{sub}'")
        return node.dtype[sub]
    if sub is not None:
        raise NnError(f"{fn}: '{head}' holds one tensor: it has no '{sub}'")
    return node.dtype


def _node_dtype(plan: Plan, node: Node, fn: str) -> Any:
    op, a = node.op, node.args

    def bad(what: str) -> NnError:
        return NnError(f"{fn}: node '{node.name}': {op}: {what}")

    def d(operand: str) -> str:
        return dtype_of(plan, operand, fn, node.name)

    if op in ("add", "sub", "mul"):
        da, db = d(a["a"]), d(a["b"])
        if da != db or da == "boolean":
            raise bad(f"takes float or integer operands of one type, got {da} and {db}")
        return da
    if op in ("div", "pow"):
        da, db = d(a["a"]), d(a["b"])
        if da != "float" or db != "float":
            raise bad(f"takes float operands, got {da} and {db}")
        return "float"
    if op in ("neg", "abs"):
        dx = d(a["x"])
        if dx == "boolean":
            raise bad("takes a float or integer operand, got boolean")
        return dx
    if op in FLOAT_UNARY:
        dx = d(a["x"])
        if dx != "float":
            raise bad(f"takes a float operand, got {dx}")
        return "float"
    if op == "is_nan":
        if d(a["x"]) != "float":
            raise bad("takes a float operand")
        return "boolean"
    if op in ("eq", "ne"):
        da, db = d(a["a"]), d(a["b"])
        if da != db:
            raise bad(f"takes operands of one type, got {da} and {db}")
        return "boolean"
    if op in ("lt", "le", "gt", "ge"):
        da, db = d(a["a"]), d(a["b"])
        if da != db or da == "boolean":
            raise bad(f"takes float or integer operands of one type, got {da} and {db}")
        return "boolean"
    if op == "logical_not":
        if d(a["x"]) != "boolean":
            raise bad("takes a boolean operand")
        return "boolean"
    if op in ("logical_and", "logical_or"):
        if d(a["a"]) != "boolean" or d(a["b"]) != "boolean":
            raise bad("takes boolean operands")
        return "boolean"
    if op == "where":
        if d(a["cond"]) != "boolean":
            raise bad("cond must be boolean")
        da, db = d(a["a"]), d(a["b"])
        if da != db:
            raise bad(f"a and b must be of one type, got {da} and {db}")
        return da
    if op == "cast":
        d(a["x"])
        return a["dtype"][0]
    if op == "constant":
        return a["value"][0]
    if op == "gather":
        if d(a["index"]) != "integer":
            raise bad("index must be integer")
        return d(a["table"])
    if op in ("split", "slice", "pad", "reshape", "permute", "stop_gradient"):
        return d(a["x"])
    if op == "broadcast":
        d(a["like"])
        return d(a["x"])
    if op == "concat":
        dts = {d(x) for x in a["inputs"]}
        if len(dts) != 1:
            raise bad("inputs must be of one type")
        return dts.pop()
    if op == "embedding_bag":
        if d(a["table"]) != "float":
            raise bad("table must be float")
        if d(a["index"]) != "integer" or d(a["segments"]) != "integer":
            raise bad("index and segments must be integer")
        if a["weights"] is not None and d(a["weights"]) != "float":
            raise bad("weights must be float")
        d(a["size"])
        return "float"
    if op in ("segment_softmax", "segment_log_softmax"):
        if d(a["x"]) != "float":
            raise bad("x must be float")
        if d(a["segments"]) != "integer":
            raise bad("segments must be integer")
        return "float"
    if op == "segment_reduce":
        dx = d(a["x"])
        if d(a["segments"]) != "integer":
            raise bad("segments must be integer")
        d(a["size"])
        reduce = a["reduce"][0]
        if dx == "boolean":
            raise bad("x must be float or integer")
        if reduce == "mean" and dx != "float":
            raise bad("mean takes a float x")
        return dx
    if op == "scatter_add":
        dx = d(a["x"])
        if dx == "boolean":
            raise bad("x must be float or integer")
        if d(a["index"]) != "integer":
            raise bad("index must be integer")
        d(a["size"])
        return dx
    if op in ("linear", "conv1d", "layer_norm", "group_norm"):
        for f in ("x", "weight", "bias"):
            if f in a and a[f] is not None and d(a[f]) != "float":
                raise bad(f"{f} must be float")
        return "float"
    if op in ("avg_pool1d", "upsample_nearest", "dropout"):
        if d(a["x"]) != "float":
            raise bad("x must be float")
        return "float"
    if op == "einsum":
        if any(d(x) != "float" for x in a["inputs"]):
            raise bad("inputs must be float")
        return "float"
    if op == "attention":
        for f in ("q", "k", "v"):
            if d(a[f]) != "float":
                raise bad(f"{f} must be float")
        if a["bias"] is not None and d(a["bias"]) != "float":
            raise bad("bias must be float")
        mask = a["mask"]
        if mask is not None:
            tag, payload = mask
            if tag == "segments" and d(payload["ids"]) != "integer":
                raise bad("the mask's ids must be integer")
            if tag == "key_sets" and (d(payload["ptr"]) != "integer" or d(payload["keys"]) != "integer"):
                raise bad("the mask's ptr and keys must be integer")
        return "float"
    if op == "rotary":
        if d(a["x"]) != "float":
            raise bad("x must be float")
        if d(a["positions"]) != "integer":
            raise bad("positions must be integer")
        return "float"
    if op in ("random_normal", "random_uniform"):
        d(a["like"])
        return "float"
    if op in AXIS_OPS:
        dx = d(a["x"])
        if dx == "boolean":
            raise bad("takes a float or integer operand, got boolean")
        if op in ("mean", "logsumexp", "softmax", "log_softmax") and dx != "float":
            raise bad(f"takes a float operand, got {dx}")
        return "integer" if op == "argmax" else dx
    if op == "call":
        module = plan.find_module(a["module"])
        assert module is not None
        for name, operand in a["inputs"].items():
            spec = module.inputs[name]
            if d(operand) != spec.dtype:
                raise bad(f"input '{name}' is {d(operand)} but the module declares {spec.dtype}")
        _infer(module, fn)
        return {out: dtype_of(module, operand, fn) for out, operand in module.outputs.items()}
    if op == "loop":
        body: Plan = a["body"]
        for name, operand in list(a["carried"].items()) + list(a["inputs"].items()):
            spec = body.inputs[name]
            if d(operand) != spec.dtype:
                raise bad(f"input '{name}' is {d(operand)} but the body declares {spec.dtype}")
        _infer(body, fn)
        result = {}
        for name in a["carried"]:
            out_dtype = dtype_of(body, body.outputs[name], fn)
            if out_dtype != body.inputs[name].dtype:
                raise bad(f"the carried '{name}' is {body.inputs[name].dtype} but the body answers {out_dtype}")
            result[name] = out_dtype
        tag, payload = a["steps"]
        if tag == "until" and dtype_of(body, body.outputs[payload["output"]], fn) != "boolean":
            raise bad(f"the stop output '{payload['output']}' must be boolean")
        return result
    raise NnError(f"{fn}: node '{node.name}': unknown operation '{op}'")


# ============================================================================
# Weights and demand
# ============================================================================


def collect_weights(plan: Plan, fn: str, prefix: str = "", into: dict[str, ParamSpec] | None = None) -> dict[str, ParamSpec]:
    """Every weight the network reaches, by name (spec §1): its own parameters
    under ``prefix``, each call's module under the call's prefix, each loop
    body under the same prefix."""
    weights = {} if into is None else into
    for name, spec in plan.params.items():
        full = prefix + name
        if full in weights and weights[full] != spec:
            raise NnError(f"{fn}: the weight '{full}' is declared twice with different shapes or initialisations")
        weights[full] = spec
    for node in plan.nodes:
        if node.op == "call":
            module = plan.find_module(node.args["module"])
            assert module is not None
            collect_weights(module, fn, prefix + node.args["prefix"] + ".", weights)
        elif node.op == "loop":
            collect_weights(node.args["body"], fn, prefix, weights)
    return weights


def needed_nodes(plan: Plan, operands: list[str]) -> list[Node]:
    """The nodes the operands depend on, in the plan's order."""
    needed: set[str] = set()
    stack = [split_operand(o)[0] for o in operands]
    while stack:
        head = stack.pop()
        if head in needed or head not in plan.index:
            continue
        needed.add(head)
        node = plan.nodes[plan.index[head]]
        stack.extend(split_operand(o)[0] for o in operands_of(node))
    return [node for node in plan.nodes if node.name in needed]


def shape_key(shape: Any) -> tuple[int, ...]:
    """A shape as a tuple of ints, from a list or a numpy array."""
    return tuple(int(d) for d in np.asarray(shape, dtype=np.int64).reshape(-1))
