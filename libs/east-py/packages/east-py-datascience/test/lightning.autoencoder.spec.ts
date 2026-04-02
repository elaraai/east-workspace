/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Lightning Autoencoder architecture tests
 */
import { East, variant } from "@elaraai/east";
import { describeEast, Assert } from "@elaraai/east-node-std";
import { Lightning } from "@elaraai/east-py-datascience";
import * as ex from "./lightning.examples.js";

describeEast("Lightning Autoencoder", (test) => {

    Assert.examples(test, { lightningAutoencoder: ex.lightningAutoencoder });

    test("autoencoder: train, encode, decode works", $ => {
        // Data for autoencoder
        const X = $.let(East.Matrix.fromArray([
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0, 1.0],
            [1.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 1.0],
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
        });

        // Train autoencoder (X -> X)
        const result = $.let(Lightning.train(X, X, config, variant('none', null), variant('none', null), variant('none', null)));

        // Encode to latent space
        const z = $.let(Lightning.encode(result.model, X));

        // Check latent dimensions: 6 samples x 2 latent
        $(Assert.equal(z.rows(), 6n));
        $(Assert.equal(z.getRow(0n).length(), 2n));

        // Decode back
        const X_reconstructed = $.let(Lightning.decode(result.model, z));

        // Check reconstruction dimensions
        $(Assert.equal(X_reconstructed.rows(), 6n));
        $(Assert.equal(X_reconstructed.getRow(0n).length(), 4n));

        // Verify autoencoder quality - reconstructions should be close to inputs
        // For one-hot input [1,0,0,0], reconstruction should have highest value at position 0
        $(Assert.greater(X_reconstructed.get(0n, 0n), X_reconstructed.get(0n, 1n)));
        $(Assert.greater(X_reconstructed.get(0n, 0n), X_reconstructed.get(0n, 2n)));
        $(Assert.greater(X_reconstructed.get(0n, 0n), X_reconstructed.get(0n, 3n)));

        // For [0,1,0,0], position 1 should be highest
        $(Assert.greater(X_reconstructed.get(1n, 1n), X_reconstructed.get(1n, 0n)));
        $(Assert.greater(X_reconstructed.get(1n, 1n), X_reconstructed.get(1n, 2n)));
        $(Assert.greater(X_reconstructed.get(1n, 1n), X_reconstructed.get(1n, 3n)));

        // Embeddings should be different for different inputs
        $(Assert.notEqual(z.get(0n, 0n), z.get(1n, 0n)));
    });
    test("autoencoder + multiclass with encode/decode", $ => {
        // Autoencoder for categorical embeddings
        // One-hot encoded origins (simulating n_origins = 4)
        const X = $.let(East.Matrix.fromArray([
            [1.0, 0.0, 0.0, 0.0],  // origin 0
            [0.0, 1.0, 0.0, 0.0],  // origin 1
            [0.0, 0.0, 1.0, 0.0],  // origin 2
            [0.0, 0.0, 0.0, 1.0],  // origin 3
            [1.0, 0.0, 0.0, 0.0],  // origin 0
            [0.0, 1.0, 0.0, 0.0],  // origin 1
        ]));

        const config = $.let({
            architecture: variant('autoencoder', {
                encoder_layers: [8n],
                latent_dim: 2n,
                decoder_layers: [8n],
            }),
            output: variant('multiclass', {
                n_classes: 4n,
                class_weights: variant('none', null),
            }),
            learning_rate: variant('some', 0.01),
            max_epochs: variant('some', 100n),
            patience: variant('some', 20n),
            batch_size: variant('some', 3n),
            dropout: variant('some', 0.0),
            gradient_clip: variant('some', 1.0),
            weight_decay: variant('none', null),
            random_state: variant('some', 42n),
            epoch_callback: variant('none', null),
        });

        // Train autoencoder (X -> X reconstruction with multiclass output)
        const result = $.let(Lightning.train(X, X, config, variant('none', null), variant('none', null), variant('none', null)));

        // Should train successfully
        $(Assert.greaterEqual(result.best_epoch, 0n));

        // Encode to latent space
        const embeddings = $.let(Lightning.encode(result.model, X));

        // Check latent dimensions: 6 samples x 2 latent
        $(Assert.equal(embeddings.rows(), 6n));
        $(Assert.equal(embeddings.getRow(0n).length(), 2n));

        // Similar origins should have similar embeddings
        // origin 0 appears at samples 0 and 4
        const emb0 = $.let(embeddings.getRow(0n));
        const emb4 = $.let(embeddings.getRow(4n));
        const dist_same = $.let(
            emb0.get(0n).subtract(emb4.get(0n)).abs()
                .add(emb0.get(1n).subtract(emb4.get(1n)).abs())
        );

        // Different origins should have different embeddings
        const emb1 = $.let(embeddings.getRow(1n));
        const dist_diff = $.let(
            emb0.get(0n).subtract(emb1.get(0n)).abs()
                .add(emb0.get(1n).subtract(emb1.get(1n)).abs())
        );

        // Same origin distance should be less than different origin distance
        $(Assert.less(dist_same, dist_diff));

        // Decode should produce valid probabilities
        const decoded = $.let(Lightning.decode(result.model, embeddings));
        $(Assert.equal(decoded.rows(), 6n));
        $(Assert.equal(decoded.getRow(0n).length(), 4n));

        // Probabilities should sum to ~1 (softmax output)
        const prob_sum = $.let(
            decoded.get(0n, 0n)
                .add(decoded.get(0n, 1n))
                .add(decoded.get(0n, 2n))
                .add(decoded.get(0n, 3n))
        );
        $(Assert.greater(prob_sum, East.value(0.99)));
        $(Assert.less(prob_sum, East.value(1.01)));
    });

    test("autoencoder + binary + vector pos_weight + masks", $ => {
        // Binary autoencoder for sparse feature embeddings
        // Binary task vectors (n_tasks = 4)
        const X = $.let(East.Matrix.fromArray([
            [1.0, 0.0, 1.0, 0.0],  // tasks 0,2 active
            [0.0, 1.0, 0.0, 1.0],  // tasks 1,3 active
            [1.0, 1.0, 0.0, 0.0],  // tasks 0,1 active
            [0.0, 0.0, 1.0, 1.0],  // tasks 2,3 active
            [1.0, 0.0, 0.0, 0.0],  // only task 0 active
            [0.0, 0.0, 0.0, 1.0],  // only task 3 active
        ]));

        // Masks: some positions are never valid for certain samples
        // (n_samples, 1, n_outputs) - 3D with middle dim = 1 for binary
        const masks = $.let([
            [[true, true, true, true]],      // all valid
            [[true, true, true, true]],      // all valid
            [[true, true, false, false]],    // tasks 2,3 masked
            [[false, false, true, true]],    // tasks 0,1 masked
            [[true, false, false, false]],   // only task 0 valid
            [[false, false, false, true]],   // only task 3 valid
        ]);

        const config = $.let({
            architecture: variant('autoencoder', {
                encoder_layers: [8n],
                latent_dim: 2n,
                decoder_layers: [8n],
            }),
            output: variant('binary', {
                // Per-position pos_weight: upweight all positive classes
                pos_weight: variant('some', new Float64Array([3.0, 3.0, 3.0, 3.0])),
            }),
            learning_rate: variant('some', 0.01),
            max_epochs: variant('some', 100n),
            patience: variant('some', 20n),
            batch_size: variant('some', 3n),
            dropout: variant('some', 0.0),
            gradient_clip: variant('some', 1.0),
            weight_decay: variant('none', null),
            random_state: variant('some', 42n),
            epoch_callback: variant('none', null),
        });

        // Train with masks
        const result = $.let(Lightning.train(X, X, config, variant('some', masks), variant('none', null), variant('none', null)));

        // Should train successfully
        $(Assert.greaterEqual(result.best_epoch, 0n));

        // Encode to latent space
        const embeddings = $.let(Lightning.encode(result.model, X));
        $(Assert.equal(embeddings.rows(), 6n));
        $(Assert.equal(embeddings.getRow(0n).length(), 2n));

        // Predict with masks - masked positions should be 0
        const y_pred = $.let(Lightning.predict(result.model, X, variant('some', masks), variant('none', null)));
        $(Assert.equal(y_pred.rows(), 6n));
        $(Assert.equal(y_pred.getRow(0n).length(), 4n));

        // Sample 2: tasks 2,3 are masked - should be 0
        $(Assert.equal(y_pred.get(2n, 2n), East.value(0.0)));
        $(Assert.equal(y_pred.get(2n, 3n), East.value(0.0)));

        // Sample 4: only task 0 valid - tasks 1,2,3 should be 0
        $(Assert.equal(y_pred.get(4n, 1n), East.value(0.0)));
        $(Assert.equal(y_pred.get(4n, 2n), East.value(0.0)));
        $(Assert.equal(y_pred.get(4n, 3n), East.value(0.0)));

        // Unmasked positions should be between 0 and 1 (sigmoid output)
        $(Assert.greaterEqual(y_pred.get(0n, 0n), East.value(0.0)));
        $(Assert.lessEqual(y_pred.get(0n, 0n), East.value(1.0)));
    });

    test("autoencoder + multi_head + class_weights + masks", $ => {
        // Multi-head autoencoder for structured plans
        // Simulating 3 heads x 3 classes (simplified from 84 x 4)
        // Each head is mutex (one-hot per head)
        const X = $.let(East.Matrix.fromArray([
            [1.0, 0.0, 0.0,  0.0, 1.0, 0.0,  0.0, 0.0, 1.0],  // h0=c0, h1=c1, h2=c2
            [0.0, 1.0, 0.0,  1.0, 0.0, 0.0,  0.0, 1.0, 0.0],  // h0=c1, h1=c0, h2=c1
            [0.0, 0.0, 1.0,  0.0, 0.0, 1.0,  1.0, 0.0, 0.0],  // h0=c2, h1=c2, h2=c0
            [1.0, 0.0, 0.0,  0.0, 1.0, 0.0,  0.0, 0.0, 1.0],  // same as sample 0
            [0.0, 1.0, 0.0,  0.0, 1.0, 0.0,  0.0, 1.0, 0.0],  // h0=c1, h1=c1, h2=c1
            [1.0, 0.0, 0.0,  1.0, 0.0, 0.0,  1.0, 0.0, 0.0],  // h0=c0, h1=c0, h2=c0
        ]));

        // Class weights: upweight rare classes (3 heads x 3 classes)
        const class_weights = $.let(East.Matrix.fromArray([
            [1.0, 2.0, 2.0],  // head 0: class 0 common, 1,2 rare
            [2.0, 1.0, 2.0],  // head 1: class 1 common, 0,2 rare
            [2.0, 2.0, 1.0],  // head 2: class 2 common, 0,1 rare
        ]));

        // Masks: (n_samples, n_heads, n_classes)
        const masks = $.let([
            [[true, true, true], [true, true, true], [true, true, true]],      // all valid
            [[true, true, false], [true, true, true], [true, true, true]],     // h0 c2 masked
            [[true, true, true], [true, true, true], [true, true, true]],      // all valid
            [[true, true, true], [true, true, true], [true, true, true]],      // all valid
            [[true, true, true], [true, true, false], [true, true, true]],     // h1 c2 masked
            [[true, true, true], [true, true, true], [false, true, true]],     // h2 c0 masked
        ]);

        const config = $.let({
            architecture: variant('autoencoder', {
                encoder_layers: [16n],
                latent_dim: 4n,
                decoder_layers: [16n],
            }),
            output: variant('multi_head', {
                n_heads: 3n,
                n_classes_per_head: 3n,
                class_weights: variant('some', class_weights),
            }),
            learning_rate: variant('some', 0.01),
            max_epochs: variant('some', 150n),
            patience: variant('some', 30n),
            batch_size: variant('some', 3n),
            dropout: variant('some', 0.0),
            gradient_clip: variant('some', 1.0),
            weight_decay: variant('none', null),
            random_state: variant('some', 42n),
            epoch_callback: variant('none', null),
        });

        // Train with masks
        const result = $.let(Lightning.train(X, X, config, variant('some', masks), variant('none', null), variant('none', null)));

        // Should train successfully
        $(Assert.greaterEqual(result.best_epoch, 0n));

        // Encode to latent space
        const embeddings = $.let(Lightning.encode(result.model, X));
        $(Assert.equal(embeddings.rows(), 6n));
        $(Assert.equal(embeddings.getRow(0n).length(), 4n));

        // Similar plans should have similar embeddings (samples 0 and 3 are identical)
        const emb0 = $.let(embeddings.getRow(0n));
        const emb3 = $.let(embeddings.getRow(3n));
        const dist_same = $.let(
            emb0.get(0n).subtract(emb3.get(0n)).abs()
                .add(emb0.get(1n).subtract(emb3.get(1n)).abs())
                .add(emb0.get(2n).subtract(emb3.get(2n)).abs())
                .add(emb0.get(3n).subtract(emb3.get(3n)).abs())
        );

        // Different plans should have different embeddings
        const emb1 = $.let(embeddings.getRow(1n));
        const dist_diff = $.let(
            emb0.get(0n).subtract(emb1.get(0n)).abs()
                .add(emb0.get(1n).subtract(emb1.get(1n)).abs())
                .add(emb0.get(2n).subtract(emb1.get(2n)).abs())
                .add(emb0.get(3n).subtract(emb1.get(3n)).abs())
        );

        // Same plan distance should be less than different plan distance
        $(Assert.less(dist_same, dist_diff));

        // Predict with masks
        const y_pred = $.let(Lightning.predict(result.model, X, variant('some', masks), variant('none', null)));
        $(Assert.equal(y_pred.rows(), 6n));
        $(Assert.equal(y_pred.getRow(0n).length(), 9n));

        // Each head's probs should sum to ~1
        const h0_sum = $.let(y_pred.get(0n, 0n).add(y_pred.get(0n, 1n)).add(y_pred.get(0n, 2n)));
        const h1_sum = $.let(y_pred.get(0n, 3n).add(y_pred.get(0n, 4n)).add(y_pred.get(0n, 5n)));
        const h2_sum = $.let(y_pred.get(0n, 6n).add(y_pred.get(0n, 7n)).add(y_pred.get(0n, 8n)));
        $(Assert.greater(h0_sum, East.value(0.99)));
        $(Assert.less(h0_sum, East.value(1.01)));
        $(Assert.greater(h1_sum, East.value(0.99)));
        $(Assert.less(h1_sum, East.value(1.01)));
        $(Assert.greater(h2_sum, East.value(0.99)));
        $(Assert.less(h2_sum, East.value(1.01)));

        // Masked positions should have ~0 probability
        // Sample 1, head 0, class 2 is masked
        $(Assert.less(y_pred.get(1n, 2n), East.value(0.001)));
        // Sample 5, head 2, class 0 is masked
        $(Assert.less(y_pred.get(5n, 6n), East.value(0.001)));
    });
}, { exportOnly: true });
