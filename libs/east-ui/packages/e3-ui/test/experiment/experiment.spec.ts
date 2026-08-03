/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from '@elaraai/east-node-std';
import { East, isTypeEqual, type ExprType } from '@elaraai/east';
import { Reactive, UIComponentType } from '@elaraai/east-ui/internal';
import { Data, Func } from '@elaraai/e3-ui';
import { Experiment } from '@elaraai/e3-ui/internal';
import { Causal } from '@elaraai/east-py-datascience';
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
        experimentRefusals: ex.experimentRefusals,
    });

    // Panels — every merged example stays mounted as a captioned row (#464).
    // The mono-uppercase Text captions are the stable per-mini anchors.

    test('experimentPrecomputed panel mounts one captioned row per merged example', $ => {
        const panel = $.const(ex.experimentPrecomputed.fn() as ExprType<UIComponentType>);
        const rows = $.const(panel.unwrap().unwrap('Stack').children);
        // Each mini is a captioned Separator followed by its content, so the
        // panel has two children per merged example.
        $(Assert.equal(rows.size(), 4n));
        $(Assert.equal(rows.get(0n).unwrap().unwrap('Separator').label.unwrap('some').unwrap().unwrap('Text').value, 'PRECOMPUTED'));
        $(Assert.equal(rows.get(2n).unwrap().unwrap('Separator').label.unwrap('some').unwrap().unwrap('Text').value, 'READONLY PRECOMPUTED'));
    });

    test('experimentRefusals panel mounts one captioned row per merged example', $ => {
        const panel = $.const(ex.experimentRefusals.fn() as ExprType<UIComponentType>);
        const rows = $.const(panel.unwrap().unwrap('Stack').children);
        $(Assert.equal(rows.size(), 4n));
        $(Assert.equal(rows.get(0n).unwrap().unwrap('Separator').label.unwrap('some').unwrap().unwrap('Text').value, 'REFUSAL OVERLAP'));
        $(Assert.equal(rows.get(2n).unwrap().unwrap('Separator').label.unwrap('some').unwrap().unwrap('Text').value, 'REFUSAL NOT ESTIMABLE'));
    });

    test('Experiment.Component is declared as an optional EastUI component', $ => {
        $(Assert.equal(East.value(Experiment.Component.name), 'Experiment'));
        $(Assert.equal(East.value(Experiment.Component.optional), true));
    });

    // DRIFT GUARD — the render contract is deliberately REPLICATED (no shared
    // package) in e3-ui and east-py-datascience and unified by structural
    // equality across the boundary. These tests are the tripwire: a field added
    // on one side without its twin fails HERE (naming the drifted type), not in
    // a production decode.
    const contractPairs: [string, boolean][] = [
        ['Config', isTypeEqual(Experiment.Types.Config, Causal.Types.CausalExperimentConfigType)],
        ['Result', isTypeEqual(Experiment.Types.Result, Causal.Types.CausalExperimentResultType)],
        ['Ci', isTypeEqual(Experiment.Types.Ci, Causal.Types.CiType)],
        ['Balance', isTypeEqual(Experiment.Types.Balance, Causal.Types.BalanceRowType)],
        ['SensitivityBenchmark', isTypeEqual(Experiment.Types.SensitivityBenchmark, Causal.Types.SensitivityBenchmarkType)],
        ['Overlap', isTypeEqual(Experiment.Types.Overlap, Causal.Types.OverlapDiagnosticType)],
        ['Refutation', isTypeEqual(Experiment.Types.Refutation, Causal.Types.RefutationType)],
        ['DoseResponse', isTypeEqual(Experiment.Types.DoseResponse, Causal.Types.DoseResponseType)],
        ['Verdict', isTypeEqual(Experiment.Types.Verdict, Causal.Types.ExperimentVerdictType)],
        ['VerdictReason', isTypeEqual(Experiment.Types.VerdictReason, Causal.Types.VerdictReasonType)],
        ['Design', isTypeEqual(Experiment.Types.Design, Causal.Types.ExperimentDesignType)],
        ['DesignConfig', isTypeEqual(Experiment.Types.DesignConfig, Causal.Types.DesignConfigType)],
    ];
    for (const [name, equal] of contractPairs) {
        test(`contract drift guard: ${name} is structurally identical to the east-py-datascience twin`, $ => {
            $(Assert.equal(East.value(equal), true));
        });
    }

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
