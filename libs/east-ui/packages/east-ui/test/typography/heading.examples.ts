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
    keywords: ["Heading", "Root", "size", "xs", "sm", "md", "lg", "xl"],
    description: "xs through xl",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Heading.Root("Extra Small (xs)", { size: "xs" }),
            Heading.Root("Small (sm)", { size: "sm" }),
            Heading.Root("Medium (md)", { size: "md" }),
            Heading.Root("Large (lg)", { size: "lg" }),
            Heading.Root("Extra Large (xl)", { size: "xl" }),
        ], { gap: "2", align: "flex-start" });
    }),
    inputs: [],
});

export const headingExtendedSizes = example({
    keywords: ["Heading", "Root", "size", "2xl", "3xl", "4xl"],
    description: "2xl through 6xl for typography",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Heading.Root("2XL Heading", { size: "2xl" }),
            Heading.Root("3XL Heading", { size: "3xl" }),
            Heading.Root("4XL Heading", { size: "4xl" }),
        ], { gap: "2", align: "flex-start" });
    }),
    inputs: [],
});

export const headingSemanticLevels = example({
    keywords: ["Heading", "Root", "as", "h1", "h2", "h3", "h4", "semantic"],
    description: "HTML heading elements h1-h6",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Heading.Root("H1 - Main Title", { as: "h1", size: "2xl" }),
            Heading.Root("H2 - Section", { as: "h2", size: "xl" }),
            Heading.Root("H3 - Subsection", { as: "h3", size: "lg" }),
            Heading.Root("H4 - Minor", { as: "h4", size: "md" }),
        ], { gap: "2", align: "flex-start" });
    }),
    inputs: [],
});

export const headingColored = example({
    keywords: ["Heading", "Root", "color", "blue", "green", "purple"],
    description: "Headings with different colors",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Heading.Root("Blue Heading", { size: "lg", color: "blue.600" }),
            Heading.Root("Green Heading", { size: "lg", color: "green.600" }),
            Heading.Root("Purple Heading", { size: "lg", color: "purple.600" }),
        ], { gap: "2", align: "flex-start" });
    }),
    inputs: [],
});

export const headingAlignment = example({
    keywords: ["Heading", "Root", "textAlign", "left", "center", "right"],
    description: "Left, center, and right aligned",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Heading.Root("Left Aligned", { size: "md", textAlign: Style.TextAlign("left") }),
            Heading.Root("Center Aligned", { size: "md", textAlign: Style.TextAlign("center") }),
            Heading.Root("Right Aligned", { size: "md", textAlign: Style.TextAlign("right") }),
        ], { gap: "2", align: "stretch" });
    }),
    inputs: [],
});

export const headingCombined = example({
    keywords: ["Heading", "Root", "combined", "size", "as", "color", "textAlign"],
    description: "Page title with all options",
    fn: East.function([], UIComponentType, (_$) => {
        return Heading.Root("Welcome to East UI", {
            size: "3xl",
            as: "h1",
            color: "gray.800",
            textAlign: Style.TextAlign("center"),
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
                Heading.Root(East.str`Click count: ${East.print(value)}`, { size: "lg" }),
                Button.Root("Click me", { onClick: increment }),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});
