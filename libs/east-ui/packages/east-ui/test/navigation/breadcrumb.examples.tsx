/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { ArrayType, East, NullType, StringType, example, some, none } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Breadcrumb, Configurator, Reactive, SegmentGroup, Text, VStack } from "@elaraai/east-ui";

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

export const breadcrumbVariants = example({
    keywords: ["Breadcrumb", "Root", "runAnchor", "run", "stamp", "leadingSeparator", "path", "Reactive", "State", "onClick", "interactive", "SegmentGroup", "Configurator", "configurator"],
    description: "Breadcrumb configurator — a chrome preset axis (plain / run-anchor / path) on one live clickable trail; the aside reads the current page",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const pageBind = $.let(State.bind([StringType], "breadcrumb_page", "Home"));
            const page = $.let(pageBind.read());
            const goHome = $.const(East.function([], NullType, $ => { $(pageBind.write("Home")); }));
            const goProducts = $.const(East.function([], NullType, $ => { $(pageBind.write("Products")); }));

            // ONE trail — the run anchor and leading separator compose on;
            // clicks write the page readout beneath.
            return (
                <VStack gap="3" align="stretch">
                    <Breadcrumb
                        items={[
                            { label: "SE region", current: none, onClick: some(goHome) },
                            { label: "wk of Sep 16", current: none, onClick: some(goProducts) },
                            { label: "Roster builder", current: some(true), onClick: none },
                        ]}
                        runAnchor="run #42"
                        leadingSeparator={true}
                    />
                    <Text.MonoLabel>{East.str`PAGE · ${page}`}</Text.MonoLabel>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});
