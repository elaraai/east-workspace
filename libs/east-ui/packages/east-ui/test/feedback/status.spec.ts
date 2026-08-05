/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { type ExprType } from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Status, Text } from "@elaraai/east-ui/internal";
import { UIComponentType } from "@elaraai/east-ui";
import * as ex from "./status.examples.js";

describeEast("Status", (test) => {
    Assert.examples(test, {
        statusBasic: ex.statusBasic,
        statusVariants: ex.statusVariants,
    });

    test("statusVariants is the live configurator", $ => {
        const panel = $.const(ex.statusVariants.fn() as ExprType<UIComponentType>);
        $(Assert.equal(panel.unwrap().hasTag("ReactiveComponent"), true));
    });

    // =========================================================================
    // Root — label + value
    // =========================================================================

    test("creates status with string label (coerced to Text.Root) and default neutral value", $ => {
        const s = $.let(Status.Root({ label: "Idle" }));
        const v = s.unwrap().unwrap("Status");
        $(Assert.equal(v.label.unwrap().unwrap("Text").value, "Idle"));
        $(Assert.equal(v.value.hasTag("neutral"), true));
    });

    test("creates status with rich UIComp label", $ => {
        const s = $.let(Status.Root({ label: Text.Root("Rich", { fontWeight: "bold" }) }));
        $(Assert.equal(
            s.unwrap().unwrap("Status").label.unwrap().unwrap("Text").value,
            "Rich",
        ));
    });

    // =========================================================================
    // §0.3 paired-icon contract
    // =========================================================================

    test("injects paired check icon for success", $ => {
        const s = $.let(Status.Root({ label: "OK", value: "success" }));
        const icon = s.unwrap().unwrap("Status").icon.unwrap("some");
        $(Assert.equal(icon.name, "circle-check"));
    });

    test("injects paired triangle icon for warning", $ => {
        const s = $.let(Status.Root({ label: "Warn", value: "warning" }));
        const icon = s.unwrap().unwrap("Status").icon.unwrap("some");
        $(Assert.equal(icon.name, "triangle-exclamation"));
    });

    test("injects paired xmark icon for danger", $ => {
        const s = $.let(Status.Root({ label: "Fail", value: "danger" }));
        const icon = s.unwrap().unwrap("Status").icon.unwrap("some");
        $(Assert.equal(icon.name, "circle-xmark"));
    });

    test("injects paired info icon for info", $ => {
        const s = $.let(Status.Root({ label: "Info", value: "info" }));
        const icon = s.unwrap().unwrap("Status").icon.unwrap("some");
        $(Assert.equal(icon.name, "circle-info"));
    });

    test("injects paired circle icon for neutral", $ => {
        const s = $.let(Status.Root({ label: "Idle", value: "neutral" }));
        const icon = s.unwrap().unwrap("Status").icon.unwrap("some");
        $(Assert.equal(icon.name, "circle"));
    });

    test("explicit icon overrides paired default", $ => {
        const s = $.let(Status.Root({ label: "Shipping",
            value: "info",
            icon: { prefix: "fas", name: "truck" },
        }));
        const icon = s.unwrap().unwrap("Status").icon.unwrap("some");
        $(Assert.equal(icon.name, "truck"));
    });

    test("showIcon: false opts out of paired default", $ => {
        const s = $.let(Status.Root({ label: "Idle", value: "success", showIcon: false }));
        $(Assert.equal(s.unwrap().unwrap("Status").icon.hasTag("none"), true));
    });

    // =========================================================================
    // Pulsing + style
    // =========================================================================

    test("creates status with pulsing flag", $ => {
        const s = $.let(Status.Root({ label: "Busy", value: "danger", pulsing: true }));
        $(Assert.equal(s.unwrap().unwrap("Status").pulsing.unwrap("some"), true));
    });

    test("creates status with colour slots", $ => {
        const s = $.let(Status.Root({ label: "T",
            value: "success",
            size: "sm",
            color: "fg.default",
            background: "bg.success.subtle",
            borderColor: "status.pos",
            dotColor: "fg.success",
        }));
        const sv = s.unwrap().unwrap("Status").style.unwrap("some");
        $(Assert.equal(sv.size.unwrap("some").hasTag("sm"), true));
        $(Assert.equal(sv.color.unwrap("some"), "fg.default"));
        $(Assert.equal(sv.background.unwrap("some"), "bg.success.subtle"));
        $(Assert.equal(sv.borderColor.unwrap("some"), "status.pos"));
        $(Assert.equal(sv.dotColor.unwrap("some"), "fg.success"));
    });
}, { platformFns: TestImpl });
