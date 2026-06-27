/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import * as ex from "./queue.examples.js";

describeEast("DecisionQueue", (test) => {
    Assert.examples(test, {
        decisionQueueCase: ex.decisionQueueCase,
        decisionQueueJudgement: ex.decisionQueueJudgement,
        decisionQueueFacets: ex.decisionQueueFacets,
        decisionQueueValueAxis: ex.decisionQueueValueAxis,
        decisionQueueOptions: ex.decisionQueueOptions,
        decisionQueueNarrow: ex.decisionQueueNarrow,
        decisionQueueScroll: ex.decisionQueueScroll,
        decisionQueueSlice: ex.decisionQueueSlice,
    });
}, { platformFns: TestImpl });
