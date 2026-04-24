/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { East, NullType, example } from "@elaraai/east";
import { EditableChip, Text, UIComponentType } from "../../src/index.js";

export const editableChipBasic = example({
    keywords: ["EditableChip", "Root", "label"],
    description: "Basic editable chip with default trigger icon",
    fn: East.function([], UIComponentType, ($) => {
        return EditableChip.Root(Text.Root("Service level · 85%"));
    }),
    inputs: [],
});

export const editableChipWithCallback = example({
    keywords: ["EditableChip", "Root", "onClick", "callback"],
    description: "Editable chip with an onClick callback",
    fn: East.function([], UIComponentType, ($) => {
        const onClick = $.const(East.function([], NullType, _ => {}));
        return EditableChip.Root(Text.Root("Scenario: Q4 forecast"), { onClick });
    }),
    inputs: [],
});

export const editableChipDisabled = example({
    keywords: ["EditableChip", "Root", "disabled"],
    description: "Disabled editable chip",
    fn: East.function([], UIComponentType, ($) => {
        return EditableChip.Root(Text.Root("Locked assumption"), { disabled: true });
    }),
    inputs: [],
});

export const editableChipStyled = example({
    keywords: ["EditableChip", "Root", "style", "colour"],
    description: "Editable chip with explicit colour slots",
    fn: East.function([], UIComponentType, ($) => {
        return EditableChip.Root(Text.Root("Demand mix · balanced"), {
            background: "blue.50",
            color: "blue.700",
            borderColor: "blue.200",
            triggerIconColor: "blue.500",
        });
    }),
    inputs: [],
});
