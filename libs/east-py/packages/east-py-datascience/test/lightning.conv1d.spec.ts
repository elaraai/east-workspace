/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Lightning Conv1D architecture tests
 */
import { East, variant } from "@elaraai/east";
import { describeEast, Assert } from "@elaraai/east-node-std";
import { Lightning } from "@elaraai/east-py-datascience";
import * as ex from "./lightning.examples.js";

describeEast("Lightning Conv1D", (test) => {

    Assert.examples(test, { lightningConv1d: ex.lightningConv1d });

    test("conv1d: train, encode, decode works", $ => {
        // Simulated temporal data: 2 channels x 4 time steps x 3 classes = 24 features
        const X = $.let(East.Matrix.fromArray([
            // Channel patterns across time
            [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0,  // ch0: pattern A
             0.0, 1.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0], // ch1: pattern B
            [0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0,  // ch0: pattern C
             1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0], // ch1: pattern D
            [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0,  // same as sample 0
             0.0, 1.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0, 1.0, 0.0, 0.0,  // ch0: pattern E
             0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0], // ch1: pattern F
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
                n_heads: 8n,  // 2 channels x 4 time steps
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
        });

        const result = $.let(Lightning.train(X, X, config, variant('none', null), variant('none', null), variant('none', null)));
        $(Assert.greaterEqual(result.best_epoch, 0n));

        // Encode to latent
        const z = $.let(Lightning.encode(result.model, X));
        $(Assert.equal(z.rows(), 4n));
        $(Assert.equal(z.getRow(0n).length(), 4n));

        // Decode should produce valid output
        const X_decoded = $.let(Lightning.decode(result.model, z));
        $(Assert.equal(X_decoded.rows(), 4n));
        $(Assert.equal(X_decoded.getRow(0n).length(), 24n));
    });
    test("conv1d conditional: train and decode with condition", $ => {
        // 2 channels x 3 time steps x 2 classes = 12 features
        const X = $.let(East.Matrix.fromArray([
            [1.0, 0.0, 0.0, 1.0, 0.0, 1.0,  0.0, 1.0, 1.0, 0.0, 1.0, 0.0],
            [0.0, 1.0, 1.0, 0.0, 1.0, 0.0,  1.0, 0.0, 0.0, 1.0, 0.0, 1.0],
            [1.0, 0.0, 0.0, 1.0, 0.0, 1.0,  0.0, 1.0, 1.0, 0.0, 1.0, 0.0],
            [0.0, 1.0, 0.0, 1.0, 1.0, 0.0,  1.0, 0.0, 0.0, 1.0, 1.0, 0.0],
        ]));

        // Condition: 3-dim feature vector per sample
        const conditions = $.let(East.Matrix.fromArray([
            [1.0, 0.0, 0.5],  // condition A
            [0.0, 1.0, 0.8],  // condition B
            [1.0, 0.0, 0.5],  // condition A (same as sample 0)
            [0.5, 0.5, 0.3],  // condition C
        ]));

        const config = $.let({
            architecture: variant('conv1d', {
                n_channels: 2n,
                sequence_length: 3n,
                conv_channels: [8n],
                kernel_size: 3n,
                latent_dim: 4n,
                condition_dim: variant('some', 3n),
            }),
            output: variant('multi_head', {
                n_heads: 6n,
                n_classes_per_head: 2n,
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
        });

        // Train with conditions (6th parameter)
        const result = $.let(Lightning.train(X, X, config, variant('none', null), variant('none', null), variant('some', conditions)));
        $(Assert.greaterEqual(result.best_epoch, 0n));

        // Encode (condition not needed for encoding)
        const z = $.let(Lightning.encode(result.model, X));
        $(Assert.equal(z.rows(), 4n));
        $(Assert.equal(z.getRow(0n).length(), 4n));

        // Decode with condition
        const decoded = $.let(Lightning.decodeConditional(result.model, z, conditions));
        $(Assert.equal(decoded.rows(), 4n));
        $(Assert.equal(decoded.getRow(0n).length(), 12n));
    });
    test("error: conv1d requires multi_head output", $ => {
        const X = $.let(East.Matrix.fromArray([[1.0, 2.0, 3.0, 4.0, 5.0, 6.0]]));
        const y = $.let(East.Matrix.fromArray([[1.0]]));  // regression output

        const config = $.let({
            architecture: variant('conv1d', {
                n_channels: 2n,
                sequence_length: 3n,
                conv_channels: [8n],
                kernel_size: 3n,
                latent_dim: 4n,
                condition_dim: variant('none', null),
            }),
            output: variant('regression', null),  // ERROR: should be multi_head
            learning_rate: variant('some', 0.01),
            max_epochs: variant('some', 10n),
            patience: variant('some', 5n),
            batch_size: variant('some', 2n),
            dropout: variant('none', null),
            gradient_clip: variant('none', null),
            weight_decay: variant('none', null),
            random_state: variant('some', 42n),
            epoch_callback: variant('none', null),
        });

        $(Assert.throws(
            Lightning.train(X, y, config, variant('none', null), variant('none', null), variant('none', null)),
            /Temporal architecture 'conv1d' requires multi_head or binary output/
        ));
    });

    test("error: n_heads must equal n_channels * sequence_length", $ => {
        const X = $.let(East.Matrix.fromArray([[1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0]]));

        const config = $.let({
            architecture: variant('conv1d', {
                n_channels: 2n,
                sequence_length: 3n,  // 2 * 3 = 6 expected heads
                conv_channels: [8n],
                kernel_size: 3n,
                latent_dim: 4n,
                condition_dim: variant('none', null),
            }),
            output: variant('multi_head', {
                n_heads: 4n,  // ERROR: should be 6
                n_classes_per_head: 2n,
                class_weights: variant('none', null),
            }),
            learning_rate: variant('some', 0.01),
            max_epochs: variant('some', 10n),
            patience: variant('some', 5n),
            batch_size: variant('some', 2n),
            dropout: variant('none', null),
            gradient_clip: variant('none', null),
            weight_decay: variant('none', null),
            random_state: variant('some', 42n),
            epoch_callback: variant('none', null),
        });

        $(Assert.throws(
            Lightning.train(X, X, config, variant('none', null), variant('none', null), variant('none', null)),
            /n_heads \(4\) must equal n_channels \* sequence_length/
        ));
    });

    test("conv1d with masks and group weights", $ => {
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

        // Masks: [n_samples, n_heads, n_classes] = [4, 8, 3]
        const masks = $.let([
            [[true, true, true], [true, true, true], [true, true, true], [true, true, true],
             [true, true, true], [true, true, true], [true, true, true], [true, true, true]],
            [[true, true, false], [true, true, true], [true, true, true], [true, true, true],
             [true, true, true], [true, true, true], [true, true, true], [true, true, true]],
            [[true, true, true], [true, true, true], [true, true, true], [true, true, true],
             [true, true, true], [true, true, true], [true, true, true], [true, true, true]],
            [[true, true, true], [true, true, true], [true, true, true], [true, true, true],
             [true, true, true], [true, true, true], [true, true, true], [false, true, true]],
        ]);

        // Group weights: 2 groups x 8 heads x 3 classes
        const group_weights = $.let({
            weights: variant('multi_head', [
                [[1.0, 2.0, 2.0], [1.0, 2.0, 2.0], [1.0, 2.0, 2.0], [1.0, 2.0, 2.0],
                 [1.0, 2.0, 2.0], [1.0, 2.0, 2.0], [1.0, 2.0, 2.0], [1.0, 2.0, 2.0]],
                [[2.0, 1.0, 2.0], [2.0, 1.0, 2.0], [2.0, 1.0, 2.0], [2.0, 1.0, 2.0],
                 [2.0, 1.0, 2.0], [2.0, 1.0, 2.0], [2.0, 1.0, 2.0], [2.0, 1.0, 2.0]],
            ]),
            sample_groups: [0n, 0n, 1n, 1n],
        });

        const config = $.let({
            architecture: variant('conv1d', {
                n_channels: 2n,
                sequence_length: 4n,
                conv_channels: [8n],
                kernel_size: 3n,
                latent_dim: 4n,
                condition_dim: variant('none', null),
            }),
            output: variant('multi_head', {
                n_heads: 8n,
                n_classes_per_head: 3n,
                class_weights: variant('none', null),
            }),
            learning_rate: variant('some', 0.01),
            max_epochs: variant('some', 50n),
            patience: variant('some', 10n),
            batch_size: variant('some', 2n),
            dropout: variant('some', 0.0),
            gradient_clip: variant('some', 1.0),
            weight_decay: variant('none', null),
            random_state: variant('some', 42n),
            epoch_callback: variant('none', null),
        });

        const result = $.let(Lightning.train(X, X, config, variant('some', masks), variant('some', group_weights), variant('none', null)));
        $(Assert.greaterEqual(result.best_epoch, 0n));

        // Predict with masks
        const y_pred = $.let(Lightning.predict(result.model, X, variant('some', masks), variant('none', null)));
        $(Assert.equal(y_pred.rows(), 4n));

        // Encode/decode should work
        const z = $.let(Lightning.encode(result.model, X));
        $(Assert.equal(z.rows(), 4n));
        $(Assert.equal(z.getRow(0n).length(), 4n));
    });
    test("error: decodeConditional on model without condition_dim", $ => {
        const X = $.let(East.Matrix.fromArray([
            [1.0, 0.0, 0.0, 1.0, 0.0, 1.0,  0.0, 1.0, 1.0, 0.0, 1.0, 0.0],
            [0.0, 1.0, 1.0, 0.0, 1.0, 0.0,  1.0, 0.0, 0.0, 1.0, 0.0, 1.0],
        ]));

        const config = $.let({
            architecture: variant('conv1d', {
                n_channels: 2n,
                sequence_length: 3n,
                conv_channels: [8n],
                kernel_size: 3n,
                latent_dim: 4n,
                condition_dim: variant('none', null),  // no conditioning
            }),
            output: variant('multi_head', {
                n_heads: 6n,
                n_classes_per_head: 2n,
                class_weights: variant('none', null),
            }),
            learning_rate: variant('some', 0.01),
            max_epochs: variant('some', 20n),
            patience: variant('some', 5n),
            batch_size: variant('some', 2n),
            dropout: variant('none', null),
            gradient_clip: variant('none', null),
            weight_decay: variant('none', null),
            random_state: variant('some', 42n),
            epoch_callback: variant('none', null),
        });

        // Train without conditions
        const result = $.let(Lightning.train(X, X, config, variant('none', null), variant('none', null), variant('none', null)));
        const z = $.let(Lightning.encode(result.model, X));
        const conditions = $.let(East.Matrix.fromArray([[1.0, 0.0], [0.0, 1.0]]));

        $(Assert.throws(
            Lightning.decodeConditional(result.model, z, conditions),
            /Model has no condition_dim but condition was provided/
        ));
    });

    test("error: decodeConditional with wrong condition_dim", $ => {
        const X = $.let(East.Matrix.fromArray([
            [1.0, 0.0, 0.0, 1.0, 0.0, 1.0,  0.0, 1.0, 1.0, 0.0, 1.0, 0.0],
            [0.0, 1.0, 1.0, 0.0, 1.0, 0.0,  1.0, 0.0, 0.0, 1.0, 0.0, 1.0],
        ]));

        // Training conditions (3 dims)
        const train_conditions = $.let(East.Matrix.fromArray([[1.0, 0.0, 0.5], [0.0, 1.0, 0.5]]));

        const config = $.let({
            architecture: variant('conv1d', {
                n_channels: 2n,
                sequence_length: 3n,
                conv_channels: [8n],
                kernel_size: 3n,
                latent_dim: 4n,
                condition_dim: variant('some', 3n),  // expects 3
            }),
            output: variant('multi_head', {
                n_heads: 6n,
                n_classes_per_head: 2n,
                class_weights: variant('none', null),
            }),
            learning_rate: variant('some', 0.01),
            max_epochs: variant('some', 20n),
            patience: variant('some', 5n),
            batch_size: variant('some', 2n),
            dropout: variant('none', null),
            gradient_clip: variant('none', null),
            weight_decay: variant('none', null),
            random_state: variant('some', 42n),
            epoch_callback: variant('none', null),
        });

        // Train with correct conditions
        const result = $.let(Lightning.train(X, X, config, variant('none', null), variant('none', null), variant('some', train_conditions)));
        const z = $.let(Lightning.encode(result.model, X));

        // Try to decode with wrong condition dim (2 instead of 3)
        const wrong_conditions = $.let(East.Matrix.fromArray([[1.0, 0.0], [0.0, 1.0]]));

        $(Assert.throws(
            Lightning.decodeConditional(result.model, z, wrong_conditions),
            /Expected condition_dim=3, got 2/
        ));
    });

    test("error: condition_dim set but no conditions provided", $ => {
        const X = $.let(East.Matrix.fromArray([
            [1.0, 0.0, 0.0, 1.0, 0.0, 1.0,  0.0, 1.0, 1.0, 0.0, 1.0, 0.0],
            [0.0, 1.0, 1.0, 0.0, 1.0, 0.0,  1.0, 0.0, 0.0, 1.0, 0.0, 1.0],
        ]));

        const config = $.let({
            architecture: variant('conv1d', {
                n_channels: 2n,
                sequence_length: 3n,
                conv_channels: [8n],
                kernel_size: 3n,
                latent_dim: 4n,
                condition_dim: variant('some', 3n),  // condition_dim is set
            }),
            output: variant('multi_head', {
                n_heads: 6n,
                n_classes_per_head: 2n,
                class_weights: variant('none', null),
            }),
            learning_rate: variant('some', 0.01),
            max_epochs: variant('some', 10n),
            patience: variant('some', 5n),
            batch_size: variant('some', 2n),
            dropout: variant('none', null),
            gradient_clip: variant('none', null),
            weight_decay: variant('none', null),
            random_state: variant('some', 42n),
            epoch_callback: variant('none', null),
        });

        // ERROR: condition_dim is set but no conditions provided (6th param is none)
        $(Assert.throws(
            Lightning.train(X, X, config, variant('none', null), variant('none', null), variant('none', null)),
            /architecture has condition_dim set but no conditions provided/
        ));
    });

    // =========================================================================
    // Conditional Predict Tests
    // =========================================================================
    test("conv1d: predict with conditions", $ => {
        // 2 channels x 3 time steps x 2 classes = 12 features
        const X = $.let(East.Matrix.fromArray([
            [1.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0, 0.0],
            [0.0, 1.0, 1.0, 0.0, 1.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 1.0],
            [1.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0, 0.0],
            [0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0],
        ]));

        // Condition: 3-dim feature vector per sample
        const conditions = $.let(East.Matrix.fromArray([
            [1.0, 0.0, 0.5],
            [0.0, 1.0, 0.8],
            [1.0, 0.0, 0.5],  // same as sample 0
            [0.5, 0.5, 0.3],
        ]));

        const config = $.let({
            architecture: variant('conv1d', {
                n_channels: 2n,
                sequence_length: 3n,
                conv_channels: [8n],
                kernel_size: 3n,
                latent_dim: 4n,
                condition_dim: variant('some', 3n),
            }),
            output: variant('multi_head', {
                n_heads: 6n,
                n_classes_per_head: 2n,
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
        });

        // Train with conditions
        const result = $.let(Lightning.train(
            X, X, config,
            variant('none', null),  // no masks
            variant('none', null),  // no group weights
            variant('some', conditions)  // conditions
        ));
        $(Assert.greaterEqual(result.best_epoch, 0n));

        // Predict with conditions (4th argument)
        const y_pred = $.let(Lightning.predict(
            result.model,
            X,
            variant('none', null),  // no masks
            variant('some', conditions)  // conditions
        ));

        $(Assert.equal(y_pred.rows(), 4n));
        $(Assert.equal(y_pred.getRow(0n).length(), 12n));

        // Encode (no conditions needed)
        const z = $.let(Lightning.encode(result.model, X));
        $(Assert.equal(z.rows(), 4n));
        $(Assert.equal(z.getRow(0n).length(), 4n));

        // decodeConditional with conditions
        const decoded = $.let(Lightning.decodeConditional(result.model, z, conditions));
        $(Assert.equal(decoded.rows(), 4n));
        $(Assert.equal(decoded.getRow(0n).length(), 12n));
    });

    test("error: predict on conditional model without conditions", $ => {
        const X = $.let(East.Matrix.fromArray([
            [1.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0, 0.0],
            [0.0, 1.0, 1.0, 0.0, 1.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 1.0],
        ]));
        const conditions = $.let(East.Matrix.fromArray([[1.0, 0.0], [0.0, 1.0]]));

        const config = $.let({
            architecture: variant('conv1d', {
                n_channels: 2n,
                sequence_length: 3n,
                conv_channels: [8n],
                kernel_size: 3n,
                latent_dim: 4n,
                condition_dim: variant('some', 2n),  // requires conditions
            }),
            output: variant('multi_head', {
                n_heads: 6n,
                n_classes_per_head: 2n,
                class_weights: variant('none', null),
            }),
            learning_rate: variant('some', 0.01),
            max_epochs: variant('some', 20n),
            patience: variant('some', 5n),
            batch_size: variant('some', 2n),
            dropout: variant('none', null),
            gradient_clip: variant('none', null),
            weight_decay: variant('none', null),
            random_state: variant('some', 42n),
            epoch_callback: variant('none', null),
        });

        // Train with conditions
        const result = $.let(Lightning.train(
            X, X, config,
            variant('none', null),
            variant('none', null),
            variant('some', conditions)
        ));

        // Try to predict WITHOUT conditions - should fail
        $(Assert.throws(
            Lightning.predict(result.model, X, variant('none', null), variant('none', null)),
            /Model requires condition_dim=2 but no conditions provided/
        ));
    });

    test("error: predict with wrong condition_dim", $ => {
        const X = $.let(East.Matrix.fromArray([
            [1.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0, 0.0],
            [0.0, 1.0, 1.0, 0.0, 1.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 1.0],
        ]));
        const train_conditions = $.let(East.Matrix.fromArray([[1.0, 0.0, 0.5], [0.0, 1.0, 0.5]]));

        const config = $.let({
            architecture: variant('conv1d', {
                n_channels: 2n,
                sequence_length: 3n,
                conv_channels: [8n],
                kernel_size: 3n,
                latent_dim: 4n,
                condition_dim: variant('some', 3n),  // expects 3 dims
            }),
            output: variant('multi_head', {
                n_heads: 6n,
                n_classes_per_head: 2n,
                class_weights: variant('none', null),
            }),
            learning_rate: variant('some', 0.01),
            max_epochs: variant('some', 20n),
            patience: variant('some', 5n),
            batch_size: variant('some', 2n),
            dropout: variant('none', null),
            gradient_clip: variant('none', null),
            weight_decay: variant('none', null),
            random_state: variant('some', 42n),
            epoch_callback: variant('none', null),
        });

        // Train with correct conditions
        const result = $.let(Lightning.train(
            X, X, config,
            variant('none', null),
            variant('none', null),
            variant('some', train_conditions)
        ));

        // Try to predict with WRONG condition_dim (2 instead of 3)
        const wrong_conditions = $.let(East.Matrix.fromArray([[1.0, 0.0], [0.0, 1.0]]));

        $(Assert.throws(
            Lightning.predict(result.model, X, variant('none', null), variant('some', wrong_conditions)),
            /Expected condition_dim=3, got 2/
        ));
    });

    test("non-conditional model: predict ignores none conditions", $ => {
        const X = $.let(East.Matrix.fromArray([
            [1.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0, 0.0],
            [0.0, 1.0, 1.0, 0.0, 1.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 1.0],
        ]));

        const config = $.let({
            architecture: variant('conv1d', {
                n_channels: 2n,
                sequence_length: 3n,
                conv_channels: [8n],
                kernel_size: 3n,
                latent_dim: 4n,
                condition_dim: variant('none', null),  // no conditions
            }),
            output: variant('multi_head', {
                n_heads: 6n,
                n_classes_per_head: 2n,
                class_weights: variant('none', null),
            }),
            learning_rate: variant('some', 0.01),
            max_epochs: variant('some', 20n),
            patience: variant('some', 5n),
            batch_size: variant('some', 2n),
            dropout: variant('none', null),
            gradient_clip: variant('none', null),
            weight_decay: variant('none', null),
            random_state: variant('some', 42n),
            epoch_callback: variant('none', null),
        });

        // Train without conditions
        const result = $.let(Lightning.train(
            X, X, config,
            variant('none', null),
            variant('none', null),
            variant('none', null)  // no conditions
        ));

        // Predict without conditions (should work fine)
        const y_pred = $.let(Lightning.predict(
            result.model, X, variant('none', null), variant('none', null)
        ));

        $(Assert.equal(y_pred.rows(), 2n));
        $(Assert.equal(y_pred.getRow(0n).length(), 12n));
    });

    test("conv1d: predict with masks and conditions", $ => {
        const X = $.let(East.Matrix.fromArray([
            [1.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0, 0.0],
            [0.0, 1.0, 1.0, 0.0, 1.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 1.0],
        ]));

        // Masks: [n_samples, n_heads, n_classes] = [2, 6, 2]
        const masks = $.let([
            [[true, true], [true, true], [true, false], [true, true], [true, true], [true, true]],
            [[true, true], [true, true], [true, true], [true, true], [false, true], [true, true]],
        ]);

        const conditions = $.let(East.Matrix.fromArray([[1.0, 0.0], [0.0, 1.0]]));

        const config = $.let({
            architecture: variant('conv1d', {
                n_channels: 2n,
                sequence_length: 3n,
                conv_channels: [8n],
                kernel_size: 3n,
                latent_dim: 4n,
                condition_dim: variant('some', 2n),
            }),
            output: variant('multi_head', {
                n_heads: 6n,
                n_classes_per_head: 2n,
                class_weights: variant('none', null),
            }),
            learning_rate: variant('some', 0.01),
            max_epochs: variant('some', 50n),
            patience: variant('some', 10n),
            batch_size: variant('some', 2n),
            dropout: variant('some', 0.0),
            gradient_clip: variant('some', 1.0),
            weight_decay: variant('none', null),
            random_state: variant('some', 42n),
            epoch_callback: variant('none', null),
        });

        // Train with masks and conditions
        const result = $.let(Lightning.train(
            X, X, config,
            variant('some', masks),
            variant('none', null),
            variant('some', conditions)
        ));

        // Predict with both masks and conditions
        const y_pred = $.let(Lightning.predict(
            result.model, X,
            variant('some', masks),
            variant('some', conditions)
        ));

        $(Assert.equal(y_pred.rows(), 2n));

        // Masked positions should have ~0 probability
        $(Assert.less(y_pred.get(0n, 5n), East.value(0.001)));  // sample 0, head 2, class 1 masked
        $(Assert.less(y_pred.get(1n, 8n), East.value(0.001)));  // sample 1, head 4, class 0 masked
    });
}, { exportOnly: true });
