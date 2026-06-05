/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { DateRangeInput } from "@elaraai/east-ui/internal";
import { East, DateTimeType, NullType } from "@elaraai/east";
import * as ex from "./date-range-input.examples.js";

describeEast("DateRangeInput", (test) => {
    Assert.examples(test, {
        dateRangeInputBasic: ex.dateRangeInputBasic,
        dateRangeInputDateTime: ex.dateRangeInputDateTime,
        dateRangeInputReactive: ex.dateRangeInputReactive,
        dateRangeInputPresets: ex.dateRangeInputPresets,
        dateRangeInputColours: ex.dateRangeInputColours,
        dateRangeInputSizes: ex.dateRangeInputSizes,
        dateRangeInputDisabled: ex.dateRangeInputDisabled,
    });

    test("creates range with start + end DateTime", $ => {
        const start = $.let(new Date("2026-04-01T00:00:00Z"), DateTimeType);
        const end = $.let(new Date("2026-04-30T00:00:00Z"), DateTimeType);
        const r = $.let(DateRangeInput.Root({ startValue: start, endValue: end }));
        $(Assert.is(r.unwrap().unwrap("DateRangeInput").startValue, new Date("2026-04-01T00:00:00Z")));
        $(Assert.is(r.unwrap().unwrap("DateRangeInput").endValue, new Date("2026-04-30T00:00:00Z")));
    });

    test("precision tag round-trips on main", $ => {
        const start = $.let(new Date("2026-04-01T09:00:00Z"), DateTimeType);
        const end = $.let(new Date("2026-04-01T17:00:00Z"), DateTimeType);
        const r = $.let(DateRangeInput.Root({ startValue: start, endValue: end, precision: "datetime" }));
        $(Assert.equal(r.unwrap().unwrap("DateRangeInput").precision.unwrap("some").hasTag("datetime"), true));
    });

    test("min/max round-trip on main", $ => {
        const start = $.let(new Date("2026-04-01T00:00:00Z"), DateTimeType);
        const end = $.let(new Date("2026-04-30T00:00:00Z"), DateTimeType);
        const min = new Date("2026-01-01T00:00:00Z");
        const max = new Date("2026-12-31T00:00:00Z");
        const r = $.let(DateRangeInput.Root({ startValue: start, endValue: end, min, max }));
        $(Assert.is(r.unwrap().unwrap("DateRangeInput").min.unwrap("some"), min));
        $(Assert.is(r.unwrap().unwrap("DateRangeInput").max.unwrap("some"), max));
    });

    test("presets array round-trips", $ => {
        const start = $.let(new Date("2026-04-21T00:00:00Z"), DateTimeType);
        const end = $.let(new Date("2026-04-28T00:00:00Z"), DateTimeType);
        const r = $.let(DateRangeInput.Root({ startValue: start, endValue: end,
            presets: [
                { label: "Last 7 days", start: new Date("2026-04-21T00:00:00Z"), end: new Date("2026-04-28T00:00:00Z") },
                { label: "MTD",         start: new Date("2026-04-01T00:00:00Z"), end: new Date("2026-04-28T00:00:00Z") },
            ],
        }));
        const presets = $.let(r.unwrap().unwrap("DateRangeInput").presets.unwrap("some"));
        $(Assert.equal(presets.size(), 2n));
        $(Assert.equal(presets.get(0n).label, "Last 7 days"));
        $(Assert.equal(presets.get(1n).label, "MTD"));
    });

    test("disabled flag round-trips on main", $ => {
        const start = $.let(new Date("2026-04-01T00:00:00Z"), DateTimeType);
        const end = $.let(new Date("2026-04-30T00:00:00Z"), DateTimeType);
        const r = $.let(DateRangeInput.Root({ startValue: start, endValue: end, disabled: true }));
        $(Assert.equal(r.unwrap().unwrap("DateRangeInput").disabled.unwrap("some"), true));
    });

    test("onChange callback round-trips on main", $ => {
        const start = $.let(new Date("2026-04-01T00:00:00Z"), DateTimeType);
        const end = $.let(new Date("2026-04-30T00:00:00Z"), DateTimeType);
        const onChange = East.function([DateTimeType, DateTimeType], NullType, (_$, _s, _e) => { /* noop */ });
        const r = $.let(DateRangeInput.Root({ startValue: start, endValue: end, onChange }));
        $(Assert.equal(r.unwrap().unwrap("DateRangeInput").onChange.hasTag("some"), true));
    });

    test("variant + size + colour overrides round-trip via style", $ => {
        const start = $.let(new Date("2026-04-01T00:00:00Z"), DateTimeType);
        const end = $.let(new Date("2026-04-30T00:00:00Z"), DateTimeType);
        const r = $.let(DateRangeInput.Root({ startValue: start, endValue: end,
            variant: "subtle",
            size: "sm",
            color: "fg",
            background: "bg.subtle",
            borderColor: "blue.300",
            focusBorderColor: "blue.500",
        }));
        const style = $.let(r.unwrap().unwrap("DateRangeInput").style.unwrap("some"));
        $(Assert.equal(style.variant.unwrap("some").hasTag("subtle"), true));
        $(Assert.equal(style.size.unwrap("some").hasTag("sm"), true));
        $(Assert.equal(style.color.unwrap("some"), "fg"));
        $(Assert.equal(style.background.unwrap("some"), "bg.subtle"));
        $(Assert.equal(style.borderColor.unwrap("some"), "blue.300"));
        $(Assert.equal(style.focusBorderColor.unwrap("some"), "blue.500"));
    });

    test("style absent when no visual fields set", $ => {
        const start = $.let(new Date("2026-04-01T00:00:00Z"), DateTimeType);
        const end = $.let(new Date("2026-04-30T00:00:00Z"), DateTimeType);
        const r = $.let(DateRangeInput.Root({ startValue: start, endValue: end }));
        $(Assert.equal(r.unwrap().unwrap("DateRangeInput").style.hasTag("none"), true));
    });
}, { platformFns: TestImpl });
