/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, IntegerType, variant, example } from "@elaraai/east";
import { Torch } from "@elaraai/east-py-datascience";

export const torchMlpTrainPredict = example({
    keywords: ["torch", "mlpTrain", "mlpPredict", "MLP", "neural network", "regression", "energy", "building sensor"],
    description: "Train MLP to predict energy consumption from building sensor features",
    fn: East.function([], IntegerType, ($) => {
        // Features: temperature, humidity, occupancy
        // Target: energy consumption (kWh)
        const X_train = $.let(East.Matrix.fromArray([
            [20.0, 40.0, 10.0],
            [22.0, 45.0, 25.0],
            [25.0, 50.0, 50.0],
            [28.0, 55.0, 75.0],
            [30.0, 60.0, 100.0],
            [18.0, 35.0, 5.0],
            [24.0, 48.0, 40.0],
            [32.0, 65.0, 90.0],
        ]));
        const y_train = $.let(East.Vector.fromArray([50.0, 65.0, 90.0, 120.0, 150.0, 40.0, 80.0, 140.0]));

        const mlp_config = $.let({
            hidden_layers: [16n, 8n],
            activation: variant('none', null),
            output_activation: variant('none', null),
            dropout: variant('none', null),
            output_dim: variant('none', null),
        }, Torch.Types.TorchMLPConfigType);

        const train_config = $.let({
            epochs: variant('some', 50n),
            batch_size: variant('some', 4n),
            learning_rate: variant('some', 0.01),
            loss: variant('none', null),
            optimizer: variant('none', null),
            early_stopping: variant('none', null),
            validation_split: variant('some', 0.2),
            random_state: variant('some', 42n),
        }, Torch.Types.TorchTrainConfigType);

        const output = $.let(Torch.mlpTrain(X_train, y_train, mlp_config, train_config));

        const X_new = $.let(East.Matrix.fromArray([
            [21.0, 42.0, 15.0],
            [27.0, 52.0, 60.0],
        ]));
        const predictions = $.let(Torch.mlpPredict(output.model, X_new));

        return predictions.length();
    }),
    inputs: [],
    returns: 2n,
});

export const torchMlpMultiOutput = example({
    keywords: ["torch", "mlpTrainMulti", "mlpPredictMulti", "multi-output", "MLP", "yield", "waste", "process"],
    description: "Train multi-output MLP to jointly predict yield and waste from process parameters",
    fn: East.function([], IntegerType, ($) => {
        // Features: temperature, pressure, catalyst_amount
        // Targets: yield (%), waste (kg)
        const X_train = $.let(East.Matrix.fromArray([
            [150.0, 2.0, 1.0],
            [160.0, 2.5, 1.5],
            [170.0, 3.0, 2.0],
            [180.0, 3.5, 2.5],
            [190.0, 4.0, 3.0],
            [155.0, 2.2, 1.2],
            [175.0, 3.2, 2.2],
            [185.0, 3.8, 2.8],
        ]));
        const Y_train = $.let(East.Matrix.fromArray([
            [60.0, 5.0],
            [70.0, 4.5],
            [85.0, 3.0],
            [90.0, 2.5],
            [88.0, 4.0],
            [65.0, 4.8],
            [82.0, 3.2],
            [92.0, 2.8],
        ]));

        const mlp_config = $.let({
            hidden_layers: [16n, 8n],
            activation: variant('none', null),
            output_activation: variant('none', null),
            dropout: variant('none', null),
            output_dim: variant('none', null),
        }, Torch.Types.TorchMLPConfigType);

        const train_config = $.let({
            epochs: variant('some', 50n),
            batch_size: variant('some', 4n),
            learning_rate: variant('some', 0.01),
            loss: variant('none', null),
            optimizer: variant('none', null),
            early_stopping: variant('none', null),
            validation_split: variant('some', 0.2),
            random_state: variant('some', 42n),
        }, Torch.Types.TorchTrainConfigType);

        const output = $.let(Torch.mlpTrainMulti(X_train, Y_train, mlp_config, train_config));

        const X_new = $.let(East.Matrix.fromArray([
            [165.0, 2.8, 1.8],
            [182.0, 3.6, 2.6],
        ]));
        const predictions = $.let(Torch.mlpPredictMulti(output.model, X_new));

        // 2 samples × 2 outputs (yield, waste)
        return predictions.rows();
    }),
    inputs: [],
    returns: 2n,
});

export const torchMlpEncodeDecode = example({
    keywords: ["torch", "mlpEncode", "mlpDecode", "autoencoder", "latent space", "dimensionality reduction", "telemetry"],
    description: "Compress high-dimensional process telemetry into latent space, then reconstruct",
    fn: East.function([], IntegerType, ($) => {
        // 4-dimensional telemetry: pressure, flow, vibration, temperature
        // Autoencoder: 4 → 8 → 2 (bottleneck) → 8 → 4
        const X = $.let(East.Matrix.fromArray([
            [1.0, 0.5, 0.2, 0.8],
            [0.9, 0.6, 0.3, 0.7],
            [0.2, 0.8, 0.9, 0.1],
            [0.3, 0.7, 0.8, 0.2],
            [0.5, 0.5, 0.5, 0.5],
            [0.8, 0.4, 0.1, 0.9],
            [0.1, 0.9, 1.0, 0.0],
            [0.6, 0.6, 0.4, 0.6],
        ]));

        const mlp_config = $.let({
            hidden_layers: [8n, 2n, 8n],
            activation: variant('none', null),
            output_activation: variant('none', null),
            dropout: variant('none', null),
            output_dim: variant('none', null),
        }, Torch.Types.TorchMLPConfigType);

        const train_config = $.let({
            epochs: variant('some', 100n),
            batch_size: variant('some', 4n),
            learning_rate: variant('some', 0.01),
            loss: variant('none', null),
            optimizer: variant('none', null),
            early_stopping: variant('none', null),
            validation_split: variant('none', null),
            random_state: variant('some', 42n),
        }, Torch.Types.TorchTrainConfigType);

        // Train autoencoder (input = output)
        const output = $.let(Torch.mlpTrainMulti(X, X, mlp_config, train_config));

        // Encode to 2D bottleneck (layer_index=1 for the 2-dim hidden layer)
        const embeddings = $.let(Torch.mlpEncode(output.model, X, 1n));

        // Decode back to original 4D space
        const reconstructed = $.let(Torch.mlpDecode(output.model, embeddings, 1n));

        // Reconstructed should have same shape: 8 samples × 4 features
        return reconstructed.getRow(0n).length();
    }),
    inputs: [],
    returns: 4n,
});
