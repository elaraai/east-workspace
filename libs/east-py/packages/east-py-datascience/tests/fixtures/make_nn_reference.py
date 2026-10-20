#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Write ``test/nn.reference.generated.ts``: the reference families of
``tests/nn_families.py`` — each network, its weights, a batch and torch's
outputs — as TypeScript East literals, so the compliance spec
(``test/nn.spec.ts``) holds ``nn_run`` on both runners to what torch answered.

Run from this package::

    uv run --package elaraai-east-py-datascience python tests/fixtures/make_nn_reference.py

The outputs come from the hand-written torch of ``nn_families`` (what
``test_nn_reference.py`` proves the interpreter against), so the module
depends on torch's f32 arithmetic only through them.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path
from typing import Any

import numpy as np
import torch
from east.types.values import (
    EastArray,
    EastDict,
    EastNull,
    EastSet,
    EastStruct,
    EastVariant,
    EastVector,
)

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import nn_families as fam  # noqa: E402
from east_py_datascience.nn import nn_init  # noqa: E402

OUT = Path(__file__).resolve().parents[2] / "test" / "nn.reference.generated.ts"


def ts_float(x: float) -> str:
    if math.isnan(x):
        return "NaN"
    if math.isinf(x):
        return "Infinity" if x > 0 else "-Infinity"
    r = repr(float(x))
    return r


def ts_key(k: str) -> str:
    return k if k.isidentifier() else repr(k).replace("'", '"')


def ts(value: Any, indent: int = 0, map_type: str | None = None) -> str:
    """An East value as a TypeScript East literal; ``map_type`` names the value
    type of a top-level Map whose values differ in case (tsc needs it told)."""
    pad = "    " * indent
    inner = "    " * (indent + 1)
    if isinstance(value, EastStruct):
        fields = [f"{inner}{ts_key(k)}: {ts(value[k], indent + 1)}," for k in value]
        return "{\n" + "\n".join(fields) + f"\n{pad}}}"
    if isinstance(value, EastVariant):
        if value.type == "none":
            return "none"
        if value.type == "some":
            return f"some({ts(value.value, indent)})"
        return f'variant("{value.type}", {ts(value.value, indent)})'
    if isinstance(value, EastDict):
        entries = [f"{inner}[{ts(k, indent + 1)}, {ts(v, indent + 1)}]," for k, v in value.items()]
        generic = f"<string, {map_type}>" if map_type else ""
        if not entries:
            return f"new Map{generic}()"
        return f"new Map{generic}([\n" + "\n".join(entries) + f"\n{pad}])"
    if isinstance(value, EastArray):
        items = [ts(v, indent + 1) for v in value]
        if not items:
            return "[]"
        if all(isinstance(v, (int, float, str, bool, EastNull)) for v in value):
            return "[" + ", ".join(items) + "]"
        return "[\n" + "\n".join(f"{inner}{it}," for it in items) + f"\n{pad}]"
    if isinstance(value, EastSet):
        return "new Set([" + ", ".join(ts(v, indent + 1) for v in value) + "])"
    if isinstance(value, EastVector):
        arr = value.to_numpy()
        if arr.dtype.kind == "f":
            return "new Float64Array([" + ", ".join(ts_float(float(x)) for x in arr) + "])"
        if arr.dtype.kind == "b":
            return "new Uint8ClampedArray([" + ", ".join("1" if x else "0" for x in arr) + "])"
        return "new BigInt64Array([" + ", ".join(f"{int(x)}n" for x in arr) + "])"
    if isinstance(value, EastNull):
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return f"{value}n"
    if isinstance(value, float):
        return ts_float(value)
    if isinstance(value, str):
        return repr(value).replace("'", '"') if "'" in value or '"' not in repr(value) else repr(value)
    raise TypeError(f"cannot print {type(value)}")


def outputs_value(ref: dict[str, torch.Tensor]) -> EastDict:
    from east.types.types import BooleanType, FloatType, IntegerType, StringType
    from east_py_datascience.nn.types import NnValueType

    out = {}
    for name, t in ref.items():
        arr = t.detach().numpy().reshape(-1)
        shape = EastArray(IntegerType, [int(d) for d in t.shape])
        if arr.dtype.kind == "f":
            out[name] = EastVariant("float", EastStruct({"shape": shape, "data": EastVector.from_numpy(arr.astype(np.float64), FloatType)}))
        elif arr.dtype.kind == "b":
            out[name] = EastVariant("boolean", EastStruct({"shape": shape, "data": EastVector.from_numpy(arr.astype(np.bool_), BooleanType)}))
        else:
            out[name] = EastVariant("integer", EastStruct({"shape": shape, "data": EastVector.from_numpy(arr.astype(np.int64), IntegerType)}))
    return EastDict(StringType, NnValueType, out)


