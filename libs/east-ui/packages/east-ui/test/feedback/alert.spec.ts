/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Alert, Text, Button } from "@elaraai/east-ui";
import * as ex from "./alert.examples.js";

describeEast("Alert", (test) => {
    Assert.examples(test, {
        alertInfo: ex.alertInfo,
        alertSuccess: ex.alertSuccess,
        alertWarning: ex.alertWarning,
        alertError: ex.alertError,
        alertNeutral: ex.alertNeutral,
        alertVariants: ex.alertVariants,
        alertTitleOnly: ex.alertTitleOnly,
        alertEmbeddedInput: ex.alertEmbeddedInput,
        alertWithActions: ex.alertWithActions,
        alertDismissible: ex.alertDismissible,
        alertInteractive: ex.alertInteractive,
    });

    // =========================================================================
    // Basic status variants
    // =========================================================================

    test("creates info alert", $ => {
        const a = $.let(Alert.Root("info"));
        const v = a.unwrap().unwrap("Alert");
        $(Assert.equal(v.status.hasTag("info"), true));
        $(Assert.equal(v.title.hasTag("none"), true));
        $(Assert.equal(v.description.hasTag("none"), true));
        $(Assert.equal(v.body.hasTag("none"), true));
        $(Assert.equal(v.actions.hasTag("none"), true));
        $(Assert.equal(v.closable.hasTag("none"), true));
    });

    test("creates neutral alert (NEW status)", $ => {
        const a = $.let(Alert.Root("neutral"));
        $(Assert.equal(a.unwrap().unwrap("Alert").status.hasTag("neutral"), true));
    });

    // =========================================================================
    // §0.3 paired-icon injection
    // =========================================================================

    test("injects paired circle-info icon for info", $ => {
        const a = $.let(Alert.Root("info"));
        const icon = a.unwrap().unwrap("Alert").icon.unwrap("some");
        $(Assert.equal(icon.name, "circle-info"));
    });

    test("injects paired triangle-exclamation icon for warning", $ => {
        const a = $.let(Alert.Root("warning"));
        $(Assert.equal(a.unwrap().unwrap("Alert").icon.unwrap("some").name, "triangle-exclamation"));
    });

    test("injects paired circle-check icon for success", $ => {
        const a = $.let(Alert.Root("success"));
        $(Assert.equal(a.unwrap().unwrap("Alert").icon.unwrap("some").name, "circle-check"));
    });

    test("injects paired circle-xmark icon for error", $ => {
        const a = $.let(Alert.Root("error"));
        $(Assert.equal(a.unwrap().unwrap("Alert").icon.unwrap("some").name, "circle-xmark"));
    });

    test("injects paired circle icon for neutral", $ => {
        const a = $.let(Alert.Root("neutral"));
        $(Assert.equal(a.unwrap().unwrap("Alert").icon.unwrap("some").name, "circle"));
    });

    test("explicit icon overrides paired default", $ => {
        const a = $.let(Alert.Root("warning", { icon: { prefix: "fas", name: "bell" } }));
        $(Assert.equal(a.unwrap().unwrap("Alert").icon.unwrap("some").name, "bell"));
    });

    // =========================================================================
    // Rich title / description
    // =========================================================================

    test("creates alert with string title (coerced to Text.Root)", $ => {
        const a = $.let(Alert.Root("success", { title: "Saved!" }));
        $(Assert.equal(
            a.unwrap().unwrap("Alert").title.unwrap("some").unwrap().unwrap("Text").value,
            "Saved!",
        ));
    });

    test("creates alert with string description", $ => {
        const a = $.let(Alert.Root("warning", { description: "Session expiring." }));
        $(Assert.equal(
            a.unwrap().unwrap("Alert").description.unwrap("some").unwrap().unwrap("Text").value,
            "Session expiring.",
        ));
    });

    test("creates alert with rich UIComp title", $ => {
        const a = $.let(Alert.Root("info", { title: Text.Root("Rich", { fontWeight: "bold" }) }));
        $(Assert.equal(
            a.unwrap().unwrap("Alert").title.unwrap("some").unwrap().unwrap("Text").value,
            "Rich",
        ));
    });

    // =========================================================================
    // body
    // =========================================================================

    test("creates alert with body containing Text", $ => {
        const a = $.let(Alert.Root("warning", {
            title: "Review required",
            body: [Text.Root("Line 1"), Text.Root("Line 2")],
        }));
        $(Assert.equal(a.unwrap().unwrap("Alert").body.unwrap("some").size(), 2n));
    });

    // =========================================================================
    // actions
    // =========================================================================

    test("creates alert with actions Button", $ => {
        const a = $.let(Alert.Root("warning", {
            title: "Drift",
            actions: Button.Root("Accept"),
        }));
        $(Assert.equal(
            a.unwrap().unwrap("Alert").actions.unwrap("some").unwrap().unwrap("Button").label.unwrap().unwrap("Text").value,
            "Accept",
        ));
    });

    // =========================================================================
    // closable / onClose
    // =========================================================================

    test("creates dismissible alert with closable", $ => {
        const a = $.let(Alert.Root("success", { closable: true }));
        $(Assert.equal(a.unwrap().unwrap("Alert").closable.unwrap("some"), true));
    });

    // =========================================================================
    // style
    // =========================================================================

    test("creates alert with style.variant preset", $ => {
        const a = $.let(Alert.Root("info", { style: { variant: "subtle" } }));
        const s = a.unwrap().unwrap("Alert").style.unwrap("some");
        $(Assert.equal(s.variant.unwrap("some").hasTag("subtle"), true));
    });

    test("creates alert with colour slot escape hatches", $ => {
        const a = $.let(Alert.Root("warning", {
            style: {
                variant: "outline",
                color: "#7a3b2e",
                background: "#fff7ed",
                borderColor: "#fed7aa",
                iconColor: "#ea580c",
            },
        }));
        const s = a.unwrap().unwrap("Alert").style.unwrap("some");
        $(Assert.equal(s.variant.unwrap("some").hasTag("outline"), true));
        $(Assert.equal(s.color.unwrap("some"), "#7a3b2e"));
        $(Assert.equal(s.background.unwrap("some"), "#fff7ed"));
        $(Assert.equal(s.borderColor.unwrap("some"), "#fed7aa"));
        $(Assert.equal(s.iconColor.unwrap("some"), "#ea580c"));
    });
}, { platformFns: TestImpl });
