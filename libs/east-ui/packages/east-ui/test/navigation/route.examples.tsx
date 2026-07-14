/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, NullType, StringType, IntegerType, StructType, example } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { Navigation, Route, Pages, Reactive, VStack, HStack, Box, Text, Button } from "@elaraai/east-ui";

/**
 * `<Route>` is `<Pages>` generalized to any slot: renders only the active
 * route's body and remounts it on navigation, but placeable anywhere. Here a
 * single Route slot hosts a per-route widget driven by the bound nav handle.
 */
export const routeBasic = example({
    keywords: ["Route", "Navigation", "nav", "routes", "hosting slot", "remount", "navigate", "widget"],
    description: "A Route slot hosts a per-route widget — typed payload per route, remounts on navigation",
    fn: East.function([], UIComponentType, (_$) => {
        const ItemRow = StructType({ id: StringType, value: IntegerType });
        const routes = Navigation.config({
            overview: { value: NullType, label: "Overview" },
            detail: { value: ItemRow, label: "Item" },
        });
        return (
            <Reactive>{$ => {
                const nav = $.let(Navigation.bind(routes, "route.basic", [routes.Page.overview()]));
                const open = $.const(East.function([], NullType, $ => {
                    $(nav.go.detail(East.value({ id: "item-1", value: 42n }, ItemRow)));
                }));
                const back = $.const(East.function([], NullType, $ => { $(nav.pop()); }));
                return (
                    <VStack gap="3" align="stretch">
                        <HStack gap="2">
                            <Button onClick={open}>Open item-1</Button>
                            <Button onClick={back}>← Back</Button>
                        </HStack>
                        <Route nav={nav} routes={{
                            overview: () => <Text>Overview widget</Text>,
                            detail: (_$, row) => <Text>{East.str`Item ${row.id} — value ${East.print(row.value)}`}</Text>,
                        }} />
                    </VStack>
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

/**
 * The body `<Pages>` and a sidebar `<Route>` bind the **same** nav handle, so
 * they stay in lockstep and each remounts *its own* slot on navigation — the
 * behaviour `<Pages>` had for the page body, now available for any slot.
 */
export const routeSidebarSlot = example({
    keywords: ["Route", "Pages", "Navigation", "sidebar", "slot", "lockstep", "app shell", "remount"],
    description: "A sidebar Route slot beside the body Pages — one nav handle drives both, each remounts its own slot on navigation",
    fn: East.function([], UIComponentType, (_$) => {
        const DetailRow = StructType({ id: StringType, group: StringType });
        const routes = Navigation.config({
            overview: { value: NullType, label: "Overview" },
            detail: { value: DetailRow, label: "Item" },
        });
        return (
            <Reactive>{$ => {
                const nav = $.let(Navigation.bind(routes, "route.shell", [routes.Page.overview()]));
                const open = $.const(East.function([], NullType, $ => {
                    $(nav.go.detail(East.value({ id: "item-7", group: "B" }, DetailRow)));
                }));
                const back = $.const(East.function([], NullType, $ => { $(nav.pop()); }));
                return (
                    <HStack gap="4" align="stretch">
                        <Box padding="3">
                            <Route nav={nav} routes={{
                                overview: () => <Text>No selection</Text>,
                                detail: (_$, row) => <Text>{East.str`Selected: ${row.id} · ${row.group}`}</Text>,
                            }} />
                        </Box>
                        <Pages nav={nav} pages={{
                            overview: () => (
                                <VStack gap="2" align="stretch">
                                    <Text>Overview — item list</Text>
                                    <Button onClick={open}>Open item-7</Button>
                                </VStack>
                            ),
                            detail: (_$, row) => (
                                <VStack gap="2" align="stretch">
                                    <Text>{East.str`Item ${row.id} · group ${row.group}`}</Text>
                                    <Button onClick={back}>← Back</Button>
                                </VStack>
                            ),
                        }} />
                    </HStack>
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});
