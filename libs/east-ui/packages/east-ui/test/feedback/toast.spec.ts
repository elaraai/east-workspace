/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { East, NullType } from "@elaraai/east";
import { Toast } from "@elaraai/east-ui";
import * as ex from "./toast.examples.js";

describeEast("Toast", (test) => {
    Assert.examples(test, {
        toastBasic: ex.toastBasic,
        toastWithActions: ex.toastWithActions,
        toastPersistent: ex.toastPersistent,
    });

    // =========================================================================
    // Toast.make — value construction
    // =========================================================================

    test("creates a success toast with title", $ => {
        const t = $.let(Toast.make("success", "Saved"));
        $(Assert.equal(t.status.hasTag("success"), true));
        $(Assert.equal(t.title, "Saved"));
        $(Assert.equal(t.description.hasTag("none"), true));
        $(Assert.equal(t.duration.hasTag("none"), true));
        $(Assert.equal(t.actions.hasTag("none"), true));
    });

    test("creates a toast with description + duration", $ => {
        const t = $.let(Toast.make("info", "Hello", {
            description: "More info",
            duration: 5000n,
        }));
        $(Assert.equal(t.description.unwrap("some"), "More info"));
        $(Assert.equal(t.duration.unwrap("some"), 5000n));
    });

    test("creates a toast with actions", $ => {
        const noop = East.function([], NullType, _$ => { /* noop */ });
        const t = $.let(Toast.make("warning", "Drift", {
            actions: [
                { label: "Undo", onClick: noop, variant: "subtle" },
                { label: "View", onClick: noop, variant: "solid" },
            ],
        }));
        $(Assert.equal(t.actions.unwrap("some").size(), 2n));
        $(Assert.equal(t.actions.unwrap("some").get(0n).label, "Undo"));
        $(Assert.equal(t.actions.unwrap("some").get(1n).label, "View"));
    });

    test("creates a neutral toast", $ => {
        const t = $.let(Toast.make("neutral", "Idle"));
        $(Assert.equal(t.status.hasTag("neutral"), true));
    });

    test("creates a toast with style slots", $ => {
        const t = $.let(Toast.make("info", "T", {
            style: {
                color: "#111827",
                background: "#eff6ff",
                borderColor: "#bfdbfe",
                iconColor: "#2563eb",
            },
        }));
        const s = t.style.unwrap("some");
        $(Assert.equal(s.color.unwrap("some"), "#111827"));
        $(Assert.equal(s.background.unwrap("some"), "#eff6ff"));
        $(Assert.equal(s.borderColor.unwrap("some"), "#bfdbfe"));
        $(Assert.equal(s.iconColor.unwrap("some"), "#2563eb"));
    });
}, { platformFns: TestImpl });
