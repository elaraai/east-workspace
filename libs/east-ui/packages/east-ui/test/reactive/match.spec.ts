/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { NullType, StringType, VariantType, variant } from "@elaraai/east";
import { Match, Text, UIComponentType } from "@elaraai/east-ui/internal";
import * as ex from "./match.examples.js";

const ModeType = VariantType({ list: NullType, detail: StringType });

describeEast("Match", (test) => {
    // Both examples compile + evaluate to valid UIComponentType IR (the
    // State-bound `on` reads and the per-case Reactive bodies included).
    Assert.examples(test, {
        matchModeSwitch: ex.matchModeSwitch,
        matchStatefulPanels: ex.matchStatefulPanels,
    });

    test("Match.Root builds a Match slot", $ => {
        const mode = $.const(variant("list", null), ModeType);
        const slot = $.let(Match.Root({
            on: mode,
            cases: {
                list: (_$) => Text.Root("ALL"),
                detail: (_$, id) => Text.Root(id),
            },
        }));
        $(Assert.equal(slot.unwrap().hasTag("Match"), true));
    });

    test("tag yields the active case name", $ => {
        const mode = $.const(variant("detail", "item-1"), ModeType);
        const slot = $.let(Match.Root({
            on: mode,
            cases: {
                list: (_$) => Text.Root("ALL"),
                detail: (_$, id) => Text.Root(id),
            },
        }));
        $(Assert.equal(slot.unwrap().unwrap("Match").tag(), "detail"));
    });

    test("render mounts only the active case with its typed payload", $ => {
        const mode = $.const(variant("detail", "item-1"), ModeType);
        const slot = $.let(Match.Root({
            on: mode,
            cases: {
                list: (_$) => Text.Root("ALL"),
                detail: (_$, id) => Text.Root(id),
            },
        }));
        const body = $.let(slot.unwrap().unwrap("Match").render(), UIComponentType);
        $(Assert.equal(body.unwrap().unwrap("Text").value, "item-1"));
    });
}, { platformFns: TestImpl });
