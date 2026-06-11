/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import * as ex from "./loop.examples.js";

describeEast("Decision loop (handle)", (test) => {
    Assert.examples(test, {
        decisionLoop: ex.decisionLoop,
    });
}, { platformFns: TestImpl });
