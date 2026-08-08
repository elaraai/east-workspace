/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { type ExprType } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui/internal";
import * as ex from "./queue.examples.js";

describeEast("DecisionQueue", (test) => {
    Assert.examples(test, {
        decisionQueueCase: ex.decisionQueueCase,
        decisionQueueJudgement: ex.decisionQueueJudgement,
        decisionQueueFacetVariants: ex.decisionQueueFacetVariants,
        decisionQueueSizing: ex.decisionQueueSizing,
        decisionQueueSlice: ex.decisionQueueSlice,
        decisionQueueGrouped: ex.decisionQueueGrouped,
    });

    // Panels — every merged example stays mounted as a captioned row (#464).
    // The mono-uppercase Text captions are the stable per-mini anchors.

    test("decisionQueueFacetVariants panel mounts one captioned row per merged example", $ => {
        const panel = $.const(ex.decisionQueueFacetVariants.fn() as ExprType<UIComponentType>);
        const rows = $.const(panel.unwrap().unwrap("Stack").children);
        $(Assert.equal(rows.size(), 6n));
        $(Assert.equal(rows.get(0n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "FACETS"));
        $(Assert.equal(rows.get(2n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "VALUE AXIS"));
        $(Assert.equal(rows.get(4n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "OPTIONS"));
    });

    test("decisionQueueSizing panel mounts one captioned row per merged example", $ => {
        const panel = $.const(ex.decisionQueueSizing.fn() as ExprType<UIComponentType>);
        const rows = $.const(panel.unwrap().unwrap("Stack").children);
        $(Assert.equal(rows.size(), 4n));
        $(Assert.equal(rows.get(0n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "NARROW"));
        $(Assert.equal(rows.get(2n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "SCROLL"));
    });
}, { platformFns: TestImpl });
