/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { type ExprType } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import * as ex from "./drawer.examples.js";

describeEast("Drawer", (test) => {
    Assert.examples(test, {
        drawerBasic: ex.drawerBasic,
        drawerProgrammatic: ex.drawerProgrammatic,
        drawerStackedNested: ex.drawerStackedNested,
        drawerVariants: ex.drawerVariants,
    });

    // =========================================================================
    // Panels — every merged example stays mounted as a captioned row (#463).
    // =========================================================================

    test("drawerVariants drives its preview from inline option tables", $ => {
        // Everything the configurator needs — the placement and body-preset
        // tables plus the onOpenChange counter — is declared inside the
        // example body, because the documentation capture only extracts `fn`.
        // That puts the tables inside the Reactive body, which TestImpl does
        // not execute, so they cannot be asserted from here; `Assert.examples`
        // above still compiles and evaluates the outer function. Per-option
        // coverage stays with the remaining Drawer examples, which construct
        // each shape directly.
        const panel = $.const(ex.drawerVariants.fn() as ExprType<UIComponentType>);
        $(Assert.equal(panel.unwrap().hasTag("ReactiveComponent"), true));
    });
}, { platformFns: TestImpl });
