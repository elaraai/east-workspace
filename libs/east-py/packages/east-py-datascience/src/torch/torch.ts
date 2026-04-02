/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * PyTorch platform functions for East.
 *
 * Provides neural network models using PyTorch.
 * Uses cloudpickle for model serialization.
 *
 * @packageDocumentation
 */

import {
    East,
    StructType,
    VariantType,
    OptionType,
    IntegerType,
    FloatType,
    BlobType,
    ArrayType,
    NullType,
} from "@elaraai/east";
import { VectorType, MatrixType } from "../types.js";

// Re-export shared types for convenience
export { VectorType, MatrixType } from "../types.js";

// ============================================================================
// Enum Types
// ============================================================================

/**
 * Activation function type for hidden layers.
 */
export const TorchActivationType = VariantType({
    /** Rectified Linear Unit */
    relu: NullType,
    /** Hyperbolic tangent */
    tanh: NullType,
    /** Sigmoid function */
    sigmoid: NullType,
    /** Leaky ReLU */
    leaky_relu: NullType,
});

/**
 * Loss function type for training.
 */
export const TorchLossType = VariantType({
    /** Mean Squared Error (regression) */
    mse: NullType,
    /** Mean Absolute Error (regression) */
    mae: NullType,
    /** Cross Entropy (multi-class classification with integer targets) */
    cross_entropy: NullType,
    /** KL Divergence (distribution matching, use with softmax output) */
    kl_div: NullType,
    /** Binary Cross Entropy (multi-label binary, requires sigmoid output) */
    bce: NullType,
    /** Binary Cross Entropy with Logits (more stable, applies sigmoid internally - do NOT use with sigmoid output_activation) */
    bce_with_logits: NullType,
});

/**
 * Optimizer type for training.
 */
export const TorchOptimizerType = VariantType({
    /** Adam optimizer */
    adam: NullType,
    /** Stochastic Gradient Descent */
    sgd: NullType,
    /** AdamW with weight decay */
    adamw: NullType,
    /** RMSprop optimizer */
    rmsprop: NullType,
});

/**
 * Output activation function type for the final layer.
 * Applied only to the output layer, not hidden layers.
 */
export const TorchOutputActivationType = VariantType({
    /** No activation (linear output) - default */
    none: NullType,
    /** Softmax (outputs sum to 1, for probability distributions) */
    softmax: NullType,
    /** Sigmoid (each output independently in [0,1]) */
    sigmoid: NullType,
});

// ============================================================================
// Config Types
// ============================================================================

/**
 * Configuration for MLP architecture.
 */
export const TorchMLPConfigType = StructType({
    /** Hidden layer sizes, e.g., [64, 32] */
    hidden_layers: ArrayType(IntegerType),
    /** Activation function for hidden layers (default relu) */
    activation: OptionType(TorchActivationType),
    /** Output activation function (default none/linear). Ignored if output_constraints is set. */
    output_activation: OptionType(TorchOutputActivationType),
    /** Dropout rate (default 0.0) */
    dropout: OptionType(FloatType),
    /** Output dimension (default 1) */
    output_dim: OptionType(IntegerType),
});

/**
 * Configuration for training.
 */
export const TorchTrainConfigType = StructType({
    /** Number of epochs (default 100) */
    epochs: OptionType(IntegerType),
    /** Batch size (default 32) */
    batch_size: OptionType(IntegerType),
    /** Learning rate (default 0.001) */
    learning_rate: OptionType(FloatType),
    /** Loss function (default mse) */
    loss: OptionType(TorchLossType),
    /** Optimizer (default adam) */
    optimizer: OptionType(TorchOptimizerType),
    /** Early stopping patience, 0 = disabled */
    early_stopping: OptionType(IntegerType),
    /** Validation split fraction (default 0.2) */
    validation_split: OptionType(FloatType),
    /** Random seed for reproducibility */
    random_state: OptionType(IntegerType),
});

// ============================================================================
// Result Types
// ============================================================================

/**
 * Result type for training.
 */
export const TorchTrainResultType = StructType({
    /** Training loss per epoch */
    train_losses: VectorType(FloatType),
    /** Validation loss per epoch */
    val_losses: VectorType(FloatType),
    /** Best epoch (for early stopping) */
    best_epoch: IntegerType,
});

/**
 * Combined result from training (model + metrics).
 */
