/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, IntegerType, variant, example } from "@elaraai/east";
import { Lightning } from "@elaraai/east-py-datascience";

export const lightningMlp = example({
    keywords: ["lightning", "train", "predict", "mlp", "regression", "demand", "tabular", "neural network"],
    description: "Train MLP on tabular operational features to forecast daily demand",
    fn: East.function([], IntegerType, ($) => {
        // Features: day_of_week, promo_active, avg_temperature, competitor_price
        // Target: daily_demand (units)
        const X_train = $.let(East.Matrix.fromArray([
            [1.0, 1.0, 22.0, 9.50],
            [2.0, 0.0, 24.0, 10.0],
            [3.0, 1.0, 18.0, 9.00],
            [4.0, 0.0, 20.0, 10.5],
            [5.0, 1.0, 26.0, 8.50],
            [6.0, 0.0, 15.0, 11.0],
            [7.0, 1.0, 28.0, 9.00],
            [0.0, 0.0, 21.0, 10.0],
        ]));
        // Target as matrix (n_samples, 1) — Lightning requires matrix target
        const y_train = $.let(East.Matrix.fromArray([
            [150.0], [120.0], [140.0], [100.0],
            [180.0], [80.0], [190.0], [110.0],
        ]));

        const config = $.let({
            architecture: variant('mlp', {
                hidden_layers: [16n, 8n],
            }),
            output: variant('regression', null),
            learning_rate: variant('some', 0.01),
            max_epochs: variant('some', 50n),
            patience: variant('some', 10n),
            batch_size: variant('some', 4n),
            dropout: variant('some', 0.0),
            gradient_clip: variant('some', 1.0),
            weight_decay: variant('none', null),
            random_state: variant('some', 42n),
            epoch_callback: variant('none', null),
        }, Lightning.Types.ConfigType);

        const result = $.let(Lightning.train(
            X_train, y_train, config,
            variant('none', null), variant('none', null), variant('none', null),
        ));

        const X_new = $.let(East.Matrix.fromArray([
            [3.0, 1.0, 20.0, 9.50],
            [6.0, 0.0, 25.0, 10.0],
        ]));
        const predictions = $.let(Lightning.predict(
            result.model, X_new,
            variant('none', null), variant('none', null),
        ));

        // 2 samples predicted
        return predictions.rows();
    }),
    inputs: [],
    returns: 2n,
});

