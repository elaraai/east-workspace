/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Status, Text } from "@elaraai/east-ui";
import * as ex from "./status.examples.js";

describeEast("Status", (test) => {
    Assert.examples(test, {
        statusBasic: ex.statusBasic,
        statusPulsing: ex.statusPulsing,
        statusRichLabel: ex.statusRichLabel,
        statusCustomIcon: ex.statusCustomIcon,
    });

    // =========================================================================
    // Root — label + value
    // =========================================================================

    test("creates status with string label (coerced to Text.Root) and default neutral value", $ => {
        const s = $.let(Status.Root("Idle"));
        const v = s.unwrap().unwrap("Status");
        $(Assert.equal(v.label.unwrap().unwrap("Text").value, "Idle"));
        $(Assert.equal(v.value.hasTag("neutral"), true));
    });

    test("creates status with rich UIComp label", $ => {
        const s = $.let(Status.Root(Text.Root("Rich", { fontWeight: "bold" })));
        $(Assert.equal(
            s.unwrap().unwrap("Status").label.unwrap().unwrap("Text").value,
            "Rich",
        ));
    });

    // =========================================================================
    // §0.3 paired-icon contract
    // =========================================================================

    test("injects paired check icon for success", $ => {
        const s = $.let(Status.Root("OK", { value: "success" }));
        const icon = s.unwrap().unwrap("Status").icon.unwrap("some");
        $(Assert.equal(icon.name, "circle-check"));
    });

    test("injects paired triangle icon for warning", $ => {
        const s = $.let(Status.Root("Warn", { value: "warning" }));
        const icon = s.unwrap().unwrap("Status").icon.unwrap("some");
        $(Assert.equal(icon.name, "triangle-exclamation"));
    });

    test("injects paired xmark icon for danger", $ => {
        const s = $.let(Status.Root("Fail", { value: "danger" }));
        const icon = s.unwrap().unwrap("Status").icon.unwrap("some");
        $(Assert.equal(icon.name, "circle-xmark"));
    });

    test("injects paired info icon for info", $ => {
        const s = $.let(Status.Root("Info", { value: "info" }));
        const icon = s.unwrap().unwrap("Status").icon.unwrap("some");
        $(Assert.equal(icon.name, "circle-info"));
    });

    test("injects paired circle icon for neutral", $ => {
        const s = $.let(Status.Root("Idle", { value: "neutral" }));
        const icon = s.unwrap().unwrap("Status").icon.unwrap("some");
        $(Assert.equal(icon.name, "circle"));
    });

    test("explicit icon overrides paired default", $ => {
        const s = $.let(Status.Root("Shipping", {
            value: "info",
            icon: { prefix: "fas", name: "truck" },
        }));
        const icon = s.unwrap().unwrap("Status").icon.unwrap("some");
        $(Assert.equal(icon.name, "truck"));
    });

    test("showIcon: false opts out of paired default", $ => {
        const s = $.let(Status.Root("Idle", { value: "success", showIcon: false }));
        $(Assert.equal(s.unwrap().unwrap("Status").icon.hasTag("none"), true));
    });

    // =========================================================================
    // Pulsing + style
    // =========================================================================

    test("creates status with pulsing flag", $ => {
        const s = $.let(Status.Root("Busy", { value: "danger", pulsing: true }));
        $(Assert.equal(s.unwrap().unwrap("Status").pulsing.unwrap("some"), true));
    });

    test("creates status with colour slots", $ => {
        const s = $.let(Status.Root("T", {
            value: "success",
            style: {
                size: "sm",
                color: "#111827",
                background: "#f0fdf4",
                borderColor: "#bbf7d0",
                dotColor: "#16a34a",
            },
        }));
        const sv = s.unwrap().unwrap("Status").style.unwrap("some");
        $(Assert.equal(sv.size.unwrap("some").hasTag("sm"), true));
        $(Assert.equal(sv.color.unwrap("some"), "#111827"));
        $(Assert.equal(sv.background.unwrap("some"), "#f0fdf4"));
        $(Assert.equal(sv.borderColor.unwrap("some"), "#bbf7d0"));
        $(Assert.equal(sv.dotColor.unwrap("some"), "#16a34a"));
    });
}, { platformFns: TestImpl });
