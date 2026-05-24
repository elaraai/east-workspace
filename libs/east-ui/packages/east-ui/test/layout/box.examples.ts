/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { Box, Button, Reactive, Stack, State, Text, Style, UIComponentType } from "@elaraai/east-ui";

export const boxBasic = example({
    keywords: ["Box", "Root", "basic", "container"],
    description: "Simple container with no styling",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Text.Root("Content inside a basic box"),
        ]);
    }),
    inputs: [],
});

export const boxStyled = example({
    keywords: ["Box", "Root", "padding", "background", "borderRadius", "color"],
    description: "Box with background, padding, and border radius",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Text.Root("Styled container content"),
        ], {
            padding: "4",
            background: "blue.50",
            color: "blue.800",
            borderRadius: "md",
        });
    }),
    inputs: [],
});

export const boxFlexRow = example({
    keywords: ["Box", "Root", "flex", "row", "justifyContent", "alignItems"],
    description: "Horizontal flex container with gap",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Text.Root("Item 1"),
            Text.Root("Item 2"),
            Text.Root("Item 3"),
        ], {
            display: Style.Display("flex"),
            flexDirection: Style.FlexDirection("row"),
            justifyContent: Style.JustifyContent("space-between"),
            alignItems: Style.AlignItems("center"),
            gap: "4",
            padding: "4",
            background: "gray.100",
            borderRadius: "md",
        });
    }),
    inputs: [],
});

export const boxFlexColumn = example({
    keywords: ["Box", "Root", "flex", "column", "vertical"],
    description: "Vertical flex container with items centered",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Text.Root("Top"),
            Text.Root("Middle"),
            Text.Root("Bottom"),
        ], {
            display: Style.Display("flex"),
            flexDirection: Style.FlexDirection("column"),
            justifyContent: Style.JustifyContent("space-around"),
            alignItems: Style.AlignItems("center"),
            height: "150px",
            padding: "4",
            background: "purple.50",
            color: "purple.800",
            borderRadius: "lg",
        });
    }),
    inputs: [],
});

export const boxFixed = example({
    keywords: ["Box", "Root", "width", "height", "fixed", "dimensions"],
    description: "Box with explicit width and height",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Text.Root("200x100 box"),
        ], {
            display: Style.Display("flex"),
            width: "200px",
            height: "100px",
            justifyContent: Style.JustifyContent("center"),
            alignItems: Style.AlignItems("center"),
            background: "teal.100",
            color: "teal.800",
            borderRadius: "sm",
        });
    }),
    inputs: [],
});

export const boxNested = example({
    keywords: ["Box", "Root", "nested", "container"],
    description: "Box containing another styled box",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Box.Root([
                Text.Root("Inner box"),
            ], {
                padding: "2",
                background: "blue.100",
                borderRadius: "sm",
            }),
        ], {
            padding: "4",
            background: "gray.100",
            borderRadius: "md",
        });
    }),
    inputs: [],
});

export const boxBorders = example({
    keywords: ["Box", "Root", "border", "borderColor", "borderWidth", "solid", "dashed"],
    description: "Box with border, borderColor, and borderWidth",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Box.Root([
                Text.Root("Solid border"),
            ], {
                padding: "4",
                border: "2px solid",
                borderColor: "blue.500",
                borderRadius: "md",
            }),
            Box.Root([
                Text.Root("Dashed border"),
            ], {
                padding: "4",
                border: "2px dashed",
                borderColor: "green.500",
                borderRadius: "md",
            }),
            Box.Root([
                Text.Root("Custom width"),
            ], {
                padding: "4",
                borderWidth: "4px",
                borderColor: "red.500",
                background: "red.50",
                borderRadius: "lg",
            }),
        ], {
            display: Style.Display("flex"),
            gap: "4",
        });
    }),
    inputs: [],
});

