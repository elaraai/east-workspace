/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { type ExprType } from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { UIComponentType } from "@elaraai/east-ui";
import * as ex from "./dialog.examples.js";

describeEast("Dialog", (test) => {
    Assert.examples(test, {
        dialogBasic: ex.dialogBasic,
        dialogProgrammatic: ex.dialogProgrammatic,
        dialogVariants: ex.dialogVariants,
    });

    test("dialogVariants is the live configurator", $ => {
        const panel = $.const(ex.dialogVariants.fn() as ExprType<UIComponentType>);
        $(Assert.equal(panel.unwrap().hasTag("ReactiveComponent"), true));
    });
}, { platformFns: TestImpl });
