/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { Button, Link, Reactive, Stack, State, Text, UIComponentType } from "@elaraai/east-ui";

export const linkBasic = example({
    keywords: ["Link", "Root", "basic", "hyperlink"],
    description: "Simple hyperlink",
    fn: East.function([], UIComponentType, (_$) => {
        return Link.Root("Click here", { href: "/home" });
    }),
    inputs: [],
});

export const linkExternal = example({
    keywords: ["Link", "Root", "external", "new tab"],
    description: "Opens in new tab",
    fn: East.function([], UIComponentType, (_$) => {
        return Link.Root("Visit GitHub", { href: "https://github.com", external: true });
    }),
    inputs: [],
});

export const linkUnderline = example({
    keywords: ["Link", "Root", "variant", "underline"],
    description: "Link with underline decoration",
    fn: East.function([], UIComponentType, (_$) => {
        return Link.Root("Underlined Link", { href: "/about", variant: "underline" });
    }),
    inputs: [],
});

export const linkPlain = example({
    keywords: ["Link", "Root", "variant", "plain"],
    description: "Link without decoration",
    fn: East.function([], UIComponentType, (_$) => {
        return Link.Root("Plain Link", { href: "/contact", variant: "plain" });
    }),
    inputs: [],
});

export const linkColors = example({
    keywords: ["Link", "Root", "colorPalette", "blue", "teal", "purple", "red"],
    description: "Links with different colors",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Link.Root("Blue", { href: "/page", colorPalette: "blue" }),
            Link.Root("Teal", { href: "/page", colorPalette: "teal" }),
            Link.Root("Purple", { href: "/page", colorPalette: "purple" }),
            Link.Root("Red", { href: "/page", colorPalette: "red" }),
        ], { gap: "4" });
    }),
    inputs: [],
});

export const linkInContext = example({
    keywords: ["Link", "Root", "inline", "context", "text"],
    description: "Link within text flow",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Text.Root("Read the "),
            Link.Root("documentation", { href: "/docs", colorPalette: "blue" }),
            Text.Root(" for more info."),
        ], { gap: "1" });
    }),
    inputs: [],
});

export const linkCombined = example({
    keywords: ["Link", "Root", "combined", "external", "variant", "colorPalette"],
    description: "External link with all options",
    fn: East.function([], UIComponentType, (_$) => {
        return Link.Root("View Documentation", {
            href: "https://docs.example.com",
            external: true,
            variant: "underline",
            colorPalette: "blue",
        });
    }),
    inputs: [],
});

export const linkInteractive = example({
    keywords: ["Link", "Reactive", "State", "interactive", "counter"],
    description: "Reactive link whose label updates from a counter",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const counter = $.let(State.bind([IntegerType], "link_counter", 0n));
            const value = $.let(counter.read());
            const increment = $.const(East.function([], NullType, $ => {
                const cur = $.let(counter.read());
                $(counter.write(cur.add(1n)));
            }));
            return Stack.VStack([
                Text.Root("Click the button to relabel the link:"),
                Link.Root(East.str`Visited ${East.print(value)} times — click here`, { href: "https://example.com", external: true }),
                Button.Root("Bump label", { onClick: increment }),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});
