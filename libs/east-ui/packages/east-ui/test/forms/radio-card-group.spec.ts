/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { RadioCardGroup, UIComponentType } from "@elaraai/east-ui/internal";
import { East, NullType, StringType, type ExprType } from "@elaraai/east";
import * as ex from "./radio-card-group.examples.js";

describeEast("RadioCardGroup", (test) => {
    Assert.examples(test, {
        radioCardGroupBasic: ex.radioCardGroupBasic,
        radioCardGroupVariants: ex.radioCardGroupVariants,
        radioCardGroupCustomColours: ex.radioCardGroupCustomColours,
    });

    // =========================================================================
    // Panels — every merged example stays mounted as a captioned row (#462).
    // The mono-uppercase Text captions are the stable per-mini anchors.
    // =========================================================================

    test("radioCardGroupVariants drives its preview from inline option tables", $ => {
        // Everything the configurator needs — the orientation / colour tables
        // and the State-bound live card group — is declared inside the example
        // body, because the documentation capture only extracts `fn`. That
        // puts the tables inside the Reactive body, which TestImpl does not
        // execute, so they cannot be asserted from here; `Assert.examples`
        // above still compiles and evaluates the outer function. The
        // per-option coverage lives in the RadioCardGroup.Root tests below,
        // which construct each option directly.
        const panel = $.const(ex.radioCardGroupVariants.fn() as ExprType<UIComponentType>);
        $(Assert.equal(panel.unwrap().hasTag("ReactiveComponent"), true));
    });

    test("creates card group with selected value", $ => {
        const r = $.let(RadioCardGroup.Root({ value: "a", items: [
            { value: "a", label: "A" },
            { value: "b", label: "B" },
        ] }), UIComponentType);
        $(Assert.equal(r.unwrap().unwrap("RadioCardGroup").value, "a"));
        $(Assert.equal(r.unwrap().unwrap("RadioCardGroup").items.size(), 2n));
    });

    test("description and disabled round-trip", $ => {
        const r = $.let(RadioCardGroup.Root({ value: "a", items: [
            { value: "a", label: "A", description: "first" },
            { value: "b", label: "B", disabled: true },
        ] }));
        const items = $.let(r.unwrap().unwrap("RadioCardGroup").items);
        $(Assert.equal(items.get(0n).description.unwrap("some"), "first"));
        $(Assert.equal(items.get(1n).disabled.unwrap("some"), true));
    });

    test("orientation literal sets variant tag", $ => {
        const r = $.let(RadioCardGroup.Root({ value: "x", items: [{ value: "x", label: "X" }], orientation: "horizontal" }));
        const style = $.let(r.unwrap().unwrap("RadioCardGroup").style.unwrap("some"));
        $(Assert.equal(style.orientation.unwrap("some").hasTag("horizontal"), true));
    });

    test("selectedBorderColor / selectedCardBackground round-trip", $ => {
        const r = $.let(RadioCardGroup.Root({ value: "x", items: [{ value: "x", label: "X" }], 
            selectedCardBackground: "bg.brand.subtle",
            selectedBorderColor: "border.brand",
        }));
        const style = $.let(r.unwrap().unwrap("RadioCardGroup").style.unwrap("some"));
        $(Assert.equal(style.selectedCardBackground.unwrap("some"), "bg.brand.subtle"));
        $(Assert.equal(style.selectedBorderColor.unwrap("some"), "border.brand"));
    });

    test("onChange callback round-trips on main", $ => {
        const onChange = East.function([StringType], NullType, (_$, _v) => { /* noop */ });
        const r = $.let(RadioCardGroup.Root({ value: "x", items: [{ value: "x", label: "X" }], onChange }));
        $(Assert.equal(r.unwrap().unwrap("RadioCardGroup").onChange.hasTag("some"), true));
    });
}, { platformFns: TestImpl });
