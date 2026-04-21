/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import * as ex from "./sales-dashboard.examples.js";

describeEast("SalesDashboard", (test) => {
    Assert.examples(test, {
        salesDashboardComplex: ex.salesDashboardComplex,
    });
}, { platformFns: TestImpl });
