/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { type ExprType } from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Button, ButtonGroup } from "@elaraai/east-ui/internal";
import { UIComponentType } from "@elaraai/east-ui";
import * as ex from "./button-group.examples.js";

describeEast("ButtonGroup", (test) => {
    Assert.examples(test, {
        buttonGroupPrevNext: ex.buttonGroupPrevNext,
        buttonGroupVariants: ex.buttonGroupVariants,
    });

    test("buttonGroupVariants is the live configurator", $ => {
        const panel = $.const(ex.buttonGroupVariants.fn() as ExprType<UIComponentType>);
        $(Assert.equal(panel.unwrap().hasTag("ReactiveComponent"), true));
    });

    test("creates button group with children array", $ => {
        const g = $.let(ButtonGroup.Root([
            Button.Root("A"),
            Button.Root("B"),
        ]));
        $(Assert.equal(g.unwrap().unwrap("ButtonGroup").buttons.size(), 2n));
    });

    test("button group without options has style none", $ => {
        const g = $.let(ButtonGroup.Root([Button.Root("A")]));
        $(Assert.equal(g.unwrap().unwrap("ButtonGroup").style.hasTag("none"), true));
    });

    test("creates attached button group", $ => {
        const g = $.let(ButtonGroup.Root([Button.Root("A")], { attached: true }));
        $(Assert.equal(
            g.unwrap().unwrap("ButtonGroup").style.unwrap("some").attached.unwrap("some"),
            true,
        ));
    });

    test("creates button group with gap", $ => {
        const g = $.let(ButtonGroup.Root([Button.Root("A")], { gap: "2" }));
        $(Assert.equal(
            g.unwrap().unwrap("ButtonGroup").style.unwrap("some").gap.unwrap("some"),
            "2",
        ));
    });

    test("creates button group with shared borderColor", $ => {
        const g = $.let(ButtonGroup.Root([Button.Root("A")], { borderColor: "border.brand" }));
        $(Assert.equal(
            g.unwrap().unwrap("ButtonGroup").style.unwrap("some").borderColor.unwrap("some"), "border.brand",
        ));
    });

    test("creates fully-configured attached group", $ => {
        const g = $.let(ButtonGroup.Root([
            Button.Root("1d", { variant: "outline", size: "sm" }),
            Button.Root("1w", { variant: "outline", size: "sm" }),
            Button.Root("1m", { variant: "outline", size: "sm" }),
        ], {
            attached: true,
            borderColor: "accent.teal",
        }));
        const s = g.unwrap().unwrap("ButtonGroup").style.unwrap("some");
        $(Assert.equal(g.unwrap().unwrap("ButtonGroup").buttons.size(), 3n));
        $(Assert.equal(s.attached.unwrap("some"), true));
        $(Assert.equal(s.borderColor.unwrap("some"), "accent.teal"));
    });
}, { platformFns: TestImpl });
