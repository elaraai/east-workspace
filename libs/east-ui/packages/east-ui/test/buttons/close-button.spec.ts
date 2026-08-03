/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { CloseButton } from "@elaraai/east-ui/internal";
import * as ex from "./close-button.examples.js";

describeEast("CloseButton", (test) => {
    Assert.examples(test, {
        closeButtonBasic: ex.closeButtonBasic,
        closeButtonLabelled: ex.closeButtonLabelled,
        closeButtonReactive: ex.closeButtonReactive,
        closeButtonBranded: ex.closeButtonBranded,
    });

    test("creates close button with defaults — all options none", $ => {
        const btn = $.let(CloseButton.Root());
        const b = btn.unwrap().unwrap("CloseButton");
        $(Assert.equal(b.label.hasTag("none"), true));
        $(Assert.equal(b.disabled.hasTag("none"), true));
        $(Assert.equal(b.onClick.hasTag("none"), true));
        $(Assert.equal(b.style.hasTag("none"), true));
    });

    test("creates close button with custom aria-label", $ => {
        const btn = $.let(CloseButton.Root({ label: "Fermer" }));
        $(Assert.equal(btn.unwrap().unwrap("CloseButton").label.unwrap("some"), "Fermer"));
    });

    test("creates disabled close button on main", $ => {
        const btn = $.let(CloseButton.Root({ disabled: true }));
        $(Assert.equal(btn.unwrap().unwrap("CloseButton").disabled.unwrap("some"), true));
    });

    test("creates close button with variant in style", $ => {
        const btn = $.let(CloseButton.Root({ variant: "ghost" }));
        $(Assert.equal(
            btn.unwrap().unwrap("CloseButton").style.unwrap("some").variant.unwrap("some").hasTag("ghost"),
            true,
        ));
    });

    test("creates close button with size xs", $ => {
        const btn = $.let(CloseButton.Root({ size: "xs" }));
        $(Assert.equal(
            btn.unwrap().unwrap("CloseButton").style.unwrap("some").size.unwrap("some").hasTag("xs"),
            true,
        ));
    });

    test("creates close button with full colour escape hatches", $ => {
        const btn = $.let(CloseButton.Root({
            color: "fg.inverse",
            background: "bg.inverse",
            borderColor: "border.brand",
            hoverBackground: "bg.inverse",
        }));
        const s = btn.unwrap().unwrap("CloseButton").style.unwrap("some");
        $(Assert.equal(s.color.unwrap("some"), "fg.inverse"));
        $(Assert.equal(s.background.unwrap("some"), "bg.inverse"));
        $(Assert.equal(s.borderColor.unwrap("some"), "border.brand"));
        $(Assert.equal(s.hoverBackground.unwrap("some"), "bg.inverse"));
    });
}, { platformFns: TestImpl });
