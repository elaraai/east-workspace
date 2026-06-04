/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { East, NullType } from "@elaraai/east";
import { Clipboard } from "@elaraai/east-ui";
import * as ex from "./clipboard.examples.js";

describeEast("Clipboard", (test) => {
    Assert.examples(test, {
        clipboardCopyButton: ex.clipboardCopyButton,
        clipboardCopyReactive: ex.clipboardCopyReactive,
    });

    test("Clipboard.copy compiles inside an East callback", $ => {
        const fn = East.function([], NullType, $ => {
            $(Clipboard.copy("hello"));
        });
        const value = $.let(East.value("ok"));
        $(Assert.equal(value, "ok"));
        // fn is referenced so it isn't tree-shaken; if it failed to type-check
        // the file wouldn't compile.
        void fn;
    });
}, { platformFns: TestImpl });
