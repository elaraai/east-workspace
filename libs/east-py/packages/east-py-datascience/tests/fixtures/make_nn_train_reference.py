#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Write ``test/nn.train.reference.generated.ts``: what ``nn_train`` is held
to on both runners (east-workspace#1357 R18, R20) — one AdamW step with a
weight decay per parameter group as torch's own optimiser takes it, and the
weights after an epoch run in the seeded shuffle's order — as TypeScript East
literals, beside the network and batches they come from.

Run from this package::

    uv run --package elaraai-east-py-datascience python tests/fixtures/make_nn_train_reference.py

The AdamW step is hand-written torch (``torch.optim.AdamW`` over the groups the
specification states, on the network's hand-written forward pass), not the
interpreter; the shuffled epoch's weights are the python runner's answer,
pinned so east-c is held to the same permutation and arithmetic.
"""

from __future__ import annotations

import sys
from pathlib import Path

import torch
from east import coerce_to, none, some, variant
from east.types.types import ArrayType
from east.types.values import EastDict

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import nn_families as fam  # noqa: E402
from east.types.types import FloatType, IntegerType, StringType  # noqa: E402
from east.types.values import EastArray, EastStruct, EastVector  # noqa: E402
from east_py_datascience.nn import nn_init, nn_train  # noqa: E402
from east_py_datascience.nn.types import (  # noqa: E402
    NnBatchType,
    NnTrainConfigType,
    TensorType,
)
from make_nn_reference import ts  # noqa: E402

OUT = Path(__file__).resolve().parents[2] / "test" / "nn.train.reference.generated.ts"

# A two-layer perceptron with a decaying matrix, a non-decaying bias and a half-decaying second matrix.
LR, WD, BETAS, EPS = 0.05, 0.1, (0.9, 0.999), 1e-8


def mlp_net() -> dict:
    inputs = {"x": fam.spec("float", 2), "target": fam.spec("float", 2)}
    params = {
        "w1": fam.param([3, 2], "xavier_uniform", decay=1.0),
        "b1": fam.param([3], "normal", 0.5, decay=0.0),
        "w2": fam.param([1, 3], "xavier_uniform", decay=0.5),
    }
    nodes = [
        fam.node("h0", fam.op("linear", x="x", weight="w1", bias=some("b1"))),
        fam.node("h", fam.unary("tanh", "h0")),
        fam.node("pred", fam.op("linear", x="h", weight="w2", bias=none)),
        fam.node("err", fam.binary("sub", "pred", "target")),
        fam.node("sq", fam.binary("mul", "err", "err")),
        fam.node("flat", fam.op("reshape", x="sq", shape=[-1])),
        fam.node("loss", fam.axis_op("mean", "flat", 0)),
    ]
    return fam.net(inputs, params, {}, nodes, {"loss": "loss", "pred": "pred"})


def mlp_batch(seed: int) -> dict:
    g = torch.Generator().manual_seed(seed)
    x = torch.randn(4, 2, generator=g)
    target = (x[:, :1] * 0.7 - x[:, 1:] * 0.2 + 0.1)
    return {"x": fam.tensor(x.numpy()), "target": fam.tensor(target.numpy())}


def config(**over) -> dict:
    base = {
        "loss": "loss", "validation": none,
        "optimizer": variant("adamw", {"lr": LR, "beta1": BETAS[0], "beta2": BETAS[1], "eps": EPS, "weight_decay": WD}),
        "schedule": variant("constant", None),
        "clip_norm": none, "ema": none, "shuffle": False,
        "epochs": 1, "patience": none,
        "precision": variant("f32", None), "seed": 0, "device": variant("cpu", None),
        "recompute": set(), "progress": none,
    }
    base.update(over)
    return base


def adamw_step_reference(weights, batch) -> dict[str, torch.Tensor]:
    """One AdamW step on the hand-written forward pass, the groups by decay as the specification states."""
    w = {name: t.clone().requires_grad_(True) for name, t in fam.torch_weights(weights).items()}
    b = fam.torch_batch(batch)
    groups = [
        {"params": [w["w1"]], "weight_decay": WD * 1.0},
        {"params": [w["b1"]], "weight_decay": WD * 0.0},
        {"params": [w["w2"]], "weight_decay": WD * 0.5},
    ]
    opt = torch.optim.AdamW(groups, lr=LR, betas=BETAS, eps=EPS)
    h = torch.tanh(torch.nn.functional.linear(b["x"], w["w1"], w["b1"]))
    pred = torch.nn.functional.linear(h, w["w2"])
    loss = ((pred - b["target"]) ** 2).reshape(-1).mean()
    opt.zero_grad()
    loss.backward()
    opt.step()
    return {name: t.detach() for name, t in w.items()}


def weights_literal(tensors: dict[str, torch.Tensor]) -> str:
    out = {}
    for name, t in tensors.items():
        out[name] = EastStruct({
            "shape": EastArray(IntegerType, [int(d) for d in t.shape]),
            "data": EastVector.from_numpy(t.detach().double().reshape(-1).numpy(), FloatType),
        })
    return ts(EastDict(StringType, TensorType, out), 1)


def main() -> None:
    net_data = mlp_net()
    net = fam.east_net(net_data)
    weights = nn_init(net, 5)
    step_batch = fam.east_batch(mlp_batch(1))
    stepped = adamw_step_reference(weights, step_batch)
    # the shuffled epoch: seven batches, each a different sample, one epoch in the seed's order
    batches = [mlp_batch(s) for s in range(11, 18)]
    shuffled = nn_train(
        net, weights, coerce_to(batches, ArrayType(NnBatchType)), coerce_to([], ArrayType(NnBatchType)),
        coerce_to(config(shuffle=True, seed=3), NnTrainConfigType),
    )
    shuffled_weights = {
        name: torch.from_numpy(t["data"].to_numpy().copy()).reshape([int(d) for d in t["shape"]])
        for name, t in shuffled["weights"].items()
    }
    parts = [
        "/**\n * Copyright (c) 2025 Elara AI Pty Ltd\n * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.\n */\n",
        "// Generated by tests/fixtures/make_nn_train_reference.py — do not edit. What\n"
        "// nn_train is held to on both runners: a perceptron, its initial weights, one\n"
        "// AdamW step with a weight decay per parameter group as torch's optimiser\n"
        "// takes it, and the weights after an epoch run in the seeded shuffle's order.\n",
        'import { variant, some, none, type ValueTypeOf } from "@elaraai/east";\n'
        'import { NetType, NnBatchType, NnWeightsType } from "@elaraai/east-py-datascience";\n\n',
        f"/** The perceptron: a decaying matrix, a non-decaying bias, a half-decaying matrix. */\nexport const mlp: ValueTypeOf<typeof NetType> = {ts(net, 0)};\n\n",
        f"/** Its initial weights (nn_init, seed 5). */\nexport const initial: ValueTypeOf<typeof NnWeightsType> = {ts(weights, 0)};\n\n",
        f"/** The step's batch. */\nexport const stepBatch: ValueTypeOf<typeof NnBatchType> = {ts(step_batch, 0, 'ValueTypeOf<typeof NnBatchType> extends Map<string, infer V> ? V : never')};\n\n",
        f"/** AdamW's weights after one step (lr {LR}, weight_decay {WD} × each parameter's decay). */\nexport const stepped: ValueTypeOf<typeof NnWeightsType> = {weights_literal(stepped)};\n\n",
        "/** Seven batches for the shuffled epoch. */\nexport const epochBatches: ValueTypeOf<typeof NnBatchType>[] = [\n"
        + "".join(f"    {ts(fam.east_batch(b), 1, 'ValueTypeOf<typeof NnBatchType> extends Map<string, infer V> ? V : never')},\n" for b in batches)
        + "];\n\n",
        f"/** The weights after one epoch over epochBatches in the shuffle's order (seed 3): the python runner's answer. */\nexport const shuffled: ValueTypeOf<typeof NnWeightsType> = {weights_literal(shuffled_weights)};\n",
    ]
    OUT.write_text("".join(parts))
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
