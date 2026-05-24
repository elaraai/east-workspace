/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, NullType, StringType, example, some, none } from "@elaraai/east";
import { Breadcrumb, Reactive, Stack, State, Text, UIComponentType } from "@elaraai/east-ui";

export const breadcrumbBasic = example({
    keywords: ["Breadcrumb", "Root", "navigation", "separator"],
    description: "Basic breadcrumb — mono links, '/' separator, current page in ink",
    fn: East.function([], UIComponentType, (_$) => {
        return Breadcrumb.Root([
            { label: "Home", current: none, onClick: none },
            { label: "Components", current: none, onClick: none },
            { label: "Breadcrumb", current: some(true), onClick: none },
        ]);
    }),
    inputs: [],
});

export const breadcrumbRunAnchor = example({
    keywords: ["Breadcrumb", "Root", "runAnchor", "run", "stamp"],
    description: "Breadcrumb pinned to a run via a trailing run anchor",
    fn: East.function([], UIComponentType, (_$) => {
        return Breadcrumb.Root([
            { label: "SE region", current: none, onClick: none },
            { label: "wk of Sep 16", current: none, onClick: none },
            { label: "Roster builder", current: some(true), onClick: none },
        ], { runAnchor: "run #42" });
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
                    { label: "Home", current: none, onClick: some(navigateTo("Home")) },
                    { label: "Products", current: none, onClick: some(navigateTo("Products")) },
                    { label: "Widgets", current: none, onClick: some(navigateTo("Widgets")) },
                    { label: "Details", current: some(true), onClick: none },
                ]),
                Text.Root(East.str`Current page: ${page}`, { fontWeight: "bold" }),
            ], { gap: "4", align: "flex-start" });
        }));
    }),
    inputs: [],
});
