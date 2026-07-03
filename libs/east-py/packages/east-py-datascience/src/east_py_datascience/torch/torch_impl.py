#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""PyTorch platform functions for East.

Provides neural network models using PyTorch.
Uses cloudpickle for model serialization.
"""

import warnings

# Suppress torch warnings before import
warnings.filterwarnings("ignore", module="torch")

import importlib.util  # noqa: E402

import numpy as np  # noqa: E402
from east.runtime.platform import platform_function, platform_functions  # noqa: E402
from east.types.types import (  # noqa: E402
    ArrayType,
    BlobType,
    FloatType,
    IntegerType,
    MatrixType,
    StructType,
    VariantType,
    VectorType,
)
from east.types.values import (  # noqa: E402
    EastArray,
    EastBlob,
    EastMatrix,
    EastStruct,
    EastVariant,
    EastVector,
)

from east_py_datascience.types import (  # noqa: E402
    TorchMLPConfigType,
    TorchModelBlobType,
    TorchTrainConfigType,
    TorchTrainResultType,
    _get_enum_tag,
    _get_option,
)

# ============================================================================
# Serialization Helpers
# ============================================================================


def _serialize_model(model) -> EastBlob:
    """Serialize PyTorch model using cloudpickle."""
    import cloudpickle

    try:
        return EastBlob(cloudpickle.dumps(model))
    except Exception as e:
        raise RuntimeError(f"_serialize_model: Failed to serialize model - {e}")


def _deserialize_model(blob: EastBlob):
    """Deserialize PyTorch model using cloudpickle."""
    import cloudpickle

    try:
        return cloudpickle.loads(bytes(blob))
    except Exception as e:
        raise RuntimeError(f"_deserialize_model: Failed to deserialize model - {e}")




# ============================================================================
# Internal Training Helper
# ============================================================================


def _torch_mlp_train_internal(
    X_np: np.ndarray,
    y_np: np.ndarray,
    mlp_config: EastStruct,
    train_config: EastStruct,
    is_multi_output: bool,
) -> EastStruct:
    """Internal training logic shared between single and multi-output training.

    Args:
        X_np: Input features as numpy array (n_samples, n_features)
        y_np: Targets as numpy array - 1D for single output, 2D for multi output
        mlp_config: MLP configuration struct
        train_config: Training configuration struct
        is_multi_output: Whether this is multi-output training

    Returns:
        EastStruct with model and training result
    """
    import torch
    import torch.nn as nn
    from torch.utils.data import DataLoader, TensorDataset

    # Validate shapes
    if X_np.shape[0] != y_np.shape[0]:
        raise RuntimeError(
            f"torch_mlp_train: X and y have different sample counts - X: {X_np.shape[0]}, y: {y_np.shape[0]}"
        )

    n_features = X_np.shape[1]

    # Determine output dimension
    n_outputs = y_np.shape[1] if is_multi_output else 1

    # MLP config
    hidden_layers_arr = mlp_config.get("hidden_layers")
    hidden_layers = (
        [int(h) for h in hidden_layers_arr] if hidden_layers_arr else [64, 32]
    )

    activation_variant = _get_option(mlp_config.get("activation"), None)
    activation_name = (
        _get_enum_tag(activation_variant) if activation_variant else "relu"
    )

    dropout = _get_option(mlp_config.get("dropout"), 0.0)

    # Output activation (applied to final layer only)
    output_activation_variant = _get_option(mlp_config.get("output_activation"), None)
    output_activation_name = (
        _get_enum_tag(output_activation_variant)
        if output_activation_variant
        else "none"
    )

    # Parse loss
    loss_variant = _get_option(train_config.get("loss"), None)
    loss_name = _get_enum_tag(loss_variant) if loss_variant else "mse"

    # output_dim from config overrides inferred, but default to inferred n_outputs
    output_dim = _get_option(mlp_config.get("output_dim"), n_outputs)
    output_dim = int(output_dim) if output_dim is not None else n_outputs

    # Build model
    try:
        activation_map = {
            "relu": nn.ReLU,
            "tanh": nn.Tanh,
            "sigmoid": nn.Sigmoid,
            "leaky_relu": nn.LeakyReLU,
        }
        activation_cls = activation_map.get(activation_name, nn.ReLU)

        layers = []
        prev_dim = n_features
        for hidden_dim in hidden_layers:
            layers.append(nn.Linear(prev_dim, hidden_dim))
            layers.append(activation_cls())
            if dropout > 0:
                layers.append(nn.Dropout(dropout))
            prev_dim = hidden_dim
        layers.append(nn.Linear(prev_dim, output_dim))

        # Add simple output activation if specified
        if output_activation_name == "softmax":
            layers.append(nn.Softmax(dim=-1))
        elif output_activation_name == "sigmoid":
            layers.append(nn.Sigmoid())
        # "none" = no activation (linear output) - default

        model = nn.Sequential(*layers)
    except Exception as e:
        raise RuntimeError(f"torch_mlp_train: Failed to build model - {e}")

    # Training config
    epochs = _get_option(train_config.get("epochs"), 100)
    epochs = int(epochs) if epochs is not None else 100

    batch_size = _get_option(train_config.get("batch_size"), 32)
    batch_size = int(batch_size) if batch_size is not None else 32

    lr = _get_option(train_config.get("learning_rate"), 0.001)
    lr = float(lr) if lr is not None else 0.001

    optimizer_variant = _get_option(train_config.get("optimizer"), None)
    optimizer_name = _get_enum_tag(optimizer_variant) if optimizer_variant else "adam"

    patience = _get_option(train_config.get("early_stopping"), 0)
    patience = int(patience) if patience is not None else 0

    val_split = _get_option(train_config.get("validation_split"), 0.2)
    val_split = float(val_split) if val_split is not None else 0.2

    random_state = _get_option(train_config.get("random_state"), None)
    if random_state is not None:
        random_state = int(random_state)
        torch.manual_seed(random_state)
        np.random.seed(random_state)

    # Convert to tensors and prepare data
    try:
        X_tensor = torch.FloatTensor(X_np)
        y_tensor = torch.FloatTensor(y_np)

        # For single output, unsqueeze to 2D
        if not is_multi_output:
            y_tensor = y_tensor.unsqueeze(1)

        # Train/val split
        n = len(X_tensor)
        n_val = int(n * val_split)
        n_val = max(1, n_val)  # At least 1 validation sample

        indices = torch.randperm(n)
        train_indices = indices[n_val:]
        val_indices = indices[:n_val]

        X_train = X_tensor[train_indices]
        y_train = y_tensor[train_indices]
        X_val = X_tensor[val_indices]
        y_val = y_tensor[val_indices]

        # Create data loader
        train_dataset = TensorDataset(X_train, y_train)
        train_loader = DataLoader(train_dataset, batch_size=batch_size, shuffle=True, num_workers=0)

        # Loss and optimizer
        if loss_name == "bce_with_logits":
            if output_activation_name == "sigmoid":
                raise RuntimeError(
                    "torch_mlp_train: bce_with_logits loss applies sigmoid internally. "
                    "Do not use with sigmoid output_activation - use 'none' instead."
                )
            criterion = nn.BCEWithLogitsLoss()
        elif loss_name == "bce":
            criterion = nn.BCELoss()
        else:
            loss_map = {
                "mse": nn.MSELoss,
                "mae": nn.L1Loss,
                "cross_entropy": nn.CrossEntropyLoss,
                "kl_div": lambda: nn.KLDivLoss(reduction="batchmean"),
            }
            criterion = loss_map.get(loss_name, nn.MSELoss)()

        # KL divergence requires log probabilities as input
        use_log_for_kl = loss_name == "kl_div"

        if optimizer_name == "adam":
            optimizer = torch.optim.Adam(model.parameters(), lr=lr)
        elif optimizer_name == "sgd":
            optimizer = torch.optim.SGD(model.parameters(), lr=lr)
        elif optimizer_name == "adamw":
            optimizer = torch.optim.AdamW(model.parameters(), lr=lr)
        else:  # rmsprop
            optimizer = torch.optim.RMSprop(model.parameters(), lr=lr)
    except Exception as e:
        raise RuntimeError(
            f"torch_mlp_train: Failed to prepare training data - X shape: {X_np.shape} - {e}"
        )

    # Training loop
    try:
        # Suppress PyTorch warnings during training
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", category=Warning)
            train_losses = []
            val_losses = []
            best_val_loss = float("inf")
            best_epoch = 0
            patience_counter = 0

            for epoch in range(epochs):
                # Train
                model.train()
                epoch_loss = 0.0
                for X_batch, y_batch in train_loader:
                    optimizer.zero_grad()
                    outputs = model(X_batch)

                    # KL divergence requires log probabilities as input
                    if use_log_for_kl:
                        # Clamp to avoid log(0)
                        outputs = torch.log(outputs.clamp(min=1e-10))

                    loss = criterion(outputs, y_batch)
                    loss.backward()
                    optimizer.step()
                    epoch_loss += loss.item()

                train_losses.append(epoch_loss / len(train_loader))

                # Validate
                model.eval()
                with torch.no_grad():
                    val_pred = model(X_val)

                    if use_log_for_kl:
                        val_pred = torch.log(val_pred.clamp(min=1e-10))

                    val_loss = criterion(val_pred, y_val).item()

                val_losses.append(val_loss)

                # Early stopping
                if val_loss < best_val_loss:
                    best_val_loss = val_loss
                    best_epoch = epoch
                    patience_counter = 0
                elif patience > 0:
                    patience_counter += 1
                    if patience_counter >= patience:
                        break
    except Exception as e:
        raise RuntimeError(
            f"torch_mlp_train: Training failed - X shape: {X_np.shape} - {e}"
        )

    # Serialize model
    model_data = _serialize_model(model)

    model_blob = EastVariant(
        "torch_mlp",
        EastStruct(
            {
                "data": model_data,
                "n_features": n_features,
                "hidden_layers": EastArray(IntegerType, hidden_layers),
                "output_dim": output_dim,
            }
        ),
    )

    train_result = EastStruct(
        {
            "train_losses": EastVector(FloatType, data=np.array(train_losses, dtype=np.float64)),
            "val_losses": EastVector(FloatType, data=np.array(val_losses, dtype=np.float64)),
            "best_epoch": best_epoch,
        }
    )

    return EastStruct(
        {
            "model": model_blob,
            "result": train_result,
        }
    )



# Lazy import guard for optional dependency
_HAS_TORCH_SUPPORT = importlib.util.find_spec("torch") is not None


def _check_torch_support() -> None:
    """Check if torch support is available."""
    if not _HAS_TORCH_SUPPORT:
        raise NotImplementedError(
            "Torch support requires the 'torch' extra. "
            "Add east-py-datascience[torch] to your pyproject.toml dependencies."
        )


# ============================================================================
# Result Type for Training Output
# ============================================================================

# Combined output type: model + training result
TorchTrainOutputType = StructType(
    [
        (
            "model",
            VariantType(
                [
                    (
                        "torch_mlp",
                        StructType(
                            [
                                ("data", BlobType),
                                ("n_features", IntegerType),
                                ("hidden_layers", ArrayType(IntegerType)),
                                ("output_dim", IntegerType),
                            ]
                        ),
                    ),
                ]
            ),
        ),
        ("result", TorchTrainResultType),
    ]
)
"""Combined output of a single- or multi-output MLP training run.

