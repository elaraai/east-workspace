/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { ArrayType, East, NullType, StringType, StructType, example } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { App, Configurator, Navigation, Reactive, SegmentGroup, State, VStack, Text, Button, Image } from "@elaraai/east-ui";

/**
 * Full application shell from one `Navigation.bind` handle — a collapsible rail
 * whose rows / icons / sections come straight from the `Navigation.config`, a
 * breadcrumb app bar derived from `nav.path()`, a brand logo, and the routed
 * page body. The `line` route has no `section`, so it's reachable (Overview
 * opens it) but hidden from the rail — a deep page.
 */
export const appBasic = example({
    keywords: ["App", "app shell", "Navigation", "rail", "breadcrumb", "Pages", "logo", "collapsible", "sidebar"],
    description: "Application shell — collapsible config-driven rail + breadcrumb + routed body from one nav handle",
    fn: East.function([], UIComponentType, (_$) => {
        const LOGO =
            "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2024%2024'%3E%3Ccircle%20cx='12'%20cy='12'%20r='10'%20fill='%233a7780'/%3E%3C/svg%3E";
        const LineRow = StructType({ id: StringType, line: StringType });
        const routes = Navigation.config({
            overview: { value: NullType, label: "Overview", section: "Analyse", icon: { prefix: "fas", name: "gauge-high" } },
            throughput: { value: NullType, label: "Throughput", section: "Analyse", icon: { prefix: "fas", name: "chart-line" }, badge: "3" },
            audit: { value: NullType, label: "Audit", section: "Manage", icon: { prefix: "fas", name: "list-check" } },
            settings: { value: NullType, label: "Settings", section: "Manage", icon: { prefix: "fas", name: "gear" } },
            // Deep route — no `section`, so it's hidden from the rail (reached from Overview).
            line: { value: LineRow, label: "Line" },
        });
        return (
            <Reactive>{$ => {
                const nav = $.let(Navigation.bind(routes, "app.example.route", [routes.Page.overview()]));

                // Page bodies as $.const closures capturing the shared handle.
                const overviewPage = $.const(East.function([], UIComponentType, ($) => {
                    const openLine = $.const(East.function([], NullType, $ => {
                        $(nav.go.line(East.value({ id: "L-1", line: "A" }, LineRow)));
                    }));
                    return (
                        <VStack gap="3" align="stretch">
                            <Text>Overview — production lines</Text>
                            <Button onClick={openLine}>Open line L-1</Button>
                        </VStack>
                    );
                }));
                const throughputPage = $.const(East.function([], UIComponentType, (_$) => <Text>Throughput trend</Text>));
                const auditPage = $.const(East.function([], UIComponentType, (_$) => <Text>Audit trail</Text>));
                const settingsPage = $.const(East.function([], UIComponentType, (_$) => <Text>Settings</Text>));
                const linePage = $.const(East.function([LineRow], UIComponentType, ($, row) => {
                    const back = $.const(East.function([], NullType, $ => { $(nav.pop()); }));
                    return (
                        <VStack gap="2" align="stretch">
                            <Text>{East.str`Line ${row.id} · ${row.line}`}</Text>
                            <Button onClick={back}>← Back</Button>
                        </VStack>
                    );
                }));

                return (
                    <App
                        nav={nav}
                        config={routes}
                        title="Acme Operations"
                        logo={Image.dataUri(LOGO)}
                        pages={{
                            overview: () => overviewPage(),
                            throughput: () => throughputPage(),
                            audit: () => auditPage(),
                            settings: () => settingsPage(),
                            line: (_$, row) => linePage(row),
                        }}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

/**
 * Density configurator over the app bar — `comfortable` (two rows, title
 * 24 px), `compact` (tighter two rows) and `condensed` (breadcrumb + title on
 * ONE 44 px row). Only the app bar changes; the rail and content region are
 * shared.
 */
export const appVariants = example({
    keywords: ["App", "app shell", "density", "comfortable", "compact", "condensed", "app bar", "Navigation", "Reactive", "State", "SegmentGroup", "Configurator", "configurator"],
    description: "App-shell configurator — a density axis (comfortable / compact / condensed) over one live shell",
    fn: East.function([], UIComponentType, (_$) => {
        const LOGO =
            "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2024%2024'%3E%3Ccircle%20cx='12'%20cy='12'%20r='10'%20fill='%233a7780'/%3E%3C/svg%3E";
        const routes = Navigation.config({
            overview: { value: NullType, label: "Overview", section: "Analyse", icon: { prefix: "fas", name: "gauge-high" } },
            throughput: { value: NullType, label: "Throughput", section: "Analyse", icon: { prefix: "fas", name: "chart-line" } },
            audit: { value: NullType, label: "Audit", section: "Manage", icon: { prefix: "fas", name: "list-check" } },
        });
        return (
            <Reactive>{$ => {
                const densities = $.const(["comfortable", "compact", "condensed"], ArrayType(StringType));
                const densityBind = $.let(State.bind([StringType], "app_density", "comfortable"));
                const dKey = $.let(densityBind.read());
                const onDensity = $.const(East.function([StringType], NullType, ($, next) => { $(densityBind.write(next)); }));

                const nav = $.let(Navigation.bind(routes, "app.variants.route", [routes.Page.overview()]));
                const overviewPage = $.const(East.function([], UIComponentType, (_$) => <Text>Overview — production lines</Text>));
                const throughputPage = $.const(East.function([], UIComponentType, (_$) => <Text>Throughput trend</Text>));
                const auditPage = $.const(East.function([], UIComponentType, (_$) => <Text>Audit trail</Text>));

                // density is a build-time enum on the shell, so the axis picks
                // between three shells over the one nav handle.
                const preview = $.const(dKey.equal("compact").ifElse(
                    _$ => (
                        <App nav={nav} config={routes} title="Acme Operations" logo={Image.dataUri(LOGO)} density="compact"
                            pages={{
                                overview: () => overviewPage(),
                                throughput: () => throughputPage(),
                                audit: () => auditPage(),
                            }} />
                    ),
                    _$ => dKey.equal("condensed").ifElse(
                        _$ => (
                            <App nav={nav} config={routes} title="Acme Operations" logo={Image.dataUri(LOGO)} density="condensed"
                                pages={{
                                    overview: () => overviewPage(),
                                    throughput: () => throughputPage(),
                                    audit: () => auditPage(),
                                }} />
                        ),
                        _$ => (
                            <App nav={nav} config={routes} title="Acme Operations" logo={Image.dataUri(LOGO)}
                                pages={{
                                    overview: () => overviewPage(),
                                    throughput: () => throughputPage(),
                                    audit: () => auditPage(),
                                }} />
                        ),
                    ),
                ));

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Density", dKey,
                                <SegmentGroup value={dKey} onChange={onDensity} size="sm"
                                    items={densities.map((_$, v) => SegmentGroup.Item(v, <Text>{v.upperCase()}</Text>))} />),
                        ]}
                        preview={preview}
                        spec={[
                            Configurator.Spec("App bar", dKey.equal("condensed").ifElse(_$ => "one 44px row", _$ => "two rows")),
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});
