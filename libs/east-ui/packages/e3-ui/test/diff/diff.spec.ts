/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { East, FloatType, type ExprType } from "@elaraai/east";
import { Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import { Data } from "@elaraai/e3-ui";
import { Diff } from "@elaraai/e3-ui/internal";
import * as e3 from "@elaraai/e3";
import * as ex from "./diff.examples.js";

const policyInput = e3.input("policy_spec", FloatType, 0.0);

describeEast("Diff", (test) => {
    Assert.examples(test, {
        workforcePolicyEditor: ex.workforcePolicyEditor,
        diffEditorVariants: ex.diffEditorVariants,
        rosterTableEditor: ex.rosterTableEditor,
        diffDefaults: ex.diffDefaults,
        mergeConflictDemo: ex.mergeConflictDemo,
        diffOverlayVariants: ex.diffOverlayVariants,
        diffStagedPatchVariants: ex.diffStagedPatchVariants,
    });

    // Panels — every merged example stays mounted as a captioned row (#464).
    // The mono-uppercase Text captions are the stable per-mini anchors.

    test("diffEditorVariants panel mounts one captioned row per merged example", $ => {
        const panel = $.const(ex.diffEditorVariants.fn() as ExprType<UIComponentType>);
        const rows = $.const(panel.unwrap().unwrap("Stack").children);
        $(Assert.equal(rows.size(), 7n));
        $(Assert.equal(rows.get(0n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "SERVICE CONFIG FORM"));
        $(Assert.equal(rows.get(1n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "PRICING RULES"));
        $(Assert.equal(rows.get(2n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "FEATURE FLAGS"));
        $(Assert.equal(rows.get(3n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "REGIONAL PRICING"));
        $(Assert.equal(rows.get(4n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "DEPLOYMENT STATUS"));
        $(Assert.equal(rows.get(5n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "PRICING RULES COMPACT"));
        $(Assert.equal(rows.get(6n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "PRICING RULES CONDENSED"));
    });

    test("diffOverlayVariants panel mounts one captioned row per merged example", $ => {
        const panel = $.const(ex.diffOverlayVariants.fn() as ExprType<UIComponentType>);
        const rows = $.const(panel.unwrap().unwrap("Stack").children);
        $(Assert.equal(rows.size(), 4n));
        $(Assert.equal(rows.get(0n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "POLICY OVERLAY"));
        $(Assert.equal(rows.get(1n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "REGIONAL PRICING OVERLAY DRIFT"));
        $(Assert.equal(rows.get(2n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "ROSTER OVERLAY DRIFT"));
        $(Assert.equal(rows.get(3n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "ROSTER TABLE OVERLAY"));
    });

    test("diffStagedPatchVariants panel mounts one captioned row per merged example", $ => {
        const panel = $.const(ex.diffStagedPatchVariants.fn() as ExprType<UIComponentType>);
        const rows = $.const(panel.unwrap().unwrap("Stack").children);
        $(Assert.equal(rows.size(), 2n));
        $(Assert.equal(rows.get(0n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "POLICY STAGED PATCH"));
        $(Assert.equal(rows.get(1n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "ROSTER STAGED PATCH"));
    });

    test("Diff.Component is declared as an optional EastUI component", $ => {
        $(Assert.equal(East.value(Diff.Component.name), "Diff"));
        $(Assert.equal(East.value(Diff.Component.optional), true));
    });

    test("Diff.Root produces a ReactiveComponent-tagged UIComponentType", $ => {
        const tree = $.let(
            Reactive.Root(East.function([], UIComponentType, $ => {
                const view = $.let(Data.bind(policyInput, { mode: "staged" }));
                return Diff.Root({ bindings: [view.binding] });
            })),
            UIComponentType,
        );
        $(Assert.equal(tree.unwrap().getTag(), "ReactiveComponent"));
    });
}, { platformFns: TestImpl });
