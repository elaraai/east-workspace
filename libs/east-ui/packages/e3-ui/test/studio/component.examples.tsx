/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */

/**
 * Studio components (#991) — a component is an East UI function written like a
 * `ui()` body, declared once with what the palette shows; a page places it by
 * its key.
 */

import { East, IntegerType, NullType, example, none, variant } from "@elaraai/east";
import { Box, Button, HStack, Reactive, State, Text, UIComponentType } from "@elaraai/east-ui";
import { Studio } from "@elaraai/e3-ui";

export const studioComponent = example({
    keywords: [
        "Studio", "component", "Studio.component", "Studio.Page", "palette", "placement", "self-contained",
        "ui() body", "state", "shared state", "meta", "span", "category", "icon",
    ],
    description: "A self-contained component — an East UI function written like a ui() body, declared once with what the palette shows — placed twice on a page, where the two placements share its own state",
    fn: East.function([], UIComponentType, ($) => {
        const counter = $.let(Studio.component("counter", {
            name: "Counter", category: "Display", icon: "gauge-high", span: 6n, description: "Clicks so far",
        }, East.function([], UIComponentType, _$ => (
            <Reactive>{$2 => {
                const clicks = $2.let(State.bind([IntegerType], "studio-component.clicks", 0n));
                const add = $2.const(East.function([], NullType, $3 => { $3(clicks.write(clicks.read().add(1n))); }));
                return (
                    <Box padding="4">
                        <HStack gap="3" align="center">
                            <Text>{East.str`${East.print(clicks.read())} clicks`}</Text>
                            <Button size="xs" onClick={add}>Add</Button>
                        </HStack>
                    </Box>
                );
            }}</Reactive>
        ))));
        const components = $.let([counter]);
        const pages = $.let(new Map([
            [{ project: "demo", page: "counters" }, variant("page", {
                draft: {
                    title: "Counters",
                    cells: [
                        { key: "c-one", row: "r1", span: 6n, height: none, align: variant("top", null), title: none, component: "counter", fingerprint: "" },
                        { key: "c-two", row: "r1", span: 6n, height: none, align: variant("top", null), title: none, component: "counter", fingerprint: "" },
                    ],
                },
                live: none,
            })],
        ]), Studio.Types.Pages);
        return <Studio.Page pages={pages} components={components} page={{ project: "demo", page: "counters" }} version="draft" />;
    }),
    inputs: [],
});
