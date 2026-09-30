/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { East, type ExprType } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { Button, Drawer, Text } from "@elaraai/east-ui/internal";
import * as ex from "./drawer.examples.js";

/** An option `<Drawer>` declares that neither its style struct nor its root holds — none (#1036). */
type Dropped = Exclude<keyof Parameters<typeof Drawer.Root>[1], keyof typeof Drawer.Types.Style.fields | keyof typeof Drawer.Types.Drawer.fields>;
const held: [Dropped] extends [never] ? true : Dropped = true;

describeEast("Drawer", (test) => {
    Assert.examples(test, {
        drawerBasic: ex.drawerBasic,
        drawerProgrammatic: ex.drawerProgrammatic,
        drawerStackedNested: ex.drawerStackedNested,
        drawerVariants: ex.drawerVariants,
        drawerOpenFromState: ex.drawerOpenFromState,
    });

    test("OO1–OO4, OO7 (#1036): every option it declares is encoded — open, defaultOpen, the close options and the mount options", $ => {
        const drawer = $.let(Drawer.Root([Text.Root("Detail")], {
            trigger: Button.Root("Open"), open: true, defaultOpen: false, closeOnInteractOutside: false, closeOnEscape: false,
            lazyMount: true, unmountOnExit: true,
        }));
        const style = $.let(drawer.unwrap().unwrap("Drawer").style.unwrap("some"));
        $(Assert.equal(style.open.unwrap("some"), true));
        $(Assert.equal(style.defaultOpen.unwrap("some"), false));
        $(Assert.equal(style.closeOnInteractOutside.unwrap("some"), false));
        $(Assert.equal(style.closeOnEscape.unwrap("some"), false));
        $(Assert.equal(style.lazyMount.unwrap("some"), true));
        $(Assert.equal(style.unmountOnExit.unwrap("some"), true));
        $(Assert.equal(East.value(held), true));
    });

    // =========================================================================
    // Panels — every merged example stays mounted as a captioned row (#463).
    // =========================================================================

    test("drawerVariants drives its preview from inline option tables", $ => {
        // Everything the configurator needs — the placement and body-preset
        // tables plus the onOpenChange counter — is declared inside the
        // example body, because the documentation capture only extracts `fn`.
        // That puts the tables inside the Reactive body, which TestImpl does
        // not execute, so they cannot be asserted from here; `Assert.examples`
        // above still compiles and evaluates the outer function. Per-option
        // coverage stays with the remaining Drawer examples, which construct
        // each shape directly.
        const panel = $.const(ex.drawerVariants.fn() as ExprType<UIComponentType>);
        $(Assert.equal(panel.unwrap().hasTag("ReactiveComponent"), true));
    });
}, { platformFns: TestImpl });
