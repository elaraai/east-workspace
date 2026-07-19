/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import * as ex from "./app.examples.js";

describeEast("App", (test) => {
    // The example compiles + evaluates to valid UIComponentType IR: the config-
    // derived rail (NavList), the nav.path() breadcrumb, and the <Pages> body are
    // all built from the one handle bound in the enclosing Reactive.
    Assert.examples(test, {
        appBasic: ex.appBasic,
    });

    // `<App>` composes the navigation primitives; the `appBasic` example (wired
    // above) exercises the full build — rail + breadcrumb + routed body from a
    // single Navigation.bind handle, with config-driven rail icons/sections.
}, { platformFns: TestImpl });
