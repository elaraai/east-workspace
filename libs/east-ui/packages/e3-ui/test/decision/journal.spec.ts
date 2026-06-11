/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import * as ex from "./journal.examples.js";

describeEast("DecisionJournal", (test) => {
    Assert.examples(test, {
        decisionJournalResolved: ex.decisionJournalResolved,
        decisionJournalScroll: ex.decisionJournalScroll,
    });
}, { platformFns: TestImpl });
