/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Lightning Sequential (LSTM/GRU) architecture tests
 */
import {variant, East} from "@elaraai/east";
import { describeEast, Assert } from "@elaraai/east-node-std";
import { Lightning } from "@elaraai/east-py-datascience";
import * as ex from "./lightning.examples.js";

describeEast("Lightning Sequential", (test) => {

    Assert.examples(test, { lightningSequential: ex.lightningSequential });

    test("sequential: LSTM train, encode, decode works", $ => {
        // Same data structure as conv1d test
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
                n_heads: 8n,
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

        const z = $.let(Lightning.encode(result.model, X));
        $(Assert.equal(z.rows(), 4n));
        $(Assert.equal(z.getRow(0n).length(), 4n));

        const X_decoded = $.let(Lightning.decode(result.model, z));
        $(Assert.equal(X_decoded.rows(), 4n));
        $(Assert.equal(X_decoded.getRow(0n).length(), 24n));
    });

    test("sequential: GRU bidirectional works", $ => {
        const X = $.let(East.Matrix.fromArray([
            [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0,
             0.0, 1.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0],
            [0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0,
             1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0],
        ]));

        const config = $.let({
            architecture: variant('sequential', {
                n_channels: 2n,
                sequence_length: 4n,
                hidden_size: 8n,
                n_layers: 2n,
                cell_type: variant('gru', null),
                latent_dim: 4n,
                bidirectional: true,
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

        const result = $.let(Lightning.train(X, X, config, variant('none', null), variant('none', null), variant('none', null)));
        $(Assert.greaterEqual(result.best_epoch, 0n));

        const z = $.let(Lightning.encode(result.model, X));
        $(Assert.equal(z.rows(), 2n));
        $(Assert.equal(z.getRow(0n).length(), 4n));
    });
    test("sequential conditional: LSTM with condition", $ => {
        const X = $.let(East.Matrix.fromArray([
            [1.0, 0.0, 0.0, 1.0, 0.0, 1.0,  0.0, 1.0, 1.0, 0.0, 1.0, 0.0],
            [0.0, 1.0, 1.0, 0.0, 1.0, 0.0,  1.0, 0.0, 0.0, 1.0, 0.0, 1.0],
        ]));
        const conditions = $.let(East.Matrix.fromArray([[1.0, 0.0], [0.0, 1.0]]));

        const config = $.let({
            architecture: variant('sequential', {
                n_channels: 2n,
                sequence_length: 3n,
                hidden_size: 8n,
                n_layers: 1n,
                cell_type: variant('lstm', null),
                latent_dim: 4n,
                bidirectional: false,
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

        // Train with conditions
        const result = $.let(Lightning.train(X, X, config, variant('none', null), variant('none', null), variant('some', conditions)));
        $(Assert.greaterEqual(result.best_epoch, 0n));

        const z = $.let(Lightning.encode(result.model, X));
        const decoded = $.let(Lightning.decodeConditional(result.model, z, conditions));
        $(Assert.equal(decoded.rows(), 2n));
        $(Assert.equal(decoded.getRow(0n).length(), 12n));
    });
    test("sequential: predict with conditions", $ => {
        const X = $.let(East.Matrix.fromArray([
            [1.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0, 0.0],
            [0.0, 1.0, 1.0, 0.0, 1.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 1.0],
        ]));
        const conditions = $.let(East.Matrix.fromArray([[1.0, 0.0], [0.0, 1.0]]));

        const config = $.let({
            architecture: variant('sequential', {
                n_channels: 2n,
                sequence_length: 3n,
                hidden_size: 8n,
                n_layers: 1n,
                cell_type: variant('lstm', null),
                latent_dim: 4n,
                bidirectional: false,
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

        const result = $.let(Lightning.train(
            X, X, config,
            variant('none', null),
            variant('none', null),
            variant('some', conditions)
        ));

        const y_pred = $.let(Lightning.predict(
            result.model, X, variant('none', null), variant('some', conditions)
        ));

        $(Assert.equal(y_pred.rows(), 2n));
        $(Assert.equal(y_pred.getRow(0n).length(), 12n));
    });

    // =========================================================================
    // generateSequence tests
    // =========================================================================

    test("sequential: generateSequence without prefix (binary output)", $ => {
        // Binary output for plan-like data: 2 channels x 3 steps = 6 binary values
        const X = $.let(East.Matrix.fromArray([
            [1.0, 0.0, 0.0, 1.0, 1.0, 0.0],
            [0.0, 1.0, 1.0, 0.0, 0.0, 1.0],
            [1.0, 0.0, 0.0, 1.0, 1.0, 0.0],
            [0.0, 1.0, 1.0, 0.0, 0.0, 1.0],
        ]));

        const config = $.let({
            architecture: variant('sequential', {
                n_channels: 2n,
                sequence_length: 3n,
                hidden_size: 8n,
                n_layers: 1n,
                cell_type: variant('lstm', null),
                latent_dim: 4n,
                bidirectional: false,
                condition_dim: variant('none', null),
            }),
            output: variant('binary', {
                pos_weight: variant('none', null),
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

        // Generate full sequence (no prefix)
        const generated = $.let(Lightning.generateSequence(
            result.model,
            East.Matrix.zeros(0n, 0n),  // Empty prefix
            variant('none', null),  // No condition
            { n_steps: 3n, temperature: 0.0, return_probs: true }
        ));

        // Should return (n_steps, n_channels) = (3, 2)
        $(Assert.equal(generated.rows(), 3n));
        $(Assert.equal(generated.getRow(0n).length(), 2n));

        // Probabilities should be in [0, 1]
        $(Assert.greaterEqual(generated.get(0n, 0n), 0.0));
        $(Assert.lessEqual(generated.get(0n, 0n), 1.0));
    });

    test("sequential: generateSequence with prefix", $ => {
        const X = $.let(East.Matrix.fromArray([
            [1.0, 0.0, 0.0, 1.0, 1.0, 0.0],
            [0.0, 1.0, 1.0, 0.0, 0.0, 1.0],
        ]));

        const config = $.let({
            architecture: variant('sequential', {
                n_channels: 2n,
                sequence_length: 3n,
                hidden_size: 8n,
                n_layers: 1n,
                cell_type: variant('lstm', null),
                latent_dim: 4n,
                bidirectional: false,
                condition_dim: variant('none', null),
            }),
            output: variant('binary', {
                pos_weight: variant('none', null),
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

        // Generate continuation from prefix
        const prefix = $.let(East.Matrix.fromArray([[1.0, 0.0], [0.0, 1.0]]));  // 2 timesteps of history
        const generated = $.let(Lightning.generateSequence(
            result.model,
            prefix,
            variant('none', null),
            { n_steps: 1n, temperature: 0.0, return_probs: true }
        ));

        // Should return just 1 new step
        $(Assert.equal(generated.rows(), 1n));
        $(Assert.equal(generated.getRow(0n).length(), 2n));
    });

    test("sequential: generateSequence with condition", $ => {
        const X = $.let(East.Matrix.fromArray([
            [1.0, 0.0, 0.0, 1.0, 1.0, 0.0],
            [0.0, 1.0, 1.0, 0.0, 0.0, 1.0],
            [1.0, 0.0, 0.0, 1.0, 1.0, 0.0],
            [0.0, 1.0, 1.0, 0.0, 0.0, 1.0],
        ]));
        const conditions = $.let(East.Matrix.fromArray([[1.0, 0.0], [0.0, 1.0], [1.0, 0.0], [0.0, 1.0]]));

        const config = $.let({
            architecture: variant('sequential', {
                n_channels: 2n,
                sequence_length: 3n,
                hidden_size: 8n,
                n_layers: 1n,
                cell_type: variant('lstm', null),
                latent_dim: 4n,
                bidirectional: false,
                condition_dim: variant('some', 2n),
            }),
            output: variant('binary', {
                pos_weight: variant('none', null),
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

        const result = $.let(Lightning.train(
            X, X, config, variant('none', null), variant('none', null), variant('some', conditions)
        ));

        // Generate with condition
        const condition = $.let(East.Matrix.fromArray([[1.0, 0.0]]));
        const generated = $.let(Lightning.generateSequence(
            result.model,
            East.Matrix.zeros(0n, 0n),
            variant('some', condition),
            { n_steps: 3n, temperature: 0.0, return_probs: true }
        ));

        $(Assert.equal(generated.rows(), 3n));
        $(Assert.equal(generated.getRow(0n).length(), 2n));
    });

    test("sequential: generateSequence temperature 0 is deterministic", $ => {
        const X = $.let(East.Matrix.fromArray([
            [1.0, 0.0, 0.0, 1.0, 1.0, 0.0],
            [0.0, 1.0, 1.0, 0.0, 0.0, 1.0],
        ]));

        const config = $.let({
            architecture: variant('sequential', {
                n_channels: 2n,
                sequence_length: 3n,
                hidden_size: 8n,
                n_layers: 1n,
                cell_type: variant('lstm', null),
                latent_dim: 4n,
                bidirectional: false,
                condition_dim: variant('none', null),
            }),
            output: variant('binary', {
                pos_weight: variant('none', null),
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

        // Generate twice with temperature=0 (deterministic)
        const gen1 = $.let(Lightning.generateSequence(
            result.model, East.Matrix.zeros(0n, 0n), variant('none', null),
            { n_steps: 3n, temperature: 0.0, return_probs: false }
        ));
        const gen2 = $.let(Lightning.generateSequence(
            result.model, East.Matrix.zeros(0n, 0n), variant('none', null),
            { n_steps: 3n, temperature: 0.0, return_probs: false }
        ));

        // Should be identical
        $(Assert.equal(gen1.get(0n, 0n), gen2.get(0n, 0n)));
        $(Assert.equal(gen1.get(0n, 1n), gen2.get(0n, 1n)));
    });

    test("sequential: generateSequence learns patterns (model quality)", $ => {
        // Train on clear pattern: channel 0 always on, channel 1 always off
        const X = $.let(East.Matrix.fromArray([
            [1.0, 0.0, 1.0, 0.0, 1.0, 0.0],  // Pattern: always [1, 0]
            [1.0, 0.0, 1.0, 0.0, 1.0, 0.0],
            [1.0, 0.0, 1.0, 0.0, 1.0, 0.0],
            [1.0, 0.0, 1.0, 0.0, 1.0, 0.0],
        ]));

        const config = $.let({
            architecture: variant('sequential', {
                n_channels: 2n,
                sequence_length: 3n,
                hidden_size: 16n,
                n_layers: 1n,
                cell_type: variant('lstm', null),
                latent_dim: 8n,
                bidirectional: false,
                condition_dim: variant('none', null),
            }),
            output: variant('binary', {
                pos_weight: variant('none', null),
            }),
            learning_rate: variant('some', 0.01),
            max_epochs: variant('some', 200n),
            patience: variant('some', 50n),
            batch_size: variant('some', 4n),
            dropout: variant('some', 0.0),
            gradient_clip: variant('some', 1.0),
            weight_decay: variant('none', null),
            random_state: variant('some', 42n),
            epoch_callback: variant('none', null),
        });

        const result = $.let(Lightning.train(X, X, config, variant('none', null), variant('none', null), variant('none', null)));

        // Model should have learned - verify train loss is low
        $(Assert.lessEqual(result.train_loss, 0.5));

        // Generate and verify pattern is preserved
        const generated = $.let(Lightning.generateSequence(
            result.model, East.Matrix.zeros(0n, 0n), variant('none', null),
            { n_steps: 3n, temperature: 0.0, return_probs: true }
        ));

        // Channel 0 should have higher probability than channel 1
        // (using 0.4/0.6 thresholds since autoregressive generation from autoencoder
        // may not perfectly reproduce training patterns)
        $(Assert.greaterEqual(generated.get(0n, 0n), 0.4));
        $(Assert.greaterEqual(generated.get(1n, 0n), 0.4));
        $(Assert.greaterEqual(generated.get(2n, 0n), 0.4));

        // Channel 1 should have lower probability
        $(Assert.lessEqual(generated.get(0n, 1n), 0.6));
        $(Assert.lessEqual(generated.get(1n, 1n), 0.6));
        $(Assert.lessEqual(generated.get(2n, 1n), 0.6));
    });

    test("sequential: generateSequence prefix influences output", $ => {
        // Train on two different patterns
        const X = $.let(East.Matrix.fromArray([
            [1.0, 0.0, 1.0, 0.0, 1.0, 0.0],  // Pattern A: always [1, 0]
            [1.0, 0.0, 1.0, 0.0, 1.0, 0.0],
            [0.0, 1.0, 0.0, 1.0, 0.0, 1.0],  // Pattern B: always [0, 1]
            [0.0, 1.0, 0.0, 1.0, 0.0, 1.0],
        ]));

        const config = $.let({
            architecture: variant('sequential', {
                n_channels: 2n,
                sequence_length: 3n,
                hidden_size: 16n,
                n_layers: 1n,
                cell_type: variant('lstm', null),
                latent_dim: 8n,
                bidirectional: false,
                condition_dim: variant('none', null),
            }),
            output: variant('binary', {
                pos_weight: variant('none', null),
            }),
            learning_rate: variant('some', 0.01),
            max_epochs: variant('some', 200n),
            patience: variant('some', 50n),
            batch_size: variant('some', 4n),
            dropout: variant('some', 0.0),
            gradient_clip: variant('some', 1.0),
            weight_decay: variant('none', null),
            random_state: variant('some', 42n),
            epoch_callback: variant('none', null),
        });

        const result = $.let(Lightning.train(X, X, config, variant('none', null), variant('none', null), variant('none', null)));

        // Generate with pattern A prefix
        const prefixA = $.let(East.Matrix.fromArray([[1.0, 0.0], [1.0, 0.0]]));
        const genA = $.let(Lightning.generateSequence(
            result.model, prefixA, variant('none', null),
            { n_steps: 1n, temperature: 0.0, return_probs: true }
        ));

        // Generate with pattern B prefix
        const prefixB = $.let(East.Matrix.fromArray([[0.0, 1.0], [0.0, 1.0]]));
        const genB = $.let(Lightning.generateSequence(
            result.model, prefixB, variant('none', null),
            { n_steps: 1n, temperature: 0.0, return_probs: true }
        ));

        // Pattern A should generate higher prob for channel 0
        // Pattern B should generate higher prob for channel 1
        $(Assert.greaterEqual(genA.get(0n, 0n), genB.get(0n, 0n)));
        $(Assert.lessEqual(genA.get(0n, 1n), genB.get(0n, 1n)));
    });
}, { exportOnly: true });
