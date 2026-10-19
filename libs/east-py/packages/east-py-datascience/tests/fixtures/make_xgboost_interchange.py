#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Writes test/fixtures/xgboost_interchange.json: XGBoost model blobs trained
on this runner, the inputs they are asked about, and what they answer.

The TypeScript spec (test/xgboost.spec.ts, "interchange") bakes the blobs into
its IR as constants, so every runner — east-py-datascience here, east-c's
east-c-datascience — predicts from the very bytes this runner wrote, and must
answer what it answered: a model trained on one runner predicts on the other.
Run it again when the blob form changes (xgboost/_blob.py), with the
east-py-datascience environment active::

    cd libs/east-py && uv run --package elaraai-east-py-datascience \\
        python packages/east-py-datascience/tests/fixtures/make_xgboost_interchange.py
"""

from __future__ import annotations

import base64
import json
from pathlib import Path

import numpy as np
from east import none, some
from east.types.types import FloatType, IntegerType
from east.types.values import EastMatrix, EastStruct, EastVector
from east_py_datascience.xgboost.xgboost_impl import (
    xgboost_predict,
    xgboost_predict_class,
    xgboost_predict_proba,
    xgboost_predict_quantile,
    xgboost_train_classifier,
    xgboost_train_quantile,
    xgboost_train_regressor,
)

OUT = Path(__file__).resolve().parents[2] / "test" / "fixtures" / "xgboost_interchange.json"

NONE_OPTIONS = {
    "min_child_weight": none,
    "subsample": none,
    "colsample_bytree": none,
    "reg_alpha": none,
    "reg_lambda": none,
    "gamma": none,
    "n_jobs": none,
    "sample_weight": none,
    "max_cat_to_onehot": none,
    "max_cat_threshold": none,
}


def matrix(rows: list[list[float]]) -> EastMatrix:
    return EastMatrix(FloatType, np.array(rows, dtype=np.float64))


def blob_struct(model) -> dict:
    """A blob variant as the fixture records it: its case and its struct's fields."""
    fields = {}
    for key, value in model.value.items():
        if key == "data":
            fields[key] = base64.b64encode(bytes(value)).decode("ascii")
        elif key in ("categorical_features", "categorical_n"):
            inner = value.unwrap_or(None)
            fields[key] = None if inner is None else inner.to_numpy().tolist()
        elif key == "quantiles":
            fields[key] = value.to_numpy().tolist()
        else:
            fields[key] = int(value)
    return {"case": model.type, "fields": fields}


def main() -> None:
    # A regressor over a numeric and a categorical column, the category space fixed
    X_reg = matrix([[1.0, 0.0], [2.0, 1.0], [3.0, 2.0], [4.0, 0.0], [5.0, 1.0], [6.0, 2.0], [7.0, 0.0], [8.0, 1.0]])
    y_reg = EastVector(FloatType, np.array([10.0, 21.0, 32.0, 13.0, 24.0, 35.0, 16.0, 27.0]))
    reg_config = EastStruct({
        "n_estimators": some(12), "max_depth": some(2), "learning_rate": some(0.3),
        **NONE_OPTIONS, "random_state": some(7),
        "categorical_features": some(EastVector(IntegerType, np.array([1], dtype=np.int64))),
        "categorical_n": some(EastVector(IntegerType, np.array([3], dtype=np.int64))),
        "scale_pos_weight": none,
    })
    regressor = xgboost_train_regressor(X_reg, y_reg, reg_config)
    X_reg_test = matrix([[2.5, 1.0], [6.5, 2.0], [7.5, 5.0]])  # 5.0 is outside the category space
    reg_pred = xgboost_predict(regressor, X_reg_test).to_numpy().tolist()

    # A three-class classifier whose labels are not contiguous
    X_clf = matrix([[0.0, 0.0], [0.5, 0.5], [1.0, 1.0], [10.0, 10.0], [10.5, 10.5], [11.0, 11.0], [20.0, 0.0], [20.5, 0.5], [21.0, 1.0]])
    y_clf = EastVector(IntegerType, np.array([1, 1, 1, 3, 3, 3, 7, 7, 7], dtype=np.int64))
    clf_config = EastStruct({
        "n_estimators": some(8), "max_depth": some(2), "learning_rate": some(0.3),
        **NONE_OPTIONS, "random_state": some(7), "categorical_features": none, "categorical_n": none,
        "scale_pos_weight": none,
    })
    classifier = xgboost_train_classifier(X_clf, y_clf, clf_config)
    X_clf_test = matrix([[0.2, 0.3], [10.2, 10.1], [20.4, 0.2]])
    clf_classes = xgboost_predict_class(classifier, X_clf_test).to_numpy().tolist()
    clf_proba = xgboost_predict_proba(classifier, X_clf_test).to_numpy().tolist()

    # A quantile model, its quantiles given out of order
    X_q = matrix([[1.0], [2.0], [3.0], [4.0], [5.0], [6.0], [7.0], [8.0]])
    y_q = EastVector(FloatType, np.array([2.0, 4.1, 5.9, 8.2, 9.8, 12.1, 14.0, 16.2]))
    q_config = EastStruct({
        "quantiles": EastVector(FloatType, np.array([0.9, 0.1, 0.5])),
        "n_estimators": some(10), "max_depth": some(2), "learning_rate": some(0.3),
        **NONE_OPTIONS, "random_state": some(7), "categorical_features": none, "categorical_n": none,
    })
    quantile = xgboost_train_quantile(X_q, y_q, q_config)
    X_q_test = matrix([[2.5], [6.5]])
    q_result = xgboost_predict_quantile(quantile, X_q_test)

    fixture = {
        "note": "Written by tests/fixtures/make_xgboost_interchange.py on east-py-datascience; "
                "every runner predicts from these blobs and must answer these values.",
        "regressor": {
            "model": blob_struct(regressor),
            "train": {
                "X": X_reg.to_numpy().tolist(),
                "y": y_reg.to_numpy().tolist(),
                "n_estimators": 12,
                "max_depth": 2,
                "learning_rate": 0.3,
                "random_state": 7,
                "categorical_features": [1],
                "categorical_n": [3],
            },
            "X": X_reg_test.to_numpy().tolist(),
            "predictions": reg_pred,
        },
        "classifier": {
            "model": blob_struct(classifier),
            "X": X_clf_test.to_numpy().tolist(),
            "classes": clf_classes,
            "probabilities": clf_proba,
        },
        "quantile": {
            "model": blob_struct(quantile),
            "X": X_q_test.to_numpy().tolist(),
            "quantiles": q_result["quantiles"].to_numpy().tolist(),
            "predictions": q_result["predictions"].to_numpy().tolist(),
        },
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(fixture, indent=1) + "\n")
    print(f"wrote {OUT}")
    print("regressor:", reg_pred)
    print("classifier:", clf_classes, [[round(p, 4) for p in row] for row in clf_proba])
    print("quantile:", fixture["quantile"]["quantiles"], fixture["quantile"]["predictions"])


if __name__ == "__main__":
    main()
