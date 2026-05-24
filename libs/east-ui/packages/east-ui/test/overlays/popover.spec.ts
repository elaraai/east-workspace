/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import * as ex from "./popover.examples.js";

describeEast("Popover", (test) => {
    Assert.examples(test, {
        popoverBasic: ex.popoverBasic,
        popoverChart: ex.popoverChart,
    });
}, { platformFns: TestImpl });
