/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { East, type ExprType } from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { UIComponentType } from "@elaraai/east-ui";
import { IconButton, ToggleTip } from "@elaraai/east-ui/internal";
import * as ex from "./toggle-tip.examples.js";

/** An option `<ToggleTip>` declares that neither its style struct nor its root holds — none (#1036). */
type Dropped = Exclude<keyof Parameters<typeof ToggleTip.Root>[1], keyof typeof ToggleTip.Types.Style.fields | keyof typeof ToggleTip.Types.ToggleTip.fields>;
const held: [Dropped] extends [never] ? true : Dropped = true;

describeEast("ToggleTip", (test) => {
    Assert.examples(test, {
        toggleTipBasic: ex.toggleTipBasic,
        toggleTipVariants: ex.toggleTipVariants,
        toggleTipOpenFromState: ex.toggleTipOpenFromState,
    });

    test("OO1–OO3, OO7 (#1036): every option it declares is encoded — open, defaultOpen and the close options", $ => {
        const tip = $.let(ToggleTip.Root("The score weighs the last four weeks.", {
            trigger: IconButton.Root({ prefix: "fas", name: "circle-info", label: "Info" }),
            open: true, defaultOpen: false, closeOnInteractOutside: false, closeOnEscape: false,
        }));
        const style = $.let(tip.unwrap().unwrap("ToggleTip").style.unwrap("some"));
        $(Assert.equal(style.open.unwrap("some"), true));
        $(Assert.equal(style.defaultOpen.unwrap("some"), false));
        $(Assert.equal(style.closeOnInteractOutside.unwrap("some"), false));
        $(Assert.equal(style.closeOnEscape.unwrap("some"), false));
        $(Assert.equal(East.value(held), true));
    });

    test("toggleTipVariants is the live configurator", $ => {
        const panel = $.const(ex.toggleTipVariants.fn() as ExprType<UIComponentType>);
        $(Assert.equal(panel.unwrap().hasTag("ReactiveComponent"), true));
    });
}, { platformFns: TestImpl });
