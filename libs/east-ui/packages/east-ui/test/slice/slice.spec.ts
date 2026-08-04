/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { type ExprType } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import * as ex from "./slice.examples.js";

// Use-case documents for the slice composition model. Each returns
// `UIComponentType`, so `Assert.examples` checks they compile + evaluate.
describeEast("Slice", (test) => {
    Assert.examples(test, {
        sliceTableChrome:          ex.sliceTableChrome,
        sliceChartChrome:          ex.sliceChartChrome,
        sliceRail:                 ex.sliceRail,
        sliceNarrow:               ex.sliceNarrow,
        sliceGanttChrome:          ex.sliceGanttChrome,
        sliceExpressiveFilters:    ex.sliceExpressiveFilters,
        sliceCrossFilterDashboard: ex.sliceCrossFilterDashboard,
    });

    // =========================================================================
    // Panels — every merged example stays mounted as a captioned row (#463).
    // =========================================================================

    test("sliceRail panel mounts one captioned row per merged example", $ => {
        const panel = $.const(ex.sliceRail.fn() as ExprType<UIComponentType>);
        const rows = $.const(panel.unwrap().unwrap("Stack").children);
        $(Assert.equal(rows.size(), 6n));
        $(Assert.equal(rows.get(0n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "MULTI-CONSUMER RAIL"));
        $(Assert.equal(rows.get(2n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "BRUSH DATETIME"));
        $(Assert.equal(rows.get(4n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "BRUSH CURRENCY"));
    });

    test("sliceExpressiveFilters panel mounts one captioned row per merged example", $ => {
        const panel = $.const(ex.sliceExpressiveFilters.fn() as ExprType<UIComponentType>);
        const rows = $.const(panel.unwrap().unwrap("Stack").children);
        $(Assert.equal(rows.size(), 6n));
        $(Assert.equal(rows.get(0n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "EXPRESSIVE FILTERS"));
        $(Assert.equal(rows.get(2n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "PRESETS RAIL"));
        $(Assert.equal(rows.get(4n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "PRESETS BAR"));
    });
}, { platformFns: TestImpl });
