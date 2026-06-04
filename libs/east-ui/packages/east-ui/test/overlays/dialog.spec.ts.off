/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import * as ex from "./dialog.examples.js";

describeEast("Dialog", (test) => {
    Assert.examples(test, {
        dialogBasic: ex.dialogBasic,
        dialogLarge: ex.dialogLarge,
        dialogInteractive: ex.dialogInteractive,
        dialogProgrammatic: ex.dialogProgrammatic,
    });
}, { platformFns: TestImpl });
