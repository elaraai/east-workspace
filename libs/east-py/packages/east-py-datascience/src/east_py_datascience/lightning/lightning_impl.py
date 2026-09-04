#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Lightning-based neural network platform functions for East Data Science.

Provides a production-grade neural network training module using PyTorch Lightning.
Supports regression, binary classification, multiclass classification, and
multi-head categorical outputs.

The network classes live in :mod:`east_py_datascience.lightning._models`,
which each platform function imports on use: importing this module never
loads torch or pytorch_lightning.
"""

import os
import shutil
import tempfile
import warnings
from typing import Any

import numpy as np
from east import none, some
from east.runtime.platform import platform_function, platform_functions
from east.types.types import ArrayType, BooleanType, FloatType, MatrixType, OptionType
from east.types.values import EastBlob, EastMatrix, EastStruct, EastVariant

from east_py_datascience._common import extra_guard, quiet_warnings
from east_py_datascience.types import (
    GroupWeightsType,
    LightningConfigType,
    LightningGenerateConfigType,
    LightningModelBlobType,
    LightningResultType,
)

_check_lightning_installed = extra_guard("pytorch_lightning", "lightning", "Lightning")


def _check_lightning_support() -> None:
    """Guard the ``lightning`` extra and quiet Lightning before it loads.

    Lightning reads these variables when it is first imported, so they are set
    here, ahead of the lazy imports; ``setdefault`` leaves an explicit user
    setting alone.
    """
    _check_lightning_installed()
    os.environ.setdefault("PYTORCH_LIGHTNING_DISABLE_POSSIBLE_USER_WARNINGS", "1")
    os.environ.setdefault("LT_DISABLE_STATUS_BAR", "1")


# Architectures with a latent space (encode / decode), and the temporal subset
# that accepts a condition vector.
_TEMPORAL_ARCHITECTURES = ("conv1d", "sequential", "transformer")
_LATENT_ARCHITECTURES = ("autoencoder", *_TEMPORAL_ARCHITECTURES)


def _load_model(model_blob: EastVariant):
    """Deserialize a ``LightningModelBlobType`` into an eval-mode ``LightningMLP``."""
    from east_py_datascience.lightning._models import deserialize_model

    model = deserialize_model(bytes(model_blob.value["data"]))
    model.eval()
    return model


def _masks_tensor(masks: EastVariant):
    """``Option<Array<Array<Array<Boolean>>>>`` as a bool tensor, or ``None`` for ``none``."""
    import torch

    masks_list = masks.unwrap_or(None)
    if masks_list is None:
        return None
    masks_np = np.array([[[bool(v) for v in row] for row in sample] for sample in masks_list])
    return torch.tensor(masks_np, dtype=torch.bool)


def _condition_tensor(model, condition_matrix: EastMatrix | None, noun: str, verb: str):
    """Validate a condition matrix against the model's ``condition_dim``.

    Returns the float tensor, or ``None`` when no condition is given and the
    model takes none. ``noun``/``verb`` name the parameter in the messages
    (``conditions``/``were`` for predict, ``condition``/``was`` for decode
    and generate); the spec corpus pins that wording.
    """
    import torch

    if condition_matrix is None:
        if model.condition_dim is not None:
            raise ValueError(
                f"Model requires condition_dim={model.condition_dim} but no {noun} provided"
            )
        return None
    if model.condition_dim is None:
        raise ValueError(f"Model has no condition_dim but {noun} {verb} provided")
    condition_np = condition_matrix.to_numpy()
    if condition_np.shape[1] != model.condition_dim:
        raise ValueError(
            f"Expected condition_dim={model.condition_dim}, got {condition_np.shape[1]}"
        )
    return torch.tensor(condition_np, dtype=torch.float32)


def _as_matrix(tensor) -> EastMatrix:
    """A float32 output tensor as a ``Matrix<Float>``."""
    return EastMatrix(FloatType, np.atleast_2d(tensor.numpy()).astype(np.float64))


# ============================================================================
# Platform Function Implementations
# ============================================================================

# 3D boolean tensor for masks: (n_samples, n_heads, n_classes) — mirrors TS Tensor3DBoolType
Tensor3DBoolType = ArrayType(ArrayType(ArrayType(BooleanType)))


@platform_function(
    name="lightning_train",
    inputs=[MatrixType(FloatType), MatrixType(FloatType), LightningConfigType, OptionType(Tensor3DBoolType), OptionType(GroupWeightsType), OptionType(MatrixType(FloatType))],
    output=LightningResultType,
)
def lightning_train(
    X: EastMatrix,
    y: EastMatrix,
    config: EastStruct,
    masks: EastVariant,
    group_weights: EastVariant,
    conditions: EastVariant,
) -> EastStruct:
    """Train a Lightning neural network and return the model blob with training metrics.

    Builds a ``LightningMLP`` from ``config``, applies early stopping and
    checkpoint selection, then serializes the best checkpoint.  Architecture
    and output-type variants determine the network structure and loss function.

    Args:
        X: ``Matrix<Float>`` (``EastMatrix``) - feature matrix
           (n_samples x n_features).
        y: ``Matrix<Float>`` (``EastMatrix``) - target matrix
           (n_samples x output_dim).
        config: ``LightningConfigType`` (``EastStruct``) with fields:

            - ``architecture`` (``LightningArchitectureType``): one of

              - ``mlp`` ``{hidden_layers: Array<Integer>}``: fully-connected
                network with LayerNorm + ReLU + Dropout per layer.
              - ``autoencoder`` ``{encoder_layers, latent_dim, decoder_layers}``:
                symmetric encoder/decoder MLP.
              - ``conv1d`` ``{n_channels, sequence_length, conv_channels,
                kernel_size, latent_dim, condition_dim?}``: 1-D convolutional
                autoencoder over ``sequence_length`` steps with ``n_channels``
                features per step; requires ``multi_head`` or ``binary``
                output; ``n_heads`` must equal ``n_channels * sequence_length``.
              - ``sequential`` ``{n_channels, sequence_length, hidden_size,
                n_layers, cell_type, latent_dim, bidirectional,
                condition_dim?}``: LSTM/GRU autoencoder (``cell_type``:
                ``lstm`` or ``gru``); ``bidirectional`` encoder, always
                unidirectional decoder; supports
                :func:`lightning_generate_sequence`.
              - ``transformer`` ``{n_channels, sequence_length, d_model,
                n_attention_heads, n_layers, d_ff?, latent_dim,
                condition_dim?}``: Transformer autoencoder with positional
                encoding; ``d_model`` must be divisible by
                ``n_attention_heads``.

            - ``output`` (``LightningOutputType``): one of

              - ``regression`` (``NullType``): MSE loss, no output activation.
              - ``binary`` ``{pos_weight?}``: BCE with logits loss, sigmoid
                activation; ``pos_weight`` is a ``Vector<Float>`` of
                per-output positive-class weights.
              - ``multiclass`` ``{n_classes, class_weights?}``: cross-entropy
                loss, softmax activation; ``class_weights`` is a
                ``Vector<Float>`` of length ``n_classes``.
              - ``multi_head`` ``{n_heads, n_classes_per_head,
                class_weights?}``: ``n_heads`` independent cross-entropy
                heads; ``class_weights`` is a
                ``Matrix<Float>`` (n_heads x n_classes_per_head).

            - ``learning_rate`` (``Option<Float>``): AdamW step size
              (default 1e-3).
            - ``max_epochs`` (``Option<Integer>``): training budget
              (default 100).
            - ``patience`` (``Option<Integer>``): early-stopping patience in
              epochs (default 10).
            - ``batch_size`` (``Option<Integer>``): mini-batch size
              (default 32).
            - ``dropout`` (``Option<Float>``): dropout rate per layer
              (default 0.1).
            - ``gradient_clip`` (``Option<Float>``): gradient clipping
              (default 1.0).
            - ``weight_decay`` (``Option<Float>``): L2 regularization
              (default 0.0).
            - ``random_state`` (``Option<Integer>``): seed for
              reproducibility.
            - ``epoch_callback`` (``Option<LightningEpochCallbackType>``):
              East function called at the end of each epoch with
              ``(epoch, train_loss, val_loss)``.

        masks: ``Option<Array<Array<Array<Boolean>>>>`` (``EastVariant``) -
            3-D boolean mask tensor (n_samples x n_heads x n_classes_per_head
            for ``multi_head``, or n_samples x 1 x output_dim for ``binary``);
            ``True`` = valid position. Pass ``none`` when unused.
        group_weights: ``Option<GroupWeightsType>`` (``EastVariant``) -
            per-group loss weights.  ``GroupWeightsType`` has fields:

            - ``weights``: variant ``binary`` (``Array<Array<Float>>``,
              shape [n_groups][output_dim]) or ``multi_head``
              (``Array<Array<Array<Float>>>``,
              shape [n_groups][n_heads][n_classes]); must match the output
              type.
            - ``sample_groups`` (``Array<Integer>``): group index per sample,
              length must equal n_samples.

        conditions: ``Option<Matrix<Float>>`` (``EastVariant``) - per-sample
            condition vectors (n_samples x condition_dim) for temporal
            architectures that set ``condition_dim`` in their architecture
            config. Pass ``none`` when unused.

    Returns:
        ``LightningResultType`` (``EastStruct``) with fields:

        - ``model`` (``EastVariant`` tagged ``lightning``): serialized model
          blob with ``data`` (``Blob``), ``n_features`` (``Integer``),
          ``output_dim`` (``Integer``), ``architecture_type`` (``String``),
          ``output_type`` (``String``), and ``latent_dim``
          (``Option<Integer>``; present for autoencoder/temporal).
        - ``train_loss`` (``Float``): final epoch training loss.
        - ``val_loss`` (``Float``): final epoch validation loss.
        - ``best_epoch`` (``Integer``): epoch at which training stopped.

    Raises:
        NotImplementedError: the ``lightning`` extra is not installed.
        RuntimeError: temporal architecture with unsupported output type;
            ``n_heads`` not equal to ``n_channels * sequence_length``;
            ``d_model`` not divisible by ``n_attention_heads``;
            group_weights shape mismatch; conditions shape mismatch; or
            training failure.
    """
    _check_lightning_support()
    import pytorch_lightning as pl
    import torch
    from torch.utils.data import DataLoader, Dataset, TensorDataset, random_split

    from east_py_datascience.lightning._models import EpochCallback, LightningMLP, serialize_model

    # Convert inputs
    X_np = X.to_numpy()
    y_np = y.to_numpy()

    n_samples = X_np.shape[0]
    input_dim = X_np.shape[1]
    output_dim = y_np.shape[1]

    # Parse architecture config
    arch = config["architecture"]
    architecture_type = arch.type
    architecture_config: dict[str, Any]
    if architecture_type == "autoencoder":
        architecture_config = {
            "encoder_layers": [int(x) for x in arch.value["encoder_layers"]],
            "latent_dim": int(arch.value["latent_dim"]),
            "decoder_layers": [int(x) for x in arch.value["decoder_layers"]],
        }
    elif architecture_type == "conv1d":
        condition_dim = arch.value["condition_dim"].unwrap_or(None)
        architecture_config = {
            "n_channels": int(arch.value["n_channels"]),
            "sequence_length": int(arch.value["sequence_length"]),
            "conv_channels": [int(x) for x in arch.value["conv_channels"]],
            "kernel_size": int(arch.value["kernel_size"]),
            "latent_dim": int(arch.value["latent_dim"]),
            "condition_dim": int(condition_dim) if condition_dim is not None else None,
        }
    elif architecture_type == "sequential":
        condition_dim = arch.value["condition_dim"].unwrap_or(None)
        cell_type_variant = arch.value["cell_type"]
        cell_type = cell_type_variant.type  # "lstm" or "gru"
        architecture_config = {
            "n_channels": int(arch.value["n_channels"]),
            "sequence_length": int(arch.value["sequence_length"]),
            "hidden_size": int(arch.value["hidden_size"]),
            "n_layers": int(arch.value["n_layers"]),
            "cell_type": cell_type,
            "latent_dim": int(arch.value["latent_dim"]),
            "bidirectional": bool(arch.value["bidirectional"]),
            "condition_dim": int(condition_dim) if condition_dim is not None else None,
        }
    elif architecture_type == "transformer":
        condition_dim = arch.value["condition_dim"].unwrap_or(None)
        d_ff = arch.value["d_ff"].unwrap_or(None)
        architecture_config = {
            "n_channels": int(arch.value["n_channels"]),
            "sequence_length": int(arch.value["sequence_length"]),
            "d_model": int(arch.value["d_model"]),
            "n_attention_heads": int(arch.value["n_attention_heads"]),
            "n_layers": int(arch.value["n_layers"]),
            "d_ff": int(d_ff) if d_ff is not None else None,
            "latent_dim": int(arch.value["latent_dim"]),
            "condition_dim": int(condition_dim) if condition_dim is not None else None,
        }
    else:  # mlp
        architecture_config = {
            "hidden_layers": [int(x) for x in arch.value["hidden_layers"]],
        }
    latent_dim: int | None = None if architecture_type == "mlp" else int(arch.value["latent_dim"])

    # Parse output config
    output = config["output"]
    output_type = output.type
    output_config: dict[str, Any]
    if output_type == "binary":
        pos_weight = output.value["pos_weight"].unwrap_or(None)
        output_config = {
            "pos_weight": pos_weight.to_numpy().tolist() if pos_weight is not None else None,
        }
    elif output_type == "multiclass":
        class_weights = output.value["class_weights"].unwrap_or(None)
        output_config = {
            "n_classes": int(output.value["n_classes"]),
            "class_weights": class_weights.to_numpy().tolist() if class_weights is not None else None,
        }
    elif output_type == "multi_head":
        class_weights = output.value["class_weights"].unwrap_or(None)
        output_config = {
            "n_heads": int(output.value["n_heads"]),
            "n_classes_per_head": int(output.value["n_classes_per_head"]),
            # Convert to nested list for safe serialization (numpy arrays fail with weights_only=True)
            "class_weights": class_weights.to_numpy().tolist() if class_weights is not None else None,
        }
    else:
        output_config = {}

    # Parse and validate group_weights
    group_weights_for_model = None
    sample_groups_list = None

    gw_struct = group_weights.unwrap_or(None)
    if gw_struct is not None:
        weights_variant = gw_struct["weights"]
        weights_type = weights_variant.type  # "binary" or "multi_head"
        weights_data = list(weights_variant.value)

        # Validate: group_weights only supported for multi_head and binary
        if output_type not in ("multi_head", "binary"):
            raise ValueError("group_weights only supported for multi_head and binary output")

        # Validate: weights variant matches output type
        if weights_type != output_type:
            raise ValueError(
                f"group_weights variant '{weights_type}' does not match output type '{output_type}'"
            )

        # Convert weights to nested lists
        if weights_type == "binary":
            weights_data = [[float(v) for v in group] for group in weights_data]
            expected_dim = output_dim
            if len(weights_data[0]) != expected_dim:
                raise ValueError(
                    f"binary group_weights must have shape [n_groups][{expected_dim}], "
                    f"got [n_groups][{len(weights_data[0])}]"
                )
        else:  # multi_head
            weights_data = [[[float(v) for v in cls] for cls in head] for head in weights_data]
            n_heads = output_config["n_heads"]
            n_classes = output_config["n_classes_per_head"]
            if len(weights_data[0]) != n_heads or len(weights_data[0][0]) != n_classes:
                raise ValueError(
                    f"multi_head group_weights must have shape [n_groups][{n_heads}][{n_classes}]"
                )

        # Validate group indices
        sample_groups_list = [int(g) for g in gw_struct["sample_groups"]]
        n_groups = len(weights_data)

        if len(sample_groups_list) != n_samples:
            raise ValueError(
                f"sample_groups length {len(sample_groups_list)} does not match X rows {n_samples}"
            )
        if len(sample_groups_list) == 0:
            raise ValueError("sample_groups cannot be empty")
        min_group = min(sample_groups_list)
        max_group = max(sample_groups_list)
        if min_group < 0:
            raise ValueError(f"sample_groups contains negative index {min_group}")
        if max_group >= n_groups:
            raise ValueError(
                f"sample_groups contains index {max_group} but only {n_groups} groups provided"
            )

        # Warn if both config weights and group_weights provided
        if output_type == "multi_head" and output_config.get("class_weights") is not None:
            warnings.warn("group_weights provided; ignoring config class_weights", stacklevel=2)
        elif output_type == "binary" and output_config.get("pos_weight") is not None:
            warnings.warn("group_weights provided; ignoring config pos_weight", stacklevel=2)

        group_weights_for_model = {
            "weights": weights_data,
            "weights_type": weights_type,
        }

    # Training params with defaults
    learning_rate = float(config["learning_rate"].unwrap_or(1e-3))
    max_epochs = int(config["max_epochs"].unwrap_or(100))
    patience = int(config["patience"].unwrap_or(10))
    batch_size = int(config["batch_size"].unwrap_or(32))
    dropout = float(config["dropout"].unwrap_or(0.1))
    gradient_clip = float(config["gradient_clip"].unwrap_or(1.0))
    weight_decay = float(config["weight_decay"].unwrap_or(0.0))
    random_state = config["random_state"].unwrap_or(None)
    epoch_callback_fn = config["epoch_callback"].unwrap_or(None)

    if random_state is not None:
        pl.seed_everything(int(random_state), workers=True)

    # Create model
    model = LightningMLP(
        input_dim=input_dim,
        output_dim=output_dim,
        architecture_type=architecture_type,
        architecture_config=architecture_config,
        output_type=output_type,
        output_config=output_config,
        learning_rate=learning_rate,
        dropout=dropout,
        weight_decay=weight_decay,
        group_weights=group_weights_for_model,
    )

    # Prepare data
    X_tensor = torch.tensor(X_np, dtype=torch.float32)
    y_tensor = torch.tensor(y_np, dtype=torch.float32)

    masks_tensor = _masks_tensor(masks)

    # Conditions only apply to architectures that declare condition_dim
    conditions_tensor = None
    has_condition_dim = architecture_config.get("condition_dim") is not None
    conditions_matrix = conditions.unwrap_or(None)
    if conditions_matrix is not None:
        conditions_np = conditions_matrix.to_numpy()
        conditions_tensor = torch.tensor(conditions_np, dtype=torch.float32)
        if not has_condition_dim:
            raise ValueError("conditions provided but architecture has no condition_dim set")
        if conditions_np.shape[0] != n_samples:
            raise ValueError(
                f"conditions rows {conditions_np.shape[0]} does not match X rows {n_samples}"
            )
        if conditions_np.shape[1] != architecture_config["condition_dim"]:
            raise ValueError(
                f"conditions columns {conditions_np.shape[1]} does not match condition_dim "
                f"{architecture_config['condition_dim']}"
            )
    elif has_condition_dim:
        raise ValueError("architecture has condition_dim set but no conditions provided")

    # Dataset columns are positional - (x, y, masks, group_idx, condition) -
    # and LightningMLP._unpack_batch reads them by count, so a later column
    # needs every earlier one: fill the gaps with all-valid masks / group 0.
    need_groups = sample_groups_list is not None or conditions_tensor is not None
    columns = [X_tensor, y_tensor]
    if masks_tensor is not None or need_groups:
        if masks_tensor is None:
            if output_type == "multi_head":
                shape = (n_samples, output_config["n_heads"], output_config["n_classes_per_head"])
            else:
                shape = (n_samples, 1, output_dim)
            masks_tensor = torch.ones(shape, dtype=torch.bool)
        columns.append(masks_tensor)
    if need_groups:
        groups = sample_groups_list if sample_groups_list is not None else [0] * n_samples
        columns.append(torch.tensor(groups, dtype=torch.long))
    if conditions_tensor is not None:
        columns.append(conditions_tensor)
    dataset = TensorDataset(*columns)

    # Split data - ensure at least 1 validation sample when possible
    val_size = max(1, int(0.1 * n_samples)) if n_samples >= 2 else 0
    train_size = n_samples - val_size

    generator = torch.Generator()
    if random_state is not None:
        generator.manual_seed(int(random_state))

    train_dataset: Dataset
    val_loader: DataLoader | None
    if val_size > 0:
        train_dataset, val_dataset = random_split(
            dataset, [train_size, val_size], generator=generator
        )
        val_loader = DataLoader(val_dataset, batch_size=batch_size, num_workers=0)
        monitor_metric = "val_loss"
    else:
        train_dataset = dataset
        val_loader = None
        monitor_metric = "train_loss"

    train_loader = DataLoader(train_dataset, batch_size=batch_size, shuffle=True, num_workers=0)

    # Use temp directory for checkpoints (cleaned up after training)
    checkpoint_dir = tempfile.mkdtemp(prefix="lightning_ckpt_")
    try:
        # Train
        checkpoint = pl.callbacks.ModelCheckpoint(
            dirpath=checkpoint_dir,
            monitor=monitor_metric,
            mode="min",
            save_top_k=1,
        )
        callbacks: list[pl.Callback] = [
            pl.callbacks.EarlyStopping(monitor=monitor_metric, patience=patience, mode="min"),
            checkpoint,
        ]

        # Add user epoch callback if provided
        if epoch_callback_fn is not None:
            callbacks.append(EpochCallback(epoch_callback_fn))

        trainer = pl.Trainer(
            max_epochs=max_epochs,
            callbacks=callbacks,
            gradient_clip_val=gradient_clip,
            enable_progress_bar=False,
            enable_model_summary=False,
            logger=False,
            # "auto" picks the best accelerator (incl. MPS on Apple Silicon). CI
            # runners expose MPS but can't actually allocate on it (headless), so
            # EAST_LIGHTNING_ACCELERATOR=cpu forces CPU there. Default unchanged.
            accelerator=os.environ.get("EAST_LIGHTNING_ACCELERATOR", "auto"),
            deterministic=random_state is not None,
        )

        with quiet_warnings():
            trainer.fit(model, train_loader, val_loader)

            # Get best model
            best_model_path = checkpoint.best_model_path
            if best_model_path:
                # weights_only=False needed for PyTorch 2.6+ (we trust our own checkpoints)
                model = LightningMLP.load_from_checkpoint(best_model_path, weights_only=False)
    finally:
        # Clean up temp checkpoint directory
        shutil.rmtree(checkpoint_dir, ignore_errors=True)

    # Get final metrics
    train_loss = float(trainer.callback_metrics.get("train_loss", 0.0))
    val_loss = float(trainer.callback_metrics.get("val_loss", 0.0))
    best_epoch = trainer.current_epoch

    # Serialize model
    model_blob = EastBlob(serialize_model(model))

    # Create result with model blob variant
    result_model: EastVariant = EastVariant(
        "lightning",
        EastStruct(
            {
                "data": model_blob,
                "n_features": input_dim,
                "output_dim": output_dim,
                "architecture_type": architecture_type,
                "output_type": output_type,
                "latent_dim": some(latent_dim) if latent_dim is not None else none,
            }
        ),
    )

    return EastStruct(
        {
            "model": result_model,
            "train_loss": train_loss,
            "val_loss": val_loss,
            "best_epoch": best_epoch,
        }
    )


@platform_function(
    name="lightning_predict",
    inputs=[LightningModelBlobType, MatrixType(FloatType), OptionType(Tensor3DBoolType), OptionType(MatrixType(FloatType))],
    output=MatrixType(FloatType),
)
def lightning_predict(
    model_blob: EastVariant,
    X: EastMatrix,
    masks: EastVariant,
    conditions: EastVariant,
) -> EastMatrix:
    """Predict output probabilities with a trained Lightning model.

    Applies the appropriate output activation (sigmoid for ``binary``,
    softmax per head for ``multi_head``, identity for ``regression``) and
    optionally zeros masked positions.

    Args:
        model_blob: ``LightningModelBlobType`` (``EastVariant``)
            from :func:`lightning_train`.
        X: ``Matrix<Float>`` (``EastMatrix``) - input features
           (n_samples x n_features).
        masks: ``Option<Array<Array<Array<Boolean>>>>`` (``EastVariant``) -
            3-D boolean validity mask; same layout as the training ``masks``
            parameter. Pass ``none`` when unused.
        conditions: ``Option<Matrix<Float>>`` (``EastVariant``) - per-sample
            condition vectors (n_samples x condition_dim) for temporal
            architectures. Pass ``none`` for unconditional models.

    Returns:
        ``Matrix<Float>`` (``EastMatrix``) - activated output
        (n_samples x output_dim).

    Raises:
        NotImplementedError: the ``lightning`` extra is not installed.
        RuntimeError: model requires conditions but none provided;
            condition column count does not match ``condition_dim``; or
            inference fails.
    """
    _check_lightning_support()
    import torch

    model = _load_model(model_blob)
    X_tensor = torch.tensor(X.to_numpy(), dtype=torch.float32)
    masks_tensor = _masks_tensor(masks)
    condition_tensor = _condition_tensor(model, conditions.unwrap_or(None), "conditions", "were")

    with torch.no_grad():
        if condition_tensor is not None:
            probs = model.predict_probs_with_masks_conditional(
                X_tensor, masks_tensor, condition_tensor
            )
        else:
            probs = model.predict_probs_with_masks(X_tensor, masks_tensor)

    return _as_matrix(probs)


@platform_function(
    name="lightning_encode",
    inputs=[LightningModelBlobType, MatrixType(FloatType)],
    output=MatrixType(FloatType),
)
def lightning_encode(
    model_blob: EastVariant,
    X: EastMatrix,
) -> EastMatrix:
    """Encode inputs to the latent space of an autoencoder or temporal model.

    Available for ``autoencoder``, ``conv1d``, ``sequential``, and
    ``transformer`` architectures.

    Args:
        model_blob: ``LightningModelBlobType`` (``EastVariant``)
            from :func:`lightning_train`.
        X: ``Matrix<Float>`` (``EastMatrix``) - input features
           (n_samples x n_features).

    Returns:
        ``Matrix<Float>`` (``EastMatrix``) - latent vectors
        (n_samples x latent_dim).

    Raises:
        NotImplementedError: the ``lightning`` extra is not installed.
        RuntimeError: architecture is ``mlp`` (encode not available) or
            encoding fails.
    """
    _check_lightning_support()
    import torch

    model = _load_model(model_blob)
    if model.architecture_type not in _LATENT_ARCHITECTURES:
        raise ValueError(f"encode() not available for {model.architecture_type} architecture")

    X_tensor = torch.tensor(X.to_numpy(), dtype=torch.float32)
    with torch.no_grad():
        embeddings = model.encode(X_tensor)

    return _as_matrix(embeddings)


@platform_function(
    name="lightning_decode",
    inputs=[LightningModelBlobType, MatrixType(FloatType)],
    output=MatrixType(FloatType),
)
def lightning_decode(
    model_blob: EastVariant,
    z: EastMatrix,
) -> EastMatrix:
    """Decode latent vectors to output without a condition vector.

    Available for ``autoencoder``, ``conv1d``, ``sequential``, and
    ``transformer`` architectures. Applies the output activation before
    returning (sigmoid for ``binary``, per-head softmax for ``multi_head``,
    identity for ``regression``).

    Use :func:`lightning_decode_conditional` when the architecture
    sets ``condition_dim``.

    Args:
        model_blob: ``LightningModelBlobType`` (``EastVariant``)
            from :func:`lightning_train`.
        z: ``Matrix<Float>`` (``EastMatrix``) - latent vectors
           (n_samples x latent_dim).

    Returns:
        ``Matrix<Float>`` (``EastMatrix``) - activated output
        (n_samples x output_dim).

    Raises:
        NotImplementedError: the ``lightning`` extra is not installed.
        RuntimeError: architecture is ``mlp``; model requires a condition
            vector (use :func:`lightning_decode_conditional`); or
            decoding fails.
    """
    _check_lightning_support()
    import torch

    model = _load_model(model_blob)
    if model.architecture_type not in _LATENT_ARCHITECTURES:
        raise ValueError(f"decode() not available for {model.architecture_type} architecture")
    if model.condition_dim is not None:
        raise ValueError(
            f"Model has condition_dim={model.condition_dim} but decode() was called without condition. "
            "Use decodeConditional() instead."
        )

    z_tensor = torch.tensor(z.to_numpy(), dtype=torch.float32)
    with torch.no_grad():
        output = model.apply_output_activation(model.decode(z_tensor))

    return _as_matrix(output)


@platform_function(
    name="lightning_decode_conditional",
    inputs=[LightningModelBlobType, MatrixType(FloatType), MatrixType(FloatType)],
    output=MatrixType(FloatType),
)
def lightning_decode_conditional(
    model_blob: EastVariant,
    z: EastMatrix,
    condition: EastMatrix,
) -> EastMatrix:
    """Decode latent vectors to output with a per-sample condition vector.

    Applies the same output activation as :func:`lightning_decode` but
    concatenates ``condition`` to the latent before the decoder, enabling
    controlled generation for temporal architectures (``conv1d``,
    ``sequential``, ``transformer``) that set ``condition_dim``.

    Args:
        model_blob: ``LightningModelBlobType`` (``EastVariant``)
            from :func:`lightning_train`.
        z: ``Matrix<Float>`` (``EastMatrix``) - latent vectors
           (n_samples x latent_dim).
        condition: ``Matrix<Float>`` (``EastMatrix``) - condition vectors
            (n_samples x condition_dim); column count must match the model's
            ``condition_dim``.

    Returns:
        ``Matrix<Float>`` (``EastMatrix``) - activated output
        (n_samples x output_dim).

    Raises:
        NotImplementedError: the ``lightning`` extra is not installed.
        RuntimeError: architecture is not ``conv1d``, ``sequential``, or
            ``transformer``; model has no ``condition_dim``; condition
            column count does not match ``condition_dim``; or decoding fails.
    """
    _check_lightning_support()
    import torch

    model = _load_model(model_blob)
    if model.architecture_type not in _TEMPORAL_ARCHITECTURES:
        raise ValueError(
            f"decodeConditional() requires temporal architecture (conv1d, sequential, transformer), "
            f"got {model.architecture_type}"
        )
    condition_tensor = _condition_tensor(model, condition, "condition", "was")

    z_tensor = torch.tensor(z.to_numpy(), dtype=torch.float32)
    with torch.no_grad():
        output = model.apply_output_activation(model.decode(z_tensor, condition_tensor))

    return _as_matrix(output)


@platform_function(
    name="lightning_generate_sequence",
    inputs=[LightningModelBlobType, MatrixType(FloatType), OptionType(MatrixType(FloatType)), LightningGenerateConfigType],
    output=MatrixType(FloatType),
)
def lightning_generate_sequence(
    model_blob: EastVariant,
    prefix: EastMatrix,
    condition: EastVariant,
    config: EastStruct,
) -> EastMatrix:
    """Generate a sequence autoregressively with a ``sequential`` architecture model.

    At each step the model's decoder RNN takes the previous output (or the
    last prefix step) as input and emits the next step.  An optional prefix
    seeds the RNN hidden state before generation begins.

    Only available for models trained with the ``sequential`` architecture
    and ``binary`` or ``regression`` output types.

    Args:
        model_blob: ``LightningModelBlobType`` (``EastVariant``)
            from :func:`lightning_train` with ``sequential``
            architecture.
        prefix: ``Matrix<Float>`` (``EastMatrix``) - optional prefix sequence
            (n_prefix_steps x n_channels). Pass an empty matrix (0 rows)
            to start from a zero hidden state.
        condition: ``Option<Matrix<Float>>`` (``EastVariant``) - per-step
            condition vector (1 x condition_dim) broadcast over all
            generated steps. Pass ``none`` for unconditional generation.
        config: ``LightningGenerateConfigType`` (``EastStruct``) with fields:

            - ``n_steps`` (``Integer``): number of steps to generate.
            - ``temperature`` (``Float``): sampling temperature.  ``0.0``
              selects the argmax (deterministic); values ``> 0`` scale the
              logits before sampling.
            - ``return_probs`` (``Boolean``): when ``True`` each step
              returns the activated probabilities (not a hard sample);
              when ``False`` samples are drawn for ``binary`` or the raw
              regression value is returned for ``regression``.

    Returns:
        ``Matrix<Float>`` (``EastMatrix``) - generated sequence
        (n_steps x n_channels). Does NOT include the prefix rows.

    Raises:
        NotImplementedError: the ``lightning`` extra is not installed.
        RuntimeError: model architecture is not ``sequential``; output type
            is not ``binary`` or ``regression``; model requires a condition
            but none provided; condition column count does not match
            ``condition_dim``; or generation fails.
    """
    _check_lightning_support()
    import torch

    model = _load_model(model_blob)
    if model.architecture_type != "sequential":
        raise ValueError(
            f"generateSequence requires sequential architecture, got {model.architecture_type}"
        )

    prefix_np = prefix.to_numpy()
    prefix_tensor = torch.tensor(prefix_np, dtype=torch.float32) if prefix_np.shape[0] > 0 else None
    condition_tensor = _condition_tensor(model, condition.unwrap_or(None), "condition", "was")

    with torch.no_grad():
        generated = model.generate_autoregressive(
            prefix=prefix_tensor,
            condition=condition_tensor,
            n_steps=int(config["n_steps"]),
            temperature=float(config["temperature"]),
            return_probs=bool(config["return_probs"]),
        )

    return _as_matrix(generated)


# ============================================================================
# Platform Function Registration
# ============================================================================

# Collected from the @platform_function decorations above.
lightning_impl = platform_functions(__name__)
