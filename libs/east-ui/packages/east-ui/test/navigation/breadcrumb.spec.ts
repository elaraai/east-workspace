/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { none } from "@elaraai/east";
import { Breadcrumb } from "@elaraai/east-ui/internal";
import * as ex from "./breadcrumb.examples.js";

describeEast("Breadcrumb", (test) => {
    Assert.examples(test, {
        breadcrumbBasic: ex.breadcrumbBasic,
        breadcrumbRunAnchor: ex.breadcrumbRunAnchor,
        breadcrumbLeadingSeparator: ex.breadcrumbLeadingSeparator,
        breadcrumbInteractive: ex.breadcrumbInteractive,
    });

    test("leadingSeparator round-trips", $ => {
        const r = $.let(Breadcrumb.Root([{ label: "a", current: none, onClick: none }], { leadingSeparator: true }));
        $(Assert.equal(r.unwrap().unwrap("Breadcrumb").style.unwrap("some").leadingSeparator.unwrap("some"), true));
    });

    test("leadingSeparator absent when not set", $ => {
        const r = $.let(Breadcrumb.Root([{ label: "a", current: none, onClick: none }]));
        $(Assert.equal(r.unwrap().unwrap("Breadcrumb").style.hasTag("none"), true));
    });
}, { platformFns: TestImpl });