export const TorchTrainOutputType = StructType({
    /** Trained model blob */
    model: VariantType({
        torch_mlp: StructType({
            data: BlobType,
            n_features: IntegerType,
            hidden_layers: ArrayType(IntegerType),
            output_dim: IntegerType,
        }),
    }),
    /** Training result with losses */
    result: TorchTrainResultType,
});

// ============================================================================
// Model Blob Types
// ============================================================================

/**
 * Model blob type for serialized PyTorch models.
 */
export const TorchModelBlobType = VariantType({
    /** PyTorch MLP model */
    torch_mlp: StructType({
        /** Cloudpickle serialized model */
        data: BlobType,
        /** Number of input features */
        n_features: IntegerType,
        /** Hidden layer sizes */
        hidden_layers: ArrayType(IntegerType),
        /** Output dimension */
        output_dim: IntegerType,
    }),
});

// ============================================================================
// Platform Functions
// ============================================================================

/**
 * Train a PyTorch MLP model.
 *
 * @param X - Feature matrix
 * @param y - Target vector
 * @param mlp_config - MLP architecture configuration
 * @param train_config - Training configuration
 * @returns Model blob and training result
 */
export const torch_mlp_train = East.platform(
    "torch_mlp_train",
    [MatrixType(FloatType), VectorType(FloatType), TorchMLPConfigType, TorchTrainConfigType],
    TorchTrainOutputType
);

/**
 * Make predictions with a trained PyTorch MLP.
 *
 * @param model - Trained MLP model blob
 * @param X - Feature matrix
 * @returns Predicted values
 */
export const torch_mlp_predict = East.platform(
    "torch_mlp_predict",
    [TorchModelBlobType, MatrixType(FloatType)],
    VectorType(FloatType)
);

/**
 * Train a PyTorch MLP model with multi-output support.
 *
 * Supports multi-output regression (predicting multiple values per sample)
 * and autoencoders (where input equals target for reconstruction learning).
 * Output dimension is inferred from y.shape[1] unless overridden in config.
 *
 * @param X - Feature matrix (n_samples x n_features)
 * @param y - Target matrix (n_samples x n_outputs)
 * @param mlp_config - MLP architecture configuration
 * @param train_config - Training configuration
 * @returns Model blob and training result
 */
export const torch_mlp_train_multi = East.platform(
    "torch_mlp_train_multi",
    [MatrixType(FloatType), MatrixType(FloatType), TorchMLPConfigType, TorchTrainConfigType],
    TorchTrainOutputType
);

/**
 * Make predictions with a trained PyTorch MLP (multi-output).
 *
 * Returns a matrix where each row contains the predicted outputs for a sample.
 *
 * @param model - Trained MLP model blob
 * @param X - Feature matrix (n_samples x n_features)
 * @returns Predicted matrix (n_samples x n_outputs)
 */
export const torch_mlp_predict_multi = East.platform(
    "torch_mlp_predict_multi",
    [TorchModelBlobType, MatrixType(FloatType)],
    MatrixType(FloatType)
);

/**
 * Extract intermediate layer activations (embeddings) from a trained MLP.
 *
 * For autoencoders, this allows extracting the bottleneck representation.
 * The layer_index specifies which hidden layer's output to return (0-indexed).
 *
 * For an autoencoder with architecture [input -> 8 -> 2 -> 8 -> output]
 * (hidden_layers: [8, 2, 8]):
 * - layer_index=0: output after first hidden layer (8 features)
 * - layer_index=1: output after second hidden layer (2 features) <- bottleneck
 * - layer_index=2: output after third hidden layer (8 features)
 *
 * @param model - Trained MLP model blob
 * @param X - Feature matrix (n_samples x n_features)
 * @param layer_index - Which hidden layer's output to return (0-indexed)
 * @returns Embedding matrix (n_samples x hidden_dim at that layer)
 *
 * @example
 * ```ts
 * // Train autoencoder: 4 features -> 8 -> 2 (bottleneck) -> 8 -> 4 features
 * const mlp_config = $.let({
 *     hidden_layers: [8n, 2n, 8n],
 *     activation: variant('some', variant('relu', {})),
 *     dropout: variant('none', null),
 *     output_dim: variant('none', null),
 * });
 * const output = $.let(Torch.mlpTrainMulti(X, X, mlp_config, train_config));
 *
 * // Extract bottleneck embeddings (layer_index=1 for the 2-dim bottleneck)
 * const embeddings = $.let(Torch.mlpEncode(output.model, X, 1n));
 * // embeddings is now (n_samples x 2)
 * ```
 */
