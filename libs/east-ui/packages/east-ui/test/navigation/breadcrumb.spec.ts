/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { type ExprType } from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { none } from "@elaraai/east";
import { Breadcrumb } from "@elaraai/east-ui/internal";
import { UIComponentType } from "@elaraai/east-ui";
import * as ex from "./breadcrumb.examples.js";

describeEast("Breadcrumb", (test) => {
    Assert.examples(test, {
        breadcrumbBasic: ex.breadcrumbBasic,
        breadcrumbVariants: ex.breadcrumbVariants,
    });

    test("breadcrumbVariants is the live configurator", $ => {
        const panel = $.const(ex.breadcrumbVariants.fn() as ExprType<UIComponentType>);
        $(Assert.equal(panel.unwrap().hasTag("ReactiveComponent"), true));
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
