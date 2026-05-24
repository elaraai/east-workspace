/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import * as ex from "./toggle-tip.examples.js";

describeEast("ToggleTip", (test) => {
    Assert.examples(test, {
        toggleTipBasic: ex.toggleTipBasic,
        toggleTipInfo: ex.toggleTipInfo,
    });
}, { platformFns: TestImpl });
