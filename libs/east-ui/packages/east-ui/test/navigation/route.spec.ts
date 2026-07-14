/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import * as ex from "./route.examples.js";

describeEast("Route", (test) => {
    // Both examples compile + evaluate to valid UIComponentType IR — the
    // handle bound in the enclosing Reactive, a Route slot (and, in the shell
    // example, the body Pages) sharing it. Building a Route requires a bound
    // nav handle, so structural assertions live in the examples; the Page
    // constructor mechanics are covered by the Pages spec.
    Assert.examples(test, {
        routeBasic: ex.routeBasic,
        routeSidebarSlot: ex.routeSidebarSlot,
    });
}, { platformFns: TestImpl });
