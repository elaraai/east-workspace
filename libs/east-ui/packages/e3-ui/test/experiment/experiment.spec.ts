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
    // The interactive scenes compile, type-check and render to a UIComponentType.
    Assert.examples(test, {
        experimentSurface: ex.experimentSurface,
        experimentTrust: ex.experimentTrust,
        experimentDose: ex.experimentDose,
        experimentValidate: ex.experimentValidate,
        experimentMenu: ex.experimentMenu,
        experimentPrecomputed: ex.experimentPrecomputed,
        experimentRefusalOverlap: ex.experimentRefusalOverlap,
        experimentRefusalNotEstimable: ex.experimentRefusalNotEstimable,
        experimentReadonlyPrecomputed: ex.experimentReadonlyPrecomputed,
    });

    test('Experiment.Component is declared as an optional EastUI component', $ => {
        $(Assert.equal(East.value(Experiment.Component.name), 'Experiment'));
        $(Assert.equal(East.value(Experiment.Component.optional), true));
    });

    test('Experiment.Root produces a ReactiveComponent-tagged UIComponentType', $ => {
        const tree = $.let(
            Reactive.Root(East.function([], UIComponentType, $ => {
                const data = $.let(Data.bind(ex.batchesInput));
                const configs = $.let(Data.bind(ex.experimentConfigsInput));
                const experiment = $.let(Func.bind(ex.experimentFn));
                return Experiment.Root({ data, configs, experiment });
            })),
            UIComponentType,
        );
        $(Assert.equal(tree.unwrap().getTag(), 'ReactiveComponent'));
    });

    test('Experiment.Root threads the optional journal + defaultTab through', $ => {
        const tree = $.let(
            Reactive.Root(East.function([], UIComponentType, $ => {
                const data = $.let(Data.bind(ex.batchesInput));
                const configs = $.let(Data.bind(ex.experimentConfigsInput));
                const experiment = $.let(Func.bind(ex.experimentFn));
                const journal = $.let(Data.bind(ex.experimentJournalInput));
                return Experiment.Root({ data, configs, experiment, journal, defaultTab: 'trust' });
            })),
            UIComponentType,
        );
        $(Assert.equal(tree.unwrap().getTag(), 'ReactiveComponent'));
    });

    test('Experiment.Root renders a curated, precomputed, read-only surface (no estimator)', $ => {
        const tree = $.let(
            Reactive.Root(East.function([], UIComponentType, $ => {
                const data = $.let(Data.bind(ex.batchesInput));
                const configs = $.let(Data.bind(ex.experimentPrecomputedConfigsInput));
                return Experiment.Root({ data, configs, readonly: true });
            })),
            UIComponentType,
        );
        $(Assert.equal(tree.unwrap().getTag(), 'ReactiveComponent'));
    });
}, { platformFns: TestImpl });