export const boxJustify = example({
    keywords: ["Box", "Root", "justifyContent", "flex-start", "center", "flex-end"],
    description: "Different justify-content values",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Box.Root([Text.Root("start")], {
                display: Style.Display("flex"),
                justifyContent: Style.JustifyContent("flex-start"),
                padding: "2",
                background: "green.100",
                borderRadius: "sm",
            }),
            Box.Root([Text.Root("center")], {
                display: Style.Display("flex"),
                justifyContent: Style.JustifyContent("center"),
                padding: "2",
                background: "green.100",
                borderRadius: "sm",
            }),
            Box.Root([Text.Root("end")], {
                display: Style.Display("flex"),
                justifyContent: Style.JustifyContent("flex-end"),
                padding: "2",
                background: "green.100",
                borderRadius: "sm",
            }),
        ], {
            display: Style.Display("flex"),
            flexDirection: Style.FlexDirection("column"),
            gap: "2",
        });
    }),
    inputs: [],
});

export const boxInteractive = example({
    keywords: ["Box", "Reactive", "State", "interactive", "background", "toggle"],
    description: "Box whose background colour alternates each click",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const counter = $.let(State.bind([IntegerType], "box_counter", 0n));
            const value = $.let(counter.read());
            const isEven = $.let(value.remainder(2n).equal(0n));
            const bg = $.let(isEven.ifElse(() => East.value("blue.100"), () => East.value("green.100")));
            const inc = $.const(East.function([], NullType, $ => {
                const cur = $.let(counter.read());
                $(counter.write(cur.add(1n)));
            }));
            return Stack.VStack([
                Box.Root([
                    Text.Root("Box background toggles between blue and green"),
                ], { padding: "4", background: bg, borderRadius: "md" }),
                Button.Root("Toggle background", { onClick: inc }),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});

// -----------------------------------------------------------------------------
// Tokenised style fields: position / shadow / animation / fontVariantNumeric
// -----------------------------------------------------------------------------

export const boxSticky = example({
    keywords: ["Box", "position", "sticky", "scroll", "header"],
    description: "Box with position=\"sticky\" — a header row that stays pinned while its parent scrolls",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Box.Root([Text.Root("Sticky header")], {
                position: "sticky",
                top: "0",
                zIndex: "sticky",
                padding: "3",
                background: "white",
                borderColor: "gray.200",
                borderWidth: "thin",
            }),
            Stack.VStack(
                Array.from({ length: 10 }, (_, i) => Text.Root(`Row ${i + 1}`)),
                { gap: "2", padding: "3" },
            ),
        ], { overflowY: "auto", height: "240px", borderColor: "gray.300", borderWidth: "thin" });
    }),
    inputs: [],
});

export const boxElevated = example({
    keywords: ["Box", "boxShadow", "borderRadius", "elevated", "card"],
    description: "Box with boxShadow=\"md\" + borderRadius=\"md\" to produce a card surface",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Text.Root("Elevated card — BoxShadow.md"),
        ], {
            padding: "4",
            background: "white",
            borderRadius: "md",
            boxShadow: "md",
        });
    }),
    inputs: [],
});

export const boxAnimated = example({
    keywords: ["Box", "animation", "pulse", "status", "live", "recomputing"],
    description: "Box with animation=\"pulse\" — a \"recomputing\" status dot inside a chip",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Box.Root([], {
                width: "10px",
                height: "10px",
                borderRadius: "full",
                background: "orange.500",
                animation: "pulse",
            }),
            Text.Root("Recomputing…"),
        ], { gap: "2", align: "center" });
    }),
    inputs: [],
});

export const boxTabularNumeric = example({
    keywords: ["Box", "fontFamily", "mono", "fontVariantNumeric", "tabular-nums", "KPI"],
    description: "Box with fontFamily=\"mono\" + fontVariantNumeric=\"tabular-nums\" — KPI digits align across rows",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Stack.VStack([
                Text.Root("  1,234.56"),
                Text.Root("    56.07"),
                Text.Root("789,012.30"),
            ], { gap: "1", align: "flex-end" }),
        ], {
            fontFamily: "mono",
            fontVariantNumeric: "tabular-nums",
            padding: "3",
            background: "gray.50",
            borderRadius: "md",
        });
    }),
    inputs: [],
});
