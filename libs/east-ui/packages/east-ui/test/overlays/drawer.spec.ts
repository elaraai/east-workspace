/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import * as ex from "./drawer.examples.js";

describeEast("Drawer", (test) => {
    Assert.examples(test, {
        drawerRight: ex.drawerRight,
        drawerLeft: ex.drawerLeft,
        drawerInteractive: ex.drawerInteractive,
        drawerProgrammatic: ex.drawerProgrammatic,
        drawerStackedNested: ex.drawerStackedNested,
        drawerFlush: ex.drawerFlush,
    });
}, { platformFns: TestImpl });
