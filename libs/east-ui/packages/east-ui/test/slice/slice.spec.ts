/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import * as ex from "./slice.examples.js";

// Use-case documents for the slice composition model. Each returns
// `UIComponentType`, so `Assert.examples` checks they compile + evaluate.
describeEast("Slice", (test) => {
    Assert.examples(test, {
        sliceTableChrome:          ex.sliceTableChrome,
        sliceChartChrome:          ex.sliceChartChrome,
        sliceRail:                 ex.sliceRail,
        sliceNarrow:               ex.sliceNarrow,
        slicePresetsBar:           ex.slicePresetsBar,
        sliceCrossFilterDashboard: ex.sliceCrossFilterDashboard,
        sliceExpressiveFilters:    ex.sliceExpressiveFilters,
        sliceGanttChrome:          ex.sliceGanttChrome,
    });
}, { platformFns: TestImpl });
