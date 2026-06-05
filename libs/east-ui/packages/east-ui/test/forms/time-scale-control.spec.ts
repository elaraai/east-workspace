/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { TimeScaleControl, UIComponentType } from "@elaraai/east-ui";
import { East, NullType } from "@elaraai/east";
import * as ex from "./time-scale-control.examples.js";

describeEast("TimeScaleControl", (test) => {
    Assert.examples(test, {
        timeScaleControlBasic: ex.timeScaleControlBasic,
        timeScaleControlAvailable: ex.timeScaleControlAvailable,
        timeScaleControlReactive: ex.timeScaleControlReactive,
        timeScaleControlSubtleVariant: ex.timeScaleControlSubtleVariant,
        timeScaleControlSizes: ex.timeScaleControlSizes,
    });

    test("creates control with day scale", $ => {
        const r = $.let(TimeScaleControl.Root("day"), UIComponentType);
        $(Assert.equal(r.unwrap().unwrap("TimeScaleControl").value.hasTag("day"), true));
    });

    test("availableScales array round-trips", $ => {
        const r = $.let(TimeScaleControl.Root("week", {
            availableScales: ["day", "week", "month"],
        }));
        const scales = $.let(r.unwrap().unwrap("TimeScaleControl").availableScales.unwrap("some"));
        $(Assert.equal(scales.size(), 3n));
        $(Assert.equal(scales.get(0n).hasTag("day"), true));
        $(Assert.equal(scales.get(2n).hasTag("month"), true));
    });

    test("variant + size + colorPalette round-trip via style", $ => {
        const r = $.let(TimeScaleControl.Root("hour", {
            variant: "subtle",
            size: "sm",
            colorPalette: "blue",
        }));
        const style = $.let(r.unwrap().unwrap("TimeScaleControl").style.unwrap("some"));
        $(Assert.equal(style.variant.unwrap("some").hasTag("subtle"), true));
        $(Assert.equal(style.size.unwrap("some").hasTag("sm"), true));
        $(Assert.equal(style.colorPalette.unwrap("some").hasTag("blue"), true));
    });

    test("onChange callback round-trips on main", $ => {
        const onChange = East.function([TimeScaleControl.Types.Scale], NullType, (_$, _v) => { /* noop */ });
        const r = $.let(TimeScaleControl.Root("day", { onChange }));
        $(Assert.equal(r.unwrap().unwrap("TimeScaleControl").onChange.hasTag("some"), true));
    });

    test("disabled flag round-trips", $ => {
        const r = $.let(TimeScaleControl.Root("day", { disabled: true }));
        $(Assert.equal(r.unwrap().unwrap("TimeScaleControl").disabled.unwrap("some"), true));
    });
}, { platformFns: TestImpl });
