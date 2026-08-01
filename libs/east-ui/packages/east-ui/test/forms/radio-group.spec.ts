/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { RadioGroup, UIComponentType } from "@elaraai/east-ui/internal";
import { East, NullType, StringType, type ExprType } from "@elaraai/east";
import * as ex from "./radio-group.examples.js";

describeEast("RadioGroup", (test) => {
    Assert.examples(test, {
        radioGroupBasic: ex.radioGroupBasic,
        radioGroupReactive: ex.radioGroupReactive,
        radioGroupVariants: ex.radioGroupVariants,
    });

    // =========================================================================
    // Panels — every merged example stays mounted as a captioned row (#462).
    // The mono-uppercase Text captions are the stable per-mini anchors.
    // =========================================================================

    test("radioGroupVariants panel mounts one captioned row per merged example", $ => {
        const panel = $.const(ex.radioGroupVariants.fn() as ExprType<UIComponentType>);
        const rows = $.const(panel.unwrap().unwrap("Stack").children);
        $(Assert.equal(rows.size(), 6n));
        $(Assert.equal(rows.get(0n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "GROUP HORIZONTAL"));
        $(Assert.equal(rows.get(2n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "GROUP DISABLED ITEM"));
        $(Assert.equal(rows.get(4n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "GROUP COLOUR OVERRIDES"));
    });

    test("creates radio group with selected value", $ => {
        const r = $.let(RadioGroup.Root({ value: "yes", items: [
            { value: "yes", label: "Yes" },
            { value: "no", label: "No" },
        ] }), UIComponentType);
        $(Assert.equal(r.unwrap().unwrap("RadioGroup").value, "yes"));
        $(Assert.equal(r.unwrap().unwrap("RadioGroup").items.size(), 2n));
    });

    test("item label and disabled round-trip", $ => {
        const r = $.let(RadioGroup.Root({ value: "a", items: [
            { value: "a", label: "Option A" },
            { value: "b", disabled: true },
        ] }));
        const items = $.let(r.unwrap().unwrap("RadioGroup").items);
        $(Assert.equal(items.get(0n).label.unwrap("some"), "Option A"));
        $(Assert.equal(items.get(1n).disabled.unwrap("some"), true));
    });

    test("orientation literal sets variant tag", $ => {
        const r = $.let(RadioGroup.Root({ value: "x", items: [{ value: "x" }], orientation: "horizontal" }));
        const style = $.let(r.unwrap().unwrap("RadioGroup").style.unwrap("some"));
        $(Assert.equal(style.orientation.unwrap("some").hasTag("horizontal"), true));
    });

    test("colour overrides round-trip", $ => {
        const r = $.let(RadioGroup.Root({ value: "x", items: [{ value: "x" }], 
            color: "gray.700",
            fillColor: "blue.600",
            borderColor: "blue.300",
        }));
        const style = $.let(r.unwrap().unwrap("RadioGroup").style.unwrap("some"));
        $(Assert.equal(style.color.unwrap("some"), "gray.700"));
        $(Assert.equal(style.fillColor.unwrap("some"), "blue.600"));
        $(Assert.equal(style.borderColor.unwrap("some"), "blue.300"));
    });

    test("onChange callback round-trips on main", $ => {
        const onChange = East.function([StringType], NullType, (_$, _v) => { /* noop */ });
        const r = $.let(RadioGroup.Root({ value: "x", items: [{ value: "x" }], onChange }));
        $(Assert.equal(r.unwrap().unwrap("RadioGroup").onChange.hasTag("some"), true));
    });

    test("group disabled flag round-trips on main", $ => {
        const r = $.let(RadioGroup.Root({ value: "x", items: [{ value: "x" }], disabled: true }));
        $(Assert.equal(r.unwrap().unwrap("RadioGroup").disabled.unwrap("some"), true));
    });
}, { platformFns: TestImpl });
