/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { East, FloatType } from "@elaraai/east";
import { Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import { Data } from "@elaraai/e3-ui";
import { Diff } from "@elaraai/e3-ui/internal";
import * as e3 from "@elaraai/e3";
import * as ex from "./diff.examples.js";

const policyInput = e3.input("policy_spec", FloatType, 0.0);

describeEast("Diff", (test) => {
    Assert.examples(test, {
        workforcePolicyEditor: ex.workforcePolicyEditor,
        serviceConfigForm: ex.serviceConfigForm,
        rosterTableEditor: ex.rosterTableEditor,
        pricingRulesEditor: ex.pricingRulesEditor,
        featureFlagsEditor: ex.featureFlagsEditor,
        regionalPricingEditor: ex.regionalPricingEditor,
        deploymentStatusEditor: ex.deploymentStatusEditor,
        diffDefaults: ex.diffDefaults,
        mergeConflictDemo: ex.mergeConflictDemo,
        pricingRulesEditorCompact: ex.pricingRulesEditorCompact,
        pricingRulesEditorCondensed: ex.pricingRulesEditorCondensed,
        policyOverlayEditor: ex.policyOverlayEditor,
        rosterTableEditorOverlay: ex.rosterTableEditorOverlay,
        regionalPricingOverlayDrift: ex.regionalPricingOverlayDrift,
        rosterOverlayDrift: ex.rosterOverlayDrift,
        policyStagedPatchEditor: ex.policyStagedPatchEditor,
        rosterStagedPatchEditor: ex.rosterStagedPatchEditor,
    });

    test("Diff.Component is declared as an optional EastUI component", $ => {
        $(Assert.equal(East.value(Diff.Component.name), "Diff"));
        $(Assert.equal(East.value(Diff.Component.optional), true));
    });

    test("Diff.Root produces a ReactiveComponent-tagged UIComponentType", $ => {
        const tree = $.let(
            Reactive.Root(East.function([], UIComponentType, $ => {
                const view = $.let(Data.bind(policyInput));
                return Diff.Root({ bindings: [view.binding] });
            })),
            UIComponentType,
        );
        $(Assert.equal(tree.unwrap().getTag(), "ReactiveComponent"));
    });
}, { platformFns: TestImpl });
