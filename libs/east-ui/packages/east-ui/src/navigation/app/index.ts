/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<App>` — the application shell (#367).
 *
 * Composes the first-class navigation primitives (`Navigation.bind` + `<NavList>`
 * + `<Breadcrumb>` + `<Pages>`) into one surface: a collapsible nav rail, a
 * breadcrumb app bar, an optional brand logo, app-bar slots, and the routed page
 * body. The factory pre-builds `rail` / `breadcrumb` as plain `NavList` /
 * `Breadcrumb` values that read the shared `nav` handle (so they re-evaluate on
 * navigation when `<App>` is authored inside the enclosing `<Reactive>`), and
 * `body` as a `<Pages>` value. The renderer is dumb layout + chrome (shell
 * recipe, collapse state, `AppProvider` host-slot injection).
 *
 * Rail rows are derived from the `Navigation.config`: every argless (`NullType`)
 * route that declares a `section` becomes a row (grouped, with its `icon` /
 * `badge`), the active row is the current route, and a click navigates to it.
 * Routes without a `section` (or with a payload) stay reachable but hidden — the
 * deep pages you navigate to programmatically.
 *
 * @packageDocumentation
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    ArrayType,
    DictType,
    FunctionType,
    NullType,
    StringType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { ImageSourceType } from "../../display/image/types.js";
import { NavList, type NavSectionInput, type NavItemInput } from "../nav-list/index.js";
import { Breadcrumb, BreadcrumbItemType } from "../breadcrumb/index.js";
import { Pages, type NavConfig, type NavRoutes, type BoundNav, type PagesHandlers } from "../pages/index.js";

// ============================================================================
// App input
// ============================================================================

/**
 * TypeScript input for `App.Root` — the application shell.
 *
 * @typeParam R - The routes map (fixed by `nav` / `config`, so `pages` is
 *   contextually typed and exhaustive).
 * @property nav - The handle from `Navigation.bind(config, key, initial)`, bound
 *   in the enclosing `<Reactive>`. Drives the rail, breadcrumb and body.
 * @property config - The `Navigation.config` value — the single source of truth
 *   for each route's label / rail `icon` / `section` / `badge` (the bound `nav`
 *   handle carries no labels, so the shell needs the config to build the rail
 *   and breadcrumb).
 * @property pages - One body per route — `($, payload, nav) => <…/>` (the same
 *   registry `<Pages>` takes).
 * @property title - Header surface title / wordmark; also the logo's alt text.
 * @property logo - Brand image source (`Image.url` / `Image.dataUri` /
 *   `Image.blob`); the shell renders + sizes the `<Image>` into the logo region.
 * @property logoCollapsed - Optional source for the collapsed (56 px) rail mark;
 *   defaults to `logo`.
 * @property collapsible - Whether the rail can collapse (default `true`).
 * @property themeToggle - Add a built-in dark/light item to the app bar (default
 *   `false` — the host normally injects theme via `AppProvider`).
 * @property barStart - Optional app-bar nodes rendered after the breadcrumb
 *   (leading cluster) — e.g. an environment switcher.
 * @property barEnd - Optional app-bar nodes rendered at the trailing edge —
 *   `<IconButton>` / `<Menu>` / `<Avatar>` actions.
 */
export interface AppInput<R extends NavRoutes> {
    /** The nav handle from `Navigation.bind(config, key, initial)`. */
    nav: BoundNav<R>;
    /** The `Navigation.config` value (labels / rail icons / sections). */
    config: NavConfig<R>;
    /** One body per route — `($, payload, nav) => <…/>`. */
    pages: PagesHandlers<NoInfer<R>>;
    /** Header surface title / wordmark; also the logo alt text. */
    title?: SubtypeExprOrValue<StringType>;
    /** Brand image source — the shell renders + sizes the `<Image>`. */
    logo?: SubtypeExprOrValue<ImageSourceType>;
    /** Collapsed-rail (56 px) mark source; defaults to `logo`. */
    logoCollapsed?: SubtypeExprOrValue<ImageSourceType>;
    /** Whether the rail can collapse (default `true`). */
    collapsible?: boolean;
    /** Add a built-in dark/light app-bar item (default `false`). */
    themeToggle?: boolean;
    /** App-bar nodes after the breadcrumb (leading). */
    barStart?: SubtypeExprOrValue<ArrayType<UIComponentType>>;
    /** App-bar nodes at the trailing edge. */
    barEnd?: SubtypeExprOrValue<ArrayType<UIComponentType>>;
}

// ============================================================================
// Rail — a NavList derived from the config
// ============================================================================

/** Build the rail `NavList` value: config routes with a `section` grouped into
 *  sections, the active row = the current route, click = navigate to it. */
function buildRail<R extends NavRoutes>(input: AppInput<R>): ExprType<UIComponentType> {
    const { nav, config } = input;
    // The current route tag drives the active row. Read inside the enclosing
    // <Reactive> (where <App> is authored), so it re-evaluates on navigation.
    const currentTag = nav.current().getTag();

    const order: string[] = [];
    const bySection = new Map<string, NavItemInput[]>();
    for (const [name, cfg] of Object.entries(config.routes)) {
        // Only argless routes with a section are rail rows (navigable from a
        // bare click); payload / section-less routes stay hidden.
        if (cfg.section === undefined || cfg.value !== NullType) continue;
        if (!bySection.has(cfg.section)) {
            bySection.set(cfg.section, []);
            order.push(cfg.section);
        }
        const item: NavItemInput = {
            key: name,
            label: cfg.label,
            active: currentTag.equals(name),
        };
        if (cfg.icon !== undefined) item.icon = cfg.icon;
        if (cfg.badge !== undefined) item.badge = cfg.badge;
        bySection.get(cfg.section)!.push(item);
    }
    const sections: NavSectionInput[] = order.map(label => ({ label, items: bySection.get(label)! }));
    return NavList.Root(sections, { surface: "shell", onSelect: buildRailOnSelect(input) });
}

/** Build the rail `onSelect(key)` — a static dispatch that navigates to the
 *  clicked argless route (`navigateTo([variant(route, null)])`). */
function buildRailOnSelect<R extends NavRoutes>(
    input: AppInput<R>,
): ExprType<FunctionType<[StringType], NullType>> {
    const { nav, config } = input;
    return East.function([StringType], NullType, ($, key) => {
        for (const [name, cfg] of Object.entries(config.routes)) {
            if (cfg.section === undefined || cfg.value !== NullType) continue;
            $.if(key.equals(name), $ => {
                // `name` is a runtime string over the config, so `variant` can't
                // narrow it to a route key — cast the argless route value.
                const target = $.const(East.value([variant(name, null) as never], ArrayType(config.Route)));
                $(nav.navigateTo(target));
            });
        }
    });
}

// ============================================================================
// Breadcrumb — derived from the nav path stack
// ============================================================================

/** Build the breadcrumb `Breadcrumb` value from `nav.path()`: one crumb per
 *  path segment, its label from the config, the leaf marked current. */
function buildBreadcrumb<R extends NavRoutes>(input: AppInput<R>): ExprType<UIComponentType> {
    const { nav, config } = input;
    const labelEntries: [string, string][] = Object.entries(config.routes).map(
        ([name, cfg]) => [name, cfg.label],
    );
    const labelDict = East.value(new Map(labelEntries), DictType(StringType, StringType));
    // The leaf (top of the path stack) is the current page; mark the crumb whose
    // route tag equals it. Read inside the enclosing <Reactive> so it
    // re-evaluates on navigation.
    const currentTag = nav.current().getTag();
    const items = nav.path().map(($, seg) =>
        East.value({
            label: labelDict.get(seg.getTag()),
            current: some(seg.getTag().equals(currentTag)),
            onClick: none,
        }, BreadcrumbItemType),
    );
    return Breadcrumb.Root(items, { leadingSeparator: true });
}

// ============================================================================
// App factory
// ============================================================================

/**
 * Creates an `App` — the application shell composed from the navigation
 * primitives.
 *
 * @param input - The {@link AppInput} (`nav` + `config` + `pages` + shell options).
 * @returns An East expression of type `UIComponentType`.
 *
 * @remarks
 * Author `<App>` **inside** the enclosing `<Reactive>` that binds `nav`, so the
 * rail's active row and the breadcrumb re-evaluate on navigation.
 *
 * @example
 * ```ts
 * import { East, NullType, StringType, StructType } from "@elaraai/east";
 * import { App, Navigation, Reactive, Text, VStack, UIComponentType, Image } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, (_$) => {
 *     const routes = Navigation.config({
 *         overview: { value: NullType, label: "Overview", section: "Analyse", icon: { prefix: "fas", name: "gauge-high" } },
 *         audit: { value: NullType, label: "Audit", section: "Manage", icon: { prefix: "fas", name: "list-check" } },
 *     });
 *     return Reactive.Root(East.function([], UIComponentType, ($) => {
 *         const nav = $.let(Navigation.bind(routes, "app.route", [routes.Page.overview()]));
 *         return App.Root({
 *             nav,
 *             config: routes,
 *             title: "Acme Ops",
 *             logo: Image.dataUri("data:image/svg+xml,<svg/>"),
 *             pages: {
 *                 overview: ($, _p, _nav) => VStack.Root([Text.Root("Overview")]),
 *                 audit: ($, _p, _nav) => VStack.Root([Text.Root("Audit")]),
 *             },
 *         });
 *     }));
 * });
 * ```
 */
function createApp<R extends NavRoutes>(input: AppInput<R>): ExprType<UIComponentType> {
    const { nav, config, pages } = input;
    const body = Pages.Root({ nav, pages: pages as PagesHandlers<R> });
    const rail = buildRail(input);
    const breadcrumb = buildBreadcrumb(input);
    const emptyChildren = East.value([], ArrayType(UIComponentType));

    return East.value(variant("App", {
        title: input.title !== undefined ? some(input.title) : none,
        logo: input.logo !== undefined ? some(input.logo) : none,
        logoCollapsed: input.logoCollapsed !== undefined ? some(input.logoCollapsed) : none,
        rail,
        breadcrumb,
        body,
        barStart: input.barStart ?? emptyChildren,
        barEnd: input.barEnd ?? emptyChildren,
        collapsible: input.collapsible ?? true,
        themeToggle: input.themeToggle ?? false,
        navKey: nav.key,
    }), UIComponentType);
}

/**
 * The `App` namespace — the application shell.
 *
 * @remarks
 * Authored as the `<App nav={…} config={…} pages={{…}} />` tag; `App.Root({ nav,
 * config, pages, … })` is the underlying factory. Bind the handle once with
 * `Navigation.bind` in the enclosing `<Reactive>` and pass the same `config`.
 */
export const App = {
    /** Build an `App` application shell from `{ nav, config, pages, … }`. See {@link createApp}. */
    Root: createApp,
} as const;
