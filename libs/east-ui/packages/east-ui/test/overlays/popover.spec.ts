/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { type ExprType } from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { UIComponentType } from "@elaraai/east-ui";
import * as ex from "./popover.examples.js";

describeEast("Popover", (test) => {
    Assert.examples(test, {
        popoverBasic: ex.popoverBasic,
        popoverVariants: ex.popoverVariants,
    });

    test("popoverVariants is the live configurator", $ => {
        const panel = $.const(ex.popoverVariants.fn() as ExprType<UIComponentType>);
        $(Assert.equal(panel.unwrap().hasTag("ReactiveComponent"), true));
    });
}, { platformFns: TestImpl });
