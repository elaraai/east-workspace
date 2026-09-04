#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Categorical-feature handling shared by the XGBoost-backed modules.

XGBoost (directly, and as a MAPIE base model) takes categorical columns as a
pandas ``category`` dtype. A config names the categorical column indices and,
optionally, the number of categories per column: with that count the category
space is fixed to ``[0, n)`` at training time so prediction sees the same
space, and an unseen code becomes NaN, which XGBoost routes down its learned
default branch. Without it the categories are inferred from the data.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from east import none, some
from east.types.types import IntegerType
from east.types.values import EastStruct, EastVariant, EastVector


def categorical_config(config: EastStruct) -> tuple[list[int] | None, list[int] | None]:
    """The ``categorical_features`` / ``categorical_n`` options of a config or blob struct.

    Returns:
        ``(cat_indices, categorical_n)`` as plain integer lists, each ``None``
        when the option is ``none``.
    """
    features = config["categorical_features"].unwrap_or(None)
    counts = config["categorical_n"].unwrap_or(None)
    return (
        None if features is None else features.to_numpy(dtype=np.int64).tolist(),
        None if counts is None else counts.to_numpy(dtype=np.int64).tolist(),
    )


def categorical_options(
    cat_indices: list[int] | None, categorical_n: list[int] | None
) -> tuple[EastVariant, EastVariant]:
    """The ``Option<Vector<Integer>>`` pair a model blob stores so prediction can replay the encoding."""

    def option(values: list[int] | None) -> EastVariant:
        if values is None:
            return none
        return some(EastVector(IntegerType, np.array(values, dtype=np.int64)))

    return option(cat_indices), option(categorical_n)


def _check_indices(cat_indices: list[int], n_features: int, func_name: str) -> None:
    for idx in cat_indices:
        if idx < 0 or idx >= n_features:
            raise RuntimeError(
                f"{func_name}: categorical_features index {idx} "
                f"out of bounds for {n_features} features"
            )


def _check_integer_codes(col: Any, idx: int, func_name: str) -> None:
    """Raise unless every non-NaN entry of ``col`` is a whole number."""
    valid = col[col.notna()]
    if len(valid) == 0:
        return
    non_integer = valid != valid.astype(int)
    if non_integer.any():
        bad_row = non_integer.idxmax()
        raise RuntimeError(
            f"{func_name}: categorical column {idx} contains non-integer value "
            f"{col[bad_row]} at row {bad_row}. Categorical features must contain "
            f"whole numbers (0.0, 1.0, 2.0, ...) representing category indices."
        )


def _as_category(col: Any, idx: int, func_name: str, n_cats: int | None, check: bool) -> Any:
    """One column as a pandas categorical, in the fixed ``[0, n_cats)`` space when known."""
    import pandas as pd

    if n_cats is None:
        # Inferred category space: every entry must be a whole number.
        if (col != col.astype(int)).any():
            _check_integer_codes(col, idx, func_name)
        return col.astype(int).astype("category")
    if check:
        _check_integer_codes(col, idx, func_name)
    # Codes outside [0, n_cats) become NaN, which XGBoost handles natively.
    values = [int(v) if pd.notna(v) else np.nan for v in col.values]
    return pd.Categorical(values, categories=range(n_cats))


def prepare_categorical(
    X_np: np.ndarray,
    cat_indices: list[int] | None,
    func_name: str,
    categorical_n: list[int] | None = None,
) -> tuple[Any, list[int] | None, bool]:
    """Prepare a training matrix with categorical columns.

    Args:
        X_np: Feature matrix.
        cat_indices: Categorical column indices, or ``None`` for no categoricals.
        func_name: Calling platform function, for error messages.
        categorical_n: Category count per categorical column, or ``None`` to
            infer the categories from the data.

    Returns:
        ``(X_prepared, cat_indices, enable_categorical)``: the original array
        (or a DataFrame with ``category`` columns), the indices, and whether
        XGBoost's categorical support should be enabled.
    """
    if cat_indices is None:
        return X_np, None, False
    _check_indices(cat_indices, X_np.shape[1], func_name)
    if categorical_n is not None and len(categorical_n) != len(cat_indices):
        raise RuntimeError(
            f"{func_name}: categorical_n has {len(categorical_n)} entries "
            f"but categorical_features has {len(cat_indices)} entries"
        )

    import pandas as pd

    df = pd.DataFrame(X_np)
    for i, idx in enumerate(cat_indices):
        n_cats = None if categorical_n is None else categorical_n[i]
        df[idx] = _as_category(df[idx], idx, func_name, n_cats, check=True)
    return df, cat_indices, True


def apply_categorical(
    X_np: np.ndarray,
    cat_indices: list[int] | None,
    func_name: str,
    categorical_n: list[int] | None = None,
) -> Any:
    """Apply the training-time categorical encoding to a prediction matrix.

    Same contract as :func:`prepare_categorical`, returning only the prepared
    matrix. With a known category count, codes outside ``[0, n)`` become NaN
    rather than raising, so novel categories at prediction time are tolerated.
    """
    if cat_indices is None:
        return X_np
    _check_indices(cat_indices, X_np.shape[1], func_name)

    import pandas as pd

    df = pd.DataFrame(X_np)
    for i, idx in enumerate(cat_indices):
        n_cats = None if categorical_n is None else categorical_n[i]
        df[idx] = _as_category(df[idx], idx, func_name, n_cats, check=False)
    return df


__all__ = [
    "categorical_config",
    "categorical_options",
    "prepare_categorical",
    "apply_categorical",
]
