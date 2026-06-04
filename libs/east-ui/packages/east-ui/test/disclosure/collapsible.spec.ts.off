/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Collapsible, Text } from "@elaraai/east-ui";
import * as ex from "./collapsible.examples.js";

describeEast("Collapsible", (test) => {
    Assert.examples(test, {
        collapsibleWhy: ex.collapsibleWhy,
        collapsibleDefaultOpen: ex.collapsibleDefaultOpen,
        collapsibleReactive: ex.collapsibleReactive,
        collapsibleBranded: ex.collapsibleBranded,
    });

    test("creates collapsible with string trigger (coerced to Text.Root)", $ => {
        const c = $.let(Collapsible.Root("Toggle", Text.Root("Content")));
        const v = c.unwrap().unwrap("Collapsible");
        $(Assert.equal(v.trigger.unwrap().unwrap("Text").value, "Toggle"));
        $(Assert.equal(v.content.unwrap().unwrap("Text").value, "Content"));
        $(Assert.equal(v.defaultOpen.hasTag("none"), true));
        $(Assert.equal(v.onOpenChange.hasTag("none"), true));
        $(Assert.equal(v.style.hasTag("none"), true));
    });

    test("creates collapsible with rich UIComp trigger", $ => {
        const c = $.let(Collapsible.Root(
            Text.Root("Rich", { fontWeight: "bold" }),
            Text.Root("Body"),
        ));
        $(Assert.equal(
            c.unwrap().unwrap("Collapsible").trigger.unwrap().unwrap("Text").value,
            "Rich",
        ));
    });

    test("creates collapsible with defaultOpen true", $ => {
        const c = $.let(Collapsible.Root("Open", Text.Root("Content"), { defaultOpen: true }));
        $(Assert.equal(c.unwrap().unwrap("Collapsible").defaultOpen.unwrap("some"), true));
    });

    test("creates collapsible with defaultOpen false", $ => {
        const c = $.let(Collapsible.Root("Open", Text.Root("Content"), { defaultOpen: false }));
        $(Assert.equal(c.unwrap().unwrap("Collapsible").defaultOpen.unwrap("some"), false));
    });

    test("creates collapsible with full colour escape hatches", $ => {
        const c = $.let(Collapsible.Root("T", Text.Root("C"), {
            style: {
                background: "#ffffff",
                borderColor: "#e5e7eb",
                triggerColor: "#1a2234",
                contentColor: "#374151",
            },
        }));
        const s = c.unwrap().unwrap("Collapsible").style.unwrap("some");
        $(Assert.equal(s.background.unwrap("some"), "#ffffff"));
        $(Assert.equal(s.borderColor.unwrap("some"), "#e5e7eb"));
        $(Assert.equal(s.triggerColor.unwrap("some"), "#1a2234"));
        $(Assert.equal(s.contentColor.unwrap("some"), "#374151"));
    });
}, { platformFns: TestImpl });
