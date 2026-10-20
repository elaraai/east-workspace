#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The torch interpreter against hand-written torch (#1357): the reference
families from the same weights, in the same operation order, agree to f32
rounding; the pair-proportional attention paths agree with the dense mask; and
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


def _dense_attention(q, k, v, heads, allowed, scale):
    """The dense mask's answer over `[…, T, d]` with `allowed` `[…, Tq, Tk]`."""
    *lead, t, d = q.shape
    dh = d // heads
    qh = q.reshape(*lead, t, heads, dh).transpose(-3, -2)
    kh = k.reshape(*lead, -1, heads, dh).transpose(-3, -2)
    vh = v.reshape(*lead, -1, heads, dh).transpose(-3, -2)
    scores = (qh @ kh.transpose(-1, -2)) * scale
    any_allowed = allowed.any(-1)
    scores = scores.masked_fill((~allowed & any_allowed.unsqueeze(-1)).unsqueeze(-3), float("-inf"))
    out = (torch.softmax(scores, -1) @ vh) * any_allowed.unsqueeze(-2).unsqueeze(-1).to(q.dtype)
    return out.transpose(-3, -2).reshape(*lead, t, d)


def test_segments_attention_matches_the_dense_mask_in_any_order_and_batched():
    from east_py_datascience.nn._torch import Interpreter

    g = torch.Generator().manual_seed(0)
    t, d, heads = 23, 8, 2
    for lead in ((), (3,)):
        q, k, v = (torch.randn(*lead, t, d, generator=g) for _ in range(3))
        # ids out of order, repeated apart, one id alone, lengths across several buckets
        ids = torch.randint(0, 5, (*lead, t), generator=g)
        ids[..., 0] = 7
        for causal in (False, True):
            got = Interpreter._attention_segments(q, k, v, heads, d // heads, ids, causal, 0.5)
            allowed = ids.unsqueeze(-1) == ids.unsqueeze(-2)
            if causal:
                allowed = allowed & torch.ones(t, t, dtype=torch.bool).tril()
            torch.testing.assert_close(got, _dense_attention(q, k, v, heads, allowed, 0.5), atol=1e-5, rtol=1e-5)


def test_key_sets_attention_matches_the_dense_mask():
    from east_py_datascience.nn import _torch
    from east_py_datascience.nn._torch import Interpreter

    g = torch.Generator().manual_seed(1)
    tq, tk, d, heads = 17, 13, 8, 2
    q = torch.randn(tq, d, generator=g)
    k, v = (torch.randn(tk, d, generator=g) for _ in range(2))
    ptr, keys = [0], []
    for i in range(tq):
        chosen = sorted(set(torch.randint(0, tk, (1 + i % 4,), generator=g).tolist())) if i % 5 else []
        keys.extend(chosen)
        ptr.append(len(keys))
    ptr_t, keys_t = torch.tensor(ptr), torch.tensor(keys)
    allowed = torch.zeros(tq, tk, dtype=torch.bool)
    for i in range(tq):
        allowed[i, keys_t[ptr[i] : ptr[i + 1]]] = True
    want = _dense_attention(q, k, v, heads, allowed, 0.5)
    got = Interpreter._attention_key_sets(q, k, v, heads, d // heads, ptr_t, keys_t, 0.5)
    torch.testing.assert_close(got, want, atol=1e-5, rtol=1e-5)
    # the same through several chunks
    chunk = _torch.KEY_SET_CHUNK
    _torch.KEY_SET_CHUNK = 5
    try:
        got = Interpreter._attention_key_sets(q, k, v, heads, d // heads, ptr_t, keys_t, 0.5)
    finally:
        _torch.KEY_SET_CHUNK = chunk
    torch.testing.assert_close(got, want, atol=1e-5, rtol=1e-5)


@pytest.mark.parametrize(
    ("build", "batch", "reference", "names", "seed"),
    [
        (fam.head_selection_net, fam.head_selection_batch, fam.ref_head_selection, ["back", "idx", "sel", "top"], 3),
        (fam.time_grid_net, fam.time_grid_batch, fam.ref_time_grid, ["grid", "emb", "pos", "masked"], 0),
        (fam.rotary_conventions_net, fam.rotary_conventions_batch, fam.ref_rotary_conventions, ["halves", "inter"], 0),
    ],
)
def test_the_operation_families_match_hand_written_torch(build, batch, reference, names, seed):
    net = fam.east_net(build())
    weights = nn_init(net, seed)
    b = fam.east_batch(batch())
    got = nn_run(net, weights, b, fam.output_names(names), fam.run_config())
    want = reference(b, weights)
    for name in names:
        _assert_close(got[name], want[name], name)


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
