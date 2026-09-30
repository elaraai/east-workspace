/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { East, type ExprType } from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { UIComponentType } from "@elaraai/east-ui";
import { Button, Popover, Text } from "@elaraai/east-ui/internal";
import * as ex from "./popover.examples.js";

/** An option `<Popover>` declares that neither its style struct nor its root holds — none (#1036). */
type Dropped = Exclude<keyof Parameters<typeof Popover.Root>[1], keyof typeof Popover.Types.Style.fields | keyof typeof Popover.Types.Popover.fields>;
const held: [Dropped] extends [never] ? true : Dropped = true;

describeEast("Popover", (test) => {
    Assert.examples(test, {
        popoverBasic: ex.popoverBasic,
        popoverVariants: ex.popoverVariants,
        popoverOpenFromState: ex.popoverOpenFromState,
    });

    test("OO1–OO5, OO7 (#1036): every option it declares is encoded — open, defaultOpen, the close options, autoFocus, the mount options and gutter", $ => {
        const popover = $.let(Popover.Root([Text.Root("Body")], {
            trigger: Button.Root("Open"), open: true, defaultOpen: false, closeOnInteractOutside: false, closeOnEscape: false,
            autoFocus: false, lazyMount: true, unmountOnExit: true, gutter: 6n,
        }));
        const style = $.let(popover.unwrap().unwrap("Popover").style.unwrap("some"));
        $(Assert.equal(style.open.unwrap("some"), true));
        $(Assert.equal(style.defaultOpen.unwrap("some"), false));
        $(Assert.equal(style.closeOnInteractOutside.unwrap("some"), false));
        $(Assert.equal(style.closeOnEscape.unwrap("some"), false));
        $(Assert.equal(style.autoFocus.unwrap("some"), false));
        $(Assert.equal(style.lazyMount.unwrap("some"), true));
        $(Assert.equal(style.unmountOnExit.unwrap("some"), true));
        $(Assert.equal(style.gutter.unwrap("some"), 6n));
        $(Assert.equal(East.value(held), true));
    });

    test("popoverVariants is the live configurator", $ => {
        const panel = $.const(ex.popoverVariants.fn() as ExprType<UIComponentType>);
        $(Assert.equal(panel.unwrap().hasTag("ReactiveComponent"), true));
    });
}, { platformFns: TestImpl });
