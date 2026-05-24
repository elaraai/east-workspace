/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { SliceApplyImpl } from "@elaraai/east-ui";
import * as ex from "./slice.examples.js";

// The Slice.* UI examples — affordances, the reflowing Slice.Frame, and the
// slice-bound visx charts. Each returns `UIComponentType`, so `Assert.examples`
// compiles it to East IR (the body is not executed); this guards the public
// `Slice.Frame` / `Slice.Chart` / affordance APIs against silent breakage and
// feeds the example index. `[...TestImpl, ...SliceApplyImpl]` mirrors the
// platform set the non-UI `Slice` spec uses.
describeEast("Slice UI", (test) => {
    Assert.examples(test, {
        // Affordances (standalone / focused density)
        sliceSummary:      ex.sliceSummary,
        sliceRange:        ex.sliceRange,
        sliceFilter:       ex.sliceFilter,
        sliceBreakdown:    ex.sliceBreakdown,
        sliceLegend:       ex.sliceLegend,
        sliceSearch:       ex.sliceSearch,
        sliceCohort:       ex.sliceCohort,
        // Slice.Frame — reflowing eyebrow + collapse
        sliceComposed:     ex.sliceComposed,
        sliceFrameNarrow:  ex.sliceFrameNarrow,
        sliceFrameFaceted: ex.sliceFrameFaceted,
        sliceFrameFull:    ex.sliceFrameFull,
        // Slice.Chart — one coloured series per breakdown, every mark + axis kind
        sliceChartFrame:   ex.sliceChartFrame,
        sliceChartBar:     ex.sliceChartBar,
        sliceChartArea:    ex.sliceChartArea,
        sliceChartScatter: ex.sliceChartScatter,
        sliceChartTime:    ex.sliceChartTime,
        sliceChartLinearX: ex.sliceChartLinearX,
    });
}, { platformFns: [...TestImpl, ...SliceApplyImpl] });
