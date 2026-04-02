/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Lightning MLP architecture tests
 */
import { East, variant, IntegerType, FloatType, NullType } from "@elaraai/east";
import { describeEast, Assert } from "@elaraai/east-node-std";
import { Lightning } from "@elaraai/east-py-datascience";
import * as ex from "./lightning.examples.js";

describeEast("Lightning MLP", (test) => {

    Assert.examples(test, { lightningMlp: ex.lightningMlp });

    test("regression: train and predict works", $ => {
        // Simple linear data: y = x1 + x2
        const X = $.let(East.Matrix.fromArray([
            [1.0, 1.0],
            [2.0, 2.0],
            [3.0, 3.0],
            [4.0, 4.0],
            [5.0, 5.0],
            [6.0, 6.0],
            [7.0, 7.0],
            [8.0, 8.0],
        ]));
        // Target as matrix (n_samples, 1)
        const y = $.let(East.Matrix.fromArray([
            [2.0],
            [4.0],
            [6.0],
            [8.0],
            [10.0],
            [12.0],
            [14.0],
            [16.0],
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
        });

        // Train model
        const result = $.let(Lightning.train(X, y, config, variant('none', null), variant('none', null), variant('none', null)));

        // Check result structure
        $(Assert.greaterEqual(result.best_epoch, 0n));

        // Predict on training data
        const y_pred = $.let(Lightning.predict(result.model, X, variant('none', null), variant('none', null)));

        // Check dimensions
        $(Assert.equal(y_pred.rows(), 8n));
        $(Assert.equal(y_pred.getRow(0n).length(), 1n));

        // Verify model quality - predictions should follow y = x1 + x2 pattern
        // Predictions should increase monotonically (larger inputs = larger outputs)
        $(Assert.less(y_pred.get(0n, 0n), y_pred.get(4n, 0n)));
        $(Assert.less(y_pred.get(4n, 0n), y_pred.get(7n, 0n)));
    });

    test("binary: train and predict works", $ => {
        // Binary classification data
        const X = $.let(East.Matrix.fromArray([
            [0.0, 0.0],
            [0.5, 0.5],
            [1.0, 1.0],
            [1.5, 1.5],
            [10.0, 10.0],
            [10.5, 10.5],
            [11.0, 11.0],
            [11.5, 11.5],
        ]));
        // Binary targets as matrix (n_samples, 1)
        const y = $.let(East.Matrix.fromArray([
            [0.0],
            [0.0],
            [0.0],
            [0.0],
            [1.0],
            [1.0],
            [1.0],
            [1.0],
        ]));

        const config = $.let({
            architecture: variant('mlp', {
                hidden_layers: [16n],
            }),
            output: variant('binary', {
                pos_weight: variant('none', null),
            }),
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

        // Train model
        const result = $.let(Lightning.train(X, y, config, variant('none', null), variant('none', null), variant('none', null)));

        // Predict probabilities
        const y_pred = $.let(Lightning.predict(result.model, X, variant('none', null), variant('none', null)));

        // Check dimensions
        $(Assert.equal(y_pred.rows(), 8n));

        // First samples should have low probability (class 0)
        $(Assert.less(y_pred.get(0n, 0n), East.value(0.5)));
        // Last samples should have high probability (class 1)
        $(Assert.greater(y_pred.get(7n, 0n), East.value(0.5)));
    });

    test("multiclass: train and predict works", $ => {
        // 3-class classification data
        const X = $.let(East.Matrix.fromArray([
            [0.0, 0.0],
            [0.5, 0.5],
            [5.0, 5.0],
            [5.5, 5.5],
            [10.0, 10.0],
            [10.5, 10.5],
        ]));
        // One-hot encoded targets (n_samples, n_classes)
        const y = $.let(East.Matrix.fromArray([
            [1.0, 0.0, 0.0],  // class 0
            [1.0, 0.0, 0.0],  // class 0
            [0.0, 1.0, 0.0],  // class 1
            [0.0, 1.0, 0.0],  // class 1
            [0.0, 0.0, 1.0],  // class 2
            [0.0, 0.0, 1.0],  // class 2
        ]));

        const config = $.let({
            architecture: variant('mlp', {
                hidden_layers: [16n],
            }),
            output: variant('multiclass', {
                n_classes: 3n,
                class_weights: variant('none', null),
            }),
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

        // Train model
        const result = $.let(Lightning.train(X, y, config, variant('none', null), variant('none', null), variant('none', null)));

        // Predict probabilities
        const y_pred = $.let(Lightning.predict(result.model, X, variant('none', null), variant('none', null)));

        // Check dimensions: 6 samples x 3 classes
        $(Assert.equal(y_pred.rows(), 6n));
        $(Assert.equal(y_pred.getRow(0n).length(), 3n));

        // Verify model outputs valid probabilities
        // Probabilities should sum to ~1 (softmax output)
        const sum0 = $.let(y_pred.get(0n, 0n).add(y_pred.get(0n, 1n)).add(y_pred.get(0n, 2n)));
        $(Assert.greater(sum0, East.value(0.99)));
        $(Assert.less(sum0, East.value(1.01)));

        // Each probability should be between 0 and 1
        $(Assert.greaterEqual(y_pred.get(0n, 0n), East.value(0.0)));
        $(Assert.lessEqual(y_pred.get(0n, 0n), East.value(1.0)));
    });

    test("multi_head: train and predict works", $ => {
        // Multi-head classification: 2 heads x 3 classes each
        const X = $.let(East.Matrix.fromArray([
            [1.0, 0.0],
            [0.0, 1.0],
            [1.0, 1.0],
            [0.0, 0.0],
        ]));
        // Targets: (n_samples, n_heads * n_classes) = (4, 6)
        // Each row has 2 one-hot encoded heads
        const y = $.let(East.Matrix.fromArray([
            [1.0, 0.0, 0.0,  0.0, 1.0, 0.0],  // head0=class0, head1=class1
            [0.0, 1.0, 0.0,  0.0, 0.0, 1.0],  // head0=class1, head1=class2
            [0.0, 0.0, 1.0,  1.0, 0.0, 0.0],  // head0=class2, head1=class0
            [1.0, 0.0, 0.0,  0.0, 1.0, 0.0],  // head0=class0, head1=class1
        ]));

        const config = $.let({
            architecture: variant('mlp', {
                hidden_layers: [16n],
            }),
            output: variant('multi_head', {
                n_heads: 2n,
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

        // Train model
        const result = $.let(Lightning.train(X, y, config, variant('none', null), variant('none', null), variant('none', null)));

        // Predict
        const y_pred = $.let(Lightning.predict(result.model, X, variant('none', null), variant('none', null)));

        // Check dimensions: 4 samples x 6 outputs (2 heads x 3 classes)
        $(Assert.equal(y_pred.rows(), 4n));
        $(Assert.equal(y_pred.getRow(0n).length(), 6n));

        // Verify each head's probs sum to ~1 (softmax per head)
        const head0_sum = $.let(y_pred.get(0n, 0n).add(y_pred.get(0n, 1n)).add(y_pred.get(0n, 2n)));
        const head1_sum = $.let(y_pred.get(0n, 3n).add(y_pred.get(0n, 4n)).add(y_pred.get(0n, 5n)));
        $(Assert.greater(head0_sum, East.value(0.99)));
        $(Assert.less(head0_sum, East.value(1.01)));
        $(Assert.greater(head1_sum, East.value(0.99)));
        $(Assert.less(head1_sum, East.value(1.01)));

        // Each probability should be between 0 and 1
        $(Assert.greaterEqual(y_pred.get(0n, 0n), East.value(0.0)));
        $(Assert.lessEqual(y_pred.get(0n, 0n), East.value(1.0)));
    });
    test("respects random_state for reproducibility", $ => {
        const X = $.let(East.Matrix.fromArray([
            [1.0, 2.0],
            [2.0, 3.0],
            [3.0, 4.0],
            [4.0, 5.0],
        ]));
        const y = $.let(East.Matrix.fromArray([
            [3.0],
            [5.0],
            [7.0],
            [9.0],
        ]));

        const config = $.let({
            architecture: variant('mlp', {
                hidden_layers: [8n],
            }),
            output: variant('regression', null),
            learning_rate: variant('some', 0.01),
            max_epochs: variant('some', 20n),
            patience: variant('some', 5n),
            batch_size: variant('some', 2n),
            dropout: variant('some', 0.0),
            gradient_clip: variant('some', 1.0),
            weight_decay: variant('none', null),
            random_state: variant('some', 123n),
            epoch_callback: variant('none', null),
        });

        // Train two models with same seed
        const result1 = $.let(Lightning.train(X, y, config, variant('none', null), variant('none', null), variant('none', null)));
        const result2 = $.let(Lightning.train(X, y, config, variant('none', null), variant('none', null), variant('none', null)));

        // Predictions should be identical
        const pred1 = $.let(Lightning.predict(result1.model, X, variant('none', null), variant('none', null)));
        const pred2 = $.let(Lightning.predict(result2.model, X, variant('none', null), variant('none', null)));

        $(Assert.equal(pred1.get(0n, 0n), pred2.get(0n, 0n)));
        $(Assert.equal(pred1.get(1n, 0n), pred2.get(1n, 0n)));
    });
    test("binary with vector pos_weight works", $ => {
        // Imbalanced binary data: output_dim = 2, first output is rare, second is common
        const X = $.let(East.Matrix.fromArray([
            [0.0, 0.0],
            [0.5, 0.5],
            [1.0, 1.0],
            [1.5, 1.5],
            [10.0, 10.0],
            [10.5, 10.5],
            [11.0, 11.0],
            [11.5, 11.5],
        ]));
        // Two binary outputs: first rarely 1, second commonly 1
        const y = $.let(East.Matrix.fromArray([
            [0.0, 1.0],
            [0.0, 1.0],
            [0.0, 1.0],
            [0.0, 1.0],
            [1.0, 0.0],  // rare: first output = 1
            [1.0, 0.0],
            [0.0, 1.0],
            [0.0, 1.0],
        ]));

        const config = $.let({
            architecture: variant('mlp', {
                hidden_layers: [16n],
            }),
            output: variant('binary', {
                // Per-position pos_weight: upweight first output (rare), downweight second
                pos_weight: variant('some', new Float64Array([3.0, 0.5])),
            }),
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

        // Train model
        const result = $.let(Lightning.train(X, y, config, variant('none', null), variant('none', null), variant('none', null)));

        // Should train successfully
        $(Assert.greaterEqual(result.best_epoch, 0n));

        // Predict and verify output dimensions
        const y_pred = $.let(Lightning.predict(result.model, X, variant('none', null), variant('none', null)));
        $(Assert.equal(y_pred.rows(), 8n));
        $(Assert.equal(y_pred.getRow(0n).length(), 2n));

        // Predictions should be between 0 and 1 (sigmoid)
        $(Assert.greaterEqual(y_pred.get(0n, 0n), East.value(0.0)));
        $(Assert.lessEqual(y_pred.get(0n, 0n), East.value(1.0)));
    });

    test("multiclass with class_weights works", $ => {
        // 3-class classification with weights
        const X = $.let(East.Matrix.fromArray([
            [0.0, 0.0],
            [0.5, 0.5],
            [5.0, 5.0],
            [5.5, 5.5],
            [10.0, 10.0],
            [10.5, 10.5],
        ]));
        const y = $.let(East.Matrix.fromArray([
            [1.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
            [0.0, 0.0, 1.0],
        ]));

        const config = $.let({
            architecture: variant('mlp', {
                hidden_layers: [16n],
            }),
            output: variant('multiclass', {
                n_classes: 3n,
                class_weights: variant('some', new Float64Array([1.0, 2.0, 1.0])),  // Upweight class 1
            }),
            learning_rate: variant('some', 0.01),
            max_epochs: variant('some', 50n),
            patience: variant('some', 10n),
            batch_size: variant('some', 4n),
            dropout: variant('some', 0.0),
            gradient_clip: variant('some', 1.0),
            weight_decay: variant('none', null),
            random_state: variant('some', 42n),
            epoch_callback: variant('none', null),
        });

        // Train model
        const result = $.let(Lightning.train(X, y, config, variant('none', null), variant('none', null), variant('none', null)));

        // Should train successfully
        $(Assert.greaterEqual(result.best_epoch, 0n));

        // Verify model outputs valid probabilities
        const y_pred = $.let(Lightning.predict(result.model, X, variant('none', null), variant('none', null)));

        // Probabilities should sum to ~1
        const sum0 = $.let(y_pred.get(0n, 0n).add(y_pred.get(0n, 1n)).add(y_pred.get(0n, 2n)));
        $(Assert.greater(sum0, East.value(0.99)));
        $(Assert.less(sum0, East.value(1.01)));
    });

    test("multi_head with class_weights works", $ => {
        // Multi-head with imbalanced classes - upweight rare classes
        // 2 heads x 3 classes, where class 0 dominates in both heads
        const X = $.let(East.Matrix.fromArray([
            [1.0, 0.0],
            [0.9, 0.1],
            [0.8, 0.2],
            [0.7, 0.3],
            [0.0, 1.0],  // rare: head0=class1
            [0.5, 0.5],  // rare: head1=class2
        ]));
        const y = $.let(East.Matrix.fromArray([
            [1.0, 0.0, 0.0,  1.0, 0.0, 0.0],  // head0=class0, head1=class0
            [1.0, 0.0, 0.0,  1.0, 0.0, 0.0],  // head0=class0, head1=class0
            [1.0, 0.0, 0.0,  1.0, 0.0, 0.0],  // head0=class0, head1=class0
            [1.0, 0.0, 0.0,  1.0, 0.0, 0.0],  // head0=class0, head1=class0
            [0.0, 1.0, 0.0,  1.0, 0.0, 0.0],  // head0=class1 (rare), head1=class0
            [1.0, 0.0, 0.0,  0.0, 0.0, 1.0],  // head0=class0, head1=class2 (rare)
        ]));

        // Class weights: upweight rare classes (1 and 2)
        const class_weights = $.let(East.Matrix.fromArray([
            [1.0, 4.0, 4.0],  // head 0 weights
            [1.0, 4.0, 4.0],  // head 1 weights
        ]));

        const config = $.let({
            architecture: variant('mlp', {
                hidden_layers: [32n, 16n],
            }),
            output: variant('multi_head', {
                n_heads: 2n,
                n_classes_per_head: 3n,
                class_weights: variant('some', class_weights),
            }),
            learning_rate: variant('some', 0.01),
            max_epochs: variant('some', 200n),
            patience: variant('some', 30n),
            batch_size: variant('some', 3n),
            dropout: variant('some', 0.0),
            gradient_clip: variant('some', 1.0),
            weight_decay: variant('none', null),
            random_state: variant('some', 42n),
            epoch_callback: variant('none', null),
        });

        const result = $.let(Lightning.train(X, y, config, variant('none', null), variant('none', null), variant('none', null)));

        // Should train successfully
        $(Assert.greaterEqual(result.best_epoch, 0n));

        // Verify predictions
        const y_pred = $.let(Lightning.predict(result.model, X, variant('none', null), variant('none', null)));

        // Check dimensions: 6 samples x 6 outputs (2 heads x 3 classes)
        $(Assert.equal(y_pred.rows(), 6n));
        $(Assert.equal(y_pred.getRow(0n).length(), 6n));

        // Verify each head's probs sum to ~1
        const head0_sum = $.let(y_pred.get(0n, 0n).add(y_pred.get(0n, 1n)).add(y_pred.get(0n, 2n)));
        const head1_sum = $.let(y_pred.get(0n, 3n).add(y_pred.get(0n, 4n)).add(y_pred.get(0n, 5n)));
        $(Assert.greater(head0_sum, East.value(0.99)));
        $(Assert.less(head0_sum, East.value(1.01)));
        $(Assert.greater(head1_sum, East.value(0.99)));
        $(Assert.less(head1_sum, East.value(1.01)));
    });

    test("multi_head with masks works", $ => {
        // Multi-head where certain classes are masked (invalid) per sample
        const X = $.let(East.Matrix.fromArray([
            [1.0, 0.0],
            [0.0, 1.0],
            [1.0, 1.0],
            [0.5, 0.5],
        ]));
        // 2 heads x 3 classes
        const y = $.let(East.Matrix.fromArray([
            [1.0, 0.0, 0.0,  0.0, 1.0, 0.0],  // head0=class0, head1=class1
            [0.0, 1.0, 0.0,  0.0, 0.0, 1.0],  // head0=class1, head1=class2
            [0.0, 0.0, 1.0,  1.0, 0.0, 0.0],  // head0=class2, head1=class0
            [1.0, 0.0, 0.0,  0.0, 1.0, 0.0],  // head0=class0, head1=class1
        ]));

        // Masks: (n_samples, n_heads, n_classes) - True = valid
        // Sample 0: all valid
        // Sample 1: head0 class2 masked, head1 class0 masked
        // Sample 2: head0 class0 masked, head1 class2 masked
        // Sample 3: all valid
        const masks = $.let([
            [[true, true, true], [true, true, true]],      // Sample 0: all valid
            [[true, true, false], [false, true, true]],    // Sample 1: some masked
            [[false, true, true], [true, true, false]],    // Sample 2: some masked
            [[true, true, true], [true, true, true]],      // Sample 3: all valid
        ]);

        const config = $.let({
            architecture: variant('mlp', {
                hidden_layers: [16n],
            }),
            output: variant('multi_head', {
                n_heads: 2n,
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

        // Train with masks
        const result = $.let(Lightning.train(X, y, config, variant('some', masks), variant('none', null), variant('none', null)));

        // Should train successfully
        $(Assert.greaterEqual(result.best_epoch, 0n));

        // Predict with masks
        const y_pred = $.let(Lightning.predict(result.model, X, variant('some', masks), variant('none', null)));

        // Check dimensions
        $(Assert.equal(y_pred.rows(), 4n));
        $(Assert.equal(y_pred.getRow(0n).length(), 6n));

        // For sample 1, head0 class2 is masked - its probability should be very low
        // (masked positions get -inf logits, so softmax gives ~0)
        $(Assert.less(y_pred.get(1n, 2n), East.value(0.001)));

        // For sample 2, head1 class2 is masked
        $(Assert.less(y_pred.get(2n, 5n), East.value(0.001)));

        // Probabilities should still sum to ~1 per head (softmax renormalizes)
        const s1_h0_sum = $.let(y_pred.get(1n, 0n).add(y_pred.get(1n, 1n)).add(y_pred.get(1n, 2n)));
        $(Assert.greater(s1_h0_sum, East.value(0.99)));
        $(Assert.less(s1_h0_sum, East.value(1.01)));
    });

    test("binary with masks works", $ => {
        // Binary classification with some positions masked
        const X = $.let(East.Matrix.fromArray([
            [0.0, 0.0],
            [1.0, 1.0],
            [5.0, 5.0],
            [6.0, 6.0],
            [10.0, 10.0],
            [11.0, 11.0],
        ]));
        // 4 binary outputs per sample
        const y = $.let(East.Matrix.fromArray([
            [1.0, 0.0, 0.0, 0.0],
            [1.0, 1.0, 0.0, 0.0],
            [0.0, 1.0, 1.0, 0.0],
            [0.0, 0.0, 1.0, 1.0],
            [0.0, 0.0, 0.0, 1.0],
            [1.0, 0.0, 0.0, 1.0],
        ]));

        // Masks: (n_samples, 1, output_dim) - True = valid
        // Some positions are masked for training
        const masks = $.let([
            [[true, true, true, true]],     // all valid
            [[true, true, false, false]],   // outputs 2,3 masked
            [[false, true, true, false]],   // outputs 0,3 masked
            [[true, true, true, true]],     // all valid
            [[false, false, true, true]],   // outputs 0,1 masked
            [[true, true, true, true]],     // all valid
        ]);

        const config = $.let({
            architecture: variant('mlp', {
                hidden_layers: [16n],
            }),
            output: variant('binary', {
                pos_weight: variant('none', null),
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
        const result = $.let(Lightning.train(X, y, config, variant('some', masks), variant('none', null), variant('none', null)));

        // Should train successfully
        $(Assert.greaterEqual(result.best_epoch, 0n));

        // Predict with masks - masked positions should be 0
        const y_pred = $.let(Lightning.predict(result.model, X, variant('some', masks), variant('none', null)));
        $(Assert.equal(y_pred.rows(), 6n));
        $(Assert.equal(y_pred.getRow(0n).length(), 4n));

        // Sample 1: outputs 2,3 are masked - should be 0
        $(Assert.equal(y_pred.get(1n, 2n), East.value(0.0)));
        $(Assert.equal(y_pred.get(1n, 3n), East.value(0.0)));

        // Sample 2: outputs 0,3 are masked - should be 0
        $(Assert.equal(y_pred.get(2n, 0n), East.value(0.0)));
        $(Assert.equal(y_pred.get(2n, 3n), East.value(0.0)));

        // Unmasked positions should have valid probabilities (0-1)
        $(Assert.greaterEqual(y_pred.get(0n, 0n), East.value(0.0)));
        $(Assert.lessEqual(y_pred.get(0n, 0n), East.value(1.0)));
    });

    test("epoch_callback is called with metrics", $ => {
        const X = $.let(East.Matrix.fromArray([
            [1.0, 1.0],
            [2.0, 2.0],
            [3.0, 3.0],
            [4.0, 4.0],
            [5.0, 5.0],
            [6.0, 6.0],
        ]));
        const y = $.let(East.Matrix.fromArray([
            [2.0],
            [4.0],
            [6.0],
            [8.0],
            [10.0],
            [12.0],
        ]));

        // Track that callback was called by counting epochs
        const epochCount = $.let(0n);
        const lastTrainLoss = $.let(0.0);

        const callback = East.function(
            [IntegerType, FloatType, FloatType],
            NullType,
            ($, epoch, train_loss) => {
                // Increment counter each time callback is called
                $.assign(epochCount, epochCount.add(1n));
                // Store train loss to verify it's reasonable
                $.assign(lastTrainLoss, train_loss);
                return $.return(null);
            }
        );

        const config = $.let({
            architecture: variant('mlp', {
                hidden_layers: [8n],
            }),
            output: variant('regression', null),
            learning_rate: variant('some', 0.01),
            max_epochs: variant('some', 20n),
            patience: variant('some', 5n),
            batch_size: variant('some', 2n),
            dropout: variant('some', 0.0),
            gradient_clip: variant('some', 1.0),
            weight_decay: variant('none', null),
            random_state: variant('some', 42n),
            epoch_callback: variant('some', callback),
        });

        // Train with callback
        const result = $.let(Lightning.train(X, y, config, variant('none', null), variant('none', null), variant('none', null)));

        // Callback should have been called at least once (epochCount > 0)
        $(Assert.greater(epochCount, 0n));

        // Last train loss should be non-negative
        $(Assert.greaterEqual(lastTrainLoss, East.value(0.0)));

        // Should train successfully
        $(Assert.greaterEqual(result.best_epoch, 0n));

        // Model should have learned the linear pattern
        const y_pred = $.let(Lightning.predict(result.model, X, variant('none', null), variant('none', null)));

        // Predictions should be reasonably close to targets
        $(Assert.greater(y_pred.get(0n, 0n), East.value(0.0)));
        $(Assert.less(y_pred.get(0n, 0n), East.value(6.0)));
    });
    test("multi_head with group weights", $ => {
        // 2 groups with different class distributions
        // Group 0: mostly class 0, Group 1: mostly class 1
        const X = $.let(East.Matrix.fromArray([
            [1.0, 0.0], [1.1, 0.1], [0.9, 0.1],  // group 0
            [0.0, 1.0], [0.1, 1.1], [0.1, 0.9],  // group 1
        ]));
        // 2 heads x 3 classes = 6 outputs
        const y = $.let(East.Matrix.fromArray([
            [1.0, 0.0, 0.0,  1.0, 0.0, 0.0],  // group 0: class 0
            [1.0, 0.0, 0.0,  1.0, 0.0, 0.0],
            [1.0, 0.0, 0.0,  1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0,  0.0, 1.0, 0.0],  // group 1: class 1
            [0.0, 1.0, 0.0,  0.0, 1.0, 0.0],
            [0.0, 1.0, 0.0,  0.0, 1.0, 0.0],
        ]));

        // Group weights: [n_groups][n_heads][n_classes]
        const group_weights = $.let({
            weights: variant('multi_head', [
                [[1.0, 2.0, 2.0], [1.0, 2.0, 2.0]],  // group 0: upweight rare classes
                [[2.0, 1.0, 2.0], [2.0, 1.0, 2.0]],  // group 1: upweight rare classes
            ]),
            sample_groups: [0n, 0n, 0n, 1n, 1n, 1n],
        });

        const config = $.let({
            architecture: variant('mlp', { hidden_layers: [16n] }),
            output: variant('multi_head', {
                n_heads: 2n,
                n_classes_per_head: 3n,
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

        const result = $.let(Lightning.train(X, y, config, variant('none', null), variant('some', group_weights), variant('none', null)));

        $(Assert.greaterEqual(result.best_epoch, 0n));

        const y_pred = $.let(Lightning.predict(result.model, X, variant('none', null), variant('none', null)));
        $(Assert.equal(y_pred.rows(), 6n));

        // Each head's probs should sum to ~1
        const h0_sum = $.let(y_pred.get(0n, 0n).add(y_pred.get(0n, 1n)).add(y_pred.get(0n, 2n)));
        $(Assert.greater(h0_sum, East.value(0.99)));
        $(Assert.less(h0_sum, East.value(1.01)));
    });

    test("binary with group weights", $ => {
        // 2 groups with different sparsity
        const X = $.let(East.Matrix.fromArray([
            [1.0, 0.0], [1.1, 0.1], [0.9, 0.1],  // group 0
            [0.0, 1.0], [0.1, 1.1], [0.1, 0.9],  // group 1
        ]));
        // 4 binary outputs
        const y = $.let(East.Matrix.fromArray([
            [1.0, 0.0, 0.0, 0.0],  // group 0: sparse
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 0.0, 0.0, 0.0],
            [1.0, 1.0, 1.0, 0.0],  // group 1: denser
            [1.0, 1.0, 0.0, 0.0],
            [0.0, 1.0, 1.0, 0.0],
        ]));

        // Group weights (pos_weight per group): [n_groups][output_dim]
        const group_weights = $.let({
            weights: variant('binary', [
                [5.0, 5.0, 5.0, 5.0],  // group 0: high pos_weight (sparse)
                [1.0, 1.0, 1.0, 1.0],  // group 1: low pos_weight (denser)
            ]),
            sample_groups: [0n, 0n, 0n, 1n, 1n, 1n],
        });

        const config = $.let({
            architecture: variant('mlp', { hidden_layers: [16n] }),
            output: variant('binary', { pos_weight: variant('none', null) }),
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

        const result = $.let(Lightning.train(X, y, config, variant('none', null), variant('some', group_weights), variant('none', null)));

        $(Assert.greaterEqual(result.best_epoch, 0n));

        const y_pred = $.let(Lightning.predict(result.model, X, variant('none', null), variant('none', null)));
        $(Assert.equal(y_pred.rows(), 6n));
        $(Assert.equal(y_pred.getRow(0n).length(), 4n));

        // Predictions should be between 0 and 1
        $(Assert.greaterEqual(y_pred.get(0n, 0n), East.value(0.0)));
        $(Assert.lessEqual(y_pred.get(0n, 0n), East.value(1.0)));
    });

    test("error: group_weights with regression output", $ => {
        const X = $.let(East.Matrix.fromArray([[1.0, 2.0], [3.0, 4.0], [5.0, 6.0], [7.0, 8.0]]));
        const y = $.let(East.Matrix.fromArray([[1.0], [2.0], [3.0], [4.0]]));

        const group_weights = $.let({
            weights: variant('multi_head', [[[1.0]]]),
            sample_groups: [0n, 0n, 0n, 0n],
        });

        const config = $.let({
            architecture: variant('mlp', { hidden_layers: [8n] }),
            output: variant('regression', null),
            learning_rate: variant('none', null),
            max_epochs: variant('none', null),
            patience: variant('none', null),
            batch_size: variant('none', null),
            dropout: variant('none', null),
            gradient_clip: variant('none', null),
            weight_decay: variant('none', null),
            random_state: variant('none', null),
            epoch_callback: variant('none', null),
        });

        $(Assert.throws(
            Lightning.train(X, y, config, variant('none', null), variant('some', group_weights), variant('none', null)),
            /group_weights only supported for multi_head and binary output/
        ));
    });

    test("error: weights variant does not match output type", $ => {
        const X = $.let(East.Matrix.fromArray([[1.0, 2.0], [3.0, 4.0], [5.0, 6.0], [7.0, 8.0]]));
        const y = $.let(East.Matrix.fromArray([[1.0], [0.0], [1.0], [0.0]]));

        // Using multi_head variant with binary output
        const group_weights = $.let({
            weights: variant('multi_head', [[[1.0, 1.0]]]),
            sample_groups: [0n, 0n, 0n, 0n],
        });

        const config = $.let({
            architecture: variant('mlp', { hidden_layers: [8n] }),
            output: variant('binary', { pos_weight: variant('none', null) }),
            learning_rate: variant('none', null),
            max_epochs: variant('none', null),
            patience: variant('none', null),
            batch_size: variant('none', null),
            dropout: variant('none', null),
            gradient_clip: variant('none', null),
            weight_decay: variant('none', null),
            random_state: variant('none', null),
            epoch_callback: variant('none', null),
        });

        $(Assert.throws(
            Lightning.train(X, y, config, variant('none', null), variant('some', group_weights), variant('none', null)),
            /group_weights variant 'multi_head' does not match output type 'binary'/
        ));
    });

    test("error: sample_groups index out of bounds", $ => {
        const X = $.let(East.Matrix.fromArray([[1.0, 2.0], [3.0, 4.0], [5.0, 6.0], [7.0, 8.0]]));
        const y = $.let(East.Matrix.fromArray([
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
            [1.0, 0.0, 0.0],
        ]));

        // Only 1 group but sample_groups references index 1
        const group_weights = $.let({
            weights: variant('multi_head', [[[1.0, 1.0, 1.0]]]),  // 1 group
            sample_groups: [0n, 0n, 1n, 1n],  // ERROR: index 1 out of bounds
        });

        const config = $.let({
            architecture: variant('mlp', { hidden_layers: [8n] }),
            output: variant('multi_head', {
                n_heads: 1n,
                n_classes_per_head: 3n,
                class_weights: variant('none', null),
            }),
            learning_rate: variant('none', null),
            max_epochs: variant('none', null),
            patience: variant('none', null),
            batch_size: variant('none', null),
            dropout: variant('none', null),
            gradient_clip: variant('none', null),
            weight_decay: variant('none', null),
            random_state: variant('none', null),
            epoch_callback: variant('none', null),
        });

        $(Assert.throws(
            Lightning.train(X, y, config, variant('none', null), variant('some', group_weights), variant('none', null)),
            /sample_groups contains index 1 but only 1 groups provided/
        ));
    });

    test("error: sample_groups length mismatch", $ => {
        const X = $.let(East.Matrix.fromArray([[1.0, 2.0], [3.0, 4.0], [5.0, 6.0], [7.0, 8.0]]));  // 4 samples
        const y = $.let(East.Matrix.fromArray([
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
            [1.0, 0.0, 0.0],
        ]));

        const group_weights = $.let({
            weights: variant('multi_head', [[[1.0, 1.0, 1.0]]]),
            sample_groups: [0n, 0n],  // ERROR: only 2 indices for 4 samples
        });

        const config = $.let({
            architecture: variant('mlp', { hidden_layers: [8n] }),
            output: variant('multi_head', {
                n_heads: 1n,
                n_classes_per_head: 3n,
                class_weights: variant('none', null),
            }),
            learning_rate: variant('none', null),
            max_epochs: variant('none', null),
            patience: variant('none', null),
            batch_size: variant('none', null),
            dropout: variant('none', null),
            gradient_clip: variant('none', null),
            weight_decay: variant('none', null),
            random_state: variant('none', null),
            epoch_callback: variant('none', null),
        });

        $(Assert.throws(
            Lightning.train(X, y, config, variant('none', null), variant('some', group_weights), variant('none', null)),
            /sample_groups length 2 does not match X rows 4/
        ));
    });

    // =========================================================================
    // Error handling tests
    // =========================================================================

    test("error: X and y shape mismatch", $ => {
        const X = $.let(East.Matrix.fromArray([[1.0, 2.0], [3.0, 4.0], [5.0, 6.0]]));  // 3 samples
        const y = $.let(East.Matrix.fromArray([[1.0], [2.0]]));  // 2 samples

        const config = $.let({
            architecture: variant('mlp', {
                hidden_layers: [8n],
            }),
            output: variant('regression', null),
            learning_rate: variant('none', null),
            max_epochs: variant('none', null),
            patience: variant('none', null),
            batch_size: variant('none', null),
            dropout: variant('none', null),
            gradient_clip: variant('none', null),
            weight_decay: variant('none', null),
            random_state: variant('none', null),
            epoch_callback: variant('none', null),
        });

        $(Assert.throws(
            Lightning.train(X, y, config, variant('none', null), variant('none', null), variant('none', null)),
            /Size mismatch between tensors|out of bounds for dimension/
        ));
    });

    test("error: encode on non-autoencoder model", $ => {
        const X = $.let(East.Matrix.fromArray([
            [1.0, 2.0],
            [2.0, 3.0],
            [3.0, 4.0],
            [4.0, 5.0],
        ]));
        const y = $.let(East.Matrix.fromArray([
            [3.0],
            [5.0],
            [7.0],
            [9.0],
        ]));

        const config = $.let({
            architecture: variant('mlp', {
                hidden_layers: [8n],
            }),
            output: variant('regression', null),
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

        const result = $.let(Lightning.train(X, y, config, variant('none', null), variant('none', null), variant('none', null)));

        $(Assert.throws(
            Lightning.encode(result.model, X),
            /encode\(\) not available for mlp architecture/
        ));
    });

    test("error: decode on non-autoencoder model", $ => {
        const X = $.let(East.Matrix.fromArray([
            [1.0, 2.0],
            [2.0, 3.0],
            [3.0, 4.0],
            [4.0, 5.0],
        ]));
        const y = $.let(East.Matrix.fromArray([
            [3.0],
            [5.0],
            [7.0],
            [9.0],
        ]));

        const config = $.let({
            architecture: variant('mlp', {
                hidden_layers: [8n],
            }),
            output: variant('regression', null),
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

        const result = $.let(Lightning.train(X, y, config, variant('none', null), variant('none', null), variant('none', null)));
        const z = $.let(East.Matrix.fromArray([[0.5, 0.5], [0.3, 0.7]]));

        $(Assert.throws(
            Lightning.decode(result.model, z),
            /decode\(\) not available for mlp architecture/
        ));
    });

    test("error: generateSequence on non-sequential model", $ => {
        const X = $.let(East.Matrix.fromArray([
            [1.0, 2.0],
            [2.0, 3.0],
            [3.0, 4.0],
            [4.0, 5.0],
        ]));
        const y = $.let(East.Matrix.fromArray([
            [1.0, 0.0],
            [0.0, 1.0],
            [1.0, 0.0],
            [0.0, 1.0],
        ]));

        const config = $.let({
            architecture: variant('mlp', {
                hidden_layers: [8n],
            }),
            output: variant('binary', {
                pos_weight: variant('none', null),
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

        const result = $.let(Lightning.train(X, y, config, variant('none', null), variant('none', null), variant('none', null)));

        // Try to generate sequence from MLP model
        const generateConfig = $.let({
            n_steps: 5n,
            temperature: 0.0,
            return_probs: false,
        });

        $(Assert.throws(
            Lightning.generateSequence(result.model, X, variant('none', null), generateConfig),
            /generateSequence requires sequential architecture/
        ));
    });

    // =========================================================================
    // Temporal Architecture Tests
    // =========================================================================
}, { exportOnly: true });
