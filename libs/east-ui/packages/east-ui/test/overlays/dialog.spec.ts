/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { East, type ExprType } from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { UIComponentType } from "@elaraai/east-ui";
import { Button, Dialog, Text } from "@elaraai/east-ui/internal";
import * as ex from "./dialog.examples.js";

/** An option `<Dialog>` declares that neither its style struct nor its root holds — none (#1036). */
type Dropped = Exclude<keyof Parameters<typeof Dialog.Root>[1], keyof typeof Dialog.Types.Style.fields | keyof typeof Dialog.Types.Dialog.fields>;
const held: [Dropped] extends [never] ? true : Dropped = true;
/** The one modal is always modal, traps focus and holds the page still: none of that is an option (#1036). */
type ModalOptions = Extract<keyof Parameters<typeof Dialog.Root>[1], "modal" | "trapFocus" | "preventScroll">;
const noModalOptions: [ModalOptions] extends [never] ? true : ModalOptions = true;

describeEast("Dialog", (test) => {
    Assert.examples(test, {
        dialogBasic: ex.dialogBasic,
        dialogProgrammatic: ex.dialogProgrammatic,
        dialogVariants: ex.dialogVariants,
        dialogOpenFromState: ex.dialogOpenFromState,
    });

    test("OO1–OO4, OO6, OO7 (#1036): every option it declares is encoded, and none makes it less than modal", $ => {
        const dialog = $.let(Dialog.Root([Text.Root("Remove it?")], {
            trigger: Button.Root("Remove…"), open: true, defaultOpen: false, closeOnInteractOutside: false, closeOnEscape: false,
            lazyMount: true, unmountOnExit: true,
        }));
        const style = $.let(dialog.unwrap().unwrap("Dialog").style.unwrap("some"));
        $(Assert.equal(style.open.unwrap("some"), true));
        $(Assert.equal(style.defaultOpen.unwrap("some"), false));
        $(Assert.equal(style.closeOnInteractOutside.unwrap("some"), false));
        $(Assert.equal(style.closeOnEscape.unwrap("some"), false));
        $(Assert.equal(style.lazyMount.unwrap("some"), true));
        $(Assert.equal(style.unmountOnExit.unwrap("some"), true));
        $(Assert.equal(East.value(held), true));
        $(Assert.equal(East.value(noModalOptions), true));
    });

    test("dialogVariants is the live configurator", $ => {
        const panel = $.const(ex.dialogVariants.fn() as ExprType<UIComponentType>);
        $(Assert.equal(panel.unwrap().hasTag("ReactiveComponent"), true));
    });
}, { platformFns: TestImpl });
