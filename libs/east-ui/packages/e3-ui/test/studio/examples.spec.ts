/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import * as component from "./component.examples.js";
import * as page from "./page.examples.js";
import * as studio from "./studio.examples.js";
import * as tiles from "./tiles.examples.js";

describeEast("Studio examples (#991–#1000, #1669, #1671, #1672, #1692)", (test) => {
    Assert.examples(test, {
        studioComponent: component.studioComponent,
        studioPage: page.studioPage,
        studioBuilder: studio.studioBuilder,
        studioBuilderMobile: studio.studioBuilderMobile,
        studioLibrary: studio.studioLibrary,
        studioOpsConsole: studio.studioOpsConsole,
        studioConflicts: studio.studioConflicts,
        studioContent: studio.studioContent,
        studioVisuals: studio.studioVisuals,
        studioChartOptions: studio.studioChartOptions,
        studioClicks: studio.studioClicks,
        studioKpiSizes: tiles.studioKpiSizes,
    });
}, { platformFns: TestImpl });
