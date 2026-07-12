/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import * as ex from "./aligned-stack.examples.js";

describeEast("AlignedStack", (test) => {
    // Compiling each example validates the AlignedStack IR — the `gutter`
    // (fixed{left,right} / auto) + children encode + round-trip as valid East IR.
    Assert.examples(test, {
        alignedStackCharts: ex.alignedStackCharts,
        alignedStackChartTrace: ex.alignedStackChartTrace,
        alignedStackChartCalendar: ex.alignedStackChartCalendar,
        alignedStackChartMatrix: ex.alignedStackChartMatrix,
        alignedStackChartTable: ex.alignedStackChartTable,
        alignedStackChartPlanner: ex.alignedStackChartPlanner,
        alignedStackChartTitles: ex.alignedStackChartTitles,
        alignedStackDateAxis: ex.alignedStackDateAxis,
        alignedStackLibraryDnd: ex.alignedStackLibraryDnd,
        alignedStackChartGantt: ex.alignedStackChartGantt,
        alignedStackAll: ex.alignedStackAll,
        alignedStackAllCompact: ex.alignedStackAllCompact,
        alignedStackAllCondensed: ex.alignedStackAllCondensed,
        alignedStackAuto: ex.alignedStackAuto,
    });
}, { platformFns: TestImpl });
