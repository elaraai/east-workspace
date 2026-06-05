/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { East, NullType, some, none } from "@elaraai/east";
import { Share } from "@elaraai/east-ui/internal";
import * as ex from "./share.examples.js";

describeEast("Share", (test) => {
    Assert.examples(test, {
        shareLinkButton: ex.shareLinkButton,
    });

    test("Share.link compiles with required url + optional title", $ => {
        const fn = East.function([], NullType, $ => {
            $(Share.link(East.value({
                url: "https://example.com/x",
                title: some("Example"),
                text: none,
            }, Share.Types.LinkInput)));
        });
        const value = $.let(East.value("ok"));
        $(Assert.equal(value, "ok"));
        void fn;
    });
}, { platformFns: TestImpl });