Fields: ``model`` (variant ``torch_mlp`` - ``{data: Blob (cloudpickle),
n_features: Integer, hidden_layers: Array<Integer>, output_dim: Integer}``),
``result`` (``TorchTrainResultType`` - per-epoch ``train_losses``,
``val_losses``, and ``best_epoch``).
"""


# ============================================================================
# Platform Function Implementations
# ============================================================================


@platform_function(
    name="torch_mlp_train",
    inputs=[MatrixType(FloatType), VectorType(FloatType), TorchMLPConfigType, TorchTrainConfigType],
    output=TorchTrainOutputType,
)
def torch_mlp_train_impl(
    X: EastMatrix,
    y: EastVector,
    mlp_config: EastStruct,
    train_config: EastStruct,
) -> EastStruct:
    """Train a single-output PyTorch MLP and return the model blob with training metrics.

    Builds a fully-connected network from ``mlp_config``, splits the data into
    train/val, runs the training loop, and returns the serialized model together
    with per-epoch losses.

    Args:
        X: ``Matrix<Float>`` (``EastMatrix``) - feature matrix (n_samples x n_features).
        y: ``Vector<Float>`` (``EastVector``) - scalar target per sample.
        mlp_config: ``TorchMLPConfigType`` (``EastStruct``) with fields:

            - ``hidden_layers`` (``Array<Integer>``): sizes of hidden layers,
              e.g. ``[64, 32]``.
            - ``activation`` (``Option<TorchActivationType>``): ``relu``
              (default), ``tanh``, ``sigmoid``, or ``leaky_relu``.
            - ``output_activation`` (``Option<TorchOutputActivationType>``):
              ``none`` (default), ``softmax``, or ``sigmoid``.
            - ``dropout`` (``Option<Float>``): dropout rate (default 0.0).
            - ``output_dim`` (``Option<Integer>``): output units; inferred as 1
              for single-output training (default 1).
            - ``output_constraints``: unused for this function.

        train_config: ``TorchTrainConfigType`` (``EastStruct``) with fields:

            - ``epochs`` (``Option<Integer>``): training epochs (default 100).
            - ``batch_size`` (``Option<Integer>``): mini-batch size (default 32).
            - ``learning_rate`` (``Option<Float>``): step size (default 0.001).
            - ``loss`` (``Option<TorchLossType>``): ``mse`` (default), ``mae``,
              ``cross_entropy``, ``kl_div``, ``bce``, or ``bce_with_logits``.
            - ``optimizer`` (``Option<TorchOptimizerType>``): ``adam``
              (default), ``sgd``, ``adamw``, or ``rmsprop``.
            - ``early_stopping`` (``Option<Integer>``): patience; 0 = disabled
              (default 0).
            - ``validation_split`` (``Option<Float>``): fraction held out for
              validation (default 0.2).
            - ``random_state`` (``Option<Integer>``): seed for reproducibility.

    Returns:
        ``TorchTrainOutputType`` (``EastStruct``) with fields:

        - ``model`` (``EastVariant`` tagged ``torch_mlp``): serialized model
          blob with ``data`` (``Blob``), ``n_features``, ``hidden_layers``
          (``Array<Integer>``), and ``output_dim`` (``Integer``).
        - ``result`` (``TorchTrainResultType``): ``train_losses``
          (``Vector<Float>``), ``val_losses`` (``Vector<Float>``), and
          ``best_epoch`` (``Integer``).

    Raises:
        NotImplementedError: the ``torch`` extra is not installed.
        RuntimeError: X/y shape mismatch, model build failure, or training
            failure.
    """
    _check_torch_support()
    try:
        X_np = X.to_numpy()
        y_np = y.to_numpy()
    except Exception as e:
        raise RuntimeError(f"torch_mlp_train: Invalid input data - {e}")

    return _torch_mlp_train_internal(
        X_np, y_np, mlp_config, train_config, is_multi_output=False
    )


@platform_function(
    name="torch_mlp_train_multi",
    inputs=[MatrixType(FloatType), MatrixType(FloatType), TorchMLPConfigType, TorchTrainConfigType],
    output=TorchTrainOutputType,
)
def torch_mlp_train_multi_impl(
    X: EastMatrix,
    y: EastMatrix,
    mlp_config: EastStruct,
    train_config: EastStruct,
) -> EastStruct:
    """Train a multi-output PyTorch MLP and return the model blob with training metrics.

    Identical to :func:`torch_mlp_train_impl` except that ``y`` is a matrix;
    the output dimension defaults to ``y.shape[1]`` and can be overridden by
    ``mlp_config["output_dim"]``. Suitable for multi-output regression and
    autoencoder reconstruction tasks.

    Args:
        X: ``Matrix<Float>`` (``EastMatrix``) - feature matrix (n_samples x n_features).
        y: ``Matrix<Float>`` (``EastMatrix``) - target matrix
           (n_samples x n_outputs).
        mlp_config: ``TorchMLPConfigType`` (``EastStruct``) - see
            :func:`torch_mlp_train_impl`.  ``output_dim`` overrides the
            inferred ``y.shape[1]`` when set.
        train_config: ``TorchTrainConfigType`` (``EastStruct``) - see
            :func:`torch_mlp_train_impl`.

    Returns:
        ``TorchTrainOutputType`` (``EastStruct``) - same layout as
        :func:`torch_mlp_train_impl`.

    Raises:
        NotImplementedError: the ``torch`` extra is not installed.
        RuntimeError: X/y shape mismatch, model build failure, or training
            failure.
    """
    _check_torch_support()
    try:
        X_np = X.to_numpy()
        y_np = y.to_numpy()
    except Exception as e:
        raise RuntimeError(f"torch_mlp_train_multi: Invalid input data - {e}")

    return _torch_mlp_train_internal(
        X_np, y_np, mlp_config, train_config, is_multi_output=True
    )


@platform_function(
    name="torch_mlp_predict",
    inputs=[TorchModelBlobType, MatrixType(FloatType)],
    output=VectorType(FloatType),
)
def torch_mlp_predict_impl(
    model_blob: EastVariant,
    X: EastMatrix,
) -> EastVector:
    """Predict with a trained single-output PyTorch MLP.

    Runs the model in eval mode (no gradient) and returns the scalar
    output per sample. If the network output tensor has shape (n, 1) it is
    flattened to (n,).

    Args:
        model_blob: ``TorchModelBlobType`` (``EastVariant`` tagged ``torch_mlp``)
            from :func:`torch_mlp_train_impl` or :func:`torch_mlp_train_multi_impl`.
        X: ``Matrix<Float>`` (``EastMatrix``) - input features
           (n_samples x n_features).

    Returns:
        ``Vector<Float>`` (``EastVector``) - one predicted value per sample.

    Raises:
        NotImplementedError: the ``torch`` extra is not installed.
        RuntimeError: model blob is not tagged ``torch_mlp``,
            deserialization fails, or inference fails.
    """
    _check_torch_support()
    import torch

    # Validate model type
    if model_blob.type != "torch_mlp":
        raise RuntimeError(
            f"torch_mlp_predict: Expected torch_mlp model, got {model_blob.type}"
        )

    try:
        model = _deserialize_model(model_blob.value["data"])
    except Exception as e:
        raise RuntimeError(f"torch_mlp_predict: Failed to deserialize model - {e}")

    try:
        X_np = X.to_numpy()
    except Exception as e:
        raise RuntimeError(f"torch_mlp_predict: Invalid input data - {e}")

    # Make predictions
    try:
        # Suppress warnings during prediction
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", category=Warning)
            # Set model to eval mode
            model.eval()

            with torch.no_grad():
                X_tensor = torch.FloatTensor(X_np)
                predictions = model(X_tensor).numpy()

        # Flatten if single output
        if predictions.ndim > 1 and predictions.shape[1] == 1:
            predictions = predictions.flatten()

        # Return the torch f32 buffer directly; the East bridge canonicalizes to
        # the Float storage width crossing into east-c (no astype widen here).
        return EastVector(FloatType, predictions.ravel())
    except Exception as e:
        raise RuntimeError(
            f"torch_mlp_predict: Prediction failed - X shape: {X_np.shape} - {e}"
        )


@platform_function(
    name="torch_mlp_predict_multi",
    inputs=[TorchModelBlobType, MatrixType(FloatType)],
    output=MatrixType(FloatType),
)
def torch_mlp_predict_multi_impl(
    model_blob: EastVariant,
    X: EastMatrix,
) -> EastMatrix:
    """Predict with a trained multi-output PyTorch MLP.

    Runs the model in eval mode and returns the full output matrix.
    If the network output is 1-D it is reshaped to (n, 1).

    Args:
        model_blob: ``TorchModelBlobType`` (``EastVariant`` tagged ``torch_mlp``)
            from :func:`torch_mlp_train_multi_impl`.
        X: ``Matrix<Float>`` (``EastMatrix``) - input features
           (n_samples x n_features).

    Returns:
        ``Matrix<Float>`` (``EastMatrix``) - predicted values
        (n_samples x output_dim).

    Raises:
        NotImplementedError: the ``torch`` extra is not installed.
        RuntimeError: model blob is not tagged ``torch_mlp``,
            deserialization fails, or inference fails.
    """
    _check_torch_support()
    import torch

    # Validate model type
    if model_blob.type != "torch_mlp":
        raise RuntimeError(
            f"torch_mlp_predict_multi: Expected torch_mlp model, got {model_blob.type}"
        )

    try:
        model = _deserialize_model(model_blob.value["data"])
    except Exception as e:
        raise RuntimeError(
            f"torch_mlp_predict_multi: Failed to deserialize model - {e}"
        )

    try:
        X_np = X.to_numpy()
    except Exception as e:
        raise RuntimeError(f"torch_mlp_predict_multi: Invalid input data - {e}")

    # Make predictions
    try:
        # Suppress warnings during prediction
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", category=Warning)
            # Set model to eval mode
            model.eval()

            with torch.no_grad():
                X_tensor = torch.FloatTensor(X_np)
                predictions = model(X_tensor).numpy()

        # Ensure 2D output
        if predictions.ndim == 1:
            predictions = predictions.reshape(-1, 1)

        return EastMatrix(FloatType, np.atleast_2d(predictions))
    except Exception as e:
        raise RuntimeError(
            f"torch_mlp_predict_multi: Prediction failed - X shape: {X_np.shape} - {e}"
        )


@platform_function(
    name="torch_mlp_encode",
    inputs=[TorchModelBlobType, MatrixType(FloatType), IntegerType],
    output=MatrixType(FloatType),
)
def torch_mlp_encode_impl(
    model_blob: EastVariant,
    X: EastMatrix,
    layer_index: int,
) -> EastMatrix:
    """Extract intermediate-layer activations (embeddings) from an MLP.

    Runs the forward pass up to and including the activation after hidden
    layer ``layer_index``, returning the resulting activations. Useful for
    extracting the bottleneck of an autoencoder.

    Each "layer" in ``hidden_layers`` corresponds to one
    ``Linear + Activation [+ Dropout]`` block. For a network trained with
    ``hidden_layers=[8, 2, 8]``:

    - ``layer_index=0``: output after the first block (8 features).
    - ``layer_index=1``: output after the second block (2 features -
      bottleneck).
    - ``layer_index=2``: output after the third block (8 features).

    Args:
        model_blob: ``TorchModelBlobType`` (``EastVariant`` tagged ``torch_mlp``)
            from :func:`torch_mlp_train_impl` or
            :func:`torch_mlp_train_multi_impl`.
        X: ``Matrix<Float>`` (``EastMatrix``) - input features
           (n_samples x n_features).
        layer_index: ``Integer`` - 0-indexed hidden layer whose activations
            to return. Must be in ``[0, len(hidden_layers) - 1]``.

    Returns:
        ``Matrix<Float>`` (``EastMatrix``) - activations
        (n_samples x hidden_dim at ``layer_index``).

    Raises:
        NotImplementedError: the ``torch`` extra is not installed.
        RuntimeError: model blob is not tagged ``torch_mlp``,
            ``layer_index`` is out of range, or encoding fails.
    """
    import torch

    # Validate model type
    if model_blob.type != "torch_mlp":
        raise RuntimeError(
            f"torch_mlp_encode: Expected torch_mlp model, got {model_blob.type}"
        )

    try:
        model = _deserialize_model(model_blob.value["data"])
    except Exception as e:
        raise RuntimeError(f"torch_mlp_encode: Failed to deserialize model - {e}")

    try:
        X_np = X.to_numpy()
    except Exception as e:
        raise RuntimeError(f"torch_mlp_encode: Invalid input data - {e}")

    # Get hidden layer dimensions from model metadata
    hidden_layers = list(model_blob.value["hidden_layers"])
    n_hidden = len(hidden_layers)

    if layer_index < 0 or layer_index >= n_hidden:
        raise RuntimeError(
            f"torch_mlp_encode: layer_index {layer_index} out of range. "
            f"Model has {n_hidden} hidden layers (0 to {n_hidden - 1})."
        )

    # Extract activations up to the specified layer
    try:
        model.eval()

        with torch.no_grad():
            X_tensor = torch.FloatTensor(X_np)

            # Run through model layers up to and including the target layer
            # Model structure: [Linear, Activation, (Dropout), Linear, Activation, (Dropout), ..., Linear]
            # We need to count how many "blocks" we've passed
            current_hidden_layer = -1
            x = X_tensor

            for i, layer in enumerate(model):
                x = layer(x)

                # Check if this is a Linear layer (start of a new block)
                # and this is NOT the final output layer
                if isinstance(layer, torch.nn.Linear) and i < len(model) - 1:
                    current_hidden_layer += 1

                    # If we've reached our target layer, we need to apply
                    # the activation (and optionally dropout) before returning
                    if current_hidden_layer == layer_index:
                        # Apply subsequent non-linear layers until next Linear
                        for j in range(i + 1, len(model)):
                            next_layer = model[j]
                            if isinstance(next_layer, torch.nn.Linear):
                                break
                            x = next_layer(x)
                        break

            embeddings = x.numpy()

        # Ensure 2D output
        if embeddings.ndim == 1:
            embeddings = embeddings.reshape(-1, 1)

        return EastMatrix(FloatType, np.atleast_2d(embeddings))
    except Exception as e:
        raise RuntimeError(
            f"torch_mlp_encode: Encoding failed - X shape: {X_np.shape}, "
            f"layer_index: {layer_index} - {e}"
        )


@platform_function(
    name="torch_mlp_decode",
    inputs=[TorchModelBlobType, MatrixType(FloatType), IntegerType],
    output=MatrixType(FloatType),
)
def torch_mlp_decode_impl(
    model_blob: EastVariant,
    embeddings: EastMatrix,
    layer_index: int,
) -> EastMatrix:
    """Decode embeddings through the decoder portion of an MLP.

    The complement to :func:`torch_mlp_encode_impl`. Takes activations that
    originate from hidden layer ``layer_index`` and applies all subsequent
    layers (skipping layer ``layer_index`` and its activation/dropout), ending
    at the final output.

    Primary use-case: compute a weighted blend of bottleneck embeddings from
    :func:`torch_mlp_encode_impl`, then decode to reconstruct the output
    distribution.

    For a network with ``hidden_layers=[8, 2, 8]``:

    - ``layer_index=1``: start from the 2-dim bottleneck, run layers 2+ to output.
    - ``layer_index=0``: start from the 8-dim activations, run layers 1+ to output.

    Args:
        model_blob: ``TorchModelBlobType`` (``EastVariant`` tagged ``torch_mlp``)
            from :func:`torch_mlp_train_impl` or
            :func:`torch_mlp_train_multi_impl`.
        embeddings: ``Matrix<Float>`` (``EastMatrix``) - activations at
            ``layer_index`` (n_samples x hidden_dim at that layer).
        layer_index: ``Integer`` - 0-indexed hidden layer the embeddings come
            from. Must be in ``[0, len(hidden_layers) - 1]``.

    Returns:
        ``Matrix<Float>`` (``EastMatrix``) - decoded output
        (n_samples x output_dim).

    Raises:
        NotImplementedError: the ``torch`` extra is not installed.
        RuntimeError: model blob is not tagged ``torch_mlp``,
            ``layer_index`` is out of range, embedding dimension does not
            match the expected hidden-layer width, or decoding fails.
    """
    _check_torch_support()
    import torch

    # Validate model type
    if model_blob.type != "torch_mlp":
        raise RuntimeError(
            f"torch_mlp_decode: Expected torch_mlp model, got {model_blob.type}"
        )

    try:
        model = _deserialize_model(model_blob.value["data"])
    except Exception as e:
        raise RuntimeError(f"torch_mlp_decode: Failed to deserialize model - {e}")

    try:
        emb_np = embeddings.to_numpy()
    except Exception as e:
        raise RuntimeError(f"torch_mlp_decode: Invalid embeddings data - {e}")

    # Get hidden layer dimensions from model metadata
    hidden_layers = list(model_blob.value["hidden_layers"])
    n_hidden = len(hidden_layers)

    if layer_index < 0 or layer_index >= n_hidden:
        raise RuntimeError(
            f"torch_mlp_decode: layer_index {layer_index} out of range. "
            f"Model has {n_hidden} hidden layers (0 to {n_hidden - 1})."
        )

    # Validate embedding dimensions match expected layer size
    expected_dim = int(hidden_layers[layer_index])
    actual_dim = emb_np.shape[1] if emb_np.ndim > 1 else 1
    if actual_dim != expected_dim:
        raise RuntimeError(
            f"torch_mlp_decode: Embedding dimension {actual_dim} doesn't match "
            f"expected dimension {expected_dim} for layer {layer_index}."
        )

    # Run embeddings through decoder (layers after layer_index)
    try:
        model.eval()

        with torch.no_grad():
            x = torch.FloatTensor(emb_np)

            # Find where to start in the model
            # We need to skip: (layer_index + 1) hidden layer blocks
            # Each block is: Linear + Activation + (optional Dropout)
            current_hidden_layer = -1
            start_from_next = False

            for i, layer in enumerate(model):
                if start_from_next:
                    # We're past the target layer, apply remaining layers
                    x = layer(x)
                elif isinstance(layer, torch.nn.Linear):
                    if i < len(model) - 1:  # Not the final output layer
                        current_hidden_layer += 1
                        if current_hidden_layer == layer_index:
                            # Found target layer - skip it and its activation/dropout
                            # Start applying from the NEXT Linear layer
                            start_from_next = True
                            # Skip activation and dropout that follow this Linear
                            continue
                    else:
                        # This is the final output layer
                        x = layer(x)

            output = x.numpy()

        # Ensure 2D output
        if output.ndim == 1:
            output = output.reshape(-1, 1)

        return EastMatrix(FloatType, np.atleast_2d(output))
    except Exception as e:
        raise RuntimeError(
            f"torch_mlp_decode: Decoding failed - embeddings shape: {emb_np.shape}, "
            f"layer_index: {layer_index} - {e}"
        )


# ============================================================================
# Platform Function Registration
# ============================================================================

# Collected from the @platform_function decorations above.
torch_impl = platform_functions(__name__)

__all__ = [
    "torch_impl",
]
