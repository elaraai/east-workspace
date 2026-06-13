/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from '@elaraai/east-node-std';
import { East } from '@elaraai/east';
import { Reactive, UIComponentType } from '@elaraai/east-ui/internal';
import { Data } from '@elaraai/e3-ui';
import { Experiment } from '@elaraai/e3-ui/internal';
import * as ex from './experiment.examples.js';

describeEast('Experiment', (test) => {
    // Every exported example compiles, type-checks and renders to a
    // UIComponentType value.
    Assert.examples(test, {
        experimentSurface: ex.experimentSurface,
    });

    test('Experiment.Component is declared as an optional EastUI component', $ => {
        $(Assert.equal(East.value(Experiment.Component.name), 'Experiment'));
        $(Assert.equal(East.value(Experiment.Component.optional), true));
    });

    test('Experiment.Root produces a ReactiveComponent-tagged UIComponentType', $ => {
        const tree = $.let(
            Reactive.Root(East.function([], UIComponentType, $ => {
                const spec = $.let(Data.bind(ex.experimentSpecInput));
                const answer = $.let(Data.bind(ex.experimentAnswerInput));
                return Experiment.Root({ spec, answer });
            })),
            UIComponentType,
        );
        $(Assert.equal(tree.unwrap().getTag(), 'ReactiveComponent'));
    });

    test('Experiment.Root threads the optional result bindings through', $ => {
        const tree = $.let(
            Reactive.Root(East.function([], UIComponentType, $ => {
                const spec = $.let(Data.bind(ex.experimentSpecInput));
                const answer = $.let(Data.bind(ex.experimentAnswerInput));
                const refute = $.let(Data.bind(ex.experimentRefuteInput));
                const dose = $.let(Data.bind(ex.experimentDoseInput));
                const journal = $.let(Data.bind(ex.experimentJournalInput));
                return Experiment.Root({ spec, answer, refute, dose, journal, defaultTab: 'trust' });
            })),
            UIComponentType,
        );
        $(Assert.equal(tree.unwrap().getTag(), 'ReactiveComponent'));
    });
}, { platformFns: TestImpl });
