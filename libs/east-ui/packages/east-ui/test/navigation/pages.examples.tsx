/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, NullType, StringType, IntegerType, StructType, some, example } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { Navigation, NavBindHandleType, Pages, Reactive, VStack, HStack, Box, Text, Button, NavList, Breadcrumb } from "@elaraai/east-ui";

// ============================================================================
// Basic two-page navigation
// ============================================================================

const ItemRow = StructType({ id: StringType, value: IntegerType });
const opsRoutes = Navigation.config({
    overview: { value: NullType, label: "Overview" },
    detail: { value: ItemRow, label: "Item" },
});
const OPS_KEY = "ops.route";
const OpsHandle = NavBindHandleType(opsRoutes.routes);

/**
 * Two-page navigation — overview opens a typed detail page (`nav.go.detail(row)`),
 * the detail page pops back (`nav.pop()`). `<Pages>` renders only the active route.
 */
export const pagesBasic = example({
    keywords: ["Navigation", "Pages", "navigate", "route", "stack", "go", "pop", "content-switcher"],
    description: "Two-page navigation — overview opens a typed detail page; back pops the stack",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const nav = $.let(Navigation.bind(opsRoutes, OPS_KEY, [opsRoutes.Page.overview()]));

            // Page bodies as $.const closures — each takes its typed payload + the
            // nav handle (so they capture nothing) and navigates the stack.
            const overviewPage = $.const(East.function([NullType, OpsHandle], UIComponentType, ($, _v, nav) => {
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
            const detailPage = $.const(East.function([ItemRow, OpsHandle], UIComponentType, ($, row, nav) => {
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
                    {Pages.Root(opsRoutes)({
                        stateKey: OPS_KEY,
                        initial: [opsRoutes.Page.overview()],
                        pages: {
                            overview: (_$, _v, nav) => overviewPage(_v, nav),
                            detail: (_$, row, nav) => detailPage(row, nav),
                        },
                    })}
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// Full app shell — NavList rail + breadcrumb app bar + Pages content
// ============================================================================

const DetailRow = StructType({ id: StringType, group: StringType });
const shellRoutes = Navigation.config({
    overview: { value: NullType, label: "Overview" },
    scenarios: { value: NullType, label: "Scenarios" },
    audit: { value: NullType, label: "Audit" },
    detail: { value: DetailRow, label: "Item" },
});
const SHELL_KEY = "shell.route";
const ShellHandle = NavBindHandleType(shellRoutes.routes);

/**
 * Full app shell — a `<NavList>` rail that drives `nav.navigateTo`, an app bar
 * whose `<Breadcrumb>` is derived live from `nav.path()` (each crumb jumps back to
 * its prefix), and a `<Pages>` content area. One handle wires all three on one key.
 */
export const pagesAppShell = example({
    keywords: ["Navigation", "Pages", "NavList", "Breadcrumb", "navigateTo", "path", "app shell", "rail", "breadcrumb"],
    description: "App shell — NavList rail + breadcrumb app bar from nav.path() + Pages content; navigateTo drives all three",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const nav = $.let(Navigation.bind(shellRoutes, SHELL_KEY, [shellRoutes.Page.overview()]));

            // Page bodies as $.const closures.
            const overviewPage = $.const(East.function([NullType, ShellHandle], UIComponentType, ($, _v, nav) => {
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
            const scenariosPage = $.const(East.function([NullType, ShellHandle], UIComponentType, (_$, _v, _nav) => <Text>Scenarios</Text>));
            const auditPage = $.const(East.function([NullType, ShellHandle], UIComponentType, (_$, _v, _nav) => <Text>Audit trail</Text>));
            const detailPage = $.const(East.function([DetailRow, ShellHandle], UIComponentType, ($, row, nav) => {
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
                // Coerce to the item type so `some(...)` widens to the Option fields
                // and the field order is normalised (the map element isn't otherwise
                // contextually typed against BreadcrumbItemType).
                const item = $.const({ label, current: some(isLeaf), onClick: some(jump) }, Breadcrumb.Types.Item);
                return item;
            });

            // The rail navigates to a top-level (argless) route by key.
            const onSelect = $.const(East.function([StringType], NullType, ($, key) => {
                $.if(East.equal(key, "scenarios"), $ => { $(nav.navigateTo([shellRoutes.Page.scenarios()])); });
                $.if(East.equal(key, "audit"), $ => { $(nav.navigateTo([shellRoutes.Page.audit()])); });
                $.if(East.equal(key, "overview"), $ => { $(nav.navigateTo([shellRoutes.Page.overview()])); });
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
                        {Pages.Root(shellRoutes)({
                            stateKey: SHELL_KEY,
                            initial: [shellRoutes.Page.overview()],
                            pages: {
                                overview: (_$, _v, nav) => overviewPage(_v, nav),
                                scenarios: (_$, _v, nav) => scenariosPage(_v, nav),
                                audit: (_$, _v, nav) => auditPage(_v, nav),
                                detail: (_$, row, nav) => detailPage(row, nav),
                            },
                        })}
                    </HStack>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});
