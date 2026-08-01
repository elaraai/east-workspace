/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { TimeRangeInput, UIComponentType } from "@elaraai/east-ui/internal";
import { East, IntegerType, NullType, type ExprType } from "@elaraai/east";
import * as ex from "./time-range-input.examples.js";

describeEast("TimeRangeInput", (test) => {
    Assert.examples(test, {
        timeRangeInputBasic: ex.timeRangeInputBasic,
        timeRangeInputReactive: ex.timeRangeInputReactive,
        timeRangeInputVariants: ex.timeRangeInputVariants,
    });

    // =========================================================================
    // Panels — every merged example stays mounted as a captioned row (#462).
    // The mono-uppercase Text captions are the stable per-mini anchors.
    // =========================================================================

    test("timeRangeInputVariants panel mounts one captioned row per merged example", $ => {
        const panel = $.const(ex.timeRangeInputVariants.fn() as ExprType<UIComponentType>);
        const rows = $.const(panel.unwrap().unwrap("Stack").children);
        $(Assert.equal(rows.size(), 4n));
        $(Assert.equal(rows.get(0n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "RANGE INPUT PRESETS"));
        $(Assert.equal(rows.get(1n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "RANGE INPUT COLOURS"));
        $(Assert.equal(rows.get(2n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "RANGE INPUT SIZES"));
        $(Assert.equal(rows.get(3n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "RANGE INPUT DISABLED"));
    });

    test("creates range with start + end minutes", $ => {
        const start = $.let(360n, IntegerType);
        const end = $.let(840n, IntegerType);
        const r = $.let(TimeRangeInput.Root({ startValue: start, endValue: end }));
        $(Assert.equal(r.unwrap().unwrap("TimeRangeInput").startValue, 360n));
        $(Assert.equal(r.unwrap().unwrap("TimeRangeInput").endValue, 840n));
    });

    test("step round-trips on main", $ => {
        const start = $.let(0n, IntegerType);
        const end = $.let(60n, IntegerType);
        const r = $.let(TimeRangeInput.Root({ startValue: start, endValue: end, step: 15n }));
        $(Assert.equal(r.unwrap().unwrap("TimeRangeInput").step.unwrap("some"), 15n));
    });

    test("min/max round-trip on main", $ => {
        const start = $.let(360n, IntegerType);
        const end = $.let(840n, IntegerType);
        const r = $.let(TimeRangeInput.Root({ startValue: start, endValue: end, min: 0n, max: 1440n }));
        $(Assert.equal(r.unwrap().unwrap("TimeRangeInput").min.unwrap("some"), 0n));
        $(Assert.equal(r.unwrap().unwrap("TimeRangeInput").max.unwrap("some"), 1440n));
    });

    test("presets array round-trips", $ => {
        const start = $.let(360n, IntegerType);
        const end = $.let(840n, IntegerType);
        const r = $.let(TimeRangeInput.Root({ startValue: start, endValue: end,
            presets: [
                { label: "Morning", start: 360n, end: 840n },
                { label: "Afternoon", start: 840n, end: 1320n },
            ],
        }));
        const presets = $.let(r.unwrap().unwrap("TimeRangeInput").presets.unwrap("some"));
        $(Assert.equal(presets.size(), 2n));
        $(Assert.equal(presets.get(0n).label, "Morning"));
        $(Assert.equal(presets.get(0n).start, 360n));
        $(Assert.equal(presets.get(0n).end, 840n));
        $(Assert.equal(presets.get(1n).label, "Afternoon"));
    });

    test("disabled flag round-trips on main", $ => {
        const start = $.let(360n, IntegerType);
        const end = $.let(840n, IntegerType);
        const r = $.let(TimeRangeInput.Root({ startValue: start, endValue: end, disabled: true }));
        $(Assert.equal(r.unwrap().unwrap("TimeRangeInput").disabled.unwrap("some"), true));
    });

    test("onChange callback round-trips on main", $ => {
        const start = $.let(360n, IntegerType);
        const end = $.let(840n, IntegerType);
        const onChange = East.function([IntegerType, IntegerType], NullType, (_$, _s, _e) => { /* noop */ });
        const r = $.let(TimeRangeInput.Root({ startValue: start, endValue: end, onChange }));
        $(Assert.equal(r.unwrap().unwrap("TimeRangeInput").onChange.hasTag("some"), true));
    });

    test("variant + size + colour overrides round-trip via style", $ => {
        const start = $.let(540n, IntegerType);
        const end = $.let(1020n, IntegerType);
        const r = $.let(TimeRangeInput.Root({ startValue: start, endValue: end,
            variant: "subtle",
            size: "sm",
            color: "fg",
            background: "bg.subtle",
            borderColor: "blue.300",
            focusBorderColor: "blue.500",
        }));
        const style = $.let(r.unwrap().unwrap("TimeRangeInput").style.unwrap("some"));
        $(Assert.equal(style.variant.unwrap("some").hasTag("subtle"), true));
        $(Assert.equal(style.size.unwrap("some").hasTag("sm"), true));
        $(Assert.equal(style.color.unwrap("some"), "fg"));
        $(Assert.equal(style.background.unwrap("some"), "bg.subtle"));
        $(Assert.equal(style.borderColor.unwrap("some"), "blue.300"));
        $(Assert.equal(style.focusBorderColor.unwrap("some"), "blue.500"));
    });

    test("style absent when no visual fields set", $ => {
        const start = $.let(360n, IntegerType);
        const end = $.let(840n, IntegerType);
        const r = $.let(TimeRangeInput.Root({ startValue: start, endValue: end }));
        $(Assert.equal(r.unwrap().unwrap("TimeRangeInput").style.hasTag("none"), true));
    });
}, { platformFns: TestImpl });
