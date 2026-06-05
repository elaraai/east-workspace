/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { RadioCardGroup, UIComponentType } from "@elaraai/east-ui/internal";
import { East, NullType, StringType } from "@elaraai/east";
import * as ex from "./radio-card-group.examples.js";

describeEast("RadioCardGroup", (test) => {
    Assert.examples(test, {
        radioCardGroupBasic: ex.radioCardGroupBasic,
        radioCardGroupHorizontal: ex.radioCardGroupHorizontal,
        radioCardGroupReactive: ex.radioCardGroupReactive,
        radioCardGroupDisabledItem: ex.radioCardGroupDisabledItem,
        radioCardGroupColourOverrides: ex.radioCardGroupColourOverrides,
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
            selectedCardBackground: "blue.50",
            selectedBorderColor: "blue.500",
        }));
        const style = $.let(r.unwrap().unwrap("RadioCardGroup").style.unwrap("some"));
        $(Assert.equal(style.selectedCardBackground.unwrap("some"), "blue.50"));
        $(Assert.equal(style.selectedBorderColor.unwrap("some"), "blue.500"));
    });

    test("onChange callback round-trips on main", $ => {
        const onChange = East.function([StringType], NullType, (_$, _v) => { /* noop */ });
        const r = $.let(RadioCardGroup.Root({ value: "x", items: [{ value: "x", label: "X" }], onChange }));
        $(Assert.equal(r.unwrap().unwrap("RadioCardGroup").onChange.hasTag("some"), true));
    });
}, { platformFns: TestImpl });