export const lightningAutoencoder = example({
    keywords: ["lightning", "train", "encode", "decode", "autoencoder", "latent space", "anomaly", "telemetry", "dimensionality reduction"],
    description: "Learn compressed representation of process telemetry for anomaly scoring",
    fn: East.function([], IntegerType, ($) => {
        // 6-dimensional process telemetry: pressure, flow, vibration, temperature, humidity, rpm
        const X = $.let(East.Matrix.fromArray([
            [1.0, 0.5, 0.2, 0.8, 0.4, 0.9],
            [0.9, 0.6, 0.3, 0.7, 0.5, 0.8],
            [0.2, 0.8, 0.9, 0.1, 0.7, 0.3],
            [0.3, 0.7, 0.8, 0.2, 0.6, 0.4],
            [0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
            [0.8, 0.4, 0.1, 0.9, 0.3, 1.0],
        ]));

        const config = $.let({
            architecture: variant('autoencoder', {
                encoder_layers: [8n],
                latent_dim: 2n,
                decoder_layers: [8n],
            }),
            output: variant('regression', null),
            learning_rate: variant('some', 0.01),
            max_epochs: variant('some', 100n),
            patience: variant('some', 20n),
            batch_size: variant('some', 4n),
            dropout: variant('some', 0.0),
            gradient_clip: variant('some', 1.0),
            weight_decay: variant('none', null),
            random_state: variant('some', 42n),
            epoch_callback: variant('none', null),
        }, Lightning.Types.ConfigType);

        // Train autoencoder (X → X reconstruction)
        const result = $.let(Lightning.train(
            X, X, config,
            variant('none', null), variant('none', null), variant('none', null),
        ));

        // Encode to 2D latent space
        const embeddings = $.let(Lightning.encode(result.model, X));

        // Decode back to original 6D space
        const reconstructed = $.let(Lightning.decode(result.model, embeddings));

        // Reconstructed should have same feature dimension: 6
        return reconstructed.getRow(0n).length();
    }),
    inputs: [],
    returns: 6n,
});

export const lightningConv1d = example({
    keywords: ["lightning", "train", "predict", "conv1d", "CNN", "vibration", "time-series", "fault detection", "bearing"],
    description: "Train 1D CNN on vibration time-series windows for bearing fault detection",
    fn: East.function([], IntegerType, ($) => {
        // Flattened input: 2 channels × 4 time steps × 3 classes = 24 features per sample
        // Channels: axial vibration, radial vibration
        // Time steps: sequential readings in a window
        // Classes per (channel, timestep): normal, worn, cracked
        const X = $.let(East.Matrix.fromArray([
            [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0,
             0.0, 1.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0],
            [0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0,
             1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0],
            [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0,
             0.0, 1.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0, 1.0, 0.0, 0.0,
             0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0],
        ]));

        const config = $.let({
            architecture: variant('conv1d', {
                n_channels: 2n,
                sequence_length: 4n,
                conv_channels: [8n, 16n],
                kernel_size: 3n,
                latent_dim: 4n,
                condition_dim: variant('none', null),
            }),
            output: variant('multi_head', {
                n_heads: 8n,  // 2 channels × 4 time steps
                n_classes_per_head: 3n,
                class_weights: variant('none', null),
            }),
            learning_rate: variant('some', 0.01),
            max_epochs: variant('some', 100n),
            patience: variant('some', 20n),
            batch_size: variant('some', 2n),
            dropout: variant('some', 0.0),
            gradient_clip: variant('some', 1.0),
            weight_decay: variant('none', null),
            random_state: variant('some', 42n),
            epoch_callback: variant('none', null),
        }, Lightning.Types.ConfigType);

        const result = $.let(Lightning.train(
            X, X, config,
            variant('none', null), variant('none', null), variant('none', null),
        ));

        const predictions = $.let(Lightning.predict(
            result.model, X,
            variant('none', null), variant('none', null),
        ));

        // 4 samples predicted
        return predictions.rows();
    }),
    inputs: [],
    returns: 4n,
});

export const lightningSequential = example({
    keywords: ["lightning", "train", "predict", "sequential", "LSTM", "transaction", "throughput", "time-series", "recurrent"],
    description: "Train LSTM on sequential transaction data to predict next-period throughput",
    fn: East.function([], IntegerType, ($) => {
        // Flattened input: 2 channels × 4 time steps × 3 classes = 24 features
        // Channels: transaction_volume, error_rate
        // Time steps: 4 sequential periods
        const X = $.let(East.Matrix.fromArray([
            [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0,
             0.0, 1.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0],
            [0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0,
             1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0],
            [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0,
             0.0, 1.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0, 1.0, 0.0, 0.0,
             0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0],
        ]));

        const config = $.let({
            architecture: variant('sequential', {
                n_channels: 2n,
                sequence_length: 4n,
                hidden_size: 16n,
                n_layers: 1n,
                cell_type: variant('lstm', null),
                latent_dim: 4n,
                bidirectional: false,
                condition_dim: variant('none', null),
            }),
            output: variant('multi_head', {
                n_heads: 8n,  // 2 channels × 4 time steps
                n_classes_per_head: 3n,
                class_weights: variant('none', null),
            }),
            learning_rate: variant('some', 0.01),
            max_epochs: variant('some', 100n),
            patience: variant('some', 20n),
            batch_size: variant('some', 2n),
            dropout: variant('some', 0.0),
            gradient_clip: variant('some', 1.0),
            weight_decay: variant('none', null),
            random_state: variant('some', 42n),
            epoch_callback: variant('none', null),
        }, Lightning.Types.ConfigType);

        const result = $.let(Lightning.train(
            X, X, config,
            variant('none', null), variant('none', null), variant('none', null),
        ));

        // Encode to latent space and verify dimensionality
        const z = $.let(Lightning.encode(result.model, X));

        // Latent dim = 4
        return z.getRow(0n).length();
    }),
    inputs: [],
    returns: 4n,
});

export const lightningTransformer = example({
    keywords: ["lightning", "train", "predict", "transformer", "attention", "multi-variate", "demand", "pattern recognition", "time-series"],
    description: "Train transformer on multi-variate time-series for demand pattern recognition",
    fn: East.function([], IntegerType, ($) => {
        // Flattened input: 2 channels × 4 time steps × 3 classes = 24 features
        // Channels: product_category_demand, promotional_channel
        // Time steps: 4 sequential periods
        const X = $.let(East.Matrix.fromArray([
            [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0,
             0.0, 1.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0],
            [0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0,
             1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0],
            [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0,
             0.0, 1.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0, 1.0, 0.0, 0.0,
             0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0],
        ]));

        const config = $.let({
            architecture: variant('transformer', {
                n_channels: 2n,
                sequence_length: 4n,
                d_model: 16n,
                n_attention_heads: 2n,
                n_layers: 1n,
                d_ff: variant('none', null),
                latent_dim: 4n,
                condition_dim: variant('none', null),
            }),
            output: variant('multi_head', {
                n_heads: 8n,  // 2 channels × 4 time steps
                n_classes_per_head: 3n,
                class_weights: variant('none', null),
            }),
            learning_rate: variant('some', 0.01),
            max_epochs: variant('some', 100n),
            patience: variant('some', 20n),
            batch_size: variant('some', 2n),
            dropout: variant('some', 0.0),
            gradient_clip: variant('some', 1.0),
            weight_decay: variant('none', null),
            random_state: variant('some', 42n),
            epoch_callback: variant('none', null),
        }, Lightning.Types.ConfigType);

        const result = $.let(Lightning.train(
            X, X, config,
            variant('none', null), variant('none', null), variant('none', null),
        ));

        const predictions = $.let(Lightning.predict(
            result.model, X,
            variant('none', null), variant('none', null),
        ));

        // 4 samples × 24 features (8 heads × 3 classes)
        return predictions.getRow(0n).length();
    }),
    inputs: [],
    returns: 24n,
});
