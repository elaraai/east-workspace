#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The XGBoost model blob every runner reads.

A blob's ``data`` is XGBoost's own UBJSON model (``Booster.save_raw("ubj")``),
so a model trained on one runner predicts on the other (east-c-datascience
writes and reads the same bytes). A classifier carries its class labels as
the booster attribute ``east_classes``, a JSON array of integers; a quantile
model is a container of one UBJSON model per quantile: :data:`QUANTILE_MAGIC`,
a little-endian ``u32`` count, then each model's quantile (``f64``), length
(``u64``) and bytes.

Blobs an earlier release wrote are cloudpickle (a protocol-2+ pickle begins
with ``0x80``; UBJSON with ``{``). Every runner refuses one the same way,
naming the conversion: ``xgboost_resave`` reads it — on this runner, which
alone reads a pickle — and writes it in the UBJSON form, once.
"""

from __future__ import annotations

import json
import struct
from typing import Any

import numpy as np
from east.types.values import EastBlob

from east_py_datascience._common import deserialize

QUANTILE_MAGIC = b"E3XGBQ01"
"""The first eight bytes of a quantile model blob."""

_HEADER = struct.Struct("<8sI")
_ENTRY = struct.Struct("<dQ")


def is_legacy_pickle(data: bytes) -> bool:
    """Whether ``data`` is a cloudpickle blob from before the UBJSON form."""
    return data[:1] == b"\x80"


LEGACY_MESSAGE = (
    "the model blob is from before the UBJSON form (a cloudpickle); "
    "re-save it once with xgboost_resave on the python runner"
)
"""What every runner says of a pre-UBJSON blob, after the function's name."""


def refuse_legacy(blob: EastBlob, fn: str) -> None:
    """Refuses a cloudpickle blob as every runner refuses it, naming the conversion."""
    if is_legacy_pickle(bytes(blob)):
        raise RuntimeError(f"{fn}: {LEGACY_MESSAGE}")


def booster_blob(model: Any) -> EastBlob:
    """The UBJSON model of a fitted sklearn wrapper or a ``Booster``."""
    import xgboost as xgb

    booster = model if isinstance(model, xgb.Booster) else model.get_booster()
    return EastBlob(bytes(booster.save_raw("ubj")))


def classifier_blob(model: Any, classes: np.ndarray) -> EastBlob:
    """The UBJSON model of a fitted classifier, carrying its class labels."""
    booster = model.get_booster()
    booster.set_attr(east_classes=json.dumps([int(c) for c in classes]))
    return booster_blob(booster)


def _loaded(estimator: Any, data: bytes) -> Any:
    """``estimator`` holding the model ``data`` (an sklearn wrapper over the booster)."""
    estimator.load_model(bytearray(data))
    return estimator


def load_regressor(blob: EastBlob, legacy: bool = False) -> Any:
    """The fitted regressor a ``xgboost_regressor`` blob holds; a pickle only
    when ``legacy`` (``xgboost_resave``'s read)."""
    data = bytes(blob)
    if is_legacy_pickle(data):
        if not legacy:
            raise RuntimeError(LEGACY_MESSAGE)
        return deserialize(blob)
    import xgboost as xgb

    return _loaded(xgb.XGBRegressor(), data)


def load_classifier(blob: EastBlob, legacy: bool = False) -> tuple[Any, np.ndarray]:
    """The fitted classifier a ``xgboost_classifier`` blob holds, and its class
    labels; a pickle only when ``legacy`` (``xgboost_resave``'s read)."""
    data = bytes(blob)
    if is_legacy_pickle(data):
        if not legacy:
            raise RuntimeError(LEGACY_MESSAGE)
        old = deserialize(blob)
        return old["model"], np.asarray(old["classes"])
    import xgboost as xgb

    model = _loaded(xgb.XGBClassifier(), data)
    labels = model.get_booster().attr("east_classes")
    if labels is None:
        raise RuntimeError("the classifier blob carries no class labels")
    return model, np.asarray(json.loads(labels), dtype=np.int64)


def quantile_blob(models: dict[float, Any]) -> EastBlob:
    """The container of one UBJSON model per quantile, in ascending order."""
    out = bytearray(_HEADER.pack(QUANTILE_MAGIC, len(models)))
    for q in sorted(models):
        raw = bytes(booster_blob(models[q]))
        out += _ENTRY.pack(float(q), len(raw))
        out += raw
    return EastBlob(bytes(out))


def load_quantiles(blob: EastBlob, legacy: bool = False) -> dict[float, Any]:
    """The fitted regressors a ``xgboost_quantile`` blob holds, by quantile; a
    pickle only when ``legacy`` (``xgboost_resave``'s read)."""
    data = bytes(blob)
    if is_legacy_pickle(data):
        if not legacy:
            raise RuntimeError(LEGACY_MESSAGE)
        return deserialize(blob)
    if data[: len(QUANTILE_MAGIC)] != QUANTILE_MAGIC:
        raise RuntimeError("the quantile model blob is not one this runner reads")
    import xgboost as xgb

    _magic, count = _HEADER.unpack_from(data, 0)
    at = _HEADER.size
    models: dict[float, Any] = {}
    for _ in range(count):
        q, length = _ENTRY.unpack_from(data, at)
        at += _ENTRY.size
        models[q] = _loaded(xgb.XGBRegressor(), data[at : at + length])
        at += length
    return models


__all__ = [
    "QUANTILE_MAGIC",
    "LEGACY_MESSAGE",
    "is_legacy_pickle",
    "refuse_legacy",
    "booster_blob",
    "classifier_blob",
    "load_regressor",
    "load_classifier",
    "quantile_blob",
    "load_quantiles",
]
