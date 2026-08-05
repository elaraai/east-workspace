/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { type ExprType } from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Collapsible, Text } from "@elaraai/east-ui/internal";
import { UIComponentType } from "@elaraai/east-ui";
import * as ex from "./collapsible.examples.js";

describeEast("Collapsible", (test) => {
    Assert.examples(test, {
        collapsibleWhy: ex.collapsibleWhy,
        collapsibleVariants: ex.collapsibleVariants,
    });

    test("collapsibleVariants is the live configurator", $ => {
        const panel = $.const(ex.collapsibleVariants.fn() as ExprType<UIComponentType>);
        $(Assert.equal(panel.unwrap().hasTag("ReactiveComponent"), true));
    });

    test("creates collapsible with string trigger (coerced to Text.Root)", $ => {
        const c = $.let(Collapsible.Root(Text.Root("Content"), { trigger: "Toggle" }));
        const v = c.unwrap().unwrap("Collapsible");
        $(Assert.equal(v.trigger.unwrap().unwrap("Text").value, "Toggle"));
        $(Assert.equal(v.content.unwrap().unwrap("Text").value, "Content"));
        $(Assert.equal(v.defaultOpen.hasTag("none"), true));
        $(Assert.equal(v.onOpenChange.hasTag("none"), true));
        $(Assert.equal(v.style.hasTag("none"), true));
    });

    test("creates collapsible with rich UIComp trigger", $ => {
        const c = $.let(Collapsible.Root(
            Text.Root("Body"),
            { trigger: Text.Root("Rich", { fontWeight: "bold" }) },
        ));
        $(Assert.equal(
            c.unwrap().unwrap("Collapsible").trigger.unwrap().unwrap("Text").value,
            "Rich",
        ));
    });

    test("creates collapsible with defaultOpen true", $ => {
        const c = $.let(Collapsible.Root(Text.Root("Content"), { trigger: "Open", defaultOpen: true }));
        $(Assert.equal(c.unwrap().unwrap("Collapsible").defaultOpen.unwrap("some"), true));
    });

    test("creates collapsible with defaultOpen false", $ => {
        const c = $.let(Collapsible.Root(Text.Root("Content"), { trigger: "Open", defaultOpen: false }));
        $(Assert.equal(c.unwrap().unwrap("Collapsible").defaultOpen.unwrap("some"), false));
    });

    test("creates collapsible with full colour escape hatches", $ => {
        const c = $.let(Collapsible.Root(Text.Root("C"), { trigger: "T",
            background: "bg.surface",
            borderColor: "border.subtle",
            triggerColor: "fg.default",
            contentColor: "fg.default",
        }));
        const s = c.unwrap().unwrap("Collapsible").style.unwrap("some");
        $(Assert.equal(s.background.unwrap("some"), "bg.surface"));
        $(Assert.equal(s.borderColor.unwrap("some"), "border.subtle"));
        $(Assert.equal(s.triggerColor.unwrap("some"), "fg.default"));
        $(Assert.equal(s.contentColor.unwrap("some"), "fg.default"));
    });
}, { platformFns: TestImpl });
