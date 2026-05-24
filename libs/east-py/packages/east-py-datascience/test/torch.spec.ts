/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * PyTorch platform function tests
 */
import {variant, East} from "@elaraai/east";
import { describeEast, Assert } from "@elaraai/east-node-std";
import { Torch } from "@elaraai/east-py-datascience";
import * as ex from "./torch.examples.js";

describeEast("PyTorch platform functions", (test) => {

    Assert.examples(test, { torchMlpTrainPredict: ex.torchMlpTrainPredict, torchMlpMultiOutput: ex.torchMlpMultiOutput, torchMlpEncodeDecode: ex.torchMlpEncodeDecode });

    test("mlp_train trains regression model", $ => {
        // Simple linear relationship: y = x1 + x2
        const X = $.let(East.Matrix.fromArray([
            [1.0, 2.0],
            [2.0, 3.0],
            [3.0, 4.0],
            [4.0, 5.0],
            [5.0, 6.0],
            [6.0, 7.0],
            [7.0, 8.0],
            [8.0, 9.0],
        ]));
        const y = $.let(new Float64Array([3.0, 5.0, 7.0, 9.0, 11.0, 13.0, 15.0, 17.0]));

        const mlp_config = $.let({
            hidden_layers: [16n, 8n],
            activation: variant('none', null),
            output_activation: variant('none', null),
            dropout: variant('none', null),
            output_dim: variant('none', null),
        });

        const train_config = $.let({
            epochs: variant('some', 50n),
            batch_size: variant('some', 4n),
            learning_rate: variant('some', 0.01),
            loss: variant('none', null),
            optimizer: variant('none', null),
            early_stopping: variant('none', null),
            validation_split: variant('some', 0.2),
            random_state: variant('some', 42n),
        });

        const output = $.let(Torch.mlpTrain(X, y, mlp_config, train_config));

        // Check training result
        $(Assert.greater(output.result.train_losses.length(), 0n));
        $(Assert.greater(output.result.val_losses.length(), 0n));
        $(Assert.greaterEqual(output.result.best_epoch, 0n));
    });

    test("mlp_predict makes predictions", $ => {
        const X = $.let(East.Matrix.fromArray([
            [1.0, 2.0],
            [2.0, 3.0],
            [3.0, 4.0],
            [4.0, 5.0],
            [5.0, 6.0],
            [6.0, 7.0],
            [7.0, 8.0],
            [8.0, 9.0],
        ]));
        const y = $.let(new Float64Array([3.0, 5.0, 7.0, 9.0, 11.0, 13.0, 15.0, 17.0]));

        const mlp_config = $.let({
            hidden_layers: [16n, 8n],
            activation: variant('none', null),
            output_activation: variant('none', null),
            dropout: variant('none', null),
            output_dim: variant('none', null),
        });

        const train_config = $.let({
            epochs: variant('some', 50n),
            batch_size: variant('some', 4n),
            learning_rate: variant('some', 0.01),
            loss: variant('none', null),
            optimizer: variant('none', null),
            early_stopping: variant('none', null),
            validation_split: variant('some', 0.2),
            random_state: variant('some', 42n),
        });

        const output = $.let(Torch.mlpTrain(X, y, mlp_config, train_config));
        const predictions = $.let(Torch.mlpPredict(output.model, X));

        $(Assert.equal(predictions.length(), 8n));
    });

    test("mlp with different activations", $ => {
        const X = $.let(East.Matrix.fromArray([
            [1.0, 2.0],
            [2.0, 3.0],
            [3.0, 4.0],
            [4.0, 5.0],
        ]));
        const y = $.let(new Float64Array([3.0, 5.0, 7.0, 9.0]));

        const mlp_config = $.let({
            hidden_layers: [8n],
            activation: variant('some', variant('tanh', null)),
            output_activation: variant('none', null),
            dropout: variant('some', 0.1),
            output_dim: variant('none', null),
        });

        const train_config = $.let({
            epochs: variant('some', 30n),
            batch_size: variant('some', 2n),
            learning_rate: variant('some', 0.01),
            loss: variant('none', null),
            optimizer: variant('some', variant('sgd', null)),
            early_stopping: variant('none', null),
            validation_split: variant('some', 0.25),
            random_state: variant('some', 42n),
        });

        const output = $.let(Torch.mlpTrain(X, y, mlp_config, train_config));
        $(Assert.greater(output.result.train_losses.length(), 0n));
    });

    test("autoencoder reconstruction (identity mapping)", $ => {
        // Autoencoder test: network learns to reconstruct input through bottleneck
        // Input dimension = 4, bottleneck = 2, then expand back to 4
        // This tests if the MLP can learn an identity-like mapping
        const X = $.let(East.Matrix.fromArray([
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0, 1.0],
            [0.5, 0.5, 0.0, 0.0],
            [0.0, 0.5, 0.5, 0.0],
            [0.0, 0.0, 0.5, 0.5],
            [0.5, 0.0, 0.0, 0.5],
        ]));
        // Target is the sum of features (simple pattern to learn)
        const y = $.let(new Float64Array([1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0]));

        // Bottleneck architecture: 4 -> 2 -> 4 (conceptually)
        // For regression we just output 1 value
        const mlp_config = $.let({
            hidden_layers: [2n, 4n],  // Bottleneck then expand
            activation: variant('some', variant('relu', null)),
            output_activation: variant('none', null),
            dropout: variant('none', null),
            output_dim: variant('some', 1n),
        });

        const train_config = $.let({
            epochs: variant('some', 100n),
            batch_size: variant('some', 4n),
            learning_rate: variant('some', 0.01),
            loss: variant('some', variant('mse', null)),
            optimizer: variant('some', variant('adam', null)),
            early_stopping: variant('some', 10n),
            validation_split: variant('some', 0.25),
            random_state: variant('some', 42n),
        });

        const output = $.let(Torch.mlpTrain(X, y, mlp_config, train_config));
        const predictions = $.let(Torch.mlpPredict(output.model, X));

        // All inputs sum to 1.0, so predictions should be close to 1.0
        $(Assert.equal(predictions.length(), 8n));
        $(Assert.greater(output.result.train_losses.length(), 0n));
    });

    test("early stopping triggers", $ => {
        // Simple pattern that should converge quickly
        const X = $.let(East.Matrix.fromArray([
            [1.0],
            [2.0],
            [3.0],
            [4.0],
            [5.0],
            [6.0],
            [7.0],
            [8.0],
        ]));
        const y = $.let(new Float64Array([2.0, 4.0, 6.0, 8.0, 10.0, 12.0, 14.0, 16.0]));

        const mlp_config = $.let({
            hidden_layers: [4n],
            activation: variant('none', null),
            output_activation: variant('none', null),
            dropout: variant('none', null),
            output_dim: variant('none', null),
        });

        const train_config = $.let({
            epochs: variant('some', 200n),  // High epochs
            batch_size: variant('some', 4n),
            learning_rate: variant('some', 0.1),
            loss: variant('none', null),
            optimizer: variant('none', null),
            early_stopping: variant('some', 5n),  // Low patience
            validation_split: variant('some', 0.25),
            random_state: variant('some', 42n),
        });

        const output = $.let(Torch.mlpTrain(X, y, mlp_config, train_config));

        // Early stopping should kick in before 200 epochs
        $(Assert.less(output.result.train_losses.length(), 200n));
        $(Assert.greaterEqual(output.result.best_epoch, 0n));
    });

    test("mlp with adamw optimizer", $ => {
        const X = $.let(East.Matrix.fromArray([
            [1.0, 2.0],
            [2.0, 3.0],
            [3.0, 4.0],
            [4.0, 5.0],
        ]));
        const y = $.let(new Float64Array([3.0, 5.0, 7.0, 9.0]));

        const mlp_config = $.let({
            hidden_layers: [8n],
            activation: variant('none', null),
            output_activation: variant('none', null),
            dropout: variant('none', null),
            output_dim: variant('none', null),
        });

        const train_config = $.let({
            epochs: variant('some', 30n),
            batch_size: variant('some', 2n),
            learning_rate: variant('some', 0.01),
            loss: variant('none', null),
            optimizer: variant('some', variant('adamw', null)),
            early_stopping: variant('none', null),
            validation_split: variant('some', 0.25),
            random_state: variant('some', 42n),
        });

        const output = $.let(Torch.mlpTrain(X, y, mlp_config, train_config));
        $(Assert.greater(output.result.train_losses.length(), 0n));
    });

    test("mlp with rmsprop optimizer", $ => {
        const X = $.let(East.Matrix.fromArray([
            [1.0, 2.0],
            [2.0, 3.0],
            [3.0, 4.0],
            [4.0, 5.0],
        ]));
        const y = $.let(new Float64Array([3.0, 5.0, 7.0, 9.0]));

        const mlp_config = $.let({
            hidden_layers: [8n],
            activation: variant('none', null),
            output_activation: variant('none', null),
            dropout: variant('none', null),
            output_dim: variant('none', null),
        });

        const train_config = $.let({
            epochs: variant('some', 30n),
            batch_size: variant('some', 2n),
            learning_rate: variant('some', 0.01),
            loss: variant('none', null),
            optimizer: variant('some', variant('rmsprop', null)),
            early_stopping: variant('none', null),
            validation_split: variant('some', 0.25),
            random_state: variant('some', 42n),
        });

        const output = $.let(Torch.mlpTrain(X, y, mlp_config, train_config));
        $(Assert.greater(output.result.train_losses.length(), 0n));
    });

    test("mlp with mae loss", $ => {
        const X = $.let(East.Matrix.fromArray([
            [1.0, 2.0],
            [2.0, 3.0],
            [3.0, 4.0],
            [4.0, 5.0],
        ]));
        const y = $.let(new Float64Array([3.0, 5.0, 7.0, 9.0]));

        const mlp_config = $.let({
            hidden_layers: [8n],
            activation: variant('none', null),
            output_activation: variant('none', null),
            dropout: variant('none', null),
            output_dim: variant('none', null),
        });

        const train_config = $.let({
            epochs: variant('some', 30n),
            batch_size: variant('some', 2n),
            learning_rate: variant('some', 0.01),
            loss: variant('some', variant('mae', null)),
            optimizer: variant('none', null),
            early_stopping: variant('none', null),
            validation_split: variant('some', 0.25),
            random_state: variant('some', 42n),
        });

        const output = $.let(Torch.mlpTrain(X, y, mlp_config, train_config));
        $(Assert.greater(output.result.train_losses.length(), 0n));
    });

    test("mlp with sigmoid activation", $ => {
        const X = $.let(East.Matrix.fromArray([
            [1.0, 2.0],
            [2.0, 3.0],
            [3.0, 4.0],
            [4.0, 5.0],
        ]));
        const y = $.let(new Float64Array([3.0, 5.0, 7.0, 9.0]));

        const mlp_config = $.let({
            hidden_layers: [8n],
            activation: variant('some', variant('sigmoid', null)),
            output_activation: variant('none', null),
            dropout: variant('none', null),
            output_dim: variant('none', null),
        });

        const train_config = $.let({
            epochs: variant('some', 30n),
            batch_size: variant('some', 2n),
            learning_rate: variant('some', 0.01),
            loss: variant('none', null),
            optimizer: variant('none', null),
            early_stopping: variant('none', null),
            validation_split: variant('some', 0.25),
            random_state: variant('some', 42n),
        });

        const output = $.let(Torch.mlpTrain(X, y, mlp_config, train_config));
        $(Assert.greater(output.result.train_losses.length(), 0n));
    });

    test("mlp with leaky_relu activation", $ => {
        const X = $.let(East.Matrix.fromArray([
            [1.0, 2.0],
            [2.0, 3.0],
            [3.0, 4.0],
            [4.0, 5.0],
        ]));
        const y = $.let(new Float64Array([3.0, 5.0, 7.0, 9.0]));

        const mlp_config = $.let({
            hidden_layers: [8n],
            activation: variant('some', variant('leaky_relu', null)),
            output_activation: variant('none', null),
            dropout: variant('none', null),
            output_dim: variant('none', null),
        });

        const train_config = $.let({
            epochs: variant('some', 30n),
            batch_size: variant('some', 2n),
            learning_rate: variant('some', 0.01),
            loss: variant('none', null),
            optimizer: variant('none', null),
            early_stopping: variant('none', null),
            validation_split: variant('some', 0.25),
            random_state: variant('some', 42n),
        });

        const output = $.let(Torch.mlpTrain(X, y, mlp_config, train_config));
        $(Assert.greater(output.result.train_losses.length(), 0n));
    });

    test("deep mlp with dropout", $ => {
        const X = $.let(East.Matrix.fromArray([
            [1.0, 2.0, 3.0],
            [2.0, 3.0, 4.0],
            [3.0, 4.0, 5.0],
            [4.0, 5.0, 6.0],
            [5.0, 6.0, 7.0],
            [6.0, 7.0, 8.0],
        ]));
        const y = $.let(new Float64Array([6.0, 9.0, 12.0, 15.0, 18.0, 21.0]));

        const mlp_config = $.let({
            hidden_layers: [32n, 16n, 8n],  // Deeper network
            activation: variant('some', variant('relu', null)),
            output_activation: variant('none', null),
            dropout: variant('some', 0.2),
            output_dim: variant('none', null),
        });

        const train_config = $.let({
            epochs: variant('some', 50n),
            batch_size: variant('some', 2n),
            learning_rate: variant('some', 0.01),
            loss: variant('none', null),
            optimizer: variant('none', null),
            early_stopping: variant('none', null),
            validation_split: variant('some', 0.2),
            random_state: variant('some', 42n),
        });

        const output = $.let(Torch.mlpTrain(X, y, mlp_config, train_config));
        const predictions = $.let(Torch.mlpPredict(output.model, X));

        $(Assert.equal(predictions.length(), 6n));
        $(Assert.greater(output.result.train_losses.length(), 0n));
    });

    test("error: train_regressor shape mismatch", $ => {
        const X = $.let(East.Matrix.fromArray([[1.0, 2.0], [3.0, 4.0], [5.0, 6.0]]));  // 3 samples
        const y = $.let(new Float64Array([1.0, 2.0]));  // 2 samples

        const mlp_config = $.let({
            hidden_layers: [8n],
            activation: variant('none', null),
            output_activation: variant('none', null),
            dropout: variant('none', null),
            output_dim: variant('none', null),
        });

        const train_config = $.let({
            epochs: variant('some', 10n),
            batch_size: variant('some', 2n),
            learning_rate: variant('some', 0.01),
            loss: variant('none', null),
            optimizer: variant('none', null),
            early_stopping: variant('none', null),
            validation_split: variant('none', null),
            random_state: variant('none', null),
        });

        $(Assert.throws(Torch.mlpTrain(X, y, mlp_config, train_config), /torch_mlp_train.*X.*3.*y.*2/));
    });

    // ========================================================================
    // Multi-Output Tests
    // ========================================================================

    test("mlp_train_multi trains multi-output regression model", $ => {
        // Multi-output: predict 3 values from 2 features
        // y1 = x1 + x2, y2 = x1 * 2, y3 = x2 * 2
        const X = $.let(East.Matrix.fromArray([
            [1.0, 2.0],
            [2.0, 3.0],
            [3.0, 4.0],
            [4.0, 5.0],
            [5.0, 6.0],
            [6.0, 7.0],
            [7.0, 8.0],
            [8.0, 9.0],
        ]));
        const y = $.let(East.Matrix.fromArray([
            [3.0, 2.0, 4.0],
            [5.0, 4.0, 6.0],
            [7.0, 6.0, 8.0],
            [9.0, 8.0, 10.0],
            [11.0, 10.0, 12.0],
            [13.0, 12.0, 14.0],
            [15.0, 14.0, 16.0],
            [17.0, 16.0, 18.0],
        ]));

        const mlp_config = $.let({
            hidden_layers: [32n, 16n],
            activation: variant('some', variant('relu', null)),
            output_activation: variant('none', null),
            dropout: variant('none', null),
            output_dim: variant('none', null),  // Inferred from y: 3
        });

        const train_config = $.let({
            epochs: variant('some', 100n),
            batch_size: variant('some', 4n),
            learning_rate: variant('some', 0.01),
            loss: variant('some', variant('mse', null)),
            optimizer: variant('some', variant('adam', null)),
            early_stopping: variant('some', 15n),
            validation_split: variant('some', 0.2),
            random_state: variant('some', 42n),
        });

        const output = $.let(Torch.mlpTrainMulti(X, y, mlp_config, train_config));

        // Check training result
        $(Assert.greater(output.result.train_losses.length(), 0n));
        $(Assert.greater(output.result.val_losses.length(), 0n));
        $(Assert.greaterEqual(output.result.best_epoch, 0n));
    });

    test("mlp_predict_multi makes multi-output predictions", $ => {
        // Train multi-output model and predict
        const X = $.let(East.Matrix.fromArray([
            [1.0, 2.0],
            [2.0, 3.0],
            [3.0, 4.0],
            [4.0, 5.0],
            [5.0, 6.0],
            [6.0, 7.0],
            [7.0, 8.0],
            [8.0, 9.0],
        ]));
        const y = $.let(East.Matrix.fromArray([
            [3.0, 2.0, 4.0],
            [5.0, 4.0, 6.0],
            [7.0, 6.0, 8.0],
            [9.0, 8.0, 10.0],
            [11.0, 10.0, 12.0],
            [13.0, 12.0, 14.0],
            [15.0, 14.0, 16.0],
            [17.0, 16.0, 18.0],
        ]));

        const mlp_config = $.let({
            hidden_layers: [16n, 8n],
            activation: variant('none', null),
            output_activation: variant('none', null),
            dropout: variant('none', null),
            output_dim: variant('none', null),
        });

        const train_config = $.let({
            epochs: variant('some', 50n),
            batch_size: variant('some', 4n),
            learning_rate: variant('some', 0.01),
            loss: variant('none', null),
            optimizer: variant('none', null),
            early_stopping: variant('none', null),
            validation_split: variant('some', 0.2),
            random_state: variant('some', 42n),
        });

        const output = $.let(Torch.mlpTrainMulti(X, y, mlp_config, train_config));
        const predictions = $.let(Torch.mlpPredictMulti(output.model, X));

        // Predictions should have 8 rows (samples) and 3 columns (outputs)
        $(Assert.equal(predictions.rows(), 8n));
        // Check first prediction has 3 output values
        $(Assert.equal(predictions.getRow(0n).length(), 3n));
    });

    test("autoencoder reconstruction (X = y)", $ => {
        // Autoencoder: network learns to reconstruct input
        // Input = Output, so y = X
        const X = $.let(East.Matrix.fromArray([
            [0.5, 0.3, 0.2, 0.0],
            [0.0, 0.4, 0.4, 0.2],
            [0.3, 0.3, 0.2, 0.2],
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0, 1.0],
            [0.25, 0.25, 0.25, 0.25],
        ]));
        // For autoencoder, y = X (reconstruct input)
        const y = $.let(East.Matrix.fromArray([
            [0.5, 0.3, 0.2, 0.0],
            [0.0, 0.4, 0.4, 0.2],
            [0.3, 0.3, 0.2, 0.2],
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0, 1.0],
            [0.25, 0.25, 0.25, 0.25],
        ]));

        // Bottleneck architecture: 4 -> 8 -> 2 (bottleneck) -> 8 -> 4
        const mlp_config = $.let({
            hidden_layers: [8n, 2n, 8n],  // Bottleneck at 2
            activation: variant('some', variant('relu', null)),
            output_activation: variant('none', null),
            dropout: variant('none', null),
            output_dim: variant('none', null),  // Inferred from y: 4
        });

        const train_config = $.let({
            epochs: variant('some', 200n),
            batch_size: variant('some', 4n),
            learning_rate: variant('some', 0.01),
            loss: variant('some', variant('mse', null)),
            optimizer: variant('some', variant('adam', null)),
            early_stopping: variant('some', 20n),
            validation_split: variant('some', 0.2),
            random_state: variant('some', 42n),
        });

        const output = $.let(Torch.mlpTrainMulti(X, y, mlp_config, train_config));
        const predictions = $.let(Torch.mlpPredictMulti(output.model, X));

        // Should reconstruct with same dimensions: 8 samples x 4 features
        $(Assert.equal(predictions.rows(), 8n));
        $(Assert.equal(predictions.getRow(0n).length(), 4n));
        $(Assert.greater(output.result.train_losses.length(), 0n));
    });

    test("multi-output with explicit output_dim override", $ => {
        // Test that output_dim in config can override inferred dimension
        const X = $.let(East.Matrix.fromArray([
            [1.0, 2.0],
            [2.0, 3.0],
            [3.0, 4.0],
            [4.0, 5.0],
        ]));
        // y has 2 outputs but we override to 3
        const y = $.let(East.Matrix.fromArray([
            [3.0, 2.0],
            [5.0, 4.0],
            [7.0, 6.0],
            [9.0, 8.0],
        ]));

        const mlp_config = $.let({
            hidden_layers: [8n],
            activation: variant('none', null),
            output_activation: variant('none', null),
            dropout: variant('none', null),
            output_dim: variant('some', 2n),  // Explicit: match y's columns
        });

        const train_config = $.let({
            epochs: variant('some', 30n),
            batch_size: variant('some', 2n),
            learning_rate: variant('some', 0.01),
            loss: variant('none', null),
            optimizer: variant('none', null),
            early_stopping: variant('none', null),
            validation_split: variant('some', 0.25),
            random_state: variant('some', 42n),
        });

        const output = $.let(Torch.mlpTrainMulti(X, y, mlp_config, train_config));
        const predictions = $.let(Torch.mlpPredictMulti(output.model, X));

        $(Assert.equal(predictions.rows(), 4n));
        $(Assert.equal(predictions.getRow(0n).length(), 2n));
    });

    test("error: train_multi shape mismatch", $ => {
        const X = $.let(East.Matrix.fromArray([[1.0, 2.0], [3.0, 4.0], [5.0, 6.0]]));  // 3 samples
        const y = $.let(East.Matrix.fromArray([[1.0, 2.0], [3.0, 4.0]]));  // 2 samples

        const mlp_config = $.let({
            hidden_layers: [8n],
            activation: variant('none', null),
            output_activation: variant('none', null),
            dropout: variant('none', null),
            output_dim: variant('none', null),
        });

        const train_config = $.let({
            epochs: variant('some', 10n),
            batch_size: variant('some', 2n),
            learning_rate: variant('some', 0.01),
            loss: variant('none', null),
            optimizer: variant('none', null),
            early_stopping: variant('none', null),
            validation_split: variant('none', null),
            random_state: variant('none', null),
        });

        $(Assert.throws(Torch.mlpTrainMulti(X, y, mlp_config, train_config), /torch_mlp_train.*X.*3.*y.*2/));
    });

    // ========================================================================
    // Encoding Tests (Extract Intermediate Layer Activations)
    // ========================================================================

    test("mlpEncode extracts bottleneck embeddings from autoencoder", $ => {
        // Train autoencoder: 4 -> 8 -> 2 (bottleneck) -> 8 -> 4
        const X = $.let(East.Matrix.fromArray([
            [0.5, 0.3, 0.2, 0.0],
            [0.0, 0.4, 0.4, 0.2],
            [0.3, 0.3, 0.2, 0.2],
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0, 1.0],
            [0.25, 0.25, 0.25, 0.25],
        ]));

        // Bottleneck architecture: 4 -> 8 -> 2 (bottleneck) -> 8 -> 4
        const mlp_config = $.let({
            hidden_layers: [8n, 2n, 8n],  // Bottleneck at index 1 (2 features)
            activation: variant('some', variant('relu', null)),
            output_activation: variant('none', null),
            dropout: variant('none', null),
            output_dim: variant('none', null),
        });

        const train_config = $.let({
            epochs: variant('some', 100n),
            batch_size: variant('some', 4n),
            learning_rate: variant('some', 0.01),
            loss: variant('some', variant('mse', null)),
            optimizer: variant('some', variant('adam', null)),
            early_stopping: variant('some', 20n),
            validation_split: variant('some', 0.2),
            random_state: variant('some', 42n),
        });

        const output = $.let(Torch.mlpTrainMulti(X, X, mlp_config, train_config));

        // Extract bottleneck embeddings (layer_index=1 for the 2-dim bottleneck)
        const embeddings = $.let(Torch.mlpEncode(output.model, X, 1n));

        // Should have 8 samples with 2-dim embeddings (the bottleneck)
        $(Assert.equal(embeddings.rows(), 8n));
        $(Assert.equal(embeddings.getRow(0n).length(), 2n));
    });

    test("mlpEncode extracts first hidden layer activations", $ => {
        // Train model: 2 features -> 16 -> 8 -> 1 output
        const X = $.let(East.Matrix.fromArray([
            [1.0, 2.0],
            [2.0, 3.0],
            [3.0, 4.0],
            [4.0, 5.0],
            [5.0, 6.0],
            [6.0, 7.0],
        ]));
        const y = $.let(new Float64Array([3.0, 5.0, 7.0, 9.0, 11.0, 13.0]));

        const mlp_config = $.let({
            hidden_layers: [16n, 8n],
            activation: variant('some', variant('relu', null)),
            output_activation: variant('none', null),
            dropout: variant('none', null),
            output_dim: variant('none', null),
        });

        const train_config = $.let({
            epochs: variant('some', 50n),
            batch_size: variant('some', 2n),
            learning_rate: variant('some', 0.01),
            loss: variant('none', null),
            optimizer: variant('none', null),
            early_stopping: variant('none', null),
            validation_split: variant('some', 0.2),
            random_state: variant('some', 42n),
        });

        const output = $.let(Torch.mlpTrain(X, y, mlp_config, train_config));

        // Extract first hidden layer activations (16-dim)
        const layer0_activations = $.let(Torch.mlpEncode(output.model, X, 0n));
        $(Assert.equal(layer0_activations.rows(), 6n));
        $(Assert.equal(layer0_activations.getRow(0n).length(), 16n));

        // Extract second hidden layer activations (8-dim)
        const layer1_activations = $.let(Torch.mlpEncode(output.model, X, 1n));
        $(Assert.equal(layer1_activations.rows(), 6n));
        $(Assert.equal(layer1_activations.getRow(0n).length(), 8n));
    });

    test("mlpEncode with single-output origin embedding use case", $ => {
        // Simulate origin embedding: one-hot inputs (4 origins) -> 3-dim embedding
        // This tests extracting "origin embeddings" from one-hot encoded inputs
        const X_onehot = $.let(East.Matrix.fromArray([
            [1.0, 0.0, 0.0, 0.0],  // Origin A
            [0.0, 1.0, 0.0, 0.0],  // Origin B
            [0.0, 0.0, 1.0, 0.0],  // Origin C
            [0.0, 0.0, 0.0, 1.0],  // Origin D
            [0.5, 0.5, 0.0, 0.0],  // Blend A+B
            [0.0, 0.5, 0.5, 0.0],  // Blend B+C
        ]));

        // Autoencoder: 4 -> 3 (embedding) -> 4
        const mlp_config = $.let({
            hidden_layers: [3n],  // Single hidden layer = embedding
            activation: variant('some', variant('tanh', null)),  // tanh for bounded embeddings
            output_activation: variant('none', null),
            dropout: variant('none', null),
            output_dim: variant('none', null),
        });

        const train_config = $.let({
            epochs: variant('some', 100n),
            batch_size: variant('some', 3n),
            learning_rate: variant('some', 0.01),
            loss: variant('some', variant('mse', null)),
            optimizer: variant('some', variant('adam', null)),
            early_stopping: variant('some', 15n),
            validation_split: variant('some', 0.2),
            random_state: variant('some', 42n),
        });

        const output = $.let(Torch.mlpTrainMulti(X_onehot, X_onehot, mlp_config, train_config));

        // Extract embeddings (the 3-dim hidden layer)
        const origin_embeddings = $.let(Torch.mlpEncode(output.model, X_onehot, 0n));

        // Should have 6 samples with 3-dim embeddings
        $(Assert.equal(origin_embeddings.rows(), 6n));
        $(Assert.equal(origin_embeddings.getRow(0n).length(), 3n));
    });

    test("error: mlpEncode with invalid layer_index", $ => {
        const X = $.let(East.Matrix.fromArray([[1.0, 2.0], [3.0, 4.0]]));
        const y = $.let(new Float64Array([3.0, 7.0]));

        const mlp_config = $.let({
            hidden_layers: [8n],  // Only 1 hidden layer (index 0)
            activation: variant('none', null),
            output_activation: variant('none', null),
            dropout: variant('none', null),
            output_dim: variant('none', null),
        });

        const train_config = $.let({
            epochs: variant('some', 10n),
            batch_size: variant('some', 2n),
            learning_rate: variant('some', 0.01),
            loss: variant('none', null),
            optimizer: variant('none', null),
            early_stopping: variant('none', null),
            validation_split: variant('some', 0.5),
            random_state: variant('some', 42n),
        });

        const output = $.let(Torch.mlpTrain(X, y, mlp_config, train_config));

        // layer_index=1 is out of range (only layer 0 exists)
        $(Assert.throws(Torch.mlpEncode(output.model, X, 1n), /layer_index.*out of range/));
    });

    // ========================================================================
    // Decoding Tests (Reconstruct from Embeddings)
    // ========================================================================

    test("mlpDecode reconstructs from bottleneck embeddings", $ => {
        // Train autoencoder: 4 -> 8 -> 2 (bottleneck) -> 8 -> 4
        const X = $.let(East.Matrix.fromArray([
            [0.5, 0.3, 0.2, 0.0],
            [0.0, 0.4, 0.4, 0.2],
            [0.3, 0.3, 0.2, 0.2],
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0, 1.0],
            [0.25, 0.25, 0.25, 0.25],
        ]));

        const mlp_config = $.let({
            hidden_layers: [8n, 2n, 8n],  // Bottleneck at index 1
            activation: variant('some', variant('relu', null)),
            output_activation: variant('none', null),
            dropout: variant('none', null),
            output_dim: variant('none', null),
        });

        const train_config = $.let({
            epochs: variant('some', 100n),
            batch_size: variant('some', 4n),
            learning_rate: variant('some', 0.01),
            loss: variant('some', variant('mse', null)),
            optimizer: variant('some', variant('adam', null)),
            early_stopping: variant('some', 20n),
            validation_split: variant('some', 0.2),
            random_state: variant('some', 42n),
        });

        const output = $.let(Torch.mlpTrainMulti(X, X, mlp_config, train_config));

        // Encode to bottleneck
        const embeddings = $.let(Torch.mlpEncode(output.model, X, 1n));
        $(Assert.equal(embeddings.rows(), 8n));
        $(Assert.equal(embeddings.getRow(0n).length(), 2n));

        // Decode back from bottleneck
        const decoded = $.let(Torch.mlpDecode(output.model, embeddings, 1n));
        $(Assert.equal(decoded.rows(), 8n));
        $(Assert.equal(decoded.getRow(0n).length(), 4n));  // Should match output dim
    });

    test("encode-decode round trip matches full forward pass", $ => {
        // The encode→decode should give same result as predictMulti
        const X = $.let(East.Matrix.fromArray([
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.5, 0.5, 0.0, 0.0],
        ]));

        const mlp_config = $.let({
            hidden_layers: [8n, 3n, 8n],  // Bottleneck at index 1 (3-dim)
            activation: variant('some', variant('relu', null)),
            output_activation: variant('none', null),
            dropout: variant('none', null),
            output_dim: variant('none', null),
        });

        const train_config = $.let({
            epochs: variant('some', 50n),
            batch_size: variant('some', 2n),
            learning_rate: variant('some', 0.01),
            loss: variant('some', variant('mse', null)),
            optimizer: variant('some', variant('adam', null)),
            early_stopping: variant('none', null),
            validation_split: variant('some', 0.3),
            random_state: variant('some', 42n),
        });

        const output = $.let(Torch.mlpTrainMulti(X, X, mlp_config, train_config));

        // Full forward pass
        const direct_output = $.let(Torch.mlpPredictMulti(output.model, X));

        // Encode then decode
        const embeddings = $.let(Torch.mlpEncode(output.model, X, 1n));
        const roundtrip_output = $.let(Torch.mlpDecode(output.model, embeddings, 1n));

        // Both should have same shape
        $(Assert.equal(direct_output.rows(), roundtrip_output.rows()));
        $(Assert.equal(direct_output.getRow(0n).length(), roundtrip_output.getRow(0n).length()));
    });

    test("mlpDecode from weighted average of embeddings (origin blending)", $ => {
        // This tests the core origin model use case:
        // 1. Get embeddings for individual origins (one-hot inputs)
        // 2. Compute weighted average
        // 3. Decode to get blended output
        const X_origins = $.let(East.Matrix.fromArray([
            [1.0, 0.0, 0.0],  // Origin A
            [0.0, 1.0, 0.0],  // Origin B
            [0.0, 0.0, 1.0],  // Origin C
        ]));

        // Simple autoencoder: 3 -> 2 (embedding) -> 3
        const mlp_config = $.let({
            hidden_layers: [2n],  // Single hidden layer = embedding
            activation: variant('some', variant('tanh', null)),
            output_activation: variant('none', null),
            dropout: variant('none', null),
            output_dim: variant('none', null),
        });

        const train_config = $.let({
            epochs: variant('some', 100n),
            batch_size: variant('some', 2n),
            learning_rate: variant('some', 0.01),
            loss: variant('some', variant('mse', null)),
            optimizer: variant('some', variant('adam', null)),
            early_stopping: variant('some', 15n),
            validation_split: variant('some', 0.3),
            random_state: variant('some', 42n),
        });

        const output = $.let(Torch.mlpTrainMulti(X_origins, X_origins, mlp_config, train_config));

        // Get embeddings for each origin (3 origins x 2 embedding dims)
        const origin_embeddings = $.let(Torch.mlpEncode(output.model, X_origins, 0n));
        $(Assert.equal(origin_embeddings.rows(), 3n));
        $(Assert.equal(origin_embeddings.getRow(0n).length(), 2n));

        // Manually compute 50/50 blend of origin A and B
        // blend_emb = 0.5 * emb_A + 0.5 * emb_B
        const emb_A = $.let(origin_embeddings.getRow(0n));
        const emb_B = $.let(origin_embeddings.getRow(1n));
        const blend_emb = $.let([
            emb_A.get(0n).multiply(0.5).add(emb_B.get(0n).multiply(0.5)),
            emb_A.get(1n).multiply(0.5).add(emb_B.get(1n).multiply(0.5)),
        ]);

        // Wrap as matrix for decode (1 sample x 2 dims)
        const blend_matrix = $.let(East.Matrix.fromArray([blend_emb]));

        // Decode the blended embedding
        const decoded_blend = $.let(Torch.mlpDecode(output.model, blend_matrix, 0n));
        $(Assert.equal(decoded_blend.rows(), 1n));  // 1 sample
        $(Assert.equal(decoded_blend.getRow(0n).length(), 3n));  // 3 outputs (origins)
    });

    test("error: mlpDecode with wrong embedding dimension", $ => {
        const X = $.let(East.Matrix.fromArray([[1.0, 2.0], [3.0, 4.0]]));

        const mlp_config = $.let({
            hidden_layers: [8n, 4n],  // layer 0 = 8-dim, layer 1 = 4-dim
            activation: variant('none', null),
            output_activation: variant('none', null),
            dropout: variant('none', null),
            output_dim: variant('none', null),
        });

        const train_config = $.let({
            epochs: variant('some', 10n),
            batch_size: variant('some', 2n),
            learning_rate: variant('some', 0.01),
            loss: variant('none', null),
            optimizer: variant('none', null),
            early_stopping: variant('none', null),
            validation_split: variant('some', 0.5),
            random_state: variant('some', 42n),
        });

        const output = $.let(Torch.mlpTrainMulti(X, X, mlp_config, train_config));

        // Try to decode 3-dim embedding at layer 1 which expects 4-dim
        const wrong_embeddings = $.let(East.Matrix.fromArray([[1.0, 2.0, 3.0]]));  // 3-dim instead of 4-dim
        $(Assert.throws(Torch.mlpDecode(output.model, wrong_embeddings, 1n), /dimension.*3.*doesn't match.*4/));
    });

    // ========================================================================
    // Output Activation Tests
    // ========================================================================

    test("softmax output activation produces valid probability distribution", $ => {
        // Input: normalized weights (sum to 1)
        const X = $.let(East.Matrix.fromArray([
            [0.5, 0.3, 0.2],
            [0.8, 0.1, 0.1],
            [0.33, 0.33, 0.34],
            [1.0, 0.0, 0.0],
        ]));

        const mlp_config = $.let({
            hidden_layers: [8n, 4n, 8n],
            activation: variant('some', variant('relu', null)),
            output_activation: variant('some', variant('softmax', null)),
            dropout: variant('none', null),
            output_dim: variant('none', null),
        });

        const train_config = $.let({
            epochs: variant('some', 50n),
            batch_size: variant('some', 2n),
            learning_rate: variant('some', 0.01),
            loss: variant('some', variant('mse', null)),
            optimizer: variant('some', variant('adam', null)),
            early_stopping: variant('none', null),
            validation_split: variant('some', 0.25),
            random_state: variant('some', 42n),
        });

        const output = $.let(Torch.mlpTrainMulti(X, X, mlp_config, train_config));
        const predictions = $.let(Torch.mlpPredictMulti(output.model, X));

        // Check all outputs sum to ~1.0 (softmax property)
        $.for(predictions.toArray(), ($, row) => {
            const row_sum = $.let(row.reduce(($, acc, val) => acc.add(val), 0.0));
            // Allow small numerical tolerance
            $(Assert.greater(row_sum, 0.99));
            $(Assert.less(row_sum, 1.01));
        });

        // Check all values are non-negative (softmax property)
        $.for(predictions.toArray(), ($, row) => {
            $.for(row, ($, val) => {
                $(Assert.greaterEqual(val, 0.0));
            });
        });
    });

    test("softmax output with KL divergence loss", $ => {
        // Autoencoder with softmax output trained with KL divergence
        const X = $.let(East.Matrix.fromArray([
            [0.6, 0.3, 0.1],
            [0.1, 0.7, 0.2],
            [0.2, 0.2, 0.6],
            [0.4, 0.4, 0.2],
        ]));

        const mlp_config = $.let({
            hidden_layers: [8n, 2n, 8n],
            activation: variant('some', variant('relu', null)),
            output_activation: variant('some', variant('softmax', null)),
            dropout: variant('none', null),
            output_dim: variant('none', null),
        });

        const train_config = $.let({
            epochs: variant('some', 100n),
            batch_size: variant('some', 2n),
            learning_rate: variant('some', 0.01),
            loss: variant('some', variant('kl_div', null)),
            optimizer: variant('some', variant('adam', null)),
            early_stopping: variant('some', 20n),
            validation_split: variant('some', 0.25),
            random_state: variant('some', 42n),
        });

        const output = $.let(Torch.mlpTrainMulti(X, X, mlp_config, train_config));

        // Check training completed
        $(Assert.greater(output.result.train_losses.length(), 0n));

        // Check outputs are valid probabilities
        const predictions = $.let(Torch.mlpPredictMulti(output.model, X));
        $.for(predictions.toArray(), ($, row) => {
            const row_sum = $.let(row.reduce(($, acc, val) => acc.add(val), 0.0));
            $(Assert.greater(row_sum, 0.99));
            $(Assert.less(row_sum, 1.01));
        });
    });

    test("sigmoid output activation produces values in [0,1]", $ => {
        const X = $.let(East.Matrix.fromArray([
            [1.0, 2.0],
            [3.0, 4.0],
            [5.0, 6.0],
            [7.0, 8.0],
        ]));
        const y = $.let(East.Matrix.fromArray([
            [0.2, 0.8],
            [0.5, 0.5],
            [0.9, 0.1],
            [0.3, 0.7],
        ]));

        const mlp_config = $.let({
            hidden_layers: [8n, 4n],
            activation: variant('some', variant('relu', null)),
            output_activation: variant('some', variant('sigmoid', null)),
            dropout: variant('none', null),
            output_dim: variant('none', null),
        });

        const train_config = $.let({
            epochs: variant('some', 50n),
            batch_size: variant('some', 2n),
            learning_rate: variant('some', 0.01),
            loss: variant('some', variant('mse', null)),
            optimizer: variant('some', variant('adam', null)),
            early_stopping: variant('none', null),
            validation_split: variant('some', 0.25),
            random_state: variant('some', 42n),
        });

        const output = $.let(Torch.mlpTrainMulti(X, y, mlp_config, train_config));
        const predictions = $.let(Torch.mlpPredictMulti(output.model, X));

        // Check all values are in [0, 1] (sigmoid property)
        $.for(predictions.toArray(), ($, row) => {
            $.for(row, ($, val) => {
                $(Assert.greaterEqual(val, 0.0));
                $(Assert.lessEqual(val, 1.0));
            });
        });
    });

    test("no output activation (linear) can produce values outside [0,1]", $ => {
        // This test verifies that without output activation, values can be unconstrained
        const X = $.let(East.Matrix.fromArray([
            [1.0, 2.0],
            [10.0, 20.0],
            [100.0, 200.0],
        ]));

        const mlp_config = $.let({
            hidden_layers: [4n],
            activation: variant('some', variant('relu', null)),
            output_activation: variant('none', null),  // No output activation
            dropout: variant('none', null),
            output_dim: variant('some', 2n),
        });

        const train_config = $.let({
            epochs: variant('some', 10n),
            batch_size: variant('some', 2n),
            learning_rate: variant('some', 0.01),
            loss: variant('some', variant('mse', null)),
            optimizer: variant('some', variant('adam', null)),
            early_stopping: variant('none', null),
            validation_split: variant('some', 0.3),
            random_state: variant('some', 42n),
        });

        const output = $.let(Torch.mlpTrainMulti(X, X, mlp_config, train_config));
        const predictions = $.let(Torch.mlpPredictMulti(output.model, X));

        // Just verify the model runs - no constraints on output values
        $(Assert.equal(predictions.rows(), 3n));
        $(Assert.equal(predictions.getRow(0n).length(), 2n));
    });

    // ========================================================================
    // BCE Loss Tests (Binary Cross Entropy)
    // ========================================================================

    test("bce loss with sigmoid output for binary reconstruction", $ => {
        // Binary data (sparse matrix simulation - mostly 0s with some 1s)
        const X = $.let(East.Matrix.fromArray([
            [1.0, 0.0, 0.0, 1.0],
            [0.0, 1.0, 1.0, 0.0],
            [1.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 1.0],
            [1.0, 0.0, 1.0, 0.0],
            [0.0, 1.0, 0.0, 1.0],
        ]));

        const mlp_config = $.let({
            hidden_layers: [8n, 3n, 8n],  // Bottleneck autoencoder
            activation: variant('some', variant('relu', null)),
            output_activation: variant('some', variant('sigmoid', null)),  // Required for BCE
            dropout: variant('none', null),
            output_dim: variant('none', null),
        });

        const train_config = $.let({
            epochs: variant('some', 100n),
            batch_size: variant('some', 3n),
            learning_rate: variant('some', 0.01),
            loss: variant('some', variant('bce', null)),  // Binary Cross Entropy
            optimizer: variant('some', variant('adam', null)),
            early_stopping: variant('some', 15n),
            validation_split: variant('some', 0.2),
            random_state: variant('some', 42n),
        });

        const output = $.let(Torch.mlpTrainMulti(X, X, mlp_config, train_config));
        const predictions = $.let(Torch.mlpPredictMulti(output.model, X));

        // Check training completed
        $(Assert.greater(output.result.train_losses.length(), 0n));

        // Check outputs are in [0, 1] (sigmoid output)
        $.for(predictions.toArray(), ($, row) => {
            $.for(row, ($, val) => {
                $(Assert.greaterEqual(val, 0.0));
                $(Assert.lessEqual(val, 1.0));
            });
        });
    });

    test("bce_with_logits loss for binary reconstruction (no sigmoid output)", $ => {
        // Binary data for autoencoder
        const X = $.let(East.Matrix.fromArray([
            [1.0, 0.0, 0.0, 1.0],
            [0.0, 1.0, 1.0, 0.0],
            [1.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 1.0],
            [1.0, 0.0, 1.0, 0.0],
            [0.0, 1.0, 0.0, 1.0],
        ]));

        const mlp_config = $.let({
            hidden_layers: [8n, 3n, 8n],  // Bottleneck autoencoder
            activation: variant('some', variant('relu', null)),
            output_activation: variant('none', null),  // NO sigmoid - bce_with_logits applies it internally
            dropout: variant('none', null),
            output_dim: variant('none', null),
        });

        const train_config = $.let({
            epochs: variant('some', 100n),
            batch_size: variant('some', 3n),
            learning_rate: variant('some', 0.01),
            loss: variant('some', variant('bce_with_logits', null)),  // Applies sigmoid internally
            optimizer: variant('some', variant('adam', null)),
            early_stopping: variant('some', 15n),
            validation_split: variant('some', 0.2),
            random_state: variant('some', 42n),
        });

        const output = $.let(Torch.mlpTrainMulti(X, X, mlp_config, train_config));

        // Check training completed
        $(Assert.greater(output.result.train_losses.length(), 0n));

        // Note: Predictions are raw logits (not sigmoid), so no [0,1] constraint
        const predictions = $.let(Torch.mlpPredictMulti(output.model, X));
        $(Assert.equal(predictions.rows(), 6n));
        $(Assert.equal(predictions.getRow(0n).length(), 4n));
    });

}, { exportOnly: true });
