#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The forward pass alone, for bench/model.mjs: the python interpreter over a
network, weights and batch read from beast2 files, its median of twenty runs
in seconds, printed. Run through uv from libs/east-py."""

from __future__ import annotations

import statistics
import sys
import time
from pathlib import Path

import torch
from east.serialization._beast2_eastc import decode_beast2_with_header_for
from east_py_datascience.nn._plan import build_plan
from east_py_datascience.nn._torch import Interpreter, prepare_weights
from east_py_datascience.nn.nn_impl import _batch_tensors, _decode_weights
from east_py_datascience.nn.types import NetType, NnBatchType, NnWeightsType


def main() -> None:
    net_file, weights_file, batch_file = sys.argv[1:4]
    net = decode_beast2_with_header_for(NetType)(Path(net_file).read_bytes())
    weights = decode_beast2_with_header_for(NnWeightsType)(Path(weights_file).read_bytes())
    batch = decode_beast2_with_header_for(NnBatchType)(Path(batch_file).read_bytes())
    plan = build_plan(net, "nn_run")
    device = torch.device("cpu")
    prepared = prepare_weights(plan, _decode_weights(weights), device, "nn_run")
    inputs = _batch_tensors(batch, device, "nn_run")
    interpreter = Interpreter("nn_run", device, False, 0)
    operands = [plan.outputs["probs"]]
    times = []
    with torch.no_grad():
        for _ in range(23):
            t0 = time.perf_counter()
            interpreter.run(plan, prepared, inputs, operands)
            times.append(time.perf_counter() - t0)
    print(f"{statistics.median(times[3:]):.6f}")


if __name__ == "__main__":
    main()
