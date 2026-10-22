#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""xgboost_resave on this runner: a blob from before the UBJSON form (the
cloudpickle an earlier release wrote) is refused by every prediction, naming
the conversion, and comes back from ``xgboost_resave`` as the UBJSON model
that predicts what it predicted — the one thing only this runner does, so it
is held here rather than in the suite every runner replays
(test/xgboost.spec.ts holds the refusal and the UBJSON re-save on both)."""

from __future__ import annotations

import base64
import json
from pathlib import Path

import numpy as np
import pytest
from east import none, some
from east.types.types import FloatType
from east.types.values import EastBlob, EastMatrix, EastStruct, EastVariant
from east_py_datascience.xgboost._blob import is_legacy_pickle
from east_py_datascience.xgboost.xgboost_impl import xgboost_predict, xgboost_resave

FIXTURE = Path(__file__).resolve().parents[1] / "test" / "fixtures" / "xgboost_interchange.json"


def blob_value(model: dict) -> EastVariant:
    f = model["fields"]
    vec = lambda xs: none if xs is None else some(__import__("east.types.values", fromlist=["EastVector"]).EastVector.from_numpy(np.array(xs, dtype=np.int64), __import__("east.types.types", fromlist=["IntegerType"]).IntegerType))  # noqa: E731
    return EastVariant(
        model["case"],
        EastStruct(
            {
                "data": EastBlob(base64.b64decode(f["data"])),
                "n_features": f["n_features"],
                "categorical_features": vec(f["categorical_features"]),
                "categorical_n": vec(f["categorical_n"]),
            }
        ),
    )


@pytest.mark.skipif(not FIXTURE.exists(), reason="the interchange fixture is missing")
def test_legacy_blob_is_refused_then_resaved() -> None:
    fixture = json.loads(FIXTURE.read_text())
    legacy = blob_value(fixture["legacy"]["model"])
    assert is_legacy_pickle(bytes(legacy.value["data"]))
    X = EastMatrix(FloatType, np.array(fixture["regressor"]["X"], dtype=np.float64))

    with pytest.raises(RuntimeError, match=r"^xgboost_predict: the model blob is from before the UBJSON form"):
        xgboost_predict(legacy, X)

    resaved = xgboost_resave(legacy)
    assert resaved.type == "xgboost_regressor"
    assert not is_legacy_pickle(bytes(resaved.value["data"]))
    assert int(resaved.value["n_features"]) == int(legacy.value["n_features"])
    predictions = xgboost_predict(resaved, X).to_numpy()
    np.testing.assert_allclose(predictions, np.array(fixture["regressor"]["predictions"]), rtol=0, atol=1e-6)
