/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from '@elaraai/east-node-std';
import { East } from '@elaraai/east';
import { Reactive, UIComponentType } from '@elaraai/east-ui/internal';
import { Data, Func } from '@elaraai/e3-ui';
import { Experiment } from '@elaraai/e3-ui/internal';
import * as ex from './experiment.examples.js';

describeEast('Experiment', (test) => {
    // The interactive scene compiles, type-checks and renders to a
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
                const data = $.let(Data.bind(ex.batchesInput));
                const spec = $.let(Data.bind(ex.experimentSpecInput, { mode: 'staged' }));
                const estimate = $.let(Func.bind(ex.estimateFn));
                return Experiment.Root({ data, spec, estimate });
            })),
            UIComponentType,
        );
        $(Assert.equal(tree.unwrap().getTag(), 'ReactiveComponent'));
    });

    test('Experiment.Root threads the optional functions + journal through', $ => {
        const tree = $.let(
            Reactive.Root(East.function([], UIComponentType, $ => {
                const data = $.let(Data.bind(ex.batchesInput));
                const spec = $.let(Data.bind(ex.experimentSpecInput, { mode: 'staged' }));
                const estimate = $.let(Func.bind(ex.estimateFn));
                const refute = $.let(Func.bind(ex.refuteFn));
                const dose = $.let(Func.bind(ex.doseFn));
                const journal = $.let(Data.bind(ex.experimentJournalInput));
                return Experiment.Root({ data, spec, estimate, refute, dose, journal, defaultTab: 'trust' });
            })),
            UIComponentType,
        );
        $(Assert.equal(tree.unwrap().getTag(), 'ReactiveComponent'));
    });
}, { platformFns: TestImpl });
