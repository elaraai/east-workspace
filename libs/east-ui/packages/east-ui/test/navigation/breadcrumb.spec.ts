/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import * as ex from "./breadcrumb.examples.js";

describeEast("Breadcrumb", (test) => {
    Assert.examples(test, {
        breadcrumbPlain: ex.breadcrumbPlain,
        breadcrumbUnderline: ex.breadcrumbUnderline,
        breadcrumbSizes: ex.breadcrumbSizes,
        breadcrumbColors: ex.breadcrumbColors,
        breadcrumbInteractive: ex.breadcrumbInteractive,
    });
}, { platformFns: TestImpl });
