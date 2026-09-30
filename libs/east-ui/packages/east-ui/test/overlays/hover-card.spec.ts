/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { East, type ExprType } from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { UIComponentType } from "@elaraai/east-ui";
import { HoverCard, Text } from "@elaraai/east-ui/internal";
import * as ex from "./hover-card.examples.js";

/** An option `<HoverCard>` declares that neither its style struct nor its root holds — none (#1036). */
type Dropped = Exclude<keyof Parameters<typeof HoverCard.Root>[1], keyof typeof HoverCard.Types.Style.fields | keyof typeof HoverCard.Types.HoverCard.fields>;
const held: [Dropped] extends [never] ? true : Dropped = true;

describeEast("HoverCard", (test) => {
    Assert.examples(test, {
        hoverCardProfile: ex.hoverCardProfile,
        hoverCardVariants: ex.hoverCardVariants,
        hoverCardOpenFromState: ex.hoverCardOpenFromState,
    });

    test("OO1, OO2, OO4, OO7 (#1036): every option it declares is encoded — open, defaultOpen and the mount options", $ => {
        const card = $.let(HoverCard.Root([Text.Root("Body")], {
            trigger: Text.Root("@johndoe"), open: true, defaultOpen: false, lazyMount: true, unmountOnExit: true,
        }));
        const style = $.let(card.unwrap().unwrap("HoverCard").style.unwrap("some"));
        $(Assert.equal(style.open.unwrap("some"), true));
        $(Assert.equal(style.defaultOpen.unwrap("some"), false));
        $(Assert.equal(style.lazyMount.unwrap("some"), true));
        $(Assert.equal(style.unmountOnExit.unwrap("some"), true));
        $(Assert.equal(East.value(held), true));
    });

    test("hoverCardVariants is the live configurator", $ => {
        const panel = $.const(ex.hoverCardVariants.fn() as ExprType<UIComponentType>);
        $(Assert.equal(panel.unwrap().hasTag("ReactiveComponent"), true));
    });
}, { platformFns: TestImpl });
