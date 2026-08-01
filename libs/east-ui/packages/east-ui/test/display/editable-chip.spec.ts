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
        editableChipReactive: ex.editableChipReactive,
    });

    // =========================================================================
    // Panels — every merged example stays mounted as a captioned row (#462).
    // The mono-uppercase Text captions are the stable per-mini anchors.
    // =========================================================================

    test("editableChipVariants panel mounts one captioned row per merged example", $ => {
        const panel = $.const(ex.editableChipVariants.fn() as ExprType<UIComponentType>);
        const rows = $.const(panel.unwrap().unwrap("Stack").children);
        $(Assert.equal(rows.size(), 6n));
        $(Assert.equal(rows.get(0n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "CHIP DISABLED"));
        $(Assert.equal(rows.get(2n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "CHIP STYLED"));
        $(Assert.equal(rows.get(4n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "CHIP DENSITIES"));
    });

    test("editableChipReactive panel mounts one captioned row per merged example", $ => {
        const panel = $.const(ex.editableChipReactive.fn() as ExprType<UIComponentType>);
        const rows = $.const(panel.unwrap().unwrap("Stack").children);
        $(Assert.equal(rows.size(), 4n));
        $(Assert.equal(rows.get(0n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "CHIP WITH CALLBACK"));
        $(Assert.equal(rows.get(2n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "CHIP REACTIVE"));
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
            background: "blue.50",
            color: "blue.700",
            borderColor: "blue.200",
            triggerIconColor: "blue.500",
        }));
        $(Assert.equal(chip.unwrap().unwrap("EditableChip").style.unwrap("some").background.unwrap("some"), "blue.50"));
        $(Assert.equal(chip.unwrap().unwrap("EditableChip").style.unwrap("some").color.unwrap("some"), "blue.700"));
        $(Assert.equal(chip.unwrap().unwrap("EditableChip").style.unwrap("some").borderColor.unwrap("some"), "blue.200"));
        $(Assert.equal(chip.unwrap().unwrap("EditableChip").style.unwrap("some").triggerIconColor.unwrap("some"), "blue.500"));
    });
}, { platformFns: TestImpl });
