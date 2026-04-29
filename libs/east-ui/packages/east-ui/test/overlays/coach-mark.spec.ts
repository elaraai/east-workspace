/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Button, CoachMark } from "@elaraai/east-ui";
import { East, NullType } from "@elaraai/east";
import * as ex from "./coach-mark.examples.js";

describeEast("CoachMark", (test) => {
    Assert.examples(test, {
        coachMarkBasic: ex.coachMarkBasic,
        coachMarkShowOnce: ex.coachMarkShowOnce,
        coachMarkColours: ex.coachMarkColours,
        coachMarkOnContent: ex.coachMarkOnContent,
    });

    test("basic shape — wraps a target child + title + body", $ => {
        const r = $.let(CoachMark.Root(Button.Root("Tap me"), "Hello", "World"));
        $(Assert.equal(r.unwrap().unwrap("CoachMark").title, "Hello"));
        $(Assert.equal(r.unwrap().unwrap("CoachMark").body, "World"));
        $(Assert.equal(r.unwrap().unwrap("CoachMark").target.unwrap().hasTag("Button"), true));
        $(Assert.equal(r.unwrap().unwrap("CoachMark").showOnce.hasTag("none"), true));
        $(Assert.equal(r.unwrap().unwrap("CoachMark").style.hasTag("none"), true));
    });

    test("showOnce key round-trips", $ => {
        const r = $.let(CoachMark.Root(Button.Root("X"), "A", "B", { showOnce: "coach.x" }));
        $(Assert.equal(r.unwrap().unwrap("CoachMark").showOnce.unwrap("some"), "coach.x"));
    });

    test("dismissible flag round-trips", $ => {
        const r = $.let(CoachMark.Root(Button.Root("X"), "A", "B", { dismissible: false }));
        $(Assert.equal(r.unwrap().unwrap("CoachMark").dismissible.unwrap("some"), false));
    });

    test("onDismiss callback round-trips", $ => {
        const onDismiss = East.function([], NullType, (_$) => { /* noop */ });
        const r = $.let(CoachMark.Root(Button.Root("X"), "A", "B", { onDismiss }));
        $(Assert.equal(r.unwrap().unwrap("CoachMark").onDismiss.hasTag("some"), true));
    });

    test("colour overrides round-trip via style", $ => {
        const r = $.let(CoachMark.Root(Button.Root("X"), "A", "B", {
            placement: "right",
            background: "blue.50",
            borderColor: "blue.300",
            arrowColor: "blue.300",
        }));
        const style = $.let(r.unwrap().unwrap("CoachMark").style.unwrap("some"));
        $(Assert.equal(style.placement.unwrap("some").hasTag("right"), true));
        $(Assert.equal(style.background.unwrap("some"), "blue.50"));
        $(Assert.equal(style.borderColor.unwrap("some"), "blue.300"));
        $(Assert.equal(style.arrowColor.unwrap("some"), "blue.300"));
    });
}, { platformFns: TestImpl });
