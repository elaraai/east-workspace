/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { East, NullType, type ExprType } from "@elaraai/east";
import { EditableChip, Text, UIComponentType } from "@elaraai/east-ui/internal";
import * as ex from "./editable-chip.examples.js";

describeEast("EditableChip", (test) => {
    Assert.examples(test, {
        editableChipBasic: ex.editableChipBasic,
        editableChipVariants: ex.editableChipVariants,
    });

    // =========================================================================
    // Panels — every merged example stays mounted as a captioned row (#462).
    // The mono-uppercase Text captions are the stable per-mini anchors.
    // =========================================================================

    test("editableChipVariants drives its preview from inline option tables", $ => {
        // Everything the configurator needs — the density / radius / colour
        // tables — is declared inside the example body, because the
        // documentation capture only extracts `fn`. That puts the tables inside
        // the Reactive body, which TestImpl does not execute, so they cannot be
        // asserted from here; `Assert.examples` above still compiles and
        // evaluates the outer function. The per-axis coverage lives in the
        // EditableChip.Root tests below, which construct each option directly.
        const panel = $.const(ex.editableChipVariants.fn() as ExprType<UIComponentType>);
        $(Assert.equal(panel.unwrap().hasTag("ReactiveComponent"), true));
    });


    test("creates an EditableChip with a label", $ => {
        const chip = $.let(EditableChip.Root(Text.Root("Scenario")));
        $(Assert.equal(chip.unwrap().unwrap("EditableChip").trigger.hasTag("none"), true));
        $(Assert.equal(chip.unwrap().unwrap("EditableChip").disabled.hasTag("none"), true));
        $(Assert.equal(chip.unwrap().unwrap("EditableChip").onClick.hasTag("none"), true));
        $(Assert.equal(chip.unwrap().unwrap("EditableChip").style.hasTag("none"), true));
    });

    test("creates an EditableChip with onClick", $ => {
        const onClick = $.const(East.function([], NullType, _ => {}));
        const chip = $.let(EditableChip.Root(Text.Root("Click me"), { onClick }));
        $(Assert.equal(chip.unwrap().unwrap("EditableChip").onClick.hasTag("some"), true));
    });

    test("creates a disabled EditableChip", $ => {
        const chip = $.let(EditableChip.Root(Text.Root("Locked"), { disabled: true }));
        $(Assert.equal(chip.unwrap().unwrap("EditableChip").disabled.unwrap("some"), true));
    });

    test("creates an EditableChip with style slots", $ => {
        const chip = $.let(EditableChip.Root(Text.Root("Branded"), {
            background: "bg.brand.subtle",
            color: "link",
            borderColor: "border.brand",
            triggerIconColor: "link",
        }));
        $(Assert.equal(chip.unwrap().unwrap("EditableChip").style.unwrap("some").background.unwrap("some"), "bg.brand.subtle"));
        $(Assert.equal(chip.unwrap().unwrap("EditableChip").style.unwrap("some").color.unwrap("some"), "link"));
        $(Assert.equal(chip.unwrap().unwrap("EditableChip").style.unwrap("some").borderColor.unwrap("some"), "border.brand"));
        $(Assert.equal(chip.unwrap().unwrap("EditableChip").style.unwrap("some").triggerIconColor.unwrap("some"), "link"));
    });

    // The density / radius axes moved into the configurator's Reactive body,
    // which TestImpl never executes — cover them directly here instead.
    test("creates an EditableChip at each density with an explicit radius", $ => {
        const condensed = $.let(EditableChip.Root(Text.Root("Service level · 85%"), { density: "condensed", borderRadius: "sm" }));
        const compact = $.let(EditableChip.Root(Text.Root("Service level · 85%"), { density: "compact", borderRadius: "md" }));
        const comfortable = $.let(EditableChip.Root(Text.Root("Service level · 85%"), { density: "comfortable", borderRadius: "full" }));
        $(Assert.equal(condensed.unwrap().unwrap("EditableChip").density.unwrap("some").hasTag("condensed"), true));
        $(Assert.equal(compact.unwrap().unwrap("EditableChip").density.unwrap("some").hasTag("compact"), true));
        $(Assert.equal(comfortable.unwrap().unwrap("EditableChip").density.unwrap("some").hasTag("comfortable"), true));
        $(Assert.equal(condensed.unwrap().unwrap("EditableChip").style.unwrap("some").borderRadius.unwrap("some"), "sm"));
        $(Assert.equal(comfortable.unwrap().unwrap("EditableChip").style.unwrap("some").borderRadius.unwrap("some"), "full"));
    });
}, { platformFns: TestImpl });