export const torch_mlp_encode = East.platform(
    "torch_mlp_encode",
    [TorchModelBlobType, MatrixType(FloatType), IntegerType],
    MatrixType(FloatType)
);

/**
 * Decode embeddings back through the decoder portion of an MLP.
 *
 * For autoencoders, this takes bottleneck activations and runs them through
 * the decoder to reconstruct the output. This is the complement to mlpEncode.
 *
 * For an autoencoder with architecture [input -> 8 -> 2 -> 8 -> output]
 * (hidden_layers: [8, 2, 8]):
 * - layer_index=1: Start from the 2-dim bottleneck, run through layers 2+ to output
 * - layer_index=0: Start from the 8-dim first layer, run through layers 1+ to output
 *
 * Use case: Compute weighted average of origin embeddings, then decode to
 * get the reconstructed blend weight distribution.
 *
 * @param model - Trained MLP model blob
 * @param embeddings - Embedding matrix (n_samples x hidden_dim at layer_index)
 * @param layer_index - Which hidden layer the embeddings come from (0-indexed)
 * @returns Decoded output matrix (n_samples x output_dim)
 *
 * @example
 * ```ts
 * // After training autoencoder and extracting embeddings...
 * const origin_embeddings = $.let(Torch.mlpEncode(output.model, X_onehot, 1n));
 *
 * // Compute weighted blend embedding (e.g., 50% origin A + 50% origin B)
 * const blend_embedding = $.let(...); // weighted average of origin embeddings
 *
 * // Decode back to weight distribution
 * const reconstructed = $.let(Torch.mlpDecode(output.model, blend_embedding, 1n));
 * ```
 */
export const torch_mlp_decode = East.platform(
    "torch_mlp_decode",
    [TorchModelBlobType, MatrixType(FloatType), IntegerType],
    MatrixType(FloatType)
);

// ============================================================================
// Grouped Export
// ============================================================================

/**
 * Type definitions for PyTorch functions.
 */
export const TorchTypes = {
    /** Activation function type for hidden layers */
    TorchActivationType,
    /** Output activation function type */
    TorchOutputActivationType,
    /** Loss function type */
    TorchLossType,
    /** Optimizer type */
    TorchOptimizerType,
    /** MLP configuration type */
    TorchMLPConfigType,
    /** Training configuration type */
    TorchTrainConfigType,
    /** Training result type */
    TorchTrainResultType,
    /** Training output type (model + result) */
    TorchTrainOutputType,
    /** Model blob type for PyTorch models */
    ModelBlobType: TorchModelBlobType,
} as const;

/**
 * PyTorch neural network models.
 *
 * Provides MLP training and inference using PyTorch.
 *
 * @example
 * ```ts
 * import { East, variant } from "@elaraai/east";
 * import { Torch } from "@elaraai/east-py-datascience";
 *
 * const train = East.function([], Torch.Types.TorchTrainOutputType, $ => {
 *     const X = $.let([[1.0, 2.0], [3.0, 4.0], [5.0, 6.0], [7.0, 8.0]]);
 *     const y = $.let([1.0, 2.0, 3.0, 4.0]);
 *     const mlp_config = $.let({
 *         hidden_layers: [32n, 16n],
 *         activation: variant('none', null),
 *         dropout: variant('none', null),
 *         output_dim: variant('none', null),
 *     });
 *     const train_config = $.let({
 *         epochs: variant('some', 50n),
 *         batch_size: variant('some', 4n),
 *         learning_rate: variant('some', 0.01),
 *         loss: variant('none', null),
 *         optimizer: variant('none', null),
 *         early_stopping: variant('none', null),
 *         validation_split: variant('some', 0.2),
 *         random_state: variant('some', 42n),
 *     });
 *     return $.return(Torch.mlpTrain(X, y, mlp_config, train_config));
 * });
 * ```
 */
