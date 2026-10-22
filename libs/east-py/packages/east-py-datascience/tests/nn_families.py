#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The reference families of ``docs/neural-networks.md`` (#1357), each as a
``NetType`` value and as a hand-written torch implementation over the same
weights, in the same operation order:

- a transformer over ragged, grouped sequences: embedding and embedding-bag
  inputs, rotary positions, attention within each group causally and over
  explicit key sets, a categorical, a mixture-density and a discrete-time
  hazard head, and greedy decoding as a ``loop`` under the masks;
- a 1-D convolutional U-Net conditioned by FiLM from an MLP over an embedding
  and an attention-pooled set encoder, trained as a flow-matching model with
  an auxiliary variance head, sampled by Heun's ODE integration as a ``loop``
  and by an SDE, with monotone output constraints on the sample.

And three small ones for the operations the event and series workloads
select, expand and grid with (east-workspace#1357 R13, R16): a head run on
the events a boolean mask picks and written back by index, segment features
expanded to their events; a time grid from ``range`` into a sinusoidal
embedding, a position channel and a prefix mask; and ``rotary`` under both
pairing conventions.

``test_nn_reference.py`` holds the interpreter to the hand-written torch, and
``fixtures/make_nn_reference.py`` writes the TypeScript reference module the
compliance spec holds both runners to.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from east import coerce_to, none, some, variant
from east.types.types import ArrayType, StringType
from east_py_datascience.nn.types import NetType, NnBatchType, NnRunConfigType, NnWeightsType

# ============================================================================
# Builders
# ============================================================================


def op(tag: str, **fields: Any) -> Any:
    return variant(tag, fields)


def spec(dtype: str, rank: int) -> dict[str, Any]:
    return {"dtype": variant(dtype, None), "rank": rank}


def param(shape: list[int], init: str, arg: float | None = None, trainable: bool = True, decay: float = 1.0) -> dict[str, Any]:
    return {"shape": shape, "init": variant(init, arg), "trainable": trainable, "decay": decay}


def node(name: str, operation: Any) -> dict[str, Any]:
    return {"name": name, "op": operation}


def unary(tag: str, x: str) -> Any:
    return op(tag, x=x)


def binary(tag: str, a: str, b: str) -> Any:
    return op(tag, a=a, b=b)


def axis_op(tag: str, x: str, axis: int) -> Any:
    return op(tag, x=x, axis=axis)


def net(inputs: dict, params: dict, modules: dict, nodes: list, outputs: dict) -> dict[str, Any]:
    return {"inputs": inputs, "params": params, "modules": modules, "nodes": nodes, "outputs": outputs}


def tensor(data: Any, dtype: str = "float") -> Any:
    arr = np.asarray(data)
    flat = arr.reshape(-1)
    if dtype in ("float", "float64"):
        flat = flat.astype(np.float64)
    elif dtype == "integer":
        flat = flat.astype(np.int64)
    else:
        flat = flat.astype(np.bool_)
    return variant(dtype, {"shape": [int(d) for d in arr.shape], "data": flat})


# ============================================================================
# Family A: a transformer over ragged, grouped sequences
# ============================================================================

A = {"V": 7, "d": 8, "heads": 2, "K": 3, "B": 4, "T": 10, "Nb": 5, "EOS": 6}


def transformer_block(d: int, heads: int, mask: str) -> dict[str, Any]:
    inputs = {"x": spec("float", 2)}
    if mask == "segments":
        inputs |= {"groups": spec("integer", 1), "positions": spec("integer", 1)}
    else:
        inputs |= {"ptr": spec("integer", 1), "keys": spec("integer", 1)}
    params = {
        "ln1_w": param([d], "ones"), "ln1_b": param([d], "zeros"),
        "wq": param([d, d], "xavier_uniform"), "bq": param([d], "zeros"),
        "wk": param([d, d], "xavier_uniform"), "bk": param([d], "zeros"),
        "wv": param([d, d], "xavier_uniform"), "bv": param([d], "zeros"),
        "wo": param([d, d], "xavier_uniform"), "bo": param([d], "zeros"),
        "ln2_w": param([d], "ones"), "ln2_b": param([d], "zeros"),
        "w1": param([4 * d, d], "xavier_uniform"), "b1": param([4 * d], "zeros"),
        "w2": param([d, 4 * d], "xavier_uniform"), "b2": param([d], "zeros"),
    }
    nodes = [
        node("h", op("layer_norm", x="x", weight=some("ln1_w"), bias=some("ln1_b"), eps=1e-5)),
        node("q", op("linear", x="h", weight="wq", bias=some("bq"))),
        node("k", op("linear", x="h", weight="wk", bias=some("bk"))),
        node("v", op("linear", x="h", weight="wv", bias=some("bv"))),
    ]
    if mask == "segments":
        nodes += [
            node("qr", op("rotary", x="q", positions="positions", heads=heads, base=10000.0, convention=variant("halves", None))),
            node("kr", op("rotary", x="k", positions="positions", heads=heads, base=10000.0, convention=variant("halves", None))),
            node("att", op("attention", q="qr", k="kr", v="v", heads=heads,
                           mask=variant("segments", {"ids": "groups", "causal": True}), bias=none, scale=none)),
        ]
    else:
        nodes += [
            node("att", op("attention", q="q", k="k", v="v", heads=heads,
                           mask=variant("key_sets", {"ptr": "ptr", "keys": "keys"}), bias=none, scale=none)),
        ]
    nodes += [
        node("o", op("linear", x="att", weight="wo", bias=some("bo"))),
        node("x1", binary("add", "x", "o")),
        node("h2", op("layer_norm", x="x1", weight=some("ln2_w"), bias=some("ln2_b"), eps=1e-5)),
        node("f1", op("linear", x="h2", weight="w1", bias=some("b1"))),
        node("g", op("gelu", x="f1", approximate=variant("exact", None))),
        node("f2", op("linear", x="g", weight="w2", bias=some("b2"))),
        node("y", binary("add", "x1", "f2")),
    ]
    return net(inputs, params, {}, nodes, {"y": "y"})


def transformer_trunk(c: dict[str, int]) -> dict[str, Any]:
    d = c["d"]
    inputs = {
        "tokens": spec("integer", 1), "groups": spec("integer", 1), "positions": spec("integer", 1),
        "bag_index": spec("integer", 1), "bag_segments": spec("integer", 1), "bag_weights": spec("float", 1),
        "key_ptr": spec("integer", 1), "keys": spec("integer", 1),
    }
    params = {
        "tok_table": param([c["V"], d], "normal", 0.5),
        "bag_table": param([c["Nb"], d], "normal", 0.5),
        "ln_w": param([d], "ones"), "ln_b": param([d], "zeros"),
    }
    nodes = [
        node("emb", op("gather", table="tok_table", index="tokens")),
        node("bag", op("embedding_bag", table="bag_table", index="bag_index", weights=some("bag_weights"),
                       segments="bag_segments", size="tokens")),
        node("x0", binary("add", "emb", "bag")),
        node("b1", op("call", module="block", prefix="block1", inputs={"x": "x0", "groups": "groups", "positions": "positions"})),
        node("b2", op("call", module="block", prefix="block2", inputs={"x": "b1", "groups": "groups", "positions": "positions"})),
        node("s", op("call", module="set_block", prefix="setblock", inputs={"x": "b2.y", "ptr": "key_ptr", "keys": "keys"})),
        node("hn", op("layer_norm", x="s", weight=some("ln_w"), bias=some("ln_b"), eps=1e-5)),
    ]
    return net(inputs, params, {}, nodes, {"h": "hn"})


def transformer_net(c: dict[str, int] = A) -> dict[str, Any]:
    """Family A as a ``NetType`` value (python natives; ``coerce_to(…, NetType)`` types it)."""
    d, V, K, B, T = c["d"], c["V"], c["K"], c["B"], c["T"]
    trunk_inputs = {
        "tokens": "tokens", "groups": "groups", "positions": "positions", "bag_index": "bag_index",
        "bag_segments": "bag_segments", "bag_weights": "bag_weights", "key_ptr": "key_ptr", "keys": "keys",
    }
    inputs = {
        "tokens": spec("integer", 1), "groups": spec("integer", 1), "positions": spec("integer", 1),
        "bag_index": spec("integer", 1), "bag_segments": spec("integer", 1), "bag_weights": spec("float", 1),
        "key_ptr": spec("integer", 1), "keys": spec("integer", 1),
        "target_onehot": spec("float", 2), "y": spec("float", 1),
        "hazard_event": spec("float", 2), "hazard_at_risk": spec("float", 2),
        "canvas_init": spec("integer", 1),
    }
    params = {
        "cat_w": param([V, d], "xavier_uniform"), "cat_b": param([V], "zeros"),
        "mdn_w": param([3 * K, d], "xavier_uniform"), "mdn_b": param([3 * K], "zeros"),
        "haz_w": param([B, d], "xavier_uniform"), "haz_b": param([B], "zeros"),
    }
    modules = {
        "block": transformer_block(d, c["heads"], "segments"),
        "set_block": transformer_block(d, c["heads"], "key_sets"),
        "trunk": transformer_trunk(c),
    }
    # Greedy decoding under the masks: the canvas carries the tokens so far,
    # each iteration reads the logits at the step's position and writes the
    # argmax at the next, until it is the end token.
    body = net(
        {
            "canvas": spec("integer", 1), "step": spec("integer", 0),
            "groups": spec("integer", 1), "positions": spec("integer", 1),
            "bag_index": spec("integer", 1), "bag_segments": spec("integer", 1), "bag_weights": spec("float", 1),
            "key_ptr": spec("integer", 1), "keys": spec("integer", 1),
            "cat_w": spec("float", 2), "cat_b": spec("float", 1),
        },
        {},
        {},
        [
            node("t", op("call", module="trunk", prefix="trunk", inputs={**trunk_inputs, "tokens": "canvas"})),
            node("logits", op("linear", x="t", weight="cat_w", bias=some("cat_b"))),
            node("pos", op("reshape", x="step", shape=[1])),
            node("row", op("gather", table="logits", index="pos")),
            node("tok", axis_op("argmax", "row", -1)),
            node("one", op("constant", value=variant("integer", 1))),
            node("next", binary("add", "step", "one")),
            node("idx", op("reshape", x="next", shape=[1])),
            node("placed", op("scatter_add", x="tok", index="idx", size="canvas")),
            node("canvas2", binary("add", "canvas", "placed")),
            node("eos", op("constant", value=variant("integer", c["EOS"]))),
            node("is_eos", binary("eq", "tok", "eos")),
            node("done", op("reshape", x="is_eos", shape=[])),
        ],
        {"canvas": "canvas2", "done": "done"},
    )
    nodes = [
        node("t", op("call", module="trunk", prefix="trunk", inputs=trunk_inputs)),
        # categorical head
        node("logits", op("linear", x="t", weight="cat_w", bias=some("cat_b"))),
        node("logp", axis_op("log_softmax", "logits", -1)),
        node("picked", binary("mul", "target_onehot", "logp")),
        node("nll", unary("neg", "picked_sum")) if False else node("picked_sum", axis_op("sum", "picked", -1)),
        node("nll", unary("neg", "picked_sum")),
        node("loss_cat", axis_op("mean", "nll", 0)),
        # mixture-density head
        node("mdn", op("linear", x="t", weight="mdn_w", bias=some("mdn_b"))),
        node("mix_logits", op("split", x="mdn", axis=1, sizes=[K, K, K], part=0)),
        node("mu", op("split", x="mdn", axis=1, sizes=[K, K, K], part=1)),
        node("log_sigma", op("split", x="mdn", axis=1, sizes=[K, K, K], part=2)),
        node("y2", op("reshape", x="y", shape=[-1, 1])),
        node("sigma", unary("exp", "log_sigma")),
        node("z", binary("div", "diff", "sigma")) if False else node("diff", binary("sub", "y2", "mu")),
        node("z", binary("div", "diff", "sigma")),
        node("zz", binary("mul", "z", "z")),
        node("half", op("constant", value=variant("float", -0.5))),
        node("term", binary("mul", "half", "zz")),
        node("lp1", binary("sub", "term", "log_sigma")),
        node("c2", op("constant", value=variant("float", 0.5 * math.log(2 * math.pi)))),
        node("logpdf", binary("sub", "lp1", "c2")),
        node("mix_logp", axis_op("log_softmax", "mix_logits", -1)),
        node("comp", binary("add", "mix_logp", "logpdf")),
        node("ll", axis_op("logsumexp", "comp", -1)),
        node("mean_ll", axis_op("mean", "ll", 0)),
        node("loss_mdn", unary("neg", "mean_ll")),
        # discrete-time hazard head
        node("hz", op("linear", x="t", weight="haz_w", bias=some("haz_b"))),
        node("neg_hz", unary("neg", "hz")),
        node("sp_neg", unary("softplus", "neg_hz")),
        node("log_h", unary("neg", "sp_neg")),
        node("sp", unary("softplus", "hz")),
        node("log_1mh", unary("neg", "sp")),
        node("e_term", binary("mul", "hazard_event", "log_h")),
        node("r_term", binary("mul", "hazard_at_risk", "log_1mh")),
        node("ll_h_terms", binary("add", "e_term", "r_term")),
        node("ll_h", axis_op("sum", "ll_h_terms", -1)),
        node("mean_ll_h", axis_op("mean", "ll_h", 0)),
        node("loss_haz", unary("neg", "mean_ll_h")),
        node("loss_a", binary("add", "loss_cat", "loss_mdn")),
        node("loss", binary("add", "loss_a", "loss_haz")),
        # what inference reads
        node("probs", axis_op("softmax", "logits", -1)),
        node("next_token", axis_op("argmax", "logits", -1)),
        node("cum_log_s", axis_op("cumsum", "log_1mh", -1)),
        node("survival", unary("exp", "cum_log_s")),
        node("decode", op("loop", body=body, carried={"canvas": "canvas_init"},
                          inputs={**{k: v for k, v in trunk_inputs.items() if k != "tokens"}, "cat_w": "cat_w", "cat_b": "cat_b"},
                          step=some("step"), steps=variant("until", {"output": "done", "max": T - 1}))),
    ]
    outputs = {
        "loss": "loss", "probs": "probs", "next_token": "next_token", "survival": "survival",
        "decoded": "decode.canvas", "hidden": "t.h",
    }
    return net(inputs, params, modules, nodes, outputs)


def transformer_batch(c: dict[str, int] = A, seed: int = 3) -> dict[str, Any]:
    """A batch for family A: three groups of 3, 4 and 3 tokens."""
    rng = np.random.default_rng(seed)
    V, K, B, T, Nb = c["V"], c["K"], c["B"], c["T"], c["Nb"]
    del K
    groups = np.array([0, 0, 0, 1, 1, 1, 1, 2, 2, 2])
    positions = np.array([0, 1, 2, 0, 1, 2, 3, 0, 1, 2])
    tokens = rng.integers(1, V - 1, size=T)
    bag_index, bag_segments, bag_weights = [], [], []
    for t in range(T):
        for _ in range(1 + t % 2):
            bag_index.append(int(rng.integers(0, Nb)))
            bag_segments.append(t)
            bag_weights.append(float(rng.uniform(0.5, 1.5)))
    key_ptr, keys = [0], []
    for t in range(T):
        chosen = sorted(set(rng.integers(0, T, size=1 + t % 3).tolist()))
        keys.extend(chosen)
        key_ptr.append(len(keys))
    target = rng.integers(0, V, size=T)
    onehot = np.zeros((T, V))
    onehot[np.arange(T), target] = 1.0
    event_bin = rng.integers(0, B, size=T)
    hazard_event = np.zeros((T, B))
    hazard_at_risk = np.zeros((T, B))
    for t in range(T):
        hazard_event[t, event_bin[t]] = 1.0
        hazard_at_risk[t, : event_bin[t]] = 1.0
    canvas = np.zeros(T, dtype=np.int64)
    canvas[0] = tokens[0]
    return {
        "tokens": tensor(tokens, "integer"), "groups": tensor(groups, "integer"), "positions": tensor(positions, "integer"),
        "bag_index": tensor(bag_index, "integer"), "bag_segments": tensor(bag_segments, "integer"),
        "bag_weights": tensor(bag_weights), "key_ptr": tensor(key_ptr, "integer"), "keys": tensor(keys, "integer"),
        "target_onehot": tensor(onehot), "y": tensor(rng.normal(size=T)),
        "hazard_event": tensor(hazard_event), "hazard_at_risk": tensor(hazard_at_risk),
        "canvas_init": tensor(canvas, "integer"),
    }


# ============================================================================
# Family B: a conditioned 1-D U-Net trained by flow matching
# ============================================================================

B_CFG = {"N": 2, "C": 2, "L": 8, "C1": 4, "C2": 6, "dc": 8, "de": 4, "nf": 4, "S": 5, "ncat": 3, "steps": 4}


def film_block(c_in: int, c_out: int, dc: int, groups: int) -> dict[str, Any]:
    """Group norm, FiLM from the conditioning vector, SiLU, conv; a 1×1 skip."""
    inputs = {"x": spec("float", 3), "c": spec("float", 2)}
    params = {
        "gn_w": param([c_in], "ones"), "gn_b": param([c_in], "zeros"),
        "film_w": param([2 * c_in, dc], "xavier_uniform"), "film_b": param([2 * c_in], "zeros"),
        "conv_w": param([c_out, c_in, 3], "kaiming_uniform"), "conv_b": param([c_out], "zeros"),
        "skip_w": param([c_out, c_in, 1], "xavier_uniform"),
    }
    nodes = [
        node("gn", op("group_norm", x="x", groups=groups, weight=some("gn_w"), bias=some("gn_b"), eps=1e-5)),
        node("film", op("linear", x="c", weight="film_w", bias=some("film_b"))),
        node("gamma", op("split", x="film", axis=1, sizes=[c_in, c_in], part=0)),
        node("beta", op("split", x="film", axis=1, sizes=[c_in, c_in], part=1)),
        node("gamma3", op("reshape", x="gamma", shape=[-1, c_in, 1])),
        node("beta3", op("reshape", x="beta", shape=[-1, c_in, 1])),
        node("one", op("constant", value=variant("float", 1.0))),
        node("scale", binary("add", "one", "gamma3")),
        node("scaled", binary("mul", "gn", "scale")),
        node("shifted", binary("add", "scaled", "beta3")),
        node("act", unary("silu", "shifted")),
        node("padded", op("pad", x="act", axis=2, before=1, after=1, mode=variant("zeros", None))),
        node("conv", op("conv1d", x="padded", weight="conv_w", bias=some("conv_b"), stride=1, dilation=1, groups=1)),
        node("skip", op("conv1d", x="x", weight="skip_w", bias=none, stride=1, dilation=1, groups=1)),
        node("y", binary("add", "conv", "skip")),
    ]
    return net(inputs, params, {}, nodes, {"y": "y"})


def cond_module(c: dict[str, int]) -> dict[str, Any]:
    """An embedding and an attention-pooled set encoder, through an MLP."""
    de, dc = c["de"], c["dc"]
    inputs = {"cond_cat": spec("integer", 1), "set_values": spec("float", 2), "set_segments": spec("integer", 1)}
    params = {
        "emb": param([c["ncat"], de], "normal", 0.5),
        "ws1": param([de, 2], "xavier_uniform"), "bs1": param([de], "zeros"),
        "wa": param([1, de], "xavier_uniform"), "ba": param([1], "zeros"),
        "wf": param([dc, 2 * de], "xavier_uniform"), "bf": param([dc], "zeros"),
    }
    nodes = [
        node("e", op("gather", table="emb", index="cond_cat")),
        node("hs0", op("linear", x="set_values", weight="ws1", bias=some("bs1"))),
        node("hs", op("gelu", x="hs0", approximate=variant("tanh", None))),
        node("scores", op("linear", x="hs", weight="wa", bias=some("ba"))),
        node("w", op("segment_softmax", x="scores", segments="set_segments")),
        node("weighted", binary("mul", "hs", "w")),
        node("pooled", op("segment_reduce", x="weighted", segments="set_segments", size="cond_cat", reduce=variant("sum", None))),
        node("cat", op("concat", inputs=["e", "pooled"], axis=-1)),
        node("f", op("linear", x="cat", weight="wf", bias=some("bf"))),
        node("c", op("gelu", x="f", approximate=variant("tanh", None))),
    ]
    return net(inputs, params, {}, nodes, {"c": "c"})


def unet_module(c: dict[str, int]) -> dict[str, Any]:
    C, C1, C2, dc, nf = c["C"], c["C1"], c["C2"], c["dc"], c["nf"]
    inputs = {"x": spec("float", 3), "t": spec("float", 1), "c": spec("float", 2)}
    params = {
        "freq": param([1, nf], "ones", trainable=False),
        "wt": param([dc, 2 * nf + dc], "xavier_uniform"), "bt": param([dc], "zeros"),
        "out_w": param([C, C1 + C2, 3], "xavier_uniform"), "out_b": param([C], "zeros"),
        "var_w": param([C, C1 + C2, 1], "xavier_uniform"), "var_b": param([C], "zeros"),
    }
    nodes = [
        node("t2", op("reshape", x="t", shape=[-1, 1])),
        node("ang", binary("mul", "t2", "freq")),
        node("sin", unary("sin", "ang")),
        node("cos", unary("cos", "ang")),
        node("te", op("concat", inputs=["sin", "cos", "c"], axis=-1)),
        node("h0", op("linear", x="te", weight="wt", bias=some("bt"))),
        node("h", unary("silu", "h0")),
        node("d1", op("call", module="film", prefix="down1", inputs={"x": "x", "c": "h"})),
        node("p1", op("avg_pool1d", x="d1", kernel=2, stride=2)),
        node("d2", op("call", module="film2", prefix="down2", inputs={"x": "p1", "c": "h"})),
        node("u", op("upsample_nearest", x="d2", scale=2)),
        node("cat", op("concat", inputs=["u", "d1"], axis=1)),
        node("padded", op("pad", x="cat", axis=2, before=1, after=1, mode=variant("replicate", None))),
        node("v", op("conv1d", x="padded", weight="out_w", bias=some("out_b"), stride=1, dilation=1, groups=1)),
        node("logvar0", op("conv1d", x="cat", weight="var_w", bias=some("var_b"), stride=1, dilation=1, groups=1)),
        node("logvar", op("clamp", x="logvar0", min=some(-5.0), max=some(5.0))),
    ]
    return net(inputs, params, {}, nodes, {"v": "v", "logvar": "logvar"})


def unet_net(c: dict[str, int] = B_CFG) -> dict[str, Any]:
    """Family B as a ``NetType`` value."""
    C, C1, C2, dc, L = c["C"], c["C1"], c["C2"], c["dc"], c["L"]
    n_steps = c["steps"]
    inputs = {
        "x1": spec("float", 3), "t": spec("float", 1), "noise": spec("float", 3),
        "cond_cat": spec("integer", 1), "set_values": spec("float", 2), "set_segments": spec("integer", 1),
        "x_init": spec("float", 3), "ones_n": spec("float", 1),
    }
    params = {"mono_scale": param([], "ones")}
    modules = {
        "film": film_block(C, C1, dc, 1),
        "film2": film_block(C1, C2, dc, 2),
        "cond": cond_module(c),
        "unet": unet_module(c),
    }
    cond_inputs = {"cond_cat": "cond_cat", "set_values": "set_values", "set_segments": "set_segments"}
    # Heun's method over n fixed steps from t = 0 to 1, the velocity from the trained U-Net.
    heun = net(
        {"x": spec("float", 3), "step": spec("integer", 0), "c": spec("float", 2), "ones_n": spec("float", 1)},
        {},
        {},
        [
            node("fs", op("cast", x="step", dtype=variant("float", None))),
            node("n", op("constant", value=variant("float", float(n_steps)))),
            node("t0", binary("div", "fs", "n")),
            node("dt", op("constant", value=variant("float", 1.0 / n_steps))),
            node("t0v", binary("mul", "ones_n", "t0")),
            node("v1", op("call", module="unet", prefix="unet", inputs={"x": "x", "t": "t0v", "c": "c"})),
            node("v1dt", binary("mul", "v1.v", "dt")),
            node("xe", binary("add", "x", "v1dt")),
            node("t1", binary("add", "t0", "dt")),
            node("t1v", binary("mul", "ones_n", "t1")),
            node("v2", op("call", module="unet", prefix="unet", inputs={"x": "xe", "t": "t1v", "c": "c"})),
            node("vsum", binary("add", "v1.v", "v2.v")),
            node("half_dt", op("constant", value=variant("float", 0.5 / n_steps))),
            node("dx", binary("mul", "vsum", "half_dt")),
            node("xn", binary("add", "x", "dx")),
        ],
        {"x": "xn"},
    )
    # An Euler–Maruyama step with the interpreter's noise: shape and finiteness only across runners.
    sde = net(
        {"x": spec("float", 3), "step": spec("integer", 0), "c": spec("float", 2), "ones_n": spec("float", 1)},
        {},
        {},
        [
            node("fs", op("cast", x="step", dtype=variant("float", None))),
            node("n", op("constant", value=variant("float", float(n_steps)))),
            node("t0", binary("div", "fs", "n")),
            node("dt", op("constant", value=variant("float", 1.0 / n_steps))),
            node("t0v", binary("mul", "ones_n", "t0")),
            node("v", op("call", module="unet", prefix="unet", inputs={"x": "x", "t": "t0v", "c": "c"})),
            node("vdt", binary("mul", "v.v", "dt")),
            node("drift", binary("add", "x", "vdt")),
            node("eps", op("random_normal", like="x", keys=none)),
            node("sigma", op("constant", value=variant("float", 0.1 * math.sqrt(1.0 / n_steps)))),
            node("noise", binary("mul", "eps", "sigma")),
            node("xn", binary("add", "drift", "noise")),
        ],
        {"x": "xn"},
    )
    nodes = [
        node("c", op("call", module="cond", prefix="cond", inputs=cond_inputs)),
        # flow matching: x_t = (1 - t) noise + t x1, target velocity x1 - noise
        node("t3", op("reshape", x="t", shape=[-1, 1, 1])),
        node("one", op("constant", value=variant("float", 1.0))),
        node("omt", binary("sub", "one", "t3")),
        node("a", binary("mul", "omt", "noise")),
        node("b", binary("mul", "t3", "x1")),
        node("xt", binary("add", "a", "b")),
        node("target", binary("sub", "x1", "noise")),
        node("out", op("call", module="unet", prefix="unet", inputs={"x": "xt", "t": "t", "c": "c"})),
        node("err", binary("sub", "out.v", "target")),
        node("sq", binary("mul", "err", "err")),
        node("prec", unary("exp", "neg_logvar")) if False else node("neg_logvar", unary("neg", "out.logvar")),
        node("prec", unary("exp", "neg_logvar")),
        node("wsq", binary("mul", "sq", "prec")),
        node("nll", binary("add", "wsq", "out.logvar")),
        node("flat", op("reshape", x="nll", shape=[-1])),
        node("loss", axis_op("mean", "flat", 0)),
        # sampling
        node("sample", op("loop", body=heun, carried={"x": "x_init"}, inputs={"c": "c", "ones_n": "ones_n"},
                          step=some("step"), steps=variant("fixed", n_steps))),
        node("sde_sample", op("loop", body=sde, carried={"x": "x_init"}, inputs={"c": "c", "ones_n": "ones_n"},
                              step=some("step"), steps=variant("fixed", n_steps))),
        # monotone constraints on the sample's channels
        node("ch0", op("slice", x="sample.x", axis=1, start=0, stop=some(1))),
        node("ch1", op("slice", x="sample.x", axis=1, start=1, stop=none)),
        node("mono_max", axis_op("cummax", "ch0", -1)),
        node("mono_min", axis_op("cummin", "ch0", -1)),
        node("pos", unary("softplus", "ch1")),
        node("cum", axis_op("cumsum", "pos", -1)),
        node("mono_sum", binary("mul", "cum", "mono_scale")),
    ]
    outputs = {
        "loss": "loss", "velocity": "out.v", "sample": "sample.x", "sde_sample": "sde_sample.x",
        "mono_max": "mono_max", "mono_min": "mono_min", "mono_sum": "mono_sum",
    }
    del C1, C2, L
    return net(inputs, params, modules, nodes, outputs)


def unet_batch(c: dict[str, int] = B_CFG, seed: int = 5) -> dict[str, Any]:
    rng = np.random.default_rng(seed)
    N, C, L, S = c["N"], c["C"], c["L"], c["S"]
    return {
        "x1": tensor(rng.normal(size=(N, C, L))),
        "t": tensor(rng.uniform(0.1, 0.9, size=N)),
        "noise": tensor(rng.normal(size=(N, C, L))),
        "cond_cat": tensor(rng.integers(0, c["ncat"], size=N), "integer"),
        "set_values": tensor(rng.normal(size=(S, 2))),
        "set_segments": tensor(np.sort(rng.integers(0, N, size=S)), "integer"),
        "x_init": tensor(rng.normal(size=(N, C, L))),
        "ones_n": tensor(np.ones(N)),
    }


def unet_weights_override(weights: Any, c: dict[str, int] = B_CFG) -> None:
    """The sinusoidal frequencies: a geometric series the init cannot express (a data value, not a draw)."""
    from east.types.types import FloatType, IntegerType
    from east.types.values import EastArray, EastStruct, EastVector

    nf = c["nf"]
    freq = 2.0 ** np.arange(nf) * math.pi
    weights["unet.freq"] = EastStruct({"shape": EastArray(IntegerType, [1, nf]), "data": EastVector.from_numpy(freq.astype(np.float64), FloatType)})


# ============================================================================
# Hand-written torch
# ============================================================================


def torch_weights(weights: Any, device: Any = None) -> dict[str, Any]:
    """An ``NnWeightsType`` value as f32 torch tensors by name."""
    import torch

    out = {}
    for name, t in weights.items():
        shape = [int(d) for d in t["shape"]]
        out[name] = torch.from_numpy(np.array(t["data"].to_numpy(), dtype=np.float32)).reshape(shape)
        if device is not None:
            out[name] = out[name].to(device)
    return out


def torch_batch(batch: Any) -> dict[str, Any]:
    import torch

    dt = {"float": np.float32, "float64": np.float64, "integer": np.int64, "boolean": np.bool_}
    out = {}
    for name, v in batch.items():
        shape = [int(d) for d in v.value["shape"]]
        out[name] = torch.from_numpy(np.array(v.value["data"].to_numpy(), dtype=dt[v.type])).reshape(shape)
    return out


def ref_rotary(x: Any, positions: Any, heads: int, base: float) -> Any:
    import torch

    t, d = x.shape
    dh = d // heads
    half = dh // 2
    inv = (base ** (-torch.arange(half, dtype=torch.float64) * 2.0 / dh)).to(x.dtype)  # in double, then f32 (§4)
    ang = positions.to(x.dtype)[:, None] * inv  # [T, half]
    cos, sin = ang.cos()[:, None, :], ang.sin()[:, None, :]
    xh = x.reshape(t, heads, dh)
    x1, x2 = xh[..., :half], xh[..., half:]
    return torch.cat([x1 * cos - x2 * sin, x2 * cos + x1 * sin], -1).reshape(t, d)


def ref_attention(q: Any, k: Any, v: Any, heads: int, allowed: Any) -> Any:
    import torch

    t, d = q.shape
    dh = d // heads
    qh = q.reshape(t, heads, dh).transpose(0, 1)
    kh = k.reshape(-1, heads, dh).transpose(0, 1)
    vh = v.reshape(-1, heads, dh).transpose(0, 1)
    scores = qh @ kh.transpose(1, 2) / math.sqrt(dh)
    any_allowed = allowed.any(-1)
    scores = scores.masked_fill((~allowed & any_allowed[:, None])[None], float("-inf"))
    probs = torch.softmax(scores, -1)
    out = (probs @ vh) * any_allowed[None, :, None].to(q.dtype)
    return out.transpose(0, 1).reshape(t, d)


def ref_block(x: Any, w: dict[str, Any], p: str, heads: int, groups: Any = None, positions: Any = None,
              ptr: Any = None, keys: Any = None) -> Any:
    import torch
    import torch.nn.functional as F

    g = lambda n: w[f"{p}.{n}"]  # noqa: E731
    h = F.layer_norm(x, (x.shape[-1],), g("ln1_w"), g("ln1_b"), 1e-5)
    q, k, v = F.linear(h, g("wq"), g("bq")), F.linear(h, g("wk"), g("bk")), F.linear(h, g("wv"), g("bv"))
    t = x.shape[0]
    if groups is not None:
        q, k = ref_rotary(q, positions, heads, 10000.0), ref_rotary(k, positions, heads, 10000.0)
        allowed = (groups[:, None] == groups[None, :]) & torch.ones(t, t, dtype=torch.bool).tril()
    else:
        allowed = torch.zeros(t, t, dtype=torch.bool)
        for i in range(t):
            allowed[i, keys[ptr[i] : ptr[i + 1]]] = True
    att = ref_attention(q, k, v, heads, allowed)
    x1 = x + F.linear(att, g("wo"), g("bo"))
    h2 = F.layer_norm(x1, (x1.shape[-1],), g("ln2_w"), g("ln2_b"), 1e-5)
    return x1 + F.linear(F.gelu(F.linear(h2, g("w1"), g("b1"))), g("w2"), g("b2"))


def ref_trunk(tokens: Any, b: dict[str, Any], w: dict[str, Any], heads: int) -> Any:
    import torch
    import torch.nn.functional as F

    emb = w["trunk.tok_table"][tokens]
    rows = w["trunk.bag_table"][b["bag_index"]] * b["bag_weights"][:, None]
    bag = torch.zeros_like(emb).index_add(0, b["bag_segments"], rows)
    x = emb + bag
    x = ref_block(x, w, "trunk.block1", heads, groups=b["groups"], positions=b["positions"])
    x = ref_block(x, w, "trunk.block2", heads, groups=b["groups"], positions=b["positions"])
    x = ref_block(x, w, "trunk.setblock", heads, ptr=b["key_ptr"], keys=b["keys"])
    return F.layer_norm(x, (x.shape[-1],), w["trunk.ln_w"], w["trunk.ln_b"], 1e-5)


def ref_transformer(batch: Any, weights: Any, c: dict[str, int] = A) -> dict[str, Any]:
    """Family A by hand: every output of ``transformer_net`` as a torch tensor."""
    import torch
    import torch.nn.functional as F

    b, w = torch_batch(batch), torch_weights(weights)
    K, heads = c["K"], c["heads"]
    h = ref_trunk(b["tokens"], b, w, heads)
    logits = F.linear(h, w["cat_w"], w["cat_b"])
    logp = torch.log_softmax(logits, -1)
    loss_cat = (-(b["target_onehot"] * logp).sum(-1)).mean()
    mdn = F.linear(h, w["mdn_w"], w["mdn_b"])
    mix_logits, mu, log_sigma = torch.split(mdn, [K, K, K], 1)
    z = (b["y"][:, None] - mu) / torch.exp(log_sigma)
    logpdf = -0.5 * z * z - log_sigma - 0.5 * math.log(2 * math.pi)
    loss_mdn = -torch.logsumexp(torch.log_softmax(mix_logits, -1) + logpdf, -1).mean()
    hz = F.linear(h, w["haz_w"], w["haz_b"])
    log_h, log_1mh = -F.softplus(-hz), -F.softplus(hz)
    loss_haz = -(b["hazard_event"] * log_h + b["hazard_at_risk"] * log_1mh).sum(-1).mean()
    canvas = b["canvas_init"].clone()
    for step in range(c["T"] - 1):
        hh = ref_trunk(canvas, b, w, heads)
        lg = F.linear(hh, w["cat_w"], w["cat_b"])
        tok = lg[step].argmax()
        canvas[step + 1] = tok
        if int(tok) == c["EOS"]:
            break
    return {
        "loss": loss_cat + loss_mdn + loss_haz,
        "probs": torch.softmax(logits, -1),
        "next_token": logits.argmax(-1),
        "survival": torch.exp(torch.cumsum(log_1mh, -1)),
        "decoded": canvas,
        "hidden": h,
    }


def ref_film(x: Any, cvec: Any, w: dict[str, Any], p: str, groups: int) -> Any:
    import torch
    import torch.nn.functional as F

    g = lambda n: w[f"{p}.{n}"]  # noqa: E731
    c_in = x.shape[1]
    gn = F.group_norm(x, groups, g("gn_w"), g("gn_b"), 1e-5)
    film = F.linear(cvec, g("film_w"), g("film_b"))
    gamma, beta = torch.split(film, [c_in, c_in], 1)
    act = F.silu(gn * (1.0 + gamma[:, :, None]) + beta[:, :, None])
    conv = F.conv1d(F.pad(act, (1, 1)), g("conv_w"), g("conv_b"))
    return conv + F.conv1d(x, g("skip_w"))


def ref_cond(b: dict[str, Any], w: dict[str, Any]) -> Any:
    import torch
    import torch.nn.functional as F

    e = w["cond.emb"][b["cond_cat"]]
    hs = F.gelu(F.linear(b["set_values"], w["cond.ws1"], w["cond.bs1"]), approximate="tanh")
    scores = F.linear(hs, w["cond.wa"], w["cond.ba"])  # [S, 1]
    seg = b["set_segments"]
    n = b["cond_cat"].shape[0]
    weights = torch.zeros_like(scores)
    for s in range(n):
        m = seg == s
        if m.any():
            weights[m] = torch.softmax(scores[m], 0)
    pooled = torch.zeros(n, hs.shape[1]).index_add(0, seg, hs * weights)
    return F.gelu(F.linear(torch.cat([e, pooled], -1), w["cond.wf"], w["cond.bf"]), approximate="tanh")


def ref_unet(x: Any, t: Any, cvec: Any, w: dict[str, Any]) -> tuple[Any, Any]:
    import torch
    import torch.nn.functional as F

    ang = t[:, None] * w["unet.freq"]
    te = torch.cat([ang.sin(), ang.cos(), cvec], -1)
    h = F.silu(F.linear(te, w["unet.wt"], w["unet.bt"]))
    d1 = ref_film(x, h, w, "unet.down1", 1)
    p1 = F.avg_pool1d(d1, 2, 2)
    d2 = ref_film(p1, h, w, "unet.down2", 2)
    u = d2.repeat_interleave(2, dim=-1)
    cat = torch.cat([u, d1], 1)
    padded = F.pad(cat, (1, 1), mode="replicate")
    v = F.conv1d(padded, w["unet.out_w"], w["unet.out_b"])
    logvar = torch.clamp(F.conv1d(cat, w["unet.var_w"], w["unet.var_b"]), -5.0, 5.0)
    return v, logvar


def ref_unet_family(batch: Any, weights: Any, c: dict[str, int] = B_CFG) -> dict[str, Any]:
    """Family B by hand: the loss, the velocity, Heun's sample and the monotone outputs."""
    import torch
    import torch.nn.functional as F

    b, w = torch_batch(batch), torch_weights(weights)
    n_steps = c["steps"]
    cvec = ref_cond(b, w)
    t3 = b["t"][:, None, None]
    xt = (1.0 - t3) * b["noise"] + t3 * b["x1"]
    target = b["x1"] - b["noise"]
    v, logvar = ref_unet(xt, b["t"], cvec, w)
    err = v - target
    loss = (err * err * torch.exp(-logvar) + logvar).reshape(-1).mean()
    x = b["x_init"]
    for step in range(n_steps):
        t0 = float(step) / n_steps
        dt = 1.0 / n_steps
        t0v = b["ones_n"] * t0
        v1, _ = ref_unet(x, t0v, cvec, w)
        xe = x + v1 * dt
        t1v = b["ones_n"] * (t0 + dt)
        v2, _ = ref_unet(xe, t1v, cvec, w)
        x = x + (v1 + v2) * (0.5 / n_steps)
    ch0, ch1 = x[:, 0:1], x[:, 1:]
    return {
        "loss": loss,
        "velocity": v,
        "sample": x,
        "mono_max": torch.cummax(ch0, -1).values,
        "mono_min": torch.cummin(ch0, -1).values,
        "mono_sum": torch.cumsum(F.softplus(ch1), -1) * w["mono_scale"],
    }


# ============================================================================
# Family C: a head on the events a mask selects (W2-shaped), features expanded by counts
# ============================================================================

C_CFG = {"N": 9, "S": 3, "d": 6, "c": 4}


def head_selection_net(c: dict[str, int] = C_CFG) -> dict[str, Any]:
    """Segment features repeated to their events, added to the events; a head
    run on the events a boolean mask selects, its probabilities written back
    to every event's row by the mask's indices (zeros elsewhere)."""
    inputs = {
        "x": spec("float", 2), "seg_feat": spec("float", 2), "counts": spec("integer", 1), "mask": spec("boolean", 1),
    }
    params = {"w": param([c["c"], c["d"]], "xavier_uniform"), "b": param([c["c"]], "zeros")}
    nodes = [
        node("rep", op("repeat", x="seg_feat", counts="counts")),
        node("h", binary("add", "x", "rep")),
        node("sel", op("mask_select", x="h", mask="mask")),
        node("idx", op("mask_indices", mask="mask")),
        node("logits", op("linear", x="sel", weight="w", bias=some("b"))),
        node("probs", axis_op("softmax", "logits", -1)),
        node("back", op("scatter_add", x="probs", index="idx", size="x")),
        node("top", axis_op("argmax", "probs", -1)),
    ]
    return net(inputs, params, {}, nodes, {"back": "back", "idx": "idx", "sel": "sel", "top": "top"})


def head_selection_batch(c: dict[str, int] = C_CFG, seed: int = 7) -> dict[str, Any]:
    rng = np.random.default_rng(seed)
    N, S, d = c["N"], c["S"], c["d"]
    counts = np.array([4, 0, 5])
    assert counts.sum() == N and len(counts) == S
    mask = np.array([True, False, True, True, False, False, True, False, True])
    return {
        "x": tensor(rng.normal(size=(N, d))),
        "seg_feat": tensor(rng.normal(size=(S, d))),
        "counts": tensor(counts, "integer"),
        "mask": tensor(mask, "boolean"),
    }


def ref_head_selection(batch: Any, weights: Any) -> dict[str, Any]:
    import torch
    import torch.nn.functional as F

    b, w = torch_batch(batch), torch_weights(weights)
    rep = b["seg_feat"].repeat_interleave(b["counts"], dim=0)
    h = b["x"] + rep
    sel = h[b["mask"]]
    idx = b["mask"].nonzero().reshape(-1)
    probs = torch.softmax(F.linear(sel, w["w"], w["b"]), -1)
    back = torch.zeros(h.shape[0], probs.shape[1]).index_add(0, idx, probs)
    return {"back": back, "idx": idx, "sel": sel, "top": probs.argmax(-1)}


# ============================================================================
# Family D: a time grid (W3-shaped) — range into a sinusoidal embedding, a position channel, a prefix mask
# ============================================================================

D_CFG = {"L": 12, "nf": 4}


def time_grid_net(c: dict[str, int] = D_CFG) -> dict[str, Any]:
    """``range`` builds the grid `0 .. L-1` from a constant length and the
    frequencies' index; the geometric frequencies come from `exp`, the
    embedding from `sin` and `cos`, the position channel from a division, and
    a prefix mask from comparing the grid with an input length."""
    L, nf = c["L"], c["nf"]
    inputs = {"prefix": spec("integer", 0)}
    nodes = [
        node("L", op("constant", value=variant("integer", L))),
        node("grid", op("range", start=0, stop="L", step=1)),
        node("t", op("cast", x="grid", dtype=variant("float", None))),
        node("nf", op("constant", value=variant("integer", nf))),
        node("i", op("range", start=0, stop="nf", step=1)),
        node("fi", op("cast", x="i", dtype=variant("float", None))),
        node("decay", op("constant", value=variant("float", -math.log(10000.0) / nf))),
        node("scaled", binary("mul", "fi", "decay")),
        node("freq", unary("exp", "scaled")),
        node("t2", op("reshape", x="t", shape=[-1, 1])),
        node("f2", op("reshape", x="freq", shape=[1, -1])),
        node("ang", binary("mul", "t2", "f2")),
        node("s", unary("sin", "ang")),
        node("co", unary("cos", "ang")),
        node("emb", op("concat", inputs=["s", "co"], axis=-1)),
        node("Lf", op("cast", x="L", dtype=variant("float", None))),
        node("pos", binary("div", "t", "Lf")),
        node("in_prefix", binary("lt", "grid", "prefix")),
        node("m", op("cast", x="in_prefix", dtype=variant("float", None))),
        node("m2", op("reshape", x="m", shape=[-1, 1])),
        node("masked", binary("mul", "emb", "m2")),
    ]
    return net(inputs, {}, {}, nodes, {"grid": "grid", "emb": "emb", "pos": "pos", "masked": "masked"})


def time_grid_batch(c: dict[str, int] = D_CFG) -> dict[str, Any]:
    return {"prefix": tensor(5, "integer")}


def ref_time_grid(batch: Any, weights: Any, c: dict[str, int] = D_CFG) -> dict[str, Any]:
    import torch

    del weights
    b = torch_batch(batch)
    L, nf = c["L"], c["nf"]
    grid = torch.arange(L)
    t = grid.float()
    freq = torch.exp(torch.arange(nf).float() * (-math.log(10000.0) / nf))
    ang = t[:, None] * freq[None, :]
    emb = torch.cat([ang.sin(), ang.cos()], -1)
    pos = t / float(L)
    m = (grid < b["prefix"]).float()
    return {"grid": grid, "emb": emb, "pos": pos, "masked": emb * m[:, None]}


# ============================================================================
# Family E: rotary under both pairing conventions
# ============================================================================

E_CFG = {"T": 3, "d": 8, "heads": 2}
# A head dimension that is not a power of two (12 = 2 × 6), at positions far enough
# along for a frequency's last bit to show in the angle: where the runners' rotary
# formulas parted before the frequencies were computed in double.
E_ODD_CFG = {"T": 4, "d": 12, "heads": 2, "positions": [0, 1, 16384, 65535]}


def rotary_conventions_net(c: dict[str, int] = E_CFG) -> dict[str, Any]:
    inputs = {"x": spec("float", 2), "positions": spec("integer", 1)}
    nodes = [
        node("halves", op("rotary", x="x", positions="positions", heads=c["heads"], base=10000.0, convention=variant("halves", None))),
        node("inter", op("rotary", x="x", positions="positions", heads=c["heads"], base=10000.0, convention=variant("interleaved", None))),
    ]
    return net(inputs, {}, {}, nodes, {"halves": "halves", "inter": "inter"})


def rotary_conventions_batch(c: dict[str, Any] = E_CFG, seed: int = 9) -> dict[str, Any]:
    rng = np.random.default_rng(seed)
    positions = c.get("positions", [0, 1, 7])
    return {"x": tensor(rng.normal(size=(c["T"], c["d"]))), "positions": tensor(positions, "integer")}


def ref_rotary_interleaved(x: Any, positions: Any, heads: int, base: float) -> Any:
    import torch

    t, d = x.shape
    dh = d // heads
    half = dh // 2
    inv = (base ** (-torch.arange(half, dtype=torch.float64) * 2.0 / dh)).to(x.dtype)  # in double, then f32 (§4)
    ang = positions.to(x.dtype)[:, None] * inv  # [T, half]
    cos, sin = ang.cos()[:, None, :], ang.sin()[:, None, :]
    pairs = x.reshape(t, heads, half, 2)
    x1, x2 = pairs[..., 0], pairs[..., 1]
    return torch.stack([x1 * cos - x2 * sin, x2 * cos + x1 * sin], -1).reshape(t, d)


def ref_rotary_conventions(batch: Any, weights: Any, c: dict[str, Any] = E_CFG) -> dict[str, Any]:
    del weights
    b = torch_batch(batch)
    return {
        "halves": ref_rotary(b["x"], b["positions"], c["heads"], 10000.0),
        "inter": ref_rotary_interleaved(b["x"], b["positions"], c["heads"], 10000.0),
    }


# ============================================================================
# Family F: the keyed draws — what the python runner draws, pinned for east-c
# ============================================================================

F_CFG = {"rows": 6, "width": 4}


def draws_net(c: dict[str, int] = F_CFG) -> dict[str, Any]:
    """Uniform and normal draws over a `like` tensor, keyed and by position; a
    dropout in training; the same draws inside a called module and a loop."""
    inner = net(
        {"z": spec("float", 2), "keys": spec("integer", 1)},
        {},
        {},
        [node("u", op("random_uniform", like="z", keys=some("keys")))],
        {"u": "u"},
    )
    body = net(
        {"z": spec("float", 2), "step": spec("integer", 0), "acc": spec("float", 2)},
        {},
        {},
        [
            node("n", op("random_normal", like="z", keys=none)),
            node("acc2", binary("add", "acc", "n")),
        ],
        {"acc": "acc2"},
    )
    nodes = [
        node("u_keyed", op("random_uniform", like="z", keys=some("keys"))),
        node("u_pos", op("random_uniform", like="z", keys=none)),
        node("n_keyed", op("random_normal", like="z", keys=some("keys"))),
        node("dropped", op("dropout", x="z", p=0.5)),
        node("called", op("call", module="inner", prefix="inner", inputs={"z": "z", "keys": "keys"})),
        node("looped", op("loop", body=body, carried={"acc": "z"}, inputs={"z": "z"}, step=some("step"), steps=variant("fixed", 3))),
        node("scalar", op("random_uniform", like="one", keys=none)),
    ]
    inputs = {"z": spec("float", 2), "keys": spec("integer", 1), "one": spec("float", 0)}
    return net(inputs, {}, {"inner": inner}, nodes, {
        "u_keyed": "u_keyed", "u_pos": "u_pos", "n_keyed": "n_keyed", "dropped": "dropped",
        "called": "called.u", "looped": "looped.acc", "scalar": "scalar",
    })


def draws_batch(c: dict[str, int] = F_CFG) -> dict[str, Any]:
    rows, width = c["rows"], c["width"]
    return {
        "z": tensor(np.ones((rows, width))),
        "keys": tensor([10, 3, 10, 7, -2, 1000000007], "integer"),
        "one": tensor(1.0),
    }


def ref_draws(batch: Any, weights: Any) -> dict[str, Any]:
    """The python runner's own answer (the draws are specified, not torch's):
    nn_run in training mode (dropout on) at seed 11."""
    import torch
    from east_py_datascience.nn import nn_run

    del weights
    net_value = east_net(draws_net())
    names = ["u_keyed", "u_pos", "n_keyed", "dropped", "called", "looped", "scalar"]
    got = nn_run(net_value, weights_value({}), batch, output_names(names), run_config(training=True, seed=11))
    out = {}
    for name in names:
        v = got[name]
        out[name] = torch.from_numpy(v.value["data"].to_numpy().copy()).reshape([int(d) for d in v.value["shape"]]).float()
    return out


# ============================================================================
# East values
# ============================================================================


def east_net(data: dict[str, Any]) -> Any:
    return coerce_to(data, NetType)


def east_batch(data: dict[str, Any]) -> Any:
    return coerce_to(data, NnBatchType)


def run_config(training: bool = False, seed: int = 0) -> Any:
    return coerce_to({"device": variant("cpu", None), "seed": seed, "training": training}, NnRunConfigType)


def output_names(names: list[str]) -> Any:
    return coerce_to(names, ArrayType(StringType))


def weights_value(weights: dict[str, Any]) -> Any:
    return coerce_to(weights, NnWeightsType)
