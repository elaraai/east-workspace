#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Sklearn platform functions for East.

Provides core machine learning utilities: preprocessing, model selection, and metrics.
Uses ONNX for model serialization to enable portable inference.
"""

import warnings

# Suppress sklearn warnings
warnings.filterwarnings("ignore", module="sklearn")

import importlib.util  # noqa: E402

import numpy as np  # noqa: E402
from east.runtime.platform import platform_function, platform_functions  # noqa: E402
from east.types.types import ArrayType, FloatType, IntegerType, MatrixType, VectorType  # noqa: E402
from east.types.values import (  # noqa: E402
    EastArray,
    EastBlob,
    EastMatrix,
    EastStruct,
    EastVariant,
    EastVector,
)

from east_py_datascience.types import (  # noqa: E402
    ClassificationMetricResultsType,
    ClassificationMetricResultType,
    ClassificationMetricsConfigType,
    ClassificationMetricType,
    ClassWeightModeType,
    ConfusionMatrixResultType,
    GMMConfigType,
    MetricResultType,
    MetricsResultType,
    ModelBlobType,
    MultiClassificationConfigType,
    MultiClassificationMetricResultsType,
    MultiClassificationMetricResultType,
    MultiMetricResultType,
    MultiMetricsConfigType,
    MultiMetricsResultType,
    OverlapConfigType,
    OverlapResultType,
    # Flexible metrics types
    RegressionMetricType,
    RegressorChainConfigType,
    RocAucConfigType,
    SplitConfigType,
    SplitResultType,
    _get_enum_tag,
    _get_option,
)

# ============================================================================
# ONNX Helpers
# ============================================================================


def _sklearn_to_onnx(model, n_features: int) -> EastBlob:
    """Convert sklearn model to ONNX bytes."""
    from skl2onnx import convert_sklearn
    from skl2onnx.common.data_types import FloatTensorType

    initial_type = [("X", FloatTensorType([None, n_features]))]
    onnx_model = convert_sklearn(model, initial_types=initial_type)
    return EastBlob(onnx_model.SerializeToString())


def _onnx_transform(onnx_blob: EastBlob, X: EastArray) -> EastArray:
    """Run transform (e.g., scaler) using ONNX Runtime."""
    import onnxruntime as ort

    onnx_bytes = bytes(onnx_blob)
    X_np = X.to_numpy(dtype=np.float32)

    session = ort.InferenceSession(onnx_bytes)
    input_name = session.get_inputs()[0].name

    outputs = session.run(None, {input_name: X_np})
    X_transformed = outputs[0]

    return EastMatrix(FloatType, np.atleast_2d(X_transformed).astype(np.float64))



# Lazy import guard for optional dependency
_HAS_SKLEARN_SUPPORT = importlib.util.find_spec("sklearn") is not None


def _check_sklearn_support() -> None:
    """Check if sklearn support is available."""
    if not _HAS_SKLEARN_SUPPORT:
        raise NotImplementedError(
            "Sklearn support requires the 'sklearn' extra. "
            "Add east-py-datascience[sklearn] to your pyproject.toml dependencies."
        )


# ============================================================================
# Platform Function Implementations
# ============================================================================


def _combine_stratify_columns(columns: list[np.ndarray]) -> np.ndarray:
    """Combine multiple stratification columns into compound strata.

    Uses dynamic multipliers based on actual ranges to avoid collisions.
    For columns [A, B, C], computes: A * (max_B+1) * (max_C+1) + B * (max_C+1) + C
    """
    if len(columns) == 1:
        return columns[0]

    # Normalize each column to start from 0 and compute bases
    normalized = []
    bases = []
    for col in columns:
        col_min = col.min()
        normalized.append(col - col_min)
        bases.append(int(col.max() - col_min + 1))

    # Compute cumulative multipliers (from right to left)
    # For columns [A, B, C] with bases [bA, bB, bC]:
    # multipliers = [bB * bC, bC, 1]
    multipliers = [1] * len(columns)
    for i in range(len(columns) - 2, -1, -1):
        multipliers[i] = multipliers[i + 1] * bases[i + 1]

    # Combine: sum(normalized[i] * multipliers[i])
    combined = np.zeros(len(columns[0]), dtype=np.int64)
    for _, (col, mult) in enumerate(zip(normalized, multipliers, strict=False)):
        combined += col.astype(np.int64) * mult

    return combined


def _stratified_n_way_split(
    indices: np.ndarray,
    strata: np.ndarray,
    split_sizes: list[float],
    random_state: int | None,
    shuffle: bool,
) -> list[np.ndarray]:
    """Single-pass stratified N-way split.

    For each stratum, allocates samples proportionally to N splits.
    Guarantees each stratum with >= N samples has representation in all splits.
    """
    rng = np.random.default_rng(random_state)
    n_splits = len(split_sizes)

    # Initialize empty lists for each split
    split_indices = [[] for _ in range(n_splits)]

    # Group indices by stratum
    unique_strata = np.unique(strata)

    for stratum in unique_strata:
        stratum_mask = strata == stratum
        stratum_indices = indices[stratum_mask]

        if shuffle:
            rng.shuffle(stratum_indices)

        # Allocate proportionally to each split
        n_stratum = len(stratum_indices)
        allocated = 0

        for i, size in enumerate(split_sizes):
            if i == n_splits - 1:
                # Last split gets remaining
                count = n_stratum - allocated
            else:
                # Round to ensure at least 1 per split when possible
                count = max(1, int(round(n_stratum * size))) if n_stratum >= n_splits else int(round(n_stratum * size))
                # Don't exceed remaining samples
                count = min(count, n_stratum - allocated - (n_splits - i - 1))
                count = max(0, count)

            split_indices[i].extend(stratum_indices[allocated:allocated + count])
            allocated += count

    # Convert to numpy arrays
    return [np.array(s, dtype=np.int64) for s in split_indices]


@platform_function(
    name="sklearn_split",
    inputs=[MatrixType(FloatType), MatrixType(FloatType), SplitConfigType],
    output=SplitResultType,
)
def sklearn_split_impl(
    X: EastMatrix,
    Y: EastMatrix,
    config: EastStruct,
) -> EastStruct:
    """Split feature and target matrices into N subsets (train/test, train/val/test, etc.).

    Performs single-pass proportional allocation per stratum, with optional
    stratification, overlap enforcement, and multi-valued overlap columns.
    Rows whose overlap-column values are too rare (below ``min_overlap``) are
    placed in ``rejected_indices`` rather than any split.

    Args:
        X: ``Matrix<Float>`` (``EastMatrix``) - feature matrix, shape
            (n_samples, n_features).
        Y: ``Matrix<Float>`` (``EastMatrix``) - target matrix, shape
            (n_samples, n_targets); must have the same number of rows as X.
        config: ``SplitConfigType`` (``EastStruct``) with fields:

            - ``split_sizes`` (``Array<Float>``): proportions that must sum
              to 1.0, e.g. ``[0.7, 0.15, 0.15]`` for train/val/test.
            - ``random_state`` (``Option<Integer>``): RNG seed; default None.
            - ``shuffle`` (``Option<Boolean>``): shuffle before splitting;
              default true.
            - ``stratify`` (``Option<Matrix<Integer>>``): each row is one
              column of integer stratum labels; rows are combined into
              compound strata.
            - ``overlap`` (``Option<Matrix<Integer>>``): each row is one
              column of integer labels that must appear in every split;
              samples whose values are too rare are rejected.
            - ``multi_overlap`` (``Option<Array<Array<Vector<Integer>>>>``):
              multi-valued overlap columns; each sample may belong to
              multiple categories.
            - ``min_overlap`` (``Option<Integer>``): minimum samples per
              overlap value before rejection; default equals n_splits.

    Returns:
        ``SplitResultType`` (``EastStruct``): ``X_splits`` /
        ``Y_splits`` (``Array<Matrix<Float>>``, one entry per split in
        ``split_sizes`` order), ``rejected_indices`` (``Array<Integer>``
        of original row indices rejected due to rare overlap values).

    Raises:
        NotImplementedError: the ``sklearn`` extra is not installed.
        RuntimeError: split_sizes length < 2, split_sizes do not sum to
            1.0, row-count mismatch between X and Y, or split failure.
    """
    _check_sklearn_support()
    try:
        X_np = X.to_numpy()
        Y_np = Y.to_numpy()
    except Exception as e:
        raise RuntimeError(f"sklearn_split: Invalid input data - {e}") from e

    if X_np.shape[0] != Y_np.shape[0]:
        raise RuntimeError(
            f"sklearn_split: X has {X_np.shape[0]} samples "
            f"but Y has {Y_np.shape[0]} samples"
        )

    # Parse config
    split_sizes = [float(s) for s in config.get("split_sizes")]
    n_splits = len(split_sizes)

    if n_splits < 2:
        raise RuntimeError("sklearn_split: split_sizes must have at least 2 elements")

    if abs(sum(split_sizes) - 1.0) > 0.01:
        raise RuntimeError(f"sklearn_split: split_sizes must sum to 1.0, got {sum(split_sizes)}")

    random_state = _get_option(config.get("random_state"), None)
    shuffle = _get_option(config.get("shuffle"), True)
    stratify_columns = _get_option(config.get("stratify"), None)
    overlap_columns = _get_option(config.get("overlap"), None)

    if random_state is not None:
        random_state = int(random_state)

    # min_overlap: minimum samples per overlap value (default = n_splits, need at least 1 per split)
    min_overlap = _get_option(config.get("min_overlap"), n_splits)
    min_overlap = int(min_overlap) if min_overlap is not None else n_splits

    # Multi-value overlap: each sample can have MULTIPLE values (a set)
    multi_overlap_columns = _get_option(config.get("multi_overlap"), None)

    n_samples = X_np.shape[0]
    rejected_indices = []
    original_indices = np.arange(n_samples)

    # Build compound stratification from multiple columns (no pre-filtering, just for distribution)
    stratify_arr = None
    if stratify_columns is not None:
        # stratify_columns is an EastMatrix (rows=columns, cols=samples)
        stratify_data = stratify_columns.to_numpy()
        columns = [stratify_data[i].astype(np.int64) for i in range(stratify_data.shape[0])]
        for i, col in enumerate(columns):
            if len(col) != n_samples:
                raise RuntimeError(
                    f"sklearn_split: stratify column {i} has {len(col)} labels "
                    f"but X has {n_samples} samples"
                )
        stratify_arr = _combine_stratify_columns(columns)

    # Build overlap columns array if provided (keep as list of columns, not combined)
    # Pre-filter: reject samples where ANY overlap column value has fewer than min_overlap samples
    overlap_cols_filtered = None
    if overlap_columns is not None:
        # overlap_columns is an EastMatrix (rows=columns, cols=samples)
        overlap_data = overlap_columns.to_numpy()
        overlap_cols = [overlap_data[i].astype(np.int64) for i in range(overlap_data.shape[0])]
        for i, col in enumerate(overlap_cols):
            if len(col) != n_samples:
                raise RuntimeError(
                    f"sklearn_split: overlap column {i} has {len(col)} labels "
                    f"but X has {n_samples} samples"
                )

        # Find values with enough samples in each column
        keep_mask = np.ones(n_samples, dtype=bool)
        for col in overlap_cols:
            unique_vals, counts = np.unique(col, return_counts=True)
            rare_vals = set(unique_vals[counts < min_overlap])
            if rare_vals:
                col_mask = np.array([v not in rare_vals for v in col])
                keep_mask = keep_mask & col_mask

        if not keep_mask.all():
            rejected_indices = original_indices[~keep_mask].tolist()
            X_np = X_np[keep_mask]
            Y_np = Y_np[keep_mask]
            if stratify_arr is not None:
                stratify_arr = stratify_arr[keep_mask]
            original_indices = original_indices[keep_mask]
            overlap_cols_filtered = [col[keep_mask] for col in overlap_cols]
        else:
            overlap_cols_filtered = overlap_cols

    # Build multi-overlap columns array if provided
    # Structure: multi_overlap_columns[col_idx][sample_idx] = list of values for that sample
    multi_overlap_cols_filtered = None
    if multi_overlap_columns is not None:
        multi_overlap_cols = []
        for col_idx, col in enumerate(multi_overlap_columns):
            # col is an EastArray of EastVector(IntegerType) - each sample is a vector of values
            col_as_lists = [sample_vec.to_numpy().tolist() for sample_vec in col]
            if len(col_as_lists) != n_samples:
                raise RuntimeError(
                    f"sklearn_split: multi_overlap column {col_idx} has {len(col_as_lists)} samples "
                    f"but X has {n_samples} samples"
                )
            multi_overlap_cols.append(col_as_lists)

        # Pre-filter based on rejected_indices from regular overlap
        # Need to filter multi_overlap_cols to match the current sample set
        if len(original_indices) < n_samples:
            # Map from original index to new index
            orig_idx_set = set(original_indices)
            multi_overlap_cols_temp = []
            for col in multi_overlap_cols:
                # Filter to only samples that are still in the set
                filtered_col = [col[i] for i in range(n_samples) if i in orig_idx_set]
                multi_overlap_cols_temp.append(filtered_col)
            multi_overlap_cols = multi_overlap_cols_temp

        # For multi-overlap, count samples per value (a sample counts once per unique value it has)
        keep_mask = np.ones(len(X_np), dtype=bool)
        for col in multi_overlap_cols:
            # Count samples containing each unique value
            value_counts: dict[int, int] = {}
            for sample_vals in col:
                for v in set(sample_vals):  # unique values per sample
                    value_counts[v] = value_counts.get(v, 0) + 1

            # Find rare values
            rare_vals = {v for v, count in value_counts.items() if count < min_overlap}

            if rare_vals:
                # Reject samples where ALL their values are rare
                # (if any value is not rare, the sample can be kept)
                for i, sample_vals in enumerate(col):
                    sample_vals_set = set(sample_vals)
                    if sample_vals_set and sample_vals_set.issubset(rare_vals):
                        keep_mask[i] = False

        if not keep_mask.all():
            # Track newly rejected
            newly_rejected = original_indices[~keep_mask].tolist()
            rejected_indices.extend(newly_rejected)

            X_np = X_np[keep_mask]
            Y_np = Y_np[keep_mask]
            if stratify_arr is not None:
                stratify_arr = stratify_arr[keep_mask]
            original_indices = original_indices[keep_mask]
            if overlap_cols_filtered is not None:
                overlap_cols_filtered = [col[keep_mask] for col in overlap_cols_filtered]

            # Filter multi_overlap_cols
            keep_indices = np.where(keep_mask)[0]
            multi_overlap_cols_filtered = [
                [col[i] for i in keep_indices] for col in multi_overlap_cols
            ]
        else:
            multi_overlap_cols_filtered = multi_overlap_cols

    try:
        current_indices = np.arange(len(X_np))

        if stratify_arr is not None:
            # Use single-pass stratified split
            split_idx_lists = _stratified_n_way_split(
                current_indices, stratify_arr, split_sizes, random_state, shuffle
            )
        else:
            # Non-stratified: just shuffle and split proportionally
            rng = np.random.default_rng(random_state)
            if shuffle:
                rng.shuffle(current_indices)

            split_idx_lists = []
            allocated = 0
            for i, size in enumerate(split_sizes):
                if i == n_splits - 1:
                    count = len(current_indices) - allocated
                else:
                    count = int(round(len(current_indices) * size))
                split_idx_lists.append(current_indices[allocated:allocated + count])
                allocated += count

        # Build X_splits and Y_splits from indices
        X_splits = [X_np[idx] if len(idx) > 0 else np.empty((0, X_np.shape[1]), dtype=X_np.dtype) for idx in split_idx_lists]
        Y_splits = [Y_np[idx] if len(idx) > 0 else np.empty((0, Y_np.shape[1]), dtype=Y_np.dtype) for idx in split_idx_lists]

        # Build overlap_splits for post-validation (per-column arrays for each split)
        if overlap_cols_filtered is not None:
            overlap_splits_per_col = [
                [col[idx] for col in overlap_cols_filtered] if len(idx) > 0 else None
                for idx in split_idx_lists
            ]
        else:
            overlap_splits_per_col = [None] * n_splits
        idx_splits = split_idx_lists

        # Post-split validation for overlap and multi_overlap
        # Uses iterative filtering: reject samples with non-common values, recompute common, repeat
        # This ensures convergence to a stable set where all values appear in all splits

        has_overlap = overlap_cols_filtered is not None
        has_multi_overlap = multi_overlap_cols_filtered is not None

        if has_overlap or has_multi_overlap:
            max_iterations = 100  # Safety limit
            iteration = 0

            while iteration < max_iterations:
                iteration += 1
                total_rejected_this_iter = 0

                # --- OVERLAP: single-valued columns ---
                if has_overlap:
                    n_overlap_cols = len(overlap_cols_filtered)

                    # Rebuild overlap data from current idx_splits
                    overlap_splits_per_col = []
                    for col in overlap_cols_filtered:
                        splits_for_col = []
                        for split_idx_arr in idx_splits:
                            if len(split_idx_arr) > 0:
                                splits_for_col.append(col[split_idx_arr])
                            else:
                                splits_for_col.append(np.array([]))
                        overlap_splits_per_col.append(splits_for_col)

                    # Find common values per column
                    common_values_per_col = []
                    for col_idx in range(n_overlap_cols):
                        col_values_per_split = [
                            set(overlap_splits_per_col[col_idx][i])
                            for i in range(n_splits)
                            if len(idx_splits[i]) > 0
                        ]
                        if col_values_per_split:
                            common = col_values_per_split[0]
                            for vals in col_values_per_split[1:]:
                                common = common & vals
                            common_values_per_col.append(common)
                        else:
                            common_values_per_col.append(set())

                    # Filter samples with non-common values
                    for i in range(n_splits):
                        if len(idx_splits[i]) == 0:
                            continue

                        keep_mask = np.ones(len(X_splits[i]), dtype=bool)
                        for col_idx in range(n_overlap_cols):
                            col_values = overlap_splits_per_col[col_idx][i]
                            common = common_values_per_col[col_idx]
                            col_mask = np.array([v in common for v in col_values])
                            keep_mask = keep_mask & col_mask

                        n_rejected = np.sum(~keep_mask)
                        if n_rejected > 0:
                            total_rejected_this_iter += n_rejected
                            split_rejected = original_indices[idx_splits[i][~keep_mask]].tolist()
                            rejected_indices.extend(split_rejected)
                            X_splits[i] = X_splits[i][keep_mask]
                            Y_splits[i] = Y_splits[i][keep_mask]
                            idx_splits[i] = idx_splits[i][keep_mask]

                # --- MULTI_OVERLAP: multi-valued columns ---
                if has_multi_overlap:
                    n_multi_cols = len(multi_overlap_cols_filtered)

                    # Rebuild multi_overlap data from current idx_splits
                    multi_overlap_splits_per_col = []
                    for col in multi_overlap_cols_filtered:
                        splits_for_col = []
                        for split_idx_arr in idx_splits:
                            if len(split_idx_arr) > 0:
                                splits_for_col.append([col[i] for i in split_idx_arr])
                            else:
                                splits_for_col.append([])
                        multi_overlap_splits_per_col.append(splits_for_col)

                    # Find common values per column
                    common_values_per_col = []
                    for col_idx in range(n_multi_cols):
                        col_splits = multi_overlap_splits_per_col[col_idx]
                        values_per_split = []
                        for split_samples in col_splits:
                            split_vals = set()
                            for sample_vals in split_samples:
                                split_vals.update(sample_vals)
                            values_per_split.append(split_vals)

                        if values_per_split and all(len(v) > 0 for v in values_per_split):
                            common = values_per_split[0]
                            for vals in values_per_split[1:]:
                                common = common & vals
                            common_values_per_col.append(common)
                        else:
                            common_values_per_col.append(set())

                    # Filter samples with non-common values
                    for i in range(n_splits):
                        if len(idx_splits[i]) == 0:
                            continue

                        keep_mask = np.ones(len(X_splits[i]), dtype=bool)
                        for col_idx in range(n_multi_cols):
                            col_samples = multi_overlap_splits_per_col[col_idx][i]
                            common = common_values_per_col[col_idx]

                            for j, sample_vals in enumerate(col_samples):
                                sample_vals_set = set(sample_vals)
                                if sample_vals_set and not sample_vals_set.issubset(common):
                                    keep_mask[j] = False

                        n_rejected = np.sum(~keep_mask)
                        if n_rejected > 0:
                            total_rejected_this_iter += n_rejected
                            split_rejected = original_indices[idx_splits[i][~keep_mask]].tolist()
                            rejected_indices.extend(split_rejected)
                            X_splits[i] = X_splits[i][keep_mask]
                            Y_splits[i] = Y_splits[i][keep_mask]
                            idx_splits[i] = idx_splits[i][keep_mask]

                # Check convergence
                if total_rejected_this_iter == 0:
                    break

    except Exception as e:
        raise RuntimeError(
            f"sklearn_split: Split failed with X shape {X_np.shape} - {e}"
        ) from e

    return EastStruct(
        {
            "X_splits": EastArray(
                MatrixType(FloatType),
                [EastMatrix(FloatType, np.atleast_2d(x).astype(np.float64)) for x in X_splits]
            ),
            "Y_splits": EastArray(
                MatrixType(FloatType),
                [EastMatrix(FloatType, np.atleast_2d(y).astype(np.float64)) for y in Y_splits]
            ),
            "rejected_indices": EastArray(
                IntegerType,
                [int(i) for i in sorted(set(rejected_indices))]
            ),
        }
    )


def _filter_by_known_categories(
    known_per_col: dict[int, set[int]],
    X: np.ndarray,
) -> np.ndarray:
    """Return a boolean mask keeping only rows where all categorical columns have known values.

    Args:
        known_per_col: Dict mapping column index to set of known (allowed) integer values.
        X: Feature matrix (N x D).

    Returns:
        Boolean mask of length N (True = keep).
    """
    keep_mask = np.ones(len(X), dtype=bool)
    for ci, known_vals in known_per_col.items():
        col_vals = X[:, ci].astype(int)
        col_mask = np.array([v in known_vals for v in col_vals])
        keep_mask &= col_mask
    return keep_mask


@platform_function(
    name="sklearn_overlap",
    inputs=[MatrixType(FloatType), ArrayType(MatrixType(FloatType)), ArrayType(MatrixType(FloatType)), OverlapConfigType],
    output=OverlapResultType,
)
def sklearn_overlap_impl(
    X_reference: EastMatrix,
    X_targets: EastArray,
    Y_targets: EastArray,
    config: EastStruct,
) -> EastStruct:
    """Filter target matrices to rows whose categorical values all appear in the reference.

    Given a reference feature matrix (e.g. training data) and one or more
    target matrices (e.g. validation, calibration, inference), removes rows
    from each target where any categorical column holds a value not seen in
    the reference. X and Y targets are filtered in sync.

    Args:
        X_reference: ``Matrix<Float>`` (``EastMatrix``) - reference feature
            matrix; defines the set of known category values per column.
        X_targets: ``Array<Matrix<Float>>`` (``EastArray``) - target feature
            matrices to filter.
        Y_targets: ``Array<Matrix<Float>>`` (``EastArray``) - target label
            matrices; must correspond one-to-one with ``X_targets`` and have
            the same row counts.
        config: ``OverlapConfigType`` (``EastStruct``) with fields:

            - ``cat_indices`` (``Vector<Integer>``): zero-based column
              indices in X that are categorical.

    Returns:
        ``OverlapResultType`` (``EastStruct``): ``X_filtered`` /
        ``Y_filtered`` (``Array<Matrix<Float>>``, one matrix per target),
        ``rejected_counts`` (``Vector<Integer>``, rows removed per target),
        ``known_categories`` (``Array<Vector<Integer>>``, sorted known
        values per categorical column in ``cat_indices`` order).

    Raises:
        NotImplementedError: the ``sklearn`` extra is not installed.
        RuntimeError: invalid input data or conversion failure.
    """
    _check_sklearn_support()
    cat_indices = [int(v) for v in config["cat_indices"].to_numpy()]
    X_ref = X_reference.to_numpy()

    # 1. Compute known values per categorical column from reference
    known_per_col: dict[int, set[int]] = {}
    for ci in cat_indices:
        known_per_col[ci] = set(X_ref[:, ci].astype(int))

    # 2. Filter each target
    X_filtered_list = []
    Y_filtered_list = []
    rejected_counts = []
    n_targets = len(X_targets)

    for t in range(n_targets):
        X_t = X_targets[t].to_numpy()
        Y_t = Y_targets[t].to_numpy()

        keep_mask = _filter_by_known_categories(known_per_col, X_t)

        X_filtered_list.append(X_t[keep_mask])
        Y_filtered_list.append(Y_t[keep_mask])
        rejected_counts.append(int(np.sum(~keep_mask)))

    # 3. Build known_categories return value (sorted int vectors per cat column)
    known_categories_list = []
    for ci in cat_indices:
        known_categories_list.append(sorted(known_per_col[ci]))

    return EastStruct(
        {
            "X_filtered": EastArray(
                MatrixType(FloatType),
                [EastMatrix(FloatType, np.atleast_2d(x).astype(np.float64)) for x in X_filtered_list]
            ),
            "Y_filtered": EastArray(
                MatrixType(FloatType),
                [EastMatrix(FloatType, np.atleast_2d(y).astype(np.float64)) for y in Y_filtered_list]
            ),
            "rejected_counts": EastVector(IntegerType, np.array(rejected_counts, dtype=np.int64)),
            "known_categories": EastArray(
                VectorType(IntegerType),
                [
                    EastVector(IntegerType, np.array(cats, dtype=np.int64))
                    for cats in known_categories_list
                ]
            ),
        }
    )


@platform_function(
    name="sklearn_standard_scaler_fit",
    inputs=[MatrixType(FloatType)],
    output=ModelBlobType,
)
def sklearn_standard_scaler_fit_impl(X: EastMatrix) -> EastVariant:
    """Fit a StandardScaler on X and return an ONNX-serialised model blob.

    Computes per-feature mean and standard deviation; use the returned blob
    with :func:`sklearn_standard_scaler_transform_impl` to zero-centre and
    unit-variance scale new data.

    Args:
        X: ``Matrix<Float>`` (``EastMatrix``) - training data, shape
            (n_samples, n_features).

    Returns:
        ``ModelBlobType`` (``EastVariant``) tagged ``standard_scaler``:
        ``{onnx: Blob, n_features: Integer}``.

    Raises:
        NotImplementedError: the ``sklearn`` extra is not installed.
        RuntimeError: invalid input data or scaler fitting failure.
    """
    _check_sklearn_support()
    from sklearn.preprocessing import StandardScaler

    try:
        X_np = X.to_numpy()
    except Exception as e:
        raise RuntimeError(
            f"sklearn_standard_scaler_fit: Invalid input data - {e}"
        ) from e

    n_features = X_np.shape[1]

    try:
        scaler = StandardScaler()
        scaler.fit(X_np)
        onnx_data = _sklearn_to_onnx(scaler, n_features)
    except Exception as e:
        raise RuntimeError(
            f"sklearn_standard_scaler_fit: Fitting failed with X shape {X_np.shape} - {e}"
        ) from e

    return EastVariant(
        "standard_scaler",
        EastStruct(
            {
                "onnx": onnx_data,
                "n_features": n_features,
            }
        ),
    )


@platform_function(
    name="sklearn_standard_scaler_transform",
    inputs=[ModelBlobType, MatrixType(FloatType)],
    output=MatrixType(FloatType),
)
def sklearn_standard_scaler_transform_impl(
    model_blob: EastVariant,
    X: EastMatrix,
) -> EastMatrix:
    """Apply a fitted StandardScaler to X via ONNX Runtime.

    Args:
        model_blob: ``ModelBlobType`` (``EastVariant``) tagged
            ``standard_scaler``, as returned by
            :func:`sklearn_standard_scaler_fit_impl`.
        X: ``Matrix<Float>`` (``EastMatrix``) - data to transform, shape
            (n_samples, n_features); must have the same feature count as
            the fitting data.

    Returns:
        ``Matrix<Float>`` (``EastMatrix``) - zero-centred, unit-variance
        data, same shape as X.

    Raises:
        NotImplementedError: the ``sklearn`` extra is not installed.
        RuntimeError: wrong blob tag, or ONNX transform failure.
    """
    _check_sklearn_support()
    if model_blob.type != "standard_scaler":
        raise RuntimeError(
            f"sklearn_standard_scaler_transform: Expected standard_scaler, got {model_blob.type}"
        )

    try:
        onnx_blob = model_blob.value["onnx"]
        return _onnx_transform(onnx_blob, X)
    except Exception as e:
        raise RuntimeError(
            f"sklearn_standard_scaler_transform: Transform failed - {e}"
        ) from e


@platform_function(
    name="sklearn_min_max_scaler_fit",
    inputs=[MatrixType(FloatType)],
    output=ModelBlobType,
)
def sklearn_min_max_scaler_fit_impl(X: EastMatrix) -> EastVariant:
    """Fit a MinMaxScaler on X and return an ONNX-serialised model blob.

    Computes per-feature min and max; use the returned blob with
    :func:`sklearn_min_max_scaler_transform_impl` to scale features to
    [0, 1].

    Args:
        X: ``Matrix<Float>`` (``EastMatrix``) - training data, shape
            (n_samples, n_features).

    Returns:
        ``ModelBlobType`` (``EastVariant``) tagged ``min_max_scaler``:
        ``{onnx: Blob, n_features: Integer}``.

    Raises:
        NotImplementedError: the ``sklearn`` extra is not installed.
        RuntimeError: invalid input data or scaler fitting failure.
    """
    _check_sklearn_support()
    from sklearn.preprocessing import MinMaxScaler

    try:
        X_np = X.to_numpy()
    except Exception as e:
        raise RuntimeError(
            f"sklearn_min_max_scaler_fit: Invalid input data - {e}"
        ) from e

    n_features = X_np.shape[1]

    try:
        scaler = MinMaxScaler()
        scaler.fit(X_np)
        onnx_data = _sklearn_to_onnx(scaler, n_features)
    except Exception as e:
        raise RuntimeError(
            f"sklearn_min_max_scaler_fit: Fitting failed with X shape {X_np.shape} - {e}"
        ) from e

    return EastVariant(
        "min_max_scaler",
        EastStruct(
            {
                "onnx": onnx_data,
                "n_features": n_features,
            }
        ),
    )


@platform_function(
    name="sklearn_min_max_scaler_transform",
    inputs=[ModelBlobType, MatrixType(FloatType)],
    output=MatrixType(FloatType),
)
def sklearn_min_max_scaler_transform_impl(
    model_blob: EastVariant,
    X: EastMatrix,
) -> EastMatrix:
    """Apply a fitted MinMaxScaler to X via ONNX Runtime.

    Args:
        model_blob: ``ModelBlobType`` (``EastVariant``) tagged
            ``min_max_scaler``, as returned by
            :func:`sklearn_min_max_scaler_fit_impl`.
        X: ``Matrix<Float>`` (``EastMatrix``) - data to transform, shape
            (n_samples, n_features); must have the same feature count as
            the fitting data.

    Returns:
        ``Matrix<Float>`` (``EastMatrix``) - features scaled to [0, 1],
        same shape as X.

    Raises:
        NotImplementedError: the ``sklearn`` extra is not installed.
        RuntimeError: wrong blob tag, or ONNX transform failure.
    """
    _check_sklearn_support()
    if model_blob.type != "min_max_scaler":
        raise RuntimeError(
            f"sklearn_min_max_scaler_transform: Expected min_max_scaler, got {model_blob.type}"
        )

    try:
        onnx_blob = model_blob.value["onnx"]
        return _onnx_transform(onnx_blob, X)
    except Exception as e:
        raise RuntimeError(
            f"sklearn_min_max_scaler_transform: Transform failed - {e}"
        ) from e


@platform_function(
    name="sklearn_robust_scaler_fit",
    inputs=[MatrixType(FloatType)],
    output=ModelBlobType,
)
def sklearn_robust_scaler_fit_impl(X: EastMatrix) -> EastVariant:
    """Fit a RobustScaler on X and return an ONNX-serialised model blob.

    Centres using the median and scales using the interquartile range,
    making it robust to outliers.  Use the returned blob with
    :func:`sklearn_robust_scaler_transform_impl`.

    Args:
        X: ``Matrix<Float>`` (``EastMatrix``) - training data, shape
            (n_samples, n_features).

    Returns:
        ``ModelBlobType`` (``EastVariant``) tagged ``robust_scaler``:
        ``{onnx: Blob, n_features: Integer}``.

    Raises:
        NotImplementedError: the ``sklearn`` extra is not installed.
        RuntimeError: invalid input data or scaler fitting failure.
    """
    _check_sklearn_support()
    from sklearn.preprocessing import RobustScaler

    try:
        X_np = X.to_numpy()
    except Exception as e:
        raise RuntimeError(
            f"sklearn_robust_scaler_fit: Invalid input data - {e}"
        ) from e

    n_features = X_np.shape[1]

    try:
        scaler = RobustScaler()
        scaler.fit(X_np)
        onnx_data = _sklearn_to_onnx(scaler, n_features)
    except Exception as e:
        raise RuntimeError(
            f"sklearn_robust_scaler_fit: Fitting failed with X shape {X_np.shape} - {e}"
        ) from e

    return EastVariant(
        "robust_scaler",
        EastStruct(
            {
                "onnx": onnx_data,
                "n_features": n_features,
            }
        ),
    )


@platform_function(
    name="sklearn_robust_scaler_transform",
    inputs=[ModelBlobType, MatrixType(FloatType)],
    output=MatrixType(FloatType),
)
def sklearn_robust_scaler_transform_impl(
    model_blob: EastVariant,
    X: EastMatrix,
) -> EastMatrix:
    """Apply a fitted RobustScaler to X via ONNX Runtime.

    Args:
        model_blob: ``ModelBlobType`` (``EastVariant``) tagged
            ``robust_scaler``, as returned by
            :func:`sklearn_robust_scaler_fit_impl`.
        X: ``Matrix<Float>`` (``EastMatrix``) - data to transform, shape
            (n_samples, n_features); must have the same feature count as
            the fitting data.

    Returns:
        ``Matrix<Float>`` (``EastMatrix``) - median-centred, IQR-scaled
        data, same shape as X.

    Raises:
        NotImplementedError: the ``sklearn`` extra is not installed.
        RuntimeError: wrong blob tag, or ONNX transform failure.
    """
    _check_sklearn_support()
    if model_blob.type != "robust_scaler":
        raise RuntimeError(
            f"sklearn_robust_scaler_transform: Expected robust_scaler, got {model_blob.type}"
        )

    try:
        onnx_blob = model_blob.value["onnx"]
        return _onnx_transform(onnx_blob, X)
    except Exception as e:
        raise RuntimeError(
            f"sklearn_robust_scaler_transform: Transform failed - {e}"
        ) from e


@platform_function(
    name="sklearn_label_encoder_fit",
    inputs=[VectorType(IntegerType)],
    output=ModelBlobType,
)
def sklearn_label_encoder_fit_impl(y: EastVector) -> EastVariant:
    """Fit a LabelEncoder on integer labels and return a cloudpickle-serialised model blob.

    Maps arbitrary integer class codes to a contiguous 0..N-1 range; use
    the returned blob with :func:`sklearn_label_encoder_transform_impl` or
    :func:`sklearn_label_encoder_inverse_transform_impl`.

    Args:
        y: ``Vector<Integer>`` (``EastVector``) - integer class labels to
            learn from.

    Returns:
        ``ModelBlobType`` (``EastVariant``) tagged ``label_encoder``:
        ``{data: Blob, n_classes: Integer}``.

    Raises:
        NotImplementedError: the ``sklearn`` extra is not installed.
        RuntimeError: invalid input data or fitting failure.
    """
    _check_sklearn_support()
    import cloudpickle
    from sklearn.preprocessing import LabelEncoder

    try:
        y_np = y.to_numpy()
    except Exception as e:
        raise RuntimeError(
            f"sklearn_label_encoder_fit: Invalid input data - {e}"
        ) from e

    try:
        encoder = LabelEncoder()
        encoder.fit(y_np)
        n_classes = len(encoder.classes_)
    except Exception as e:
        raise RuntimeError(
            f"sklearn_label_encoder_fit: Fitting failed - {e}"
        ) from e

    return EastVariant(
        "label_encoder",
        EastStruct(
            {
                "data": EastBlob(cloudpickle.dumps(encoder)),
                "n_classes": n_classes,
            }
        ),
    )


@platform_function(
    name="sklearn_label_encoder_transform",
    inputs=[ModelBlobType, VectorType(IntegerType)],
    output=VectorType(IntegerType),
)
def sklearn_label_encoder_transform_impl(
    model_blob: EastVariant,
    y: EastVector,
) -> EastVector:
    """Encode integer labels with a fitted LabelEncoder.

    Maps each value in ``y`` to its contiguous index in the fitted class
    set (0..N-1).

    Args:
        model_blob: ``ModelBlobType`` (``EastVariant``) tagged
            ``label_encoder``, as returned by
            :func:`sklearn_label_encoder_fit_impl`.
        y: ``Vector<Integer>`` (``EastVector``) - labels to encode; all
            values must have been seen during fitting.

    Returns:
        ``Vector<Integer>`` (``EastVector``) - encoded labels in 0..N-1.

    Raises:
        NotImplementedError: the ``sklearn`` extra is not installed.
        RuntimeError: wrong blob tag, or transform failure (unseen label).
    """
    _check_sklearn_support()
    import cloudpickle

    if model_blob.type != "label_encoder":
        raise RuntimeError(
            f"sklearn_label_encoder_transform: Expected label_encoder, got {model_blob.type}"
        )

    try:
        y_np = y.to_numpy()
        encoder = cloudpickle.loads(bytes(model_blob.value["data"]))
        y_encoded = encoder.transform(y_np)
    except Exception as e:
        raise RuntimeError(
            f"sklearn_label_encoder_transform: Transform failed - {e}"
        ) from e

    return EastVector(IntegerType, y_encoded.ravel().astype(np.int64))


@platform_function(
    name="sklearn_label_encoder_inverse_transform",
    inputs=[ModelBlobType, VectorType(IntegerType)],
    output=VectorType(IntegerType),
)
def sklearn_label_encoder_inverse_transform_impl(
    model_blob: EastVariant,
    y: EastVector,
) -> EastVector:
    """Decode contiguous indices back to the original integer class labels.

    Args:
        model_blob: ``ModelBlobType`` (``EastVariant``) tagged
            ``label_encoder``, as returned by
            :func:`sklearn_label_encoder_fit_impl`.
        y: ``Vector<Integer>`` (``EastVector``) - encoded labels in
            0..N-1 to decode.

    Returns:
        ``Vector<Integer>`` (``EastVector``) - original integer class
        labels.

    Raises:
        NotImplementedError: the ``sklearn`` extra is not installed.
        RuntimeError: wrong blob tag, or inverse transform failure (index
            out of range).
    """
    _check_sklearn_support()
    import cloudpickle

    if model_blob.type != "label_encoder":
        raise RuntimeError(
            f"sklearn_label_encoder_inverse_transform: Expected label_encoder, got {model_blob.type}"
        )

    try:
        y_np = y.to_numpy()
        encoder = cloudpickle.loads(bytes(model_blob.value["data"]))
        y_original = encoder.inverse_transform(y_np)
    except Exception as e:
        raise RuntimeError(
            f"sklearn_label_encoder_inverse_transform: Inverse transform failed - {e}"
        ) from e

    return EastVector(IntegerType, y_original.ravel().astype(np.int64))


@platform_function(
    name="sklearn_ordinal_encoder_fit",
    inputs=[MatrixType(FloatType)],
    output=ModelBlobType,
)
def sklearn_ordinal_encoder_fit_impl(X: EastMatrix) -> EastVariant:
    """Fit an OrdinalEncoder on feature matrix X and return a cloudpickle-serialised model blob.

    Assigns each category in each column an integer ordinal; use the
    returned blob with :func:`sklearn_ordinal_encoder_transform_impl`.

    Args:
        X: ``Matrix<Float>`` (``EastMatrix``) - training data containing
            categorical columns, shape (n_samples, n_features).

    Returns:
        ``ModelBlobType`` (``EastVariant``) tagged ``ordinal_encoder``:
        ``{data: Blob, n_features: Integer}``.

    Raises:
        NotImplementedError: the ``sklearn`` extra is not installed.
        RuntimeError: invalid input data or fitting failure.
    """
    _check_sklearn_support()
    import cloudpickle
    from sklearn.preprocessing import OrdinalEncoder

    try:
        X_np = X.to_numpy()
    except Exception as e:
        raise RuntimeError(
            f"sklearn_ordinal_encoder_fit: Invalid input data - {e}"
        ) from e

    n_features = X_np.shape[1]

    try:
        encoder = OrdinalEncoder()
        encoder.fit(X_np)
    except Exception as e:
        raise RuntimeError(
            f"sklearn_ordinal_encoder_fit: Fitting failed - {e}"
        ) from e

    return EastVariant(
        "ordinal_encoder",
        EastStruct(
            {
                "data": EastBlob(cloudpickle.dumps(encoder)),
                "n_features": n_features,
            }
        ),
    )


@platform_function(
    name="sklearn_ordinal_encoder_transform",
    inputs=[ModelBlobType, MatrixType(FloatType)],
    output=MatrixType(FloatType),
)
def sklearn_ordinal_encoder_transform_impl(
    model_blob: EastVariant,
    X: EastMatrix,
) -> EastMatrix:
    """Apply a fitted OrdinalEncoder to X.

    Args:
        model_blob: ``ModelBlobType`` (``EastVariant``) tagged
            ``ordinal_encoder``, as returned by
            :func:`sklearn_ordinal_encoder_fit_impl`.
        X: ``Matrix<Float>`` (``EastMatrix``) - data to encode, shape
            (n_samples, n_features); must have the same feature count as
            the fitting data.

    Returns:
        ``Matrix<Float>`` (``EastMatrix``) - ordinal-encoded features,
        same shape as X.

    Raises:
        NotImplementedError: the ``sklearn`` extra is not installed.
        RuntimeError: wrong blob tag, or transform failure (unseen
            category).
    """
    _check_sklearn_support()
    import cloudpickle

    if model_blob.type != "ordinal_encoder":
        raise RuntimeError(
            f"sklearn_ordinal_encoder_transform: Expected ordinal_encoder, got {model_blob.type}"
        )

    try:
        X_np = X.to_numpy()
        encoder = cloudpickle.loads(bytes(model_blob.value["data"]))
        X_encoded = encoder.transform(X_np)
    except Exception as e:
        raise RuntimeError(
            f"sklearn_ordinal_encoder_transform: Transform failed - {e}"
        ) from e

    return EastMatrix(FloatType, np.atleast_2d(X_encoded).astype(np.float64))


@platform_function(
    name="sklearn_compute_class_weight",
    inputs=[ClassWeightModeType, VectorType(IntegerType)],
    output=VectorType(FloatType),
)
def sklearn_compute_class_weight_impl(
    mode: EastVariant,
    y: EastVector,
) -> EastVector:
    """Compute per-class weights inversely proportional to class frequencies.

    Useful for balancing training on imbalanced datasets by passing the
    returned weights to a model's ``sample_weight`` argument.

    Args:
        mode: ``ClassWeightModeType`` (``EastVariant``) - currently only
            the ``balanced`` tag is supported; weights are set to
            n_samples / (n_classes * class_count).
        y: ``Vector<Integer>`` (``EastVector``) - integer class labels for
            all training samples.

    Returns:
        ``Vector<Float>`` (``EastVector``) - one weight per unique class,
        ordered by ascending class label.

    Raises:
        NotImplementedError: the ``sklearn`` extra is not installed.
        RuntimeError: invalid input data, unknown mode, or weight
            computation failure.
    """
    _check_sklearn_support()
    from sklearn.utils.class_weight import compute_class_weight

    try:
        y_np = y.to_numpy()
    except Exception as e:
        raise RuntimeError(
            f"sklearn_compute_class_weight: Invalid input data - {e}"
        ) from e

    mode_type = mode.type
    if mode_type != "balanced":
        raise RuntimeError(
            f"sklearn_compute_class_weight: Unknown mode type: {mode_type}"
        )

    try:
        classes = np.unique(y_np)
        weights = compute_class_weight("balanced", classes=classes, y=y_np)
    except Exception as e:
        raise RuntimeError(
            f"sklearn_compute_class_weight: Computing weights failed - {e}"
        ) from e

    return EastVector(FloatType, weights.ravel().astype(np.float64))


@platform_function(
    name="sklearn_confusion_matrix",
    inputs=[VectorType(IntegerType), VectorType(IntegerType)],
    output=ConfusionMatrixResultType,
)
def sklearn_confusion_matrix_impl(
    y_true: EastVector,
    y_pred: EastVector,
) -> EastStruct:
    """Compute the confusion matrix for a set of classification predictions.

    Entry [i, j] of the returned matrix is the number of samples whose
    true label is the i-th class and whose predicted label is the j-th
    class, where classes are sorted in ascending order.

    Args:
        y_true: ``Vector<Integer>`` (``EastVector``) - ground-truth class
            labels.
        y_pred: ``Vector<Integer>`` (``EastVector``) - predicted class
            labels; must have the same length as ``y_true``.

    Returns:
        ``ConfusionMatrixResultType`` (``EastStruct``): ``matrix``
        (``Matrix<Float>`` of shape n_classes x n_classes), ``classes``
        (``Vector<Integer>``, sorted union of true and predicted labels).

    Raises:
        NotImplementedError: the ``sklearn`` extra is not installed.
        RuntimeError: length mismatch between y_true and y_pred, or
            matrix computation failure.
    """
    _check_sklearn_support()
    from sklearn.metrics import confusion_matrix

    try:
        y_true_np = y_true.to_numpy()
        y_pred_np = y_pred.to_numpy()
    except Exception as e:
        raise RuntimeError(
            f"sklearn_confusion_matrix: Invalid input data - {e}"
        ) from e

    if y_true_np.shape[0] != y_pred_np.shape[0]:
        raise RuntimeError(
            f"sklearn_confusion_matrix: y_true has {y_true_np.shape[0]} samples "
            f"but y_pred has {y_pred_np.shape[0]} samples"
        )

    try:
        classes = np.unique(np.concatenate([y_true_np, y_pred_np]))
        cm = confusion_matrix(y_true_np, y_pred_np, labels=classes)
    except Exception as e:
        raise RuntimeError(
            f"sklearn_confusion_matrix: Computing matrix failed - {e}"
        ) from e

    return EastStruct(
        {
            "matrix": EastMatrix(FloatType, np.atleast_2d(cm.astype(np.float32)).astype(np.float64)),
            "classes": EastVector(IntegerType, classes.ravel().astype(np.int64)),
        }
    )


@platform_function(
    name="sklearn_roc_auc_score",
    inputs=[VectorType(IntegerType), MatrixType(FloatType), RocAucConfigType],
    output=FloatType,
)
def sklearn_roc_auc_score_impl(
    y_true: EastVector,
    y_proba: EastMatrix,
    config: EastStruct,
) -> float:
    """Compute the ROC AUC score for binary or multi-class classification.

    For binary problems uses the positive-class column of ``y_proba``.
    For multi-class problems the ``multi_class`` and ``average`` config
    fields control the aggregation strategy.

    Args:
        y_true: ``Vector<Integer>`` (``EastVector``) - ground-truth class
            labels.
        y_proba: ``Matrix<Float>`` (``EastMatrix``) - class probability
            estimates, shape (n_samples, n_classes).
        config: ``RocAucConfigType`` (``EastStruct``) with fields:

            - ``multi_class`` (``Option<RocAucMultiClassType>``): ``ovr``
              (one-vs-rest, default) or ``ovo`` (one-vs-one).
            - ``average`` (``Option<ClassificationAverageType>``): how to
              aggregate per-class AUC; default ``macro``.

    Returns:
        ``Float`` - ROC AUC score.

    Raises:
        NotImplementedError: the ``sklearn`` extra is not installed.
        RuntimeError: sample-count mismatch, or scoring failure.
    """
    _check_sklearn_support()
    from sklearn.metrics import roc_auc_score

    try:
        y_true_np = y_true.to_numpy()
        y_proba_np = y_proba.to_numpy()
    except Exception as e:
        raise RuntimeError(
            f"sklearn_roc_auc_score: Invalid input data - {e}"
        ) from e

    if y_true_np.shape[0] != y_proba_np.shape[0]:
        raise RuntimeError(
            f"sklearn_roc_auc_score: y_true has {y_true_np.shape[0]} samples "
            f"but y_proba has {y_proba_np.shape[0]} samples"
        )

    # Get config options
    multi_class_opt = config.get("multi_class")
    multi_class = "ovr"  # default
    if (
        multi_class_opt is not None
        and hasattr(multi_class_opt, "type")
        and multi_class_opt.type == "some"
    ):
        multi_class = _get_enum_tag(multi_class_opt.value)

    average_opt = config.get("average")
    average = "macro"  # default
    if average_opt is not None and hasattr(average_opt, "type") and average_opt.type == "some":
        average = _get_enum_tag(average_opt.value)

    try:
        n_classes = len(np.unique(y_true_np))
        if n_classes == 2:
            # Binary classification - use positive class probabilities
            score = roc_auc_score(y_true_np, y_proba_np[:, 1])
        else:
            # Multi-class classification
            score = roc_auc_score(
                y_true_np,
                y_proba_np,
                multi_class=multi_class,
                average=average,
            )
    except Exception as e:
        raise RuntimeError(
            f"sklearn_roc_auc_score: Computing score failed - {e}"
        ) from e

    return float(score)


@platform_function(
    name="sklearn_log_loss",
    inputs=[VectorType(IntegerType), MatrixType(FloatType)],
    output=FloatType,
)
def sklearn_log_loss_impl(
    y_true: EastVector,
    y_proba: EastMatrix,
) -> float:
    """Compute log loss (cross-entropy) for binary or multi-class predictions.

    Args:
        y_true: ``Vector<Integer>`` (``EastVector``) - ground-truth class
            labels.
        y_proba: ``Matrix<Float>`` (``EastMatrix``) - class probability
            estimates, shape (n_samples, n_classes); each row should sum
            to 1.

    Returns:
        ``Float`` - mean log loss (lower is better).

    Raises:
        NotImplementedError: the ``sklearn`` extra is not installed.
        RuntimeError: sample-count mismatch, or loss computation failure.
    """
    _check_sklearn_support()
    from sklearn.metrics import log_loss

    try:
        y_true_np = y_true.to_numpy()
        y_proba_np = y_proba.to_numpy()
    except Exception as e:
        raise RuntimeError(
            f"sklearn_log_loss: Invalid input data - {e}"
        ) from e

    if y_true_np.shape[0] != y_proba_np.shape[0]:
        raise RuntimeError(
            f"sklearn_log_loss: y_true has {y_true_np.shape[0]} samples "
            f"but y_proba has {y_proba_np.shape[0]} samples"
        )

    try:
        loss = log_loss(y_true_np, y_proba_np)
    except Exception as e:
        raise RuntimeError(
            f"sklearn_log_loss: Computing loss failed - {e}"
        ) from e

    return float(loss)


@platform_function(
    name="sklearn_silhouette_score",
    inputs=[MatrixType(FloatType), VectorType(IntegerType)],
    output=FloatType,
)
def sklearn_silhouette_score_impl(
    X: EastMatrix, labels: EastVector
) -> float:
    """Compute the mean silhouette coefficient for clustering quality.

    The silhouette score ranges from -1 (incorrect clustering) to +1
    (dense, well-separated clusters); 0 indicates overlapping clusters.

    Args:
        X: ``Matrix<Float>`` (``EastMatrix``) - feature matrix, shape
            (n_samples, n_features).
        labels: ``Vector<Integer>`` (``EastVector``) - cluster assignment
            per sample; must have the same length as X rows and contain at
            least 2 distinct labels.

    Returns:
        ``Float`` - mean silhouette coefficient over all samples.

    Raises:
        NotImplementedError: the ``sklearn`` extra is not installed.
        RuntimeError: sample-count mismatch, or score computation failure
            (e.g. only one cluster).
    """
    _check_sklearn_support()
    from sklearn.metrics import silhouette_score

    try:
        X_np = X.to_numpy()
        labels_np = labels.to_numpy(dtype=int)
    except Exception as e:
        raise RuntimeError(
            f"sklearn_silhouette_score: Invalid input data - {e}"
        ) from e

    if X_np.shape[0] != labels_np.shape[0]:
        raise RuntimeError(
            f"sklearn_silhouette_score: X has {X_np.shape[0]} samples "
            f"but labels has {labels_np.shape[0]} samples"
        )

    try:
        score = silhouette_score(X_np, labels_np)
    except Exception as e:
        raise RuntimeError(
            f"sklearn_silhouette_score: Computing score failed - {e}"
        ) from e

    return float(score)



# ============================================================================
# Flexible Metrics Implementation
# ============================================================================

# Regression metric function mapping
REGRESSION_METRIC_FUNCTIONS = {
    "mse": lambda y_true, y_pred: float(np.mean((y_true - y_pred) ** 2)),
    "rmse": lambda y_true, y_pred: float(np.sqrt(np.mean((y_true - y_pred) ** 2))),
    "mae": lambda y_true, y_pred: float(np.mean(np.abs(y_true - y_pred))),
    "r2": None,  # Uses sklearn
    "mape": None,  # Custom implementation
    "explained_variance": None,  # Uses sklearn
    "max_error": lambda y_true, y_pred: float(np.max(np.abs(y_true - y_pred))),
    "median_ae": lambda y_true, y_pred: float(np.median(np.abs(y_true - y_pred))),
}


def _compute_regression_metric(
    metric_name: str, y_true: np.ndarray, y_pred: np.ndarray, param: float = None
) -> float:
    """Compute a single regression metric.

    Args:
        metric_name: Name of the metric to compute
        y_true: Ground truth values
        y_pred: Predicted values
        param: Optional parameter for metrics that need it (alpha for pinball, delta for huber, power for tweedie)
    """
    from sklearn import metrics as sklearn_metrics

    if metric_name == "mse":
        return float(sklearn_metrics.mean_squared_error(y_true, y_pred))
    elif metric_name == "rmse":
        return float(np.sqrt(sklearn_metrics.mean_squared_error(y_true, y_pred)))
    elif metric_name == "mae":
        return float(sklearn_metrics.mean_absolute_error(y_true, y_pred))
    elif metric_name == "r2":
        return float(sklearn_metrics.r2_score(y_true, y_pred))
    elif metric_name == "mape":
        # Avoid division by zero
        mask = y_true != 0
        if mask.any():
            return float(
                np.mean(np.abs((y_true[mask] - y_pred[mask]) / y_true[mask])) * 100
            )
        return 0.0
    elif metric_name == "explained_variance":
        return float(sklearn_metrics.explained_variance_score(y_true, y_pred))
    elif metric_name == "max_error":
        return float(sklearn_metrics.max_error(y_true, y_pred))
    elif metric_name == "median_ae":
        return float(sklearn_metrics.median_absolute_error(y_true, y_pred))
    elif metric_name == "mean_error":
        # Bias: mean(pred - true), should be ~0 for unbiased predictions
        return float(np.mean(y_pred - y_true))
    elif metric_name == "pinball_loss":
        # Proper scoring rule for quantile regression
        alpha = param if param is not None else 0.5  # default to median
        return float(sklearn_metrics.mean_pinball_loss(y_true, y_pred, alpha=alpha))
    elif metric_name == "huber":
        # Huber loss: robust to outliers
        delta = param if param is not None else 1.0
        residuals = y_pred - y_true
        abs_residuals = np.abs(residuals)
        quadratic = np.minimum(abs_residuals, delta)
        linear = abs_residuals - quadratic
        return float(np.mean(0.5 * quadratic**2 + delta * linear))
    elif metric_name == "mean_tweedie_deviance":
        # For skewed distributions (power=0: normal, power=1: Poisson, power=2: Gamma)
        power = param if param is not None else 0.0
        return float(sklearn_metrics.mean_tweedie_deviance(y_true, y_pred, power=power))
    else:
        raise ValueError(f"Unknown regression metric: {metric_name}")


@platform_function(
    name="sklearn_compute_metrics",
    inputs=[VectorType(FloatType), VectorType(FloatType), ArrayType(RegressionMetricType)],
    output=MetricsResultType,
)
def sklearn_compute_metrics_impl(
    y_true: EastVector,
    y_pred: EastVector,
    metrics: EastArray,
) -> EastArray:
    """Compute one or more regression metrics for single-target predictions.

    Metrics that raise an exception are silently skipped rather than
    failing the whole call.

    Args:
        y_true: ``Vector<Float>`` (``EastVector``) - ground-truth target
            values.
        y_pred: ``Vector<Float>`` (``EastVector``) - predicted values;
            must have the same length as ``y_true``.
        metrics: ``Array<RegressionMetricType>`` (``EastArray``) - metrics
            to compute.  Each element is an ``EastVariant`` whose tag
            selects the metric and whose value carries an optional
            parameter:

            - ``mse``, ``rmse``, ``mae``, ``r2``, ``mape``,
              ``explained_variance``, ``max_error``, ``median_ae``,
              ``mean_error`` - no parameter (``NullType``).
            - ``pinball_loss`` (``Float``) - quantile alpha (default 0.5).
            - ``huber`` (``Float``) - delta threshold (default 1.0).
            - ``mean_tweedie_deviance`` (``Float``) - power parameter
              (default 0.0 = normal).

    Returns:
        ``MetricsResultType`` (``Array<MetricResultType>``): one
        ``{metric: RegressionMetricType, value: Float}`` struct per
        successfully computed metric, in input order.

    Raises:
        NotImplementedError: the ``sklearn`` extra is not installed.
        RuntimeError: invalid input data or sample-count mismatch.
    """
    _check_sklearn_support()
    try:
        y_true_np = y_true.to_numpy()
        y_pred_np = y_pred.to_numpy()
    except Exception as e:
        raise RuntimeError(f"sklearn_compute_metrics: Invalid input data - {e}") from e

    if y_true_np.shape[0] != y_pred_np.shape[0]:
        raise RuntimeError(
            f"sklearn_compute_metrics: y_true has {y_true_np.shape[0]} samples "
            f"but y_pred has {y_pred_np.shape[0]} samples"
        )

    results = []
    for metric_variant in metrics:
        metric_name = metric_variant.type
        # Extract param for metrics that need it (pinball_loss, huber, mean_tweedie_deviance)
        param = metric_variant.value if metric_variant.value is not None else None
        try:
            value = _compute_regression_metric(metric_name, y_true_np, y_pred_np, param)
            results.append(
                EastStruct(
                    {
                        "metric": EastVariant(metric_name, param),
                        "value": value,
                    }
                )
            )
        except Exception:
            pass  # Skip metrics that fail

    return EastArray(MetricResultType, results)


@platform_function(
    name="sklearn_compute_metrics_multi",
    inputs=[
        MatrixType(FloatType),
        MatrixType(FloatType),
        ArrayType(RegressionMetricType),
        MultiMetricsConfigType,
    ],
    output=MultiMetricsResultType,
)
def sklearn_compute_metrics_multi_impl(
    Y_true: EastMatrix,
    Y_pred: EastMatrix,
    metrics: EastArray,
    config: EastStruct,
) -> EastArray:
    """Compute one or more regression metrics for multi-target predictions.

    Computes each metric per column of Y then aggregates according to
    ``config["aggregation"]``.  Metrics that raise an exception are
    silently skipped.

    Args:
        Y_true: ``Matrix<Float>`` (``EastMatrix``) - ground-truth targets,
            shape (n_samples, n_targets).
        Y_pred: ``Matrix<Float>`` (``EastMatrix``) - predicted targets;
            must have the same shape as ``Y_true``.
        metrics: ``Array<RegressionMetricType>`` (``EastArray``) - same
            variant tags and parameters as
            :func:`sklearn_compute_metrics_impl`.
        config: ``MultiMetricsConfigType`` (``EastStruct``) with fields:

            - ``aggregation`` (``Option<MetricAggregationType>``):
              ``per_target`` (default, returns a vector of per-column
              values) or ``uniform_average`` (returns a scalar mean).

    Returns:
        ``MultiMetricsResultType`` (``Array<MultiMetricResultType>``): one
        ``{metric, value: MultiMetricValueType}`` struct per successfully
        computed metric.  ``value`` is tagged ``per_target``
        (``Vector<Float>``) or ``scalar`` (``Float``) depending on
        aggregation.

    Raises:
        NotImplementedError: the ``sklearn`` extra is not installed.
        RuntimeError: invalid input data or shape mismatch.
    """
    _check_sklearn_support()
    try:
        Y_true_np = Y_true.to_numpy()
        Y_pred_np = Y_pred.to_numpy()
    except Exception as e:
        raise RuntimeError(
            f"sklearn_compute_metrics_multi: Invalid input data - {e}"
        ) from e

    if Y_true_np.shape != Y_pred_np.shape:
        raise RuntimeError(
            f"sklearn_compute_metrics_multi: Y_true has shape {Y_true_np.shape} "
            f"but Y_pred has shape {Y_pred_np.shape}"
        )

    n_targets = Y_true_np.shape[1]

    # Get aggregation mode
    agg_opt = _get_option(config.get("aggregation"), None)
    aggregation = agg_opt.type if agg_opt else "per_target"

    results = []
    for metric_variant in metrics:
        metric_name = metric_variant.type
        # Extract param for metrics that need it
        param = metric_variant.value if metric_variant.value is not None else None
        try:
            # Compute per target
            per_target_values = []
            for i in range(n_targets):
                val = _compute_regression_metric(
                    metric_name, Y_true_np[:, i], Y_pred_np[:, i], param
                )
                per_target_values.append(val)

            # Format based on aggregation
            if aggregation == "per_target":
                result_value = EastVariant(
                    "per_target", EastVector(FloatType, np.array(per_target_values, dtype=np.float64))
                )
            else:  # uniform_average
                result_value = EastVariant("scalar", float(np.mean(per_target_values)))

            results.append(
                EastStruct(
                    {
                        "metric": EastVariant(metric_name, param),
                        "value": result_value,
                    }
                )
            )
        except Exception:
            pass  # Skip metrics that fail

    return EastArray(MultiMetricResultType, results)


# Classification metric function mapping
CLASSIFICATION_METRICS_WITH_AVERAGE = {"precision", "recall", "f1", "jaccard"}


def _compute_classification_metric(
    metric_name: str,
    y_true: np.ndarray,
    y_pred: np.ndarray,
    average: str = "macro",
    cohen_kappa_weights: str | None = None,
) -> float:
    """Compute a single classification metric."""
    from sklearn import metrics as sklearn_metrics

    kwargs = {}
    if metric_name in CLASSIFICATION_METRICS_WITH_AVERAGE:
        kwargs["average"] = average
        kwargs["zero_division"] = 0

    if metric_name == "accuracy":
        return float(sklearn_metrics.accuracy_score(y_true, y_pred))
    elif metric_name == "balanced_accuracy":
        return float(sklearn_metrics.balanced_accuracy_score(y_true, y_pred))
    elif metric_name == "precision":
        return float(sklearn_metrics.precision_score(y_true, y_pred, **kwargs))
    elif metric_name == "recall":
        return float(sklearn_metrics.recall_score(y_true, y_pred, **kwargs))
    elif metric_name == "f1":
        return float(sklearn_metrics.f1_score(y_true, y_pred, **kwargs))
    elif metric_name == "matthews_corrcoef":
        return float(sklearn_metrics.matthews_corrcoef(y_true, y_pred))
    elif metric_name == "cohen_kappa":
        # Handle weights parameter
        weights = None
        if cohen_kappa_weights and cohen_kappa_weights != "none":
            weights = cohen_kappa_weights  # "linear" or "quadratic"
        return float(sklearn_metrics.cohen_kappa_score(y_true, y_pred, weights=weights))
    elif metric_name == "jaccard":
        return float(sklearn_metrics.jaccard_score(y_true, y_pred, **kwargs))
    else:
        raise ValueError(f"Unknown classification metric: {metric_name}")


@platform_function(
    name="sklearn_compute_classification_metrics",
    inputs=[
        VectorType(IntegerType),
        VectorType(IntegerType),
        ArrayType(ClassificationMetricType),
        ClassificationMetricsConfigType,
    ],
    output=ClassificationMetricResultsType,
)
def sklearn_compute_classification_metrics_impl(
    y_true: EastVector,
    y_pred: EastVector,
    metrics: EastArray,
    config: EastStruct,
) -> EastArray:
    """Compute one or more classification metrics for single-target predictions.

    Metrics that raise an exception are silently skipped.

    Args:
        y_true: ``Vector<Integer>`` (``EastVector``) - ground-truth class
            labels.
        y_pred: ``Vector<Integer>`` (``EastVector``) - predicted class
            labels; must have the same length as ``y_true``.
        metrics: ``Array<ClassificationMetricType>`` (``EastArray``) -
            metrics to compute.  Each element is an ``EastVariant`` with
            one of these tags:

            - ``accuracy``, ``balanced_accuracy``, ``precision``,
              ``recall``, ``f1``, ``matthews_corrcoef``, ``jaccard`` - no
              per-metric parameter.
            - ``cohen_kappa`` (``CohenKappaWeightsType``) - optional
              weights variant: ``none``, ``linear``, or ``quadratic``.

        config: ``ClassificationMetricsConfigType`` (``EastStruct``) with
            fields:

            - ``average`` (``Option<ClassificationAverageType>``):
              ``macro`` (default), ``micro``, ``weighted``, or ``binary``;
              applied to precision, recall, f1, and jaccard.

    Returns:
        ``ClassificationMetricResultsType``
        (``Array<ClassificationMetricResultType>``): one
        ``{metric: ClassificationMetricType, value: Float}`` struct per
        successfully computed metric, in input order.

    Raises:
        NotImplementedError: the ``sklearn`` extra is not installed.
        RuntimeError: invalid input data or sample-count mismatch.
    """
    _check_sklearn_support()
    try:
        y_true_np = y_true.to_numpy()
        y_pred_np = y_pred.to_numpy()
    except Exception as e:
        raise RuntimeError(
            f"sklearn_compute_classification_metrics: Invalid input data - {e}"
        ) from e

    if y_true_np.shape[0] != y_pred_np.shape[0]:
        raise RuntimeError(
            f"sklearn_compute_classification_metrics: y_true has {y_true_np.shape[0]} samples "
            f"but y_pred has {y_pred_np.shape[0]} samples"
        )

    # Get average mode
    avg_opt = _get_option(config.get("average"), None)
    average = avg_opt.type if avg_opt else "macro"

    results = []
    for metric_variant in metrics:
        metric_name = metric_variant.type
        # Extract cohen_kappa weights if present
        cohen_kappa_weights = None
        if (
            metric_name == "cohen_kappa"
            and metric_variant.value is not None
            and hasattr(metric_variant.value, "type")
        ):
            cohen_kappa_weights = metric_variant.value.type
        try:
            value = _compute_classification_metric(
                metric_name, y_true_np, y_pred_np, average, cohen_kappa_weights
            )
            results.append(
                EastStruct(
                    {
                        "metric": metric_variant,
                        "value": value,
                    }
                )
            )
        except Exception:
            pass  # Skip metrics that fail

    return EastArray(ClassificationMetricResultType, results)


@platform_function(
    name="sklearn_compute_classification_metrics_multi",
    inputs=[
        MatrixType(FloatType),
        MatrixType(FloatType),
        ArrayType(ClassificationMetricType),
        MultiClassificationConfigType,
    ],
    output=MultiClassificationMetricResultsType,
)
def sklearn_compute_classification_metrics_multi_impl(
    Y_true: EastMatrix,
    Y_pred: EastMatrix,
    metrics: EastArray,
    config: EastStruct,
) -> EastArray:
    """Compute one or more classification metrics for multi-target predictions.

    Computes each metric per column of Y then aggregates according to
    ``config["aggregation"]``.  Metrics that raise an exception are
    silently skipped.

    Args:
        Y_true: ``Matrix<Float>`` (``EastMatrix``) - ground-truth integer
            class labels as floats, shape (n_samples, n_targets); cast to
            int internally.
        Y_pred: ``Matrix<Float>`` (``EastMatrix``) - predicted integer
            class labels as floats; must have the same shape as
            ``Y_true``.
        metrics: ``Array<ClassificationMetricType>`` (``EastArray``) -
            same variant tags and parameters as
            :func:`sklearn_compute_classification_metrics_impl`.
        config: ``MultiClassificationConfigType`` (``EastStruct``) with
            fields:

            - ``average`` (``Option<ClassificationAverageType>``):
              ``macro`` (default), ``micro``, ``weighted``, or ``binary``.
            - ``aggregation`` (``Option<MetricAggregationType>``):
              ``per_target`` (default) or ``uniform_average``.

    Returns:
        ``MultiClassificationMetricResultsType``
        (``Array<MultiClassificationMetricResultType>``): one
        ``{metric, value: MultiMetricValueType}`` struct per successfully
        computed metric.  ``value`` is tagged ``per_target``
        (``Vector<Float>``) or ``scalar`` (``Float``).

    Raises:
        NotImplementedError: the ``sklearn`` extra is not installed.
        RuntimeError: invalid input data or shape mismatch.
    """
    _check_sklearn_support()
    try:
        Y_true_np = Y_true.to_numpy(dtype=int)
        Y_pred_np = Y_pred.to_numpy(dtype=int)
    except Exception as e:
        raise RuntimeError(
            f"sklearn_compute_classification_metrics_multi: Invalid input data - {e}"
        ) from e

    if Y_true_np.shape != Y_pred_np.shape:
        raise RuntimeError(
            f"sklearn_compute_classification_metrics_multi: Y_true has shape {Y_true_np.shape} "
            f"but Y_pred has shape {Y_pred_np.shape}"
        )

    n_targets = Y_true_np.shape[1]

    # Get config options
    avg_opt = _get_option(config.get("average"), None)
    average = avg_opt.type if avg_opt else "macro"
    agg_opt = _get_option(config.get("aggregation"), None)
    aggregation = agg_opt.type if agg_opt else "per_target"

    results = []
    for metric_variant in metrics:
        metric_name = metric_variant.type
        # Extract cohen_kappa weights if present
        cohen_kappa_weights = None
        if (
            metric_name == "cohen_kappa"
            and metric_variant.value is not None
            and hasattr(metric_variant.value, "type")
        ):
            cohen_kappa_weights = metric_variant.value.type
        try:
            # Compute per target
            per_target_values = []
            for i in range(n_targets):
                val = _compute_classification_metric(
                    metric_name, Y_true_np[:, i], Y_pred_np[:, i], average, cohen_kappa_weights
                )
                per_target_values.append(val)

            # Format based on aggregation
            if aggregation == "per_target":
                result_value = EastVariant(
                    "per_target", EastVector(FloatType, np.array(per_target_values, dtype=np.float64))
                )
            else:  # uniform_average
                result_value = EastVariant("scalar", float(np.mean(per_target_values)))

            results.append(
                EastStruct(
                    {
                        "metric": metric_variant,
                        "value": result_value,
                    }
                )
            )
        except Exception:
            pass  # Skip metrics that fail

    return EastArray(MultiClassificationMetricResultType, results)


# ============================================================================
# RegressorChain Helpers
# ============================================================================


def _serialize_model(model) -> EastBlob:
    """Serialize model using cloudpickle."""
    import cloudpickle

    return EastBlob(cloudpickle.dumps(model))


def _deserialize_model(blob: EastBlob):
    """Deserialize model using cloudpickle."""
    import cloudpickle

    return cloudpickle.loads(bytes(blob))


def _create_base_estimator(estimator_variant: EastVariant):
    """Create a sklearn-compatible base estimator from config variant."""
    estimator_type = estimator_variant.type
    config = estimator_variant.value

    if estimator_type == "xgboost":
        from xgboost import XGBRegressor

        return XGBRegressor(
            n_estimators=int(_get_option(config.get("n_estimators"), 100)),
            max_depth=int(_get_option(config.get("max_depth"), 6)),
            learning_rate=float(_get_option(config.get("learning_rate"), 0.3)),
            min_child_weight=int(_get_option(config.get("min_child_weight"), 1)),
            subsample=float(_get_option(config.get("subsample"), 1.0)),
            colsample_bytree=float(_get_option(config.get("colsample_bytree"), 1.0)),
            reg_alpha=float(_get_option(config.get("reg_alpha"), 0)),
            reg_lambda=float(_get_option(config.get("reg_lambda"), 1)),
            random_state=_get_option(config.get("random_state"), None),
            n_jobs=int(_get_option(config.get("n_jobs"), -1)),
        )

    elif estimator_type == "lightgbm":
        from lightgbm import LGBMRegressor

        return LGBMRegressor(
            n_estimators=int(_get_option(config.get("n_estimators"), 100)),
            max_depth=int(_get_option(config.get("max_depth"), -1)),
            learning_rate=float(_get_option(config.get("learning_rate"), 0.1)),
            num_leaves=int(_get_option(config.get("num_leaves"), 31)),
            min_child_samples=int(_get_option(config.get("min_child_samples"), 20)),
            subsample=float(_get_option(config.get("subsample"), 1.0)),
            colsample_bytree=float(_get_option(config.get("colsample_bytree"), 1.0)),
            reg_alpha=float(_get_option(config.get("reg_alpha"), 0)),
            reg_lambda=float(_get_option(config.get("reg_lambda"), 0)),
            random_state=_get_option(config.get("random_state"), None),
            n_jobs=int(_get_option(config.get("n_jobs"), -1)),
            verbosity=-1,
        )

    elif estimator_type == "ngboost":
        from ngboost import NGBRegressor
        from ngboost.distns import LogNormal, Normal

        dist_variant = _get_option(config.get("distribution"), None)
        dist_type = _get_enum_tag(dist_variant) if dist_variant else "normal"
        dist = LogNormal if dist_type == "lognormal" else Normal

        return NGBRegressor(
            n_estimators=int(_get_option(config.get("n_estimators"), 500)),
            learning_rate=float(_get_option(config.get("learning_rate"), 0.01)),
            minibatch_frac=float(_get_option(config.get("minibatch_frac"), 1.0)),
            col_sample=float(_get_option(config.get("col_sample"), 1.0)),
            random_state=_get_option(config.get("random_state"), None),
            Dist=dist,
            verbose=False,
        )

    elif estimator_type == "gp":
        from sklearn.gaussian_process import GaussianProcessRegressor
        from sklearn.gaussian_process.kernels import (
            RBF,
            ConstantKernel,
            DotProduct,
            Matern,
            RationalQuadratic,
        )

        kernel_variant = _get_option(config.get("kernel"), None)
        kernel_type = _get_enum_tag(kernel_variant) if kernel_variant else "rbf"

        kernel_map = {
            "rbf": ConstantKernel() * RBF(),
            "matern_1_2": ConstantKernel() * Matern(nu=0.5),
            "matern_3_2": ConstantKernel() * Matern(nu=1.5),
            "matern_5_2": ConstantKernel() * Matern(nu=2.5),
            "rational_quadratic": ConstantKernel() * RationalQuadratic(),
            "dot_product": ConstantKernel() * DotProduct(),
        }
        kernel = kernel_map.get(kernel_type, ConstantKernel() * RBF())

        alpha = _get_option(config.get("alpha"), 1e-10)
        alpha = float(alpha) if alpha is not None else 1e-10

        n_restarts = _get_option(config.get("n_restarts_optimizer"), 0)
        n_restarts = int(n_restarts) if n_restarts is not None else 0

        normalize_y = _get_option(config.get("normalize_y"), False)
        normalize_y = bool(normalize_y) if normalize_y is not None else False

        random_state = _get_option(config.get("random_state"), None)
        if random_state is not None:
            random_state = int(random_state)

        return GaussianProcessRegressor(
            kernel=kernel,
            alpha=alpha,
            n_restarts_optimizer=n_restarts,
            normalize_y=normalize_y,
            random_state=random_state,
        )

    else:
        raise RuntimeError(
            f"_create_base_estimator: Unknown estimator type: {estimator_type}"
        )


@platform_function(
    name="sklearn_regressor_chain_train",
    inputs=[MatrixType(FloatType), MatrixType(FloatType), RegressorChainConfigType],
    output=ModelBlobType,
)
def sklearn_regressor_chain_train_impl(
    X: EastMatrix,
    Y: EastMatrix,
    config: EastStruct,
) -> EastVariant:
    """Train a RegressorChain for chained multi-target regression.

    Each target in the chain is predicted using all features plus the
    predictions of all preceding targets, propagating inter-target
    dependencies.  The chain is serialised with cloudpickle for use with
    :func:`sklearn_regressor_chain_predict_impl`.

    Args:
        X: ``Matrix<Float>`` (``EastMatrix``) - feature matrix, shape
            (n_samples, n_features).
        Y: ``Matrix<Float>`` (``EastMatrix``) - target matrix, shape
            (n_samples, n_targets); must have the same number of rows as X.
        config: ``RegressorChainConfigType`` (``EastStruct``) with fields:

            - ``base_estimator`` (``RegressorChainBaseConfigType``):
              variant selecting the per-link estimator; one of:

              - ``xgboost`` (``XGBoostConfigType``) - see XGBoost docs
                for field defaults.
              - ``lightgbm`` (``LightGBMConfigType``) - see LightGBM docs
                for field defaults.
              - ``ngboost`` (``NGBoostConfigType``) - see NGBoost docs for
                field defaults.
              - ``gp`` (``GPConfigType``) - Gaussian Process regressor.

            - ``order`` (``Option<Array<Integer>>``): target ordering for
              the chain; default None means natural order 0..n_targets-1.
            - ``random_state`` (``Option<Integer>``): seed for estimators
              that support it.

    Returns:
        ``ModelBlobType`` (``EastVariant``) tagged ``regressor_chain``:
        ``{data: Blob, n_features: Integer, n_targets: Integer,
        base_estimator_type: String}``.

    Raises:
        NotImplementedError: the ``sklearn`` extra is not installed.
        RuntimeError: sample-count mismatch, unknown estimator type, base
            estimator creation failure, or training failure.
    """
    _check_sklearn_support()
    from sklearn.multioutput import RegressorChain

    try:
        X_np = X.to_numpy()
        # Y is a matrix (n_samples x n_targets)
        Y_np = Y.to_numpy(dtype=np.float32)
    except Exception as e:
        raise RuntimeError(
            f"sklearn_regressor_chain_train: Invalid input data - {e}"
        ) from e

    if X_np.shape[0] != Y_np.shape[0]:
        raise RuntimeError(
            f"sklearn_regressor_chain_train: X has {X_np.shape[0]} samples "
            f"but Y has {Y_np.shape[0]} samples"
        )

    n_features = X_np.shape[1]
    n_targets = Y_np.shape[1]

    # Get base estimator config
    base_estimator_variant = config.get("base_estimator")
    try:
        base_estimator = _create_base_estimator(base_estimator_variant)
    except Exception as e:
        raise RuntimeError(
            f"sklearn_regressor_chain_train: Failed to create base estimator - {e}"
        ) from e

    base_estimator_type = base_estimator_variant.type

    # Get order
    order = _get_option(config.get("order"), None)
    if order is not None:
        order = [int(x) for x in order]

    # Get random_state
    random_state = _get_option(config.get("random_state"), None)
    if random_state is not None:
        random_state = int(random_state)

    try:
        # Create and train chain
        # Use base_estimator for sklearn <1.6, estimator for sklearn >=1.6
        chain = RegressorChain(
            base_estimator=base_estimator,
            order=order,
            random_state=random_state,
        )
        chain.fit(X_np, Y_np)
    except Exception as e:
        raise RuntimeError(
            f"sklearn_regressor_chain_train: Training failed with X shape {X_np.shape} - {e}"
        ) from e

    return EastVariant(
        "regressor_chain",
        EastStruct(
            {
                "data": _serialize_model(chain),
                "n_features": n_features,
                "n_targets": n_targets,
                "base_estimator_type": base_estimator_type,
            }
        ),
    )


@platform_function(
    name="sklearn_regressor_chain_predict",
    inputs=[ModelBlobType, MatrixType(FloatType)],
    output=MatrixType(FloatType),
)
def sklearn_regressor_chain_predict_impl(
    model_blob: EastVariant,
    X: EastMatrix,
) -> EastMatrix:
    """Predict multi-target outputs with a fitted RegressorChain.

    Args:
        model_blob: ``ModelBlobType`` (``EastVariant``) tagged
            ``regressor_chain``, as returned by
            :func:`sklearn_regressor_chain_train_impl`.
        X: ``Matrix<Float>`` (``EastMatrix``) - feature matrix, shape
            (n_samples, n_features); must have the same feature count as
            the training data.

    Returns:
        ``Matrix<Float>`` (``EastMatrix``) - predicted targets, shape
        (n_samples, n_targets).

    Raises:
        NotImplementedError: the ``sklearn`` extra is not installed.
        RuntimeError: wrong blob tag, invalid input data, or prediction
            failure.
    """
    _check_sklearn_support()
    if model_blob.type != "regressor_chain":
        raise RuntimeError(
            f"sklearn_regressor_chain_predict: Expected regressor_chain, got {model_blob.type}"
        )

    try:
        X_np = X.to_numpy()
    except Exception as e:
        raise RuntimeError(
            f"sklearn_regressor_chain_predict: Invalid input data - {e}"
        ) from e

    try:
        chain = _deserialize_model(model_blob.value["data"])
        predictions = chain.predict(X_np)
    except Exception as e:
        raise RuntimeError(
            f"sklearn_regressor_chain_predict: Prediction failed with X shape {X_np.shape} - {e}"
        ) from e

    # Return as matrix (n_samples x n_targets)
    return EastMatrix(FloatType, np.atleast_2d(predictions).astype(np.float64))


# ============================================================================
# Gaussian Mixture Model
# ============================================================================


@platform_function(
    name="sklearn_gmm_fit",
    inputs=[MatrixType(FloatType), GMMConfigType],
    output=ModelBlobType,
)
def sklearn_gmm_fit_impl(
    X: EastMatrix,
    config: EastStruct,
) -> EastVariant:
    """Fit a Gaussian Mixture Model to data and return a cloudpickle-serialised model blob.

    Use the returned blob with :func:`sklearn_gmm_predict_impl`,
    :func:`sklearn_gmm_predict_proba_impl`,
    :func:`sklearn_gmm_score_samples_impl`,
    :func:`sklearn_gmm_sample_impl`,
    :func:`sklearn_gmm_bic_impl`, and :func:`sklearn_gmm_aic_impl`.

    Args:
        X: ``Matrix<Float>`` (``EastMatrix``) - training data, shape
            (n_samples, n_features).
        config: ``GMMConfigType`` (``EastStruct``) with fields:

            - ``n_components`` (``Option<Integer>``): number of mixture
              components; default 1.
            - ``covariance_type`` (``Option<GMMCovarianceType>``):
              ``full`` (default), ``tied``, ``diag``, or ``spherical``.
            - ``max_iter`` (``Option<Integer>``): maximum EM iterations;
              default 100.
            - ``n_init`` (``Option<Integer>``): number of random
              initialisations; best result is kept; default 1.
            - ``tol`` (``Option<Float>``): convergence threshold; default
              1e-3.
            - ``reg_covar`` (``Option<Float>``): regularisation added to
              the diagonal of each covariance matrix to ensure it is
              positive; default 1e-6.
            - ``random_state`` (``Option<Integer>``): seed; default None.

    Returns:
        ``ModelBlobType`` (``EastVariant``) tagged ``gaussian_mixture``:
        ``{data: Blob, n_features: Integer, n_components: Integer}``.

    Raises:
        NotImplementedError: the ``sklearn`` extra is not installed.
        RuntimeError: invalid input data or fitting failure.
    """
    _check_sklearn_support()
    from sklearn.mixture import GaussianMixture

    try:
        X_np = X.to_numpy()
    except Exception as e:
        raise RuntimeError(
            f"sklearn_gmm_fit: Invalid input data - {e}"
        ) from e

    n_features = X_np.shape[1]

    # Parse config
    n_components = int(_get_option(config.get("n_components"), 1))
    cov_type_variant = _get_option(config.get("covariance_type"), None)
    covariance_type = _get_enum_tag(cov_type_variant) if cov_type_variant else "full"
    max_iter = int(_get_option(config.get("max_iter"), 100))
    n_init = int(_get_option(config.get("n_init"), 1))
    tol = float(_get_option(config.get("tol"), 1e-3))
    reg_covar = float(_get_option(config.get("reg_covar"), 1e-6))
    random_state = _get_option(config.get("random_state"), None)
    if random_state is not None:
        random_state = int(random_state)

    try:
        gmm = GaussianMixture(
            n_components=n_components,
            covariance_type=covariance_type,
            max_iter=max_iter,
            n_init=n_init,
            tol=tol,
            reg_covar=reg_covar,
            random_state=random_state,
        )
        gmm.fit(X_np)
    except Exception as e:
        raise RuntimeError(
            f"sklearn_gmm_fit: Fitting failed with X shape {X_np.shape} - {e}"
        ) from e

    return EastVariant(
        "gaussian_mixture",
        EastStruct(
            {
                "data": _serialize_model(gmm),
                "n_features": n_features,
                "n_components": n_components,
            }
        ),
    )


@platform_function(
    name="sklearn_gmm_predict",
    inputs=[ModelBlobType, MatrixType(FloatType)],
    output=VectorType(IntegerType),
)
def sklearn_gmm_predict_impl(
    model_blob: EastVariant,
    X: EastMatrix,
) -> EastVector:
    """Predict the most likely component label for each sample.

    Args:
        model_blob: ``ModelBlobType`` (``EastVariant``) tagged
            ``gaussian_mixture``, as returned by
            :func:`sklearn_gmm_fit_impl`.
        X: ``Matrix<Float>`` (``EastMatrix``) - data, shape (n_samples,
            n_features); must match the feature count of the fitting data.

    Returns:
        ``Vector<Integer>`` (``EastVector``) - component index per sample
        in 0..n_components-1.

    Raises:
        NotImplementedError: the ``sklearn`` extra is not installed.
        RuntimeError: wrong blob tag, invalid input data, or prediction
            failure.
    """
    _check_sklearn_support()
    if model_blob.type != "gaussian_mixture":
        raise RuntimeError(
            f"sklearn_gmm_predict: Expected gaussian_mixture, got {model_blob.type}"
        )

    try:
        X_np = X.to_numpy()
    except Exception as e:
        raise RuntimeError(
            f"sklearn_gmm_predict: Invalid input data - {e}"
        ) from e

    try:
        gmm = _deserialize_model(model_blob.value["data"])
        labels = gmm.predict(X_np)
    except Exception as e:
        raise RuntimeError(
            f"sklearn_gmm_predict: Prediction failed - {e}"
        ) from e

    return EastVector(IntegerType, labels.ravel().astype(np.int64))


@platform_function(
    name="sklearn_gmm_predict_proba",
    inputs=[ModelBlobType, MatrixType(FloatType)],
    output=MatrixType(FloatType),
)
def sklearn_gmm_predict_proba_impl(
    model_blob: EastVariant,
    X: EastMatrix,
) -> EastMatrix:
    """Compute posterior membership probabilities for each GMM component.

    Args:
        model_blob: ``ModelBlobType`` (``EastVariant``) tagged
            ``gaussian_mixture``, as returned by
            :func:`sklearn_gmm_fit_impl`.
        X: ``Matrix<Float>`` (``EastMatrix``) - data, shape (n_samples,
            n_features).

    Returns:
        ``Matrix<Float>`` (``EastMatrix``) - posterior probabilities, shape
        (n_samples, n_components); each row sums to 1.

    Raises:
        NotImplementedError: the ``sklearn`` extra is not installed.
        RuntimeError: wrong blob tag, invalid input data, or prediction
            failure.
    """
    _check_sklearn_support()
    if model_blob.type != "gaussian_mixture":
        raise RuntimeError(
            f"sklearn_gmm_predict_proba: Expected gaussian_mixture, got {model_blob.type}"
        )

    try:
        X_np = X.to_numpy()
    except Exception as e:
        raise RuntimeError(
            f"sklearn_gmm_predict_proba: Invalid input data - {e}"
        ) from e

    try:
        gmm = _deserialize_model(model_blob.value["data"])
        proba = gmm.predict_proba(X_np)
    except Exception as e:
        raise RuntimeError(
            f"sklearn_gmm_predict_proba: Prediction failed - {e}"
        ) from e

    return EastMatrix(FloatType, np.atleast_2d(proba).astype(np.float64))


@platform_function(
    name="sklearn_gmm_score_samples",
    inputs=[ModelBlobType, MatrixType(FloatType)],
    output=VectorType(FloatType),
)
def sklearn_gmm_score_samples_impl(
    model_blob: EastVariant,
    X: EastMatrix,
) -> EastVector:
    """Compute the per-sample log-likelihood under the fitted GMM.

    Args:
        model_blob: ``ModelBlobType`` (``EastVariant``) tagged
            ``gaussian_mixture``, as returned by
            :func:`sklearn_gmm_fit_impl`.
        X: ``Matrix<Float>`` (``EastMatrix``) - data, shape (n_samples,
            n_features).

    Returns:
        ``Vector<Float>`` (``EastVector``) - log-likelihood per sample
        (higher = more likely under the model).

    Raises:
        NotImplementedError: the ``sklearn`` extra is not installed.
        RuntimeError: wrong blob tag, invalid input data, or scoring
            failure.
    """
    _check_sklearn_support()
    if model_blob.type != "gaussian_mixture":
        raise RuntimeError(
            f"sklearn_gmm_score_samples: Expected gaussian_mixture, got {model_blob.type}"
        )

    try:
        X_np = X.to_numpy()
    except Exception as e:
        raise RuntimeError(
            f"sklearn_gmm_score_samples: Invalid input data - {e}"
        ) from e

    try:
        gmm = _deserialize_model(model_blob.value["data"])
        scores = gmm.score_samples(X_np)
    except Exception as e:
        raise RuntimeError(
            f"sklearn_gmm_score_samples: Scoring failed - {e}"
        ) from e

    return EastVector(FloatType, scores.ravel().astype(np.float64))


@platform_function(
    name="sklearn_gmm_sample",
    inputs=[ModelBlobType, IntegerType],
    output=MatrixType(FloatType),
)
def sklearn_gmm_sample_impl(
    model_blob: EastVariant,
    n_samples: int,
) -> EastMatrix:
    """Draw random samples from the fitted Gaussian Mixture Model.

    Args:
        model_blob: ``ModelBlobType`` (``EastVariant``) tagged
            ``gaussian_mixture``, as returned by
            :func:`sklearn_gmm_fit_impl`.
        n_samples: ``Integer`` - number of samples to generate.

    Returns:
        ``Matrix<Float>`` (``EastMatrix``) - generated samples, shape
        (n_samples, n_features).

    Raises:
        NotImplementedError: the ``sklearn`` extra is not installed.
        RuntimeError: wrong blob tag, or sampling failure.
    """
    _check_sklearn_support()
    if model_blob.type != "gaussian_mixture":
        raise RuntimeError(
            f"sklearn_gmm_sample: Expected gaussian_mixture, got {model_blob.type}"
        )

    try:
        gmm = _deserialize_model(model_blob.value["data"])
        samples, _ = gmm.sample(int(n_samples))
    except Exception as e:
        raise RuntimeError(
            f"sklearn_gmm_sample: Sampling failed - {e}"
        ) from e

    return EastMatrix(FloatType, np.atleast_2d(samples).astype(np.float64))


@platform_function(
    name="sklearn_gmm_bic",
    inputs=[ModelBlobType, MatrixType(FloatType)],
    output=FloatType,
)
def sklearn_gmm_bic_impl(
    model_blob: EastVariant,
    X: EastMatrix,
) -> float:
    """Compute the Bayesian Information Criterion for the fitted GMM on data.

    Lower BIC indicates a better trade-off between fit quality and model
    complexity; useful for selecting the number of components.

    Args:
        model_blob: ``ModelBlobType`` (``EastVariant``) tagged
            ``gaussian_mixture``, as returned by
            :func:`sklearn_gmm_fit_impl`.
        X: ``Matrix<Float>`` (``EastMatrix``) - data to evaluate, shape
            (n_samples, n_features).

    Returns:
        ``Float`` - BIC value (lower is better).

    Raises:
        NotImplementedError: the ``sklearn`` extra is not installed.
        RuntimeError: wrong blob tag, invalid input data, or BIC
            computation failure.
    """
    _check_sklearn_support()
    if model_blob.type != "gaussian_mixture":
        raise RuntimeError(
            f"sklearn_gmm_bic: Expected gaussian_mixture, got {model_blob.type}"
        )

    try:
        X_np = X.to_numpy()
    except Exception as e:
        raise RuntimeError(
            f"sklearn_gmm_bic: Invalid input data - {e}"
        ) from e

    try:
        gmm = _deserialize_model(model_blob.value["data"])
        return float(gmm.bic(X_np))
    except Exception as e:
        raise RuntimeError(
            f"sklearn_gmm_bic: BIC computation failed - {e}"
        ) from e


@platform_function(
    name="sklearn_gmm_aic",
    inputs=[ModelBlobType, MatrixType(FloatType)],
    output=FloatType,
)
def sklearn_gmm_aic_impl(
    model_blob: EastVariant,
    X: EastMatrix,
) -> float:
    """Compute the Akaike Information Criterion for the fitted GMM on data.

    Lower AIC indicates a better trade-off between fit quality and model
    complexity; penalises complexity less heavily than BIC.

    Args:
        model_blob: ``ModelBlobType`` (``EastVariant``) tagged
            ``gaussian_mixture``, as returned by
            :func:`sklearn_gmm_fit_impl`.
        X: ``Matrix<Float>`` (``EastMatrix``) - data to evaluate, shape
            (n_samples, n_features).

    Returns:
        ``Float`` - AIC value (lower is better).

    Raises:
        NotImplementedError: the ``sklearn`` extra is not installed.
        RuntimeError: wrong blob tag, invalid input data, or AIC
            computation failure.
    """
    _check_sklearn_support()
    if model_blob.type != "gaussian_mixture":
        raise RuntimeError(
            f"sklearn_gmm_aic: Expected gaussian_mixture, got {model_blob.type}"
        )

    try:
        X_np = X.to_numpy()
    except Exception as e:
        raise RuntimeError(
            f"sklearn_gmm_aic: Invalid input data - {e}"
        ) from e

    try:
        gmm = _deserialize_model(model_blob.value["data"])
        return float(gmm.aic(X_np))
    except Exception as e:
        raise RuntimeError(
            f"sklearn_gmm_aic: AIC computation failed - {e}"
        ) from e


# ============================================================================
# Platform Function Registration
# ============================================================================

sklearn_impl = platform_functions(__name__)

__all__ = [
    "sklearn_impl",
    # Re-export types from types.py
    "SplitConfigType",
    "SplitResultType",
    "ModelBlobType",
]
