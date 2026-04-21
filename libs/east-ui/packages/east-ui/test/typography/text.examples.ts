/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { Button, Reactive, State, Text, Stack, Style, UIComponentType } from "@elaraai/east-ui";

export const textBasic = example({
    keywords: ["Text", "Root", "basic"],
    description: "Plain text with no styling",
    fn: East.function([], UIComponentType, (_$) => {
        return Text.Root("Hello World - Basic Text");
    }),
    inputs: [],
});

export const textColored = example({
    keywords: ["Text", "Root", "color", "blue"],
    description: "Text with blue color",
    fn: East.function([], UIComponentType, (_$) => {
        return Text.Root("Blue colored text", { color: "blue.500" });
    }),
    inputs: [],
});

export const textBold = example({
    keywords: ["Text", "Root", "fontWeight", "bold"],
    description: "Text with bold font weight",
    fn: East.function([], UIComponentType, (_$) => {
        return Text.Root("Bold text", { fontWeight: Style.FontWeight("bold") });
    }),
    inputs: [],
});

export const textItalic = example({
    keywords: ["Text", "Root", "fontStyle", "italic"],
    description: "Text with italic font style",
    fn: East.function([], UIComponentType, (_$) => {
        return Text.Root("Italic text", { fontStyle: Style.FontStyle("italic") });
    }),
    inputs: [],
});

export const textFontWeights = example({
    keywords: ["Text", "Root", "fontWeight", "weights", "light", "normal", "medium", "semibold", "bold"],
    description: "All available font weights",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Text.Root("Light", { fontWeight: Style.FontWeight("light") }),
            Text.Root("Normal", { fontWeight: Style.FontWeight("normal") }),
            Text.Root("Medium", { fontWeight: Style.FontWeight("medium") }),
            Text.Root("Semibold", { fontWeight: Style.FontWeight("semibold") }),
            Text.Root("Bold", { fontWeight: Style.FontWeight("bold") }),
        ], { gap: "4" });
    }),
    inputs: [],
});

export const textTransforms = example({
    keywords: ["Text", "Root", "textTransform", "uppercase", "lowercase", "capitalize"],
    description: "Text transformation options",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Text.Root("uppercase", { textTransform: Style.TextTransform("uppercase") }),
            Text.Root("LOWERCASE", { textTransform: Style.TextTransform("lowercase") }),
            Text.Root("capitalize", { textTransform: Style.TextTransform("capitalize") }),
        ], { gap: "4" });
    }),
    inputs: [],
});

export const textBackground = example({
    keywords: ["Text", "Root", "background", "highlight"],
    description: "Text with background highlight",
    fn: East.function([], UIComponentType, (_$) => {
        return Text.Root("Highlighted text", {
            background: "yellow.200",
            color: "gray.800",
        });
    }),
    inputs: [],
});

export const textBordered = example({
    keywords: ["Text", "Root", "border", "borderWidth", "borderStyle", "borderColor"],
    description: "Text with border styling",
    fn: East.function([], UIComponentType, (_$) => {
        return Text.Root("Bordered text", {
            borderWidth: Style.BorderWidth("thin"),
            borderStyle: Style.BorderStyle("solid"),
            borderColor: "gray.400",
        });
    }),
    inputs: [],
});

export const textColors = example({
    keywords: ["Text", "Root", "color", "palette", "red", "orange", "green", "teal", "blue", "purple"],
    description: "Various text colors",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Text.Root("Red", { color: "red.500" }),
            Text.Root("Orange", { color: "orange.500" }),
            Text.Root("Green", { color: "green.500" }),
            Text.Root("Teal", { color: "teal.500" }),
            Text.Root("Blue", { color: "blue.500" }),
            Text.Root("Purple", { color: "purple.500" }),
        ], { gap: "3" });
    }),
    inputs: [],
});

export const textCombined = example({
    keywords: ["Text", "Root", "combined", "color", "fontWeight", "fontStyle", "background"],
    description: "Multiple styles on one text",
    fn: East.function([], UIComponentType, (_$) => {
        return Text.Root("Styled Text", {
            color: "blue.600",
            fontWeight: Style.FontWeight("bold"),
            fontStyle: Style.FontStyle("italic"),
            background: "blue.50",
        });
    }),
    inputs: [],
});

export const textDecoration = example({
    keywords: ["Text", "Root", "textDecoration", "underline", "line-through", "overline"],
    description: "Underline, line-through, and overline",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Text.Root("Underline", { textDecoration: "underline" }),
            Text.Root("Line-through", { textDecoration: "line-through" }),
            Text.Root("Overline", { textDecoration: "overline" }),
        ], { gap: "4" });
    }),
    inputs: [],
});

export const textSpacing = example({
    keywords: ["Text", "Root", "letterSpacing", "lineHeight", "spacing"],
    description: "Fine-tune text spacing",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Text.Root("Tight letter spacing", { letterSpacing: "tighter" }),
            Text.Root("Wide letter spacing", { letterSpacing: "wider" }),
            Text.Root("Tall line height - wraps to show multi-line effect when the text is long enough", { lineHeight: "tall", maxWidth: "250px" }),
            Text.Root("Short line height - compact multi-line text when the content wraps", { lineHeight: "short", maxWidth: "250px" }),
        ], { gap: "2", align: "flex-start" });
    }),
    inputs: [],
});

export const textOpacity = example({
    keywords: ["Text", "Root", "opacity", "transparency"],
    description: "Text with varying opacity",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Text.Root("100%", { color: "blue.600", fontWeight: "bold" }),
            Text.Root("75%", { color: "blue.600", fontWeight: "bold", opacity: 0.75 }),
            Text.Root("50%", { color: "blue.600", fontWeight: "bold", opacity: 0.5 }),
            Text.Root("25%", { color: "blue.600", fontWeight: "bold", opacity: 0.25 }),
        ], { gap: "4" });
    }),
    inputs: [],
});

export const textPaddingMargin = example({
    keywords: ["Text", "Root", "padding", "margin", "spacing"],
    description: "Text with padding and margin",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Text.Root("Padding: 4", {
                padding: "4",
                background: "blue.50",
                borderWidth: "thin",
                borderStyle: "solid",
                borderColor: "blue.200",
            }),
            Text.Root("Padding: 2, Margin: 4", {
                padding: "2",
                margin: "4",
                background: "green.50",
                borderWidth: "thin",
                borderStyle: "solid",
                borderColor: "green.200",
            }),
        ], { gap: "2", align: "flex-start" });
    }),
    inputs: [],
});

export const textOverflow = example({
    keywords: ["Text", "Root", "overflow", "width", "height", "textOverflow", "ellipsis"],
    description: "Text with constrained size and overflow",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Text.Root("This text is constrained to 200px width and will clip overflow content.", {
                width: "200px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                background: "orange.50",
                padding: "2",
            }),
            Text.Root("Fixed width and height box", {
                width: "150px",
                height: "40px",
                background: "purple.50",
                padding: "2",
                overflow: "hidden",
            }),
        ], { gap: "2", align: "flex-start" });
    }),
    inputs: [],
});

export const textInteractive = example({
    keywords: ["Text", "Reactive", "State", "interactive", "counter"],
    description: "Reactive text whose content updates from a counter",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const counter = $.let(State.bind([IntegerType], "text_counter", 0n));
            const value = $.let(counter.read());
            const increment = $.const(East.function([], NullType, $ => {
                const cur = $.let(counter.read());
                $(counter.write(cur.add(1n)));
            }));
            return Stack.VStack([
                Text.Root(East.str`Clicked ${East.print(value)} times`),
                Button.Root("Click me", { onClick: increment }),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});
