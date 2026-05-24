/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { Button, Heading, Reactive, Stack, State, Style, UIComponentType } from "@elaraai/east-ui";

export const headingBasic = example({
    keywords: ["Heading", "Root", "basic"],
    description: "Simple heading with no styling",
    fn: East.function([], UIComponentType, (_$) => {
        return Heading.Root("Hello World");
    }),
    inputs: [],
});

export const headingStandardSizes = example({
    keywords: ["Heading", "Root", "textStyle", "heading-xs", "heading-sm", "heading-md", "heading-lg"],
    description: "Heading textStyles xs through lg",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Heading.Root("Extra Small (heading-xs)", { textStyle: "heading-xs" }),
            Heading.Root("Small (heading-sm)", { textStyle: "heading-sm" }),
            Heading.Root("Medium (heading-md)", { textStyle: "heading-md" }),
            Heading.Root("Large (heading-lg)", { textStyle: "heading-lg" }),
        ], { gap: "2", align: "flex-start" });
    }),
    inputs: [],
});

export const headingExtendedSizes = example({
    keywords: ["Heading", "Root", "textStyle", "display-sm", "display-md", "display-lg", "display-xl"],
    description: "Display textStyles for large page titles",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Heading.Root("Display Small", { textStyle: "display-sm" }),
            Heading.Root("Display Medium", { textStyle: "display-md" }),
            Heading.Root("Display Large", { textStyle: "display-lg" }),
            Heading.Root("Display Extra Large", { textStyle: "display-xl" }),
        ], { gap: "2", align: "flex-start" });
    }),
    inputs: [],
});

export const headingSemanticLevels = example({
    keywords: ["Heading", "Root", "as", "h1", "h2", "h3", "h4", "semantic"],
    description: "HTML heading elements h1-h6",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Heading.Root("H1 - Main Title", { as: "h1", textStyle: "display-xl" }),
            Heading.Root("H2 - Section", { as: "h2", textStyle: "heading-lg" }),
            Heading.Root("H3 - Subsection", { as: "h3", textStyle: "heading-md" }),
            Heading.Root("H4 - Minor", { as: "h4", textStyle: "heading-sm" }),
        ], { gap: "2", align: "flex-start" });
    }),
    inputs: [],
});

export const headingColored = example({
    keywords: ["Heading", "Root", "color", "blue", "green", "purple"],
    description: "Headings with different colors",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Heading.Root("Blue Heading", { textStyle: "heading-lg", color: "blue.600" }),
            Heading.Root("Green Heading", { textStyle: "heading-lg", color: "green.600" }),
            Heading.Root("Purple Heading", { textStyle: "heading-lg", color: "purple.600" }),
        ], { gap: "2", align: "flex-start" });
    }),
    inputs: [],
});

export const headingAlignment = example({
    keywords: ["Heading", "Root", "textAlign", "left", "center", "right"],
    description: "Left, center, and right aligned",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Heading.Root("Left Aligned", { textStyle: "heading-md", textAlign: Style.TextAlign("left") }),
            Heading.Root("Center Aligned", { textStyle: "heading-md", textAlign: Style.TextAlign("center") }),
            Heading.Root("Right Aligned", { textStyle: "heading-md", textAlign: Style.TextAlign("right") }),
        ], { gap: "2", align: "stretch" });
    }),
    inputs: [],
});

export const headingCombined = example({
    keywords: ["Heading", "Root", "combined", "textStyle", "as", "color", "textAlign"],
    description: "Page title with all options",
    fn: East.function([], UIComponentType, (_$) => {
        return Heading.Root("Welcome to East UI", {
            as: "h1",
            textStyle: "display-md",
            color: "gray.800",
            textAlign: Style.TextAlign("center"),
        });
    }),
    inputs: [],
});

export const headingBackground = example({
    keywords: ["Heading", "Root", "background", "hero", "coloured-band"],
    description: "Hero heading with a coloured background band",
    fn: East.function([], UIComponentType, (_$) => {
        return Heading.Root("Platform Overview", {
            as: "h2",
            textStyle: "display-sm",
            color: "blue.900",
            background: "blue.50",
            textAlign: Style.TextAlign("center"),
            padding: "4",
        });
    }),
    inputs: [],
});

export const headingInteractive = example({
    keywords: ["Heading", "Reactive", "State", "interactive", "counter"],
    description: "Reactive heading whose text updates from a counter",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const counter = $.let(State.bind([IntegerType], "heading_counter", 0n));
            const value = $.let(counter.read());
            const increment = $.const(East.function([], NullType, $ => {
                const cur = $.let(counter.read());
                $(counter.write(cur.add(1n)));
            }));
            return Stack.VStack([
                Heading.Root(East.str`Click count: ${East.print(value)}`, { textStyle: "heading-lg" }),
                Button.Root("Click me", { onClick: increment }),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});
