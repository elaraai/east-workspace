/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, NullType, StringType, example, some, none } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Breadcrumb, VStack, Text, Reactive } from "@elaraai/east-ui/jsx";

export const breadcrumbBasic = example({
    keywords: ["Breadcrumb", "Root", "navigation", "separator"],
    description: "Basic breadcrumb — mono links, '/' separator, current page in ink",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Breadcrumb items={[
                { label: "Home", current: none, onClick: none },
                { label: "Components", current: none, onClick: none },
                { label: "Breadcrumb", current: some(true), onClick: none },
            ]} />
        );
    }),
    inputs: [],
});

export const breadcrumbRunAnchor = example({
    keywords: ["Breadcrumb", "Root", "runAnchor", "run", "stamp"],
    description: "Breadcrumb pinned to a run via a trailing run anchor",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Breadcrumb
                items={[
                    { label: "SE region", current: none, onClick: none },
                    { label: "wk of Sep 16", current: none, onClick: none },
                    { label: "Roster builder", current: some(true), onClick: none },
                ]}
                runAnchor="run #42"
            />
        );
    }),
    inputs: [],
});

export const breadcrumbInteractive = example({
    keywords: ["Breadcrumb", "Root", "Reactive", "State", "onClick", "interactive"],
    description: "Click items to navigate - uses Reactive.Root to display current page",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const pageBind = $.let(State.bind([StringType], "breadcrumb_page", "Home"));
            const page = $.let(pageBind.read());
            const goHome = $.const(East.function([], NullType, $ => {
                $(pageBind.write("Home"));
            }));
            const goProducts = $.const(East.function([], NullType, $ => {
                $(pageBind.write("Products"));
            }));
            const goWidgets = $.const(East.function([], NullType, $ => {
                $(pageBind.write("Widgets"));
            }));

            return (
                <VStack gap="4" align="flex-start">
                    <Breadcrumb items={[
                        { label: "Home", current: none, onClick: some(goHome) },
                        { label: "Products", current: none, onClick: some(goProducts) },
                        { label: "Widgets", current: none, onClick: some(goWidgets) },
                        { label: "Details", current: some(true), onClick: none },
                    ]} />
                    <Text fontWeight="bold">{East.str`Current page: ${page}`}</Text>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});
