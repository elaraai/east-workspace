/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */
import { East, NullType, StringType, variant, example } from "@elaraai/east";
import { Breadcrumb, Reactive, Stack, State, Text, UIComponentType } from "../../src/index.js";

export const breadcrumbPlain = example({
    keywords: ["Breadcrumb", "Root", "variant", "plain", "chevron"],
    description: "Default plain variant with chevron separators",
    fn: East.function([], UIComponentType, (_$) => {
        return Breadcrumb.Root([
            { label: "Home", current: variant("none", null), onClick: variant("none", null) },
            { label: "Components", current: variant("none", null), onClick: variant("none", null) },
            { label: "Breadcrumb", current: variant("some", true), onClick: variant("none", null) },
        ], {
            variant: "plain",
        });
    }),
    inputs: [],
});

export const breadcrumbUnderline = example({
    keywords: ["Breadcrumb", "Root", "variant", "underline", "colorPalette"],
    description: "Underline variant with color palette",
    fn: East.function([], UIComponentType, (_$) => {
        return Breadcrumb.Root([
            { label: "Docs", current: variant("none", null), onClick: variant("none", null) },
            { label: "Components", current: variant("none", null), onClick: variant("none", null) },
            { label: "Props", current: variant("some", true), onClick: variant("none", null) },
        ], {
            variant: "underline",
            colorPalette: "blue",
        });
    }),
    inputs: [],
});

export const breadcrumbSizes = example({
    keywords: ["Breadcrumb", "Root", "size", "sm", "md", "lg"],
    description: "Available sizes: sm, md, lg",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Breadcrumb.Root([
                { label: "Home", current: variant("none", null), onClick: variant("none", null) },
                { label: "Products", current: variant("none", null), onClick: variant("none", null) },
                { label: "Item", current: variant("some", true), onClick: variant("none", null) },
            ], { size: "sm" }),
            Breadcrumb.Root([
                { label: "Home", current: variant("none", null), onClick: variant("none", null) },
                { label: "Products", current: variant("none", null), onClick: variant("none", null) },
                { label: "Item", current: variant("some", true), onClick: variant("none", null) },
            ], { size: "md" }),
            Breadcrumb.Root([
                { label: "Home", current: variant("none", null), onClick: variant("none", null) },
                { label: "Products", current: variant("none", null), onClick: variant("none", null) },
                { label: "Item", current: variant("some", true), onClick: variant("none", null) },
            ], { size: "lg" }),
        ], { gap: "4", align: "flex-start" });
    }),
    inputs: [],
});

export const breadcrumbColors = example({
    keywords: ["Breadcrumb", "Root", "colorPalette", "blue", "teal", "purple"],
    description: "Underline variant with different color palettes",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Breadcrumb.Root([
                { label: "Home", current: variant("none", null), onClick: variant("none", null) },
                { label: "Blue", current: variant("some", true), onClick: variant("none", null) },
            ], { variant: "underline", colorPalette: "blue" }),
            Breadcrumb.Root([
                { label: "Home", current: variant("none", null), onClick: variant("none", null) },
                { label: "Teal", current: variant("some", true), onClick: variant("none", null) },
            ], { variant: "underline", colorPalette: "teal" }),
            Breadcrumb.Root([
                { label: "Home", current: variant("none", null), onClick: variant("none", null) },
                { label: "Purple", current: variant("some", true), onClick: variant("none", null) },
            ], { variant: "underline", colorPalette: "purple" }),
        ], { gap: "4", align: "flex-start" });
    }),
    inputs: [],
});

export const breadcrumbInteractive = example({
    keywords: ["Breadcrumb", "Root", "Reactive", "State", "onClick", "interactive"],
    description: "Click items to navigate - uses Reactive.Root to display current page",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const pageBind = $.let(State.bind([StringType], "breadcrumb_page", "Home"));
            const page = $.let(pageBind.read());

            const navigateTo = (target: string) => $.const(East.function([], NullType, $ => {
                $(pageBind.write(target));
            }));

            return Stack.VStack([
                Breadcrumb.Root([
                    { label: "Home", current: variant("none", null), onClick: variant("some", navigateTo("Home")) },
                    { label: "Products", current: variant("none", null), onClick: variant("some", navigateTo("Products")) },
                    { label: "Widgets", current: variant("none", null), onClick: variant("some", navigateTo("Widgets")) },
                    { label: "Details", current: variant("some", true), onClick: variant("none", null) },
                ], { variant: "underline", colorPalette: "blue" }),
                Text.Root(East.str`Current page: ${page}`, { fontWeight: "bold" }),
            ], { gap: "4", align: "flex-start" });
        }));
    }),
    inputs: [],
});
