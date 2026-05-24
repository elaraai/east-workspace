/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Button, ButtonGroup } from "@elaraai/east-ui";
import * as ex from "./button-group.examples.js";

describeEast("ButtonGroup", (test) => {
    Assert.examples(test, {
        buttonGroupPrevNext: ex.buttonGroupPrevNext,
        buttonGroupTimescale: ex.buttonGroupTimescale,
        buttonGroupSplit: ex.buttonGroupSplit,
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
        const g = $.let(ButtonGroup.Root([Button.Root("A")], { style: { attached: true } }));
        $(Assert.equal(
            g.unwrap().unwrap("ButtonGroup").style.unwrap("some").attached.unwrap("some"),
            true,
        ));
    });

    test("creates button group with gap", $ => {
        const g = $.let(ButtonGroup.Root([Button.Root("A")], { style: { gap: "2" } }));
        $(Assert.equal(
            g.unwrap().unwrap("ButtonGroup").style.unwrap("some").gap.unwrap("some"),
            "2",
        ));
    });

    test("creates button group with shared borderColor", $ => {
        const g = $.let(ButtonGroup.Root([Button.Root("A")], { style: { borderColor: "#3d5cff" } }));
        $(Assert.equal(
            g.unwrap().unwrap("ButtonGroup").style.unwrap("some").borderColor.unwrap("some"),
            "#3d5cff",
        ));
    });

    test("creates fully-configured attached group", $ => {
        const g = $.let(ButtonGroup.Root([
            Button.Root("1d", { style: { variant: "outline", size: "sm" } }),
            Button.Root("1w", { style: { variant: "outline", size: "sm" } }),
            Button.Root("1m", { style: { variant: "outline", size: "sm" } }),
        ], {
            style: {
                attached: true,
                borderColor: "#14b8a6",
            },
        }));
        const s = g.unwrap().unwrap("ButtonGroup").style.unwrap("some");
        $(Assert.equal(g.unwrap().unwrap("ButtonGroup").buttons.size(), 3n));
        $(Assert.equal(s.attached.unwrap("some"), true));
        $(Assert.equal(s.borderColor.unwrap("some"), "#14b8a6"));
    });
}, { platformFns: TestImpl });