def family(name: str, net_data: dict, batch_data: dict, seed: int, reference: Any, override: Any = None) -> str:
    net = fam.east_net(net_data)
    weights = nn_init(net, seed)
    if override is not None:
        override(weights)
    batch = fam.east_batch(batch_data)
    ref = reference(batch, weights)
    integer_outputs = [k for k, t in ref.items() if not t.dtype.is_floating_point]
    whose = "the python runner's draws (specified, not torch's)" if name == "draws" else "torch's outputs"
    return (
        f"/** {name}: the network, its weights (nn_init, seed {seed}), a batch and {whose}. */\n"
        f"export const {name}: Family = {{\n"
        f"    net: {ts(net, 1)},\n"
        f"    weights: {ts(weights, 1)},\n"
        f"    batch: {ts(batch, 1, 'NnValue')},\n"
        f"    outputs: {ts(outputs_value(ref), 1, 'NnValue')},\n"
        f"    integerOutputs: {integer_outputs!r},\n"
        f"}};\n"
    )


def check_margins(batch: Any, weights: Any) -> bool:
    """Whether every argmax the family answers is clear of a tie by 1e-3 (f32 and f64 must agree on them)."""
    ref = fam.ref_transformer(batch, weights)
    top2 = torch.topk(ref["probs"], 2, dim=-1).values
    if float((top2[:, 0] - top2[:, 1]).min()) <= 1e-3:
        return False
    # the decoding's argmax at each step it took
    b, w = fam.torch_batch(batch), fam.torch_weights(weights)
    canvas = b["canvas_init"].clone()
    import torch.nn.functional as F

    for step in range(fam.A["T"] - 1):
        logits = F.linear(fam.ref_trunk(canvas, b, w, fam.A["heads"]), w["cat_w"], w["cat_b"])
        row = torch.softmax(logits[step], -1)
        t2 = torch.topk(row, 2).values
        if float(t2[0] - t2[1]) <= 1e-3:
            return False
        tok = logits[step].argmax()
        canvas[step + 1] = tok
        if int(tok) == fam.A["EOS"]:
            break
    return True


def main() -> None:
    torch.manual_seed(0)
    a_net = fam.transformer_net()
    a_batch = fam.transformer_batch()
    net = fam.east_net(a_net)
    # The first seed whose argmax outputs are clear of ties (f32 and f64 must agree on them).
    seed = next(s for s in range(11, 60) if check_margins(fam.east_batch(a_batch), nn_init(net, s)))
    parts = [
        "/**\n * Copyright (c) 2025 Elara AI Pty Ltd\n * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.\n */\n",
        "// Generated by tests/fixtures/make_nn_reference.py — do not edit. The\n"
        "// reference families of docs/neural-networks.md as East literals: each\n"
        "// network, its weights, a batch and the outputs hand-written torch gave\n"
        "// (f32). nn.spec.ts holds nn_run on both runners to them.\n",
        'import { variant, some, none, type ValueTypeOf } from "@elaraai/east";\n'
        'import { NetType, NnBatchType, NnValueType, NnWeightsType } from "@elaraai/east-py-datascience";\n\n'
        "type NnValue = ValueTypeOf<typeof NnValueType>;\n"
        "/** A reference family: the network, its weights, a batch, and torch's outputs. */\n"
        "export type Family = {\n"
        "    net: ValueTypeOf<typeof NetType>;\n"
        "    weights: ValueTypeOf<typeof NnWeightsType>;\n"
        "    batch: ValueTypeOf<typeof NnBatchType>;\n"
        "    outputs: ValueTypeOf<typeof NnBatchType>;\n"
        "    integerOutputs: string[];\n"
        "};\n\n",
        family("raggedTransformer", a_net, a_batch, seed, fam.ref_transformer),
        "\n",
        family("conditionedUnet", fam.unet_net(), fam.unet_batch(), 13, fam.ref_unet_family, fam.unet_weights_override),
        "\n",
        family("headSelection", fam.head_selection_net(), fam.head_selection_batch(), 3, fam.ref_head_selection),
        "\n",
        family("timeGrid", fam.time_grid_net(), fam.time_grid_batch(), 0, fam.ref_time_grid),
        "\n",
        family("rotaryConventions", fam.rotary_conventions_net(), fam.rotary_conventions_batch(), 0, fam.ref_rotary_conventions),
        "\n",
        family("draws", fam.draws_net(), fam.draws_batch(), 0, fam.ref_draws),
    ]
    OUT.write_text("".join(parts))
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
