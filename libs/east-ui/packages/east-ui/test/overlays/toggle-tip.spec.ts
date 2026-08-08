/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { type ExprType } from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { UIComponentType } from "@elaraai/east-ui";
import * as ex from "./toggle-tip.examples.js";

describeEast("ToggleTip", (test) => {
    Assert.examples(test, {
        toggleTipBasic: ex.toggleTipBasic,
        toggleTipVariants: ex.toggleTipVariants,
    });

    test("toggleTipVariants is the live configurator", $ => {
        const panel = $.const(ex.toggleTipVariants.fn() as ExprType<UIComponentType>);
        $(Assert.equal(panel.unwrap().hasTag("ReactiveComponent"), true));
    });
}, { platformFns: TestImpl });
