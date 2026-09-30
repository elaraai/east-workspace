/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { East } from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { ActionBar } from "@elaraai/east-ui/internal";

/** An option `<ActionBar>` declares that neither its style struct nor its root holds — none (#1036). */
type Dropped = Exclude<keyof NonNullable<Parameters<typeof ActionBar.Root>[1]>, keyof typeof ActionBar.Types.Style.fields | keyof typeof ActionBar.Types.ActionBar.fields>;
const held: [Dropped] extends [never] ? true : Dropped = true;

describeEast("ActionBar", (test) => {
    test("OO1, OO3, OO7 (#1036): every option it declares is encoded — open in place of the selection count's, and the close options", $ => {
        const bar = $.let(ActionBar.Root([ActionBar.Action("archive", "Archive")], {
            selectionCount: 3n, open: false, closeOnInteractOutside: false, closeOnEscape: false,
        }));
        const value = $.let(bar.unwrap().unwrap("ActionBar"));
        const style = $.let(value.style.unwrap("some"));
        $(Assert.equal(value.selectionCount.unwrap("some"), 3n));
        $(Assert.equal(style.open.unwrap("some"), false));
        $(Assert.equal(style.closeOnInteractOutside.unwrap("some"), false));
        $(Assert.equal(style.closeOnEscape.unwrap("some"), false));
        $(Assert.equal(East.value(held), true));
    });

    test("without options, it has no style — the selection count opens it", $ => {
        const bar = $.let(ActionBar.Root([ActionBar.Action("archive", "Archive")], { selectionCount: 2n }));
        $(Assert.equal(bar.unwrap().unwrap("ActionBar").style.hasTag("none"), true));
    });
}, { platformFns: TestImpl });
