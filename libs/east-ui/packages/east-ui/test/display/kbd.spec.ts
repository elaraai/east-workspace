/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { type ExprType } from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Kbd } from "@elaraai/east-ui/internal";
import { UIComponentType } from "@elaraai/east-ui";
import * as ex from "./kbd.examples.js";

describeEast("Kbd", (test) => {
    Assert.examples(test, {
        kbdSingle: ex.kbdSingle,
        kbdVariants: ex.kbdVariants,
    });

    test("kbdVariants is the live configurator", $ => {
        const panel = $.const(ex.kbdVariants.fn() as ExprType<UIComponentType>);
        $(Assert.equal(panel.unwrap().hasTag("ReactiveComponent"), true));
    });

    test("creates a single-key Kbd", $ => {
        const kbd = $.let(Kbd.Root(["K"]));
        $(Assert.equal(kbd.unwrap().unwrap("Kbd").keys.size(), 1n));
        $(Assert.equal(kbd.unwrap().unwrap("Kbd").keys.get(0n), "K"));
        $(Assert.equal(kbd.unwrap().unwrap("Kbd").style.hasTag("none"), true));
    });

    test("creates a multi-key chord", $ => {
        const kbd = $.let(Kbd.Root(["⌘", "K"]));
        $(Assert.equal(kbd.unwrap().unwrap("Kbd").keys.size(), 2n));
        $(Assert.equal(kbd.unwrap().unwrap("Kbd").keys.get(0n), "⌘"));
        $(Assert.equal(kbd.unwrap().unwrap("Kbd").keys.get(1n), "K"));
    });

    test("creates a styled Kbd", $ => {
        const kbd = $.let(Kbd.Root(["Ctrl", "Shift", "P"], {
            variant: "solid",
            colorPalette: "brand",
            size: "md",
        }));
        $(Assert.equal(kbd.unwrap().unwrap("Kbd").keys.size(), 3n));
        $(Assert.equal(kbd.unwrap().unwrap("Kbd").style.unwrap("some").variant.unwrap("some").hasTag("solid"), true));
        $(Assert.equal(kbd.unwrap().unwrap("Kbd").style.unwrap("some").colorPalette.unwrap("some").hasTag("brand"), true));
        $(Assert.equal(kbd.unwrap().unwrap("Kbd").style.unwrap("some").size.unwrap("some").hasTag("md"), true));
    });

    test("creates a Kbd with explicit shadow colour", $ => {
        const kbd = $.let(Kbd.Root(["Esc"], {
            shadowColor: "border.subtle",
        }));
        $(Assert.equal(kbd.unwrap().unwrap("Kbd").style.unwrap("some").shadowColor.unwrap("some"), "border.subtle"));
    });
}, { platformFns: TestImpl });
