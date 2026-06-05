/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Banner, Text, Button } from "@elaraai/east-ui";
import * as ex from "./banner.examples.js";

describeEast("Banner", (test) => {
    Assert.examples(test, {
        bannerStaleData: ex.bannerStaleData,
        bannerFrozenScenario: ex.bannerFrozenScenario,
        bannerRunWarnings: ex.bannerRunWarnings,
        bannerDismissible: ex.bannerDismissible,
    });

    test("creates banner with string title + status (coerced)", $ => {
        const b = $.let(Banner.Root({ status: "warning", title: "Heads up" }));
        const v = b.unwrap().unwrap("Banner");
        $(Assert.equal(v.status.hasTag("warning"), true));
        $(Assert.equal(v.title.unwrap().unwrap("Text").value, "Heads up"));
    });

    test("creates banner with rich UIComp title", $ => {
        const b = $.let(Banner.Root({ status: "info", title: Text.Root("Rich", { fontWeight: "bold" }) }));
        $(Assert.equal(
            b.unwrap().unwrap("Banner").title.unwrap().unwrap("Text").value,
            "Rich",
        ));
    });

    // §0.3 paired-icon
    test("injects paired warning icon", $ => {
        const b = $.let(Banner.Root({ status: "warning", title: "Warn" }));
        $(Assert.equal(b.unwrap().unwrap("Banner").icon.unwrap("some").name, "triangle-exclamation"));
    });

    test("explicit icon overrides paired default", $ => {
        const b = $.let(Banner.Root({ status: "info", title: "Ship", icon: { prefix: "fas", name: "truck" } }));
        $(Assert.equal(b.unwrap().unwrap("Banner").icon.unwrap("some").name, "truck"));
    });

    test("showIcon: false opts out of paired default", $ => {
        const b = $.let(Banner.Root({ status: "success", title: "OK", showIcon: false }));
        $(Assert.equal(b.unwrap().unwrap("Banner").icon.hasTag("none"), true));
    });

    test("creates banner with neutral status (new)", $ => {
        const b = $.let(Banner.Root({ status: "neutral", title: "Draft" }));
        $(Assert.equal(b.unwrap().unwrap("Banner").status.hasTag("neutral"), true));
        $(Assert.equal(b.unwrap().unwrap("Banner").icon.unwrap("some").name, "circle"));
    });

    test("creates banner with description", $ => {
        const b = $.let(Banner.Root({ status: "warning", title: "T", description: "Details here." }));
        $(Assert.equal(
            b.unwrap().unwrap("Banner").description.unwrap("some").unwrap().unwrap("Text").value,
            "Details here.",
        ));
    });

    test("creates banner with actions", $ => {
        const b = $.let(Banner.Root({ status: "warning", title: "T", actions: Button.Root("Refresh") }));
        $(Assert.equal(
            b.unwrap().unwrap("Banner").actions.unwrap("some").unwrap().unwrap("Button").label.unwrap().unwrap("Text").value,
            "Refresh",
        ));
    });

    test("creates dismissible banner", $ => {
        const b = $.let(Banner.Root({ status: "info", title: "Hi", dismissible: true }));
        $(Assert.equal(b.unwrap().unwrap("Banner").dismissible.unwrap("some"), true));
    });

    test("creates banner with all style slots", $ => {
        const b = $.let(Banner.Root({ status: "info", title: "T",
            variant: "subtle",
            size: "md",
            color: "#111827",
            background: "#eff6ff",
            borderColor: "#bfdbfe",
            iconColor: "#2563eb",
            accentColor: "#2563eb",
        }));
        const s = b.unwrap().unwrap("Banner").style.unwrap("some");
        $(Assert.equal(s.variant.unwrap("some").hasTag("subtle"), true));
        $(Assert.equal(s.size.unwrap("some").hasTag("md"), true));
        $(Assert.equal(s.color.unwrap("some"), "#111827"));
        $(Assert.equal(s.background.unwrap("some"), "#eff6ff"));
        $(Assert.equal(s.borderColor.unwrap("some"), "#bfdbfe"));
        $(Assert.equal(s.iconColor.unwrap("some"), "#2563eb"));
        $(Assert.equal(s.accentColor.unwrap("some"), "#2563eb"));
    });
}, { platformFns: TestImpl });
