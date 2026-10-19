#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The torch interpreter against hand-written torch (#1357): both reference
families from the same weights, in the same operation order, agree to f32
rounding; the blockwise attention path agrees with the dense one; and
``nn_train`` lowers the U-Net's loss."""

from __future__ import annotations

import numpy as np
import pytest

torch = pytest.importorskip("torch")

from east import coerce_to, some, variant  # noqa: E402
from east.types.types import ArrayType  # noqa: E402
from east_py_datascience.nn import nn_init, nn_run, nn_train  # noqa: E402
from east_py_datascience.nn.types import NnBatchType, NnTrainConfigType  # noqa: E402

from . import nn_families as fam  # noqa: E402


def _as_numpy(value):
    return value.value["data"].to_numpy().reshape([int(d) for d in value.value["shape"]])


def _assert_close(got, want, name, atol=2e-5, rtol=1e-4):
    want_np = want.detach().numpy()
    got_np = _as_numpy(got)
    assert got_np.shape == want_np.shape, (name, got_np.shape, want_np.shape)
    if want_np.dtype.kind in "iub":
        np.testing.assert_array_equal(got_np, want_np, err_msg=name)
    else:
        np.testing.assert_allclose(got_np, want_np, atol=atol, rtol=rtol, err_msg=name)


def test_ragged_transformer_matches_hand_written_torch():
    net = fam.east_net(fam.transformer_net())
    weights = nn_init(net, 11)
    batch = fam.east_batch(fam.transformer_batch())
    names = ["loss", "probs", "next_token", "survival", "decoded", "hidden"]
    got = nn_run(net, weights, batch, fam.output_names(names), fam.run_config())
    want = fam.ref_transformer(batch, weights)
    for name in names:
        _assert_close(got[name], want[name], name)
    # the decoding wrote past the first token, and stopped at or before the end
    decoded = _as_numpy(got["decoded"])
    assert decoded[1] != 0 or int(_as_numpy(got["next_token"])[0]) == 0


def test_conditioned_unet_matches_hand_written_torch():
    net = fam.east_net(fam.unet_net())
    weights = nn_init(net, 13)
    fam.unet_weights_override(weights)
    batch = fam.east_batch(fam.unet_batch())
    names = ["loss", "velocity", "sample", "mono_max", "mono_min", "mono_sum"]
    got = nn_run(net, weights, batch, fam.output_names(names), fam.run_config())
    want = fam.ref_unet_family(batch, weights)
    for name in names:
        _assert_close(got[name], want[name], name, atol=5e-5)
    sde = _as_numpy(nn_run(net, weights, batch, fam.output_names(["sde_sample"]), fam.run_config())["sde_sample"])
    assert sde.shape == (fam.B_CFG["N"], fam.B_CFG["C"], fam.B_CFG["L"]) and np.isfinite(sde).all()
    # the monotone outputs are monotone along the sequence
    mono_max, mono_min, mono_sum = (_as_numpy(got[n]) for n in ("mono_max", "mono_min", "mono_sum"))
    assert (np.diff(mono_max, axis=-1) >= -1e-6).all()
    assert (np.diff(mono_min, axis=-1) <= 1e-6).all()
    assert (np.diff(mono_sum, axis=-1) >= -1e-6).all()


def test_blockwise_attention_matches_the_dense_mask():
    from east_py_datascience.nn._torch import Interpreter

    g = torch.Generator().manual_seed(0)
    t, d, heads = 12, 8, 2
    q, k, v = (torch.randn(t, d, generator=g) for _ in range(3))
    ids = torch.tensor([0, 0, 0, 1, 1, 2, 2, 2, 2, 3, 3, 3])
    interp = Interpreter("nn_run", torch.device("cpu"), False, g)
    for causal in (False, True):
        blocks = Interpreter._attention_blocks(q, k, v, heads, d // heads, ids, causal, 1.0 / 2.0)
        env = {"q": q, "k": k, "v": v, "ids": ids}
        args = {"q": "q", "k": "k", "v": "v", "heads": heads, "bias": None, "scale": None,
                "mask": ("segments", {"ids": "ids", "causal": causal})}
        # the dense path: ids out of order would take it, so give it the same ids through a permuted copy
        allowed = interp._mask("segments", {"ids": "ids", "causal": causal}, env, (), t, t, q.device, RuntimeError)
        qh = q.reshape(t, heads, 4).transpose(0, 1)
        kh = k.reshape(t, heads, 4).transpose(0, 1)
        vh = v.reshape(t, heads, 4).transpose(0, 1)
        scores = (qh @ kh.transpose(1, 2)) / 2.0
        scores = scores.masked_fill((~allowed)[None], float("-inf"))
        dense = (torch.softmax(scores, -1) @ vh).transpose(0, 1).reshape(t, d)
        torch.testing.assert_close(blocks, dense, atol=1e-5, rtol=1e-5)
        del args


def test_nn_train_lowers_the_unet_loss():
    net = fam.east_net(fam.unet_net())
    weights = nn_init(net, 17)
    fam.unet_weights_override(weights)
    batches = coerce_to([fam.unet_batch(seed=s) for s in (1, 2, 3)], ArrayType(NnBatchType))
    config = coerce_to(
        {
            "loss": "loss", "validation": some("loss"),
            "optimizer": variant("adamw", {"lr": 3e-3, "beta1": 0.9, "beta2": 0.999, "eps": 1e-8, "weight_decay": 0.01}),
            "schedule": variant("warmup_cosine", {"warmup_steps": 3, "min_lr": 1e-4}),
            "clip_norm": some(1.0), "ema_decay": some(0.9),
            "epochs": 6, "patience": some(10),
            "precision": variant("f32", None), "seed": 0, "device": variant("cpu", None),
            "recompute": {"unet"},
        },
        NnTrainConfigType,
    )
    result = nn_train(net, weights, batches, batches, config)
    history = [(int(h["epoch"]), float(h["loss"]), h["validation"].value, float(h["learning_rate"])) for h in result["history"]]
    assert [h[0] for h in history] == [1, 2, 3, 4, 5, 6]
    assert history[-1][1] < history[0][1]
    assert 1 <= int(result["best_epoch"]) <= 6
    assert set(result["weights"].keys()) == set(weights.keys())
    assert history[-1][3] < history[0][3] and history[-1][3] >= 1e-4  # the cosine decays toward min_lr
