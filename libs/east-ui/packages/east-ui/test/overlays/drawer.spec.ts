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

    test("drawerVariants panel mounts one captioned row per merged example", $ => {
        const panel = $.const(ex.drawerVariants.fn() as ExprType<UIComponentType>);
        const rows = $.const(panel.unwrap().unwrap("Stack").children);
        $(Assert.equal(rows.size(), 6n));
        $(Assert.equal(rows.get(0n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "LEFT"));
        $(Assert.equal(rows.get(2n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "FLUSH"));
        $(Assert.equal(rows.get(4n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "INTERACTIVE"));
    });
}, { platformFns: TestImpl });
