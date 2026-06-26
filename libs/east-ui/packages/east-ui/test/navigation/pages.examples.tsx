/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, NullType, StringType, IntegerType, StructType, some, example } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { Navigation, Pages, Reactive, VStack, HStack, Box, Text, Button, NavList, Breadcrumb } from "@elaraai/east-ui";

/**
 * Two-page navigation — overview opens a typed detail page (`nav.go.detail(row)`),
 * the detail page pops back (`nav.pop()`). `<Pages>` renders only the active route
 * and re-renders on navigation; the handle is bound once and passed in as a prop.
 */
export const pagesBasic = example({
    keywords: ["Navigation", "Pages", "navigate", "route", "stack", "go", "pop", "content-switcher"],
    description: "Two-page navigation — overview opens a typed detail page; back pops the stack",
    fn: East.function([], UIComponentType, (_$) => {
        const ItemRow = StructType({ id: StringType, value: IntegerType });
        const routes = Navigation.config({
            overview: { value: NullType, label: "Overview" },
            detail: { value: ItemRow, label: "Item" },
        });
        return (
            <Reactive>{$ => {
                const nav = $.let(Navigation.bind(routes, "ops.route", [routes.Page.overview()]));

                // Page bodies as $.const closures — they navigate via the shared handle.
                const overviewPage = $.const(East.function([], UIComponentType, ($) => {
                    const open = $.const(East.function([], NullType, $ => {
                        $(nav.go.detail(East.value({ id: "item-1", value: 42n }, ItemRow)));
                    }));
                    return (
                        <VStack gap="3" align="stretch">
                            <Text>Overview — pick an item</Text>
                            <Button onClick={open}>Open item-1</Button>
                        </VStack>
                    );
                }));
                const detailPage = $.const(East.function([ItemRow], UIComponentType, ($, row) => {
                    const back = $.const(East.function([], NullType, $ => { $(nav.pop()); }));
                    return (
                        <VStack gap="2" align="stretch">
                            <Text>{East.str`Item ${row.id} — value ${East.print(row.value)}`}</Text>
                            <Button onClick={back}>← Back</Button>
                        </VStack>
                    );
                }));

                return (
                    <VStack gap="4" align="stretch">
                        <Text fontWeight="bold">{East.str`Ops console · depth ${East.print(nav.depth())}`}</Text>
                        <Pages nav={nav} pages={{
                            overview: () => overviewPage(),
                            detail: (_$, row) => detailPage(row),
                        }} />
                    </VStack>
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

/**
 * Full app shell — a `<NavList>` rail that drives `nav.navigateTo`, an app bar
 * whose `<Breadcrumb>` is derived live from `nav.path()` (each crumb jumps back to
 * its prefix), and a `<Pages>` content area. One handle wires all three.
 */
export const pagesAppShell = example({
    keywords: ["Navigation", "Pages", "NavList", "Breadcrumb", "navigateTo", "path", "app shell", "rail", "breadcrumb"],
    description: "App shell — NavList rail + breadcrumb app bar from nav.path() + Pages content; navigateTo drives all three",
    fn: East.function([], UIComponentType, (_$) => {
        const DetailRow = StructType({ id: StringType, group: StringType });
        const routes = Navigation.config({
            overview: { value: NullType, label: "Overview" },
            scenarios: { value: NullType, label: "Scenarios" },
            audit: { value: NullType, label: "Audit" },
            detail: { value: DetailRow, label: "Item" },
        });
        return (
            <Reactive>{$ => {
                const nav = $.let(Navigation.bind(routes, "shell.route", [routes.Page.overview()]));

                // Page bodies as $.const closures capturing the shared handle.
                const overviewPage = $.const(East.function([], UIComponentType, ($) => {
                    const open = $.const(East.function([], NullType, $ => {
                        $(nav.go.detail(East.value({ id: "item-1", group: "A" }, DetailRow)));
                    }));
                    return (
                        <VStack gap="3" align="stretch">
                            <Text>Overview — item list</Text>
                            <Button onClick={open}>Open item-1</Button>
                        </VStack>
                    );
                }));
                const scenariosPage = $.const(East.function([], UIComponentType, (_$) => <Text>Scenarios</Text>));
                const auditPage = $.const(East.function([], UIComponentType, (_$) => <Text>Audit trail</Text>));
                const detailPage = $.const(East.function([DetailRow], UIComponentType, ($, row) => {
                    const back = $.const(East.function([], NullType, $ => { $(nav.pop()); }));
                    return (
                        <VStack gap="2" align="stretch">
                            <Text>{East.str`Item ${row.id} · group ${row.group}`}</Text>
                            <Button onClick={back}>← Back</Button>
                        </VStack>
                    );
                }));

                // Breadcrumb items derived live from the path: label via a per-route
                // match, current = is-leaf, onClick = navigate back to that prefix.
                const crumbs = nav.path().map(($, seg, i) => {
                    const label = seg.match({
                        overview: (_$, _v) => "Overview",
                        scenarios: (_$, _v) => "Scenarios",
                        audit: (_$, _v) => "Audit",
                        detail: (_$, r) => East.str`Item ${r.id}`,
                    });
                    const prefixLen = $.let(i.add(1n));
                    const isLeaf = $.let(East.equal(i, nav.path().size().subtract(1n)));
                    const jump = $.const(East.function([], NullType, $ => {
                        $(nav.navigateTo(nav.path().slice(0n, prefixLen)));
                    }));
                    const item = $.const({ label, current: some(isLeaf), onClick: some(jump) }, Breadcrumb.Types.Item);
                    return item;
                });

                // The rail navigates to a top-level (argless) route by key.
                const onSelect = $.const(East.function([StringType], NullType, ($, key) => {
                    $.if(East.equal(key, "scenarios"), $ => { $(nav.navigateTo([routes.Page.scenarios()])); });
                    $.if(East.equal(key, "audit"), $ => { $(nav.navigateTo([routes.Page.audit()])); });
                    $.if(East.equal(key, "overview"), $ => { $(nav.navigateTo([routes.Page.overview()])); });
                }));

                return (
                    <VStack gap="0" align="stretch">
                        <Box padding="3">
                            <Breadcrumb items={crumbs} />
                        </Box>
                        <HStack gap="4" align="stretch">
                            <NavList
                                sections={[{ items: [
                                    { key: "overview", label: "Overview" },
                                    { key: "scenarios", label: "Scenarios" },
                                    { key: "audit", label: "Audit" },
                                ] }]}
                                onSelect={onSelect}
                            />
                            <Pages nav={nav} pages={{
                                overview: () => overviewPage(),
                                scenarios: () => scenariosPage(),
                                audit: () => auditPage(),
                                detail: (_$, row) => detailPage(row),
                            }} />
                        </HStack>
                    </VStack>
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});
