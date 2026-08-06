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
        radioGroupVariants: ex.radioGroupVariants,
        radioGroupCustomColours: ex.radioGroupCustomColours,
    });

    // =========================================================================
    // Panels — every merged example stays mounted as a captioned row (#462).
    // The mono-uppercase Text captions are the stable per-mini anchors.
    // =========================================================================

    test("radioGroupVariants drives its preview from inline option tables", $ => {
        // Everything the configurator needs — the orientation / colour tables
        // and the State-bound live group — is declared inside the example
        // body, because the documentation capture only extracts `fn`. That
        // puts the tables inside the Reactive body, which TestImpl does not
        // execute, so they cannot be asserted from here; `Assert.examples`
        // above still compiles and evaluates the outer function. The
        // per-option coverage lives in the RadioGroup.Root tests below, which
        // construct each option directly.
        const panel = $.const(ex.radioGroupVariants.fn() as ExprType<UIComponentType>);
        $(Assert.equal(panel.unwrap().hasTag("ReactiveComponent"), true));
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
            color: "fg.default",
            fillColor: "link",
            borderColor: "border.brand",
        }));
        const style = $.let(r.unwrap().unwrap("RadioGroup").style.unwrap("some"));
        $(Assert.equal(style.color.unwrap("some"), "fg.default"));
        $(Assert.equal(style.fillColor.unwrap("some"), "link"));
        $(Assert.equal(style.borderColor.unwrap("some"), "border.brand"));
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