export const Torch = {
    /**
     * Train a PyTorch MLP model (single output).
     *
     * @example
     * ```ts
     * import { East, FloatType, MatrixType, VectorType, variant } from "@elaraai/east";
     * import { Torch, TorchMLPConfigType, TorchTrainConfigType } from "@elaraai/east-py-datascience";
     *
     * const train = East.function([], Torch.Types.TorchTrainOutputType, ($) => {
     *     const X = $.let([[1.0, 2.0], [3.0, 4.0], [5.0, 6.0], [7.0, 8.0]]);
     *     const y = $.let(new Float64Array([1.0, 2.0, 3.0, 4.0]));
     *     const mlp_config = $.let({
     *         hidden_layers: new BigInt64Array([16n, 8n]),
     *         activation: variant("some", variant("relu", null)),
     *         dropout: variant("none", null),
     *         output_dim: variant("none", null),
     *         output_activation: variant("none", null),
     *     }, TorchMLPConfigType);
     *     const train_config = $.let({
     *         epochs: variant("some", 50n), batch_size: variant("some", 4n),
     *         learning_rate: variant("some", 0.01), loss: variant("none", null),
     *         optimizer: variant("none", null), early_stopping: variant("none", null),
     *         validation_split: variant("some", 0.2), random_state: variant("some", 42n),
     *     }, TorchTrainConfigType);
     *     return $.return(Torch.mlpTrain(X, y, mlp_config, train_config));
     * });
     * ```
     */
    mlpTrain: torch_mlp_train,

    /**
     * Make predictions with a trained PyTorch MLP (single output).
     *
     * @example
     * ```ts
     * import { East, FloatType, MatrixType, VectorType } from "@elaraai/east";
     * import { Torch } from "@elaraai/east-py-datascience";
     *
     * const predictFn = East.function(
     *     [Torch.Types.ModelBlobType, MatrixType(FloatType)],
     *     VectorType(FloatType),
     *     ($, model, X) => {
     *         return $.return(Torch.mlpPredict(model, X));
     *     }
     * );
     * ```
     */
    mlpPredict: torch_mlp_predict,

    /**
     * Train a PyTorch MLP model with multi-output support.
     *
     * Supports multi-output regression and autoencoders (X = y).
     *
     * @example
     * ```ts
     * import { East, FloatType, MatrixType, variant } from "@elaraai/east";
     * import { Torch, TorchMLPConfigType, TorchTrainConfigType } from "@elaraai/east-py-datascience";
     *
     * const train = East.function([], Torch.Types.TorchTrainOutputType, ($) => {
     *     const X = $.let([[1.0, 2.0, 3.0], [4.0, 5.0, 6.0], [7.0, 8.0, 9.0]]);
     *     const y = $.let([[10.0, 20.0], [30.0, 40.0], [50.0, 60.0]]);
     *     const mlp_config = $.let({
     *         hidden_layers: new BigInt64Array([16n, 8n]),
     *         activation: variant("some", variant("relu", null)),
     *         dropout: variant("none", null),
     *         output_dim: variant("none", null),
     *         output_activation: variant("none", null),
     *     }, TorchMLPConfigType);
     *     const train_config = $.let({
     *         epochs: variant("some", 50n), batch_size: variant("some", 4n),
     *         learning_rate: variant("some", 0.01), loss: variant("none", null),
     *         optimizer: variant("none", null), early_stopping: variant("none", null),
     *         validation_split: variant("some", 0.2), random_state: variant("some", 42n),
     *     }, TorchTrainConfigType);
     *     return $.return(Torch.mlpTrainMulti(X, y, mlp_config, train_config));
     * });
     * ```
     */
    mlpTrainMulti: torch_mlp_train_multi,

    /**
     * Make predictions with a trained PyTorch MLP (multi-output).
     *
     * Returns a matrix where each row contains predicted outputs for a sample.
     *
     * @example
     * ```ts
     * import { East, FloatType, MatrixType } from "@elaraai/east";
     * import { Torch } from "@elaraai/east-py-datascience";
     *
     * const predictFn = East.function(
     *     [Torch.Types.ModelBlobType, MatrixType(FloatType)],
     *     MatrixType(FloatType),
     *     ($, model, X) => {
     *         // Returns (n_samples x n_outputs) matrix
     *         return $.return(Torch.mlpPredictMulti(model, X));
     *     }
     * );
     * ```
     */
    mlpPredictMulti: torch_mlp_predict_multi,
    /** Extract intermediate layer activations (embeddings) from MLP */
    mlpEncode: torch_mlp_encode,
    /** Decode embeddings back through decoder portion of MLP */
    mlpDecode: torch_mlp_decode,
    /** Type definitions */
    Types: TorchTypes,
} as const;
