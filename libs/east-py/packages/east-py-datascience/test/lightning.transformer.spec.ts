/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Lightning Transformer architecture tests
 */
import {variant, East} from "@elaraai/east";
import { describeEast, Assert } from "@elaraai/east-node-std";
import { Lightning } from "@elaraai/east-py-datascience";
import * as ex from "./lightning.examples.js";

describeEast("Lightning Transformer", (test) => {

    Assert.examples(test, { lightningTransformer: ex.lightningTransformer });

    test("transformer: train, encode, decode works", $ => {
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
                n_attention_heads: 2n,  // 16 / 2 = 8 per head
                n_layers: 1n,
                d_ff: variant('none', null),
                latent_dim: 4n,
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
    test("transformer conditional: with condition", $ => {
        const X = $.let(East.Matrix.fromArray([
            [1.0, 0.0, 0.0, 1.0, 0.0, 1.0,  0.0, 1.0, 1.0, 0.0, 1.0, 0.0],
            [0.0, 1.0, 1.0, 0.0, 1.0, 0.0,  1.0, 0.0, 0.0, 1.0, 0.0, 1.0],
        ]));
        const conditions = $.let(East.Matrix.fromArray([[1.0, 0.0], [0.0, 1.0]]));

        const config = $.let({
            architecture: variant('transformer', {
                n_channels: 2n,
                sequence_length: 3n,
                d_model: 8n,
                n_attention_heads: 2n,
                n_layers: 1n,
                d_ff: variant('none', null),
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

        // Train with conditions
        const result = $.let(Lightning.train(X, X, config, variant('none', null), variant('none', null), variant('some', conditions)));
        $(Assert.greaterEqual(result.best_epoch, 0n));

        const z = $.let(Lightning.encode(result.model, X));
        const decoded = $.let(Lightning.decodeConditional(result.model, z, conditions));
        $(Assert.equal(decoded.rows(), 2n));
        $(Assert.equal(decoded.getRow(0n).length(), 12n));
    });
    test("transformer: predict with conditions", $ => {
        const X = $.let(East.Matrix.fromArray([
            [1.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0, 0.0],
            [0.0, 1.0, 1.0, 0.0, 1.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 1.0],
        ]));
        const conditions = $.let(East.Matrix.fromArray([[1.0, 0.0], [0.0, 1.0]]));

        const config = $.let({
            architecture: variant('transformer', {
                n_channels: 2n,
                sequence_length: 3n,
                d_model: 8n,
                n_attention_heads: 2n,
                n_layers: 1n,
                d_ff: variant('none', null),
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
}, { exportOnly: true });
