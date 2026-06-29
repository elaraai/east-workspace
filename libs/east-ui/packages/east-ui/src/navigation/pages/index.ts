/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Navigation` — the config/bind handle for first-class navigation.
 *
 * `Navigation.config({...})` declares each route's payload type + label (the
 * single source of truth). `Navigation.bind(config, key, initial)` returns a
 * handle whose `go.<route>(payload)` closures are derived from the config (the
 * `Record.bind` pattern). `config.Page.<route>(payload)` are typed segment
 * constructors (`≡ variant(route, payload)`) for `navigateTo`.
 *
 * @packageDocumentation
 */

import {
    East,
    ArrayType,
    NullType,
    StringType,
    variant,
    type BlockBuilder,
    type ExprType,
    type SubtypeExprOrValue,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";

import {
    NavBindHandleType,
    navBindPlatformFn,
    routeVariantType,
    type NavRoutes,
    type RouteVariantOf,
    type BoundNav,
} from "./types.js";

export {
    NavBindHandleType,
    navBindPlatformFn,
    NavBindPrimitives,
    routeVariantType,
    type NavRoutes,
    type NavRouteConfig,
    type RouteVariantOf,
    type NavHandleType,
    type BoundNav,
} from "./types.js";

// ============================================================================
// Page segment constructors — typed `variant(route, payload)` builders
// ============================================================================

/**
 * Per-route typed segment constructors. `Page.<route>(payload)` returns
 * `variant(route, payload)`, type-checked against the config's payload — so a
 * whole typed path is `[Page.overview(), Page.detail(row)]` (identical to the
 * raw `[variant("overview", null), variant("detail", row)]`).
 */
export type PageConstructors<R extends NavRoutes> = {
    [K in keyof R]: R[K]["value"] extends typeof NullType
        ? () => ExprType<RouteVariantOf<R>>
        : (payload: SubtypeExprOrValue<R[K]["value"]>) => ExprType<RouteVariantOf<R>>;
};

function makePageConstructors<R extends NavRoutes>(routes: R): PageConstructors<R> {
    const page: Record<string, (payload?: unknown) => unknown> = {};
    for (const name of Object.keys(routes)) {
        page[name] = (payload?: unknown) =>
            variant(name, payload === undefined ? null : payload) as unknown as ExprType<RouteVariantOf<R>>;
    }
    return page as PageConstructors<R>;
}

// ============================================================================
// Navigation.config — the route registry (types + labels), single source of truth
// ============================================================================

/**
 * A built navigation config: the routes map, the derived `Route` variant East
 * type, and the typed {@link PageConstructors}. Consumed by {@link Navigation.bind}
 * and `<Pages>`.
 *
 * @typeParam R - The routes map.
 */
export interface NavConfig<R extends NavRoutes> {
    /** The routes map (route name → payload type + label). */
    readonly routes: R;
    /** The derived `Route` variant East type. */
    readonly Route: RouteVariantOf<R>;
    /** Typed segment constructors — `Page.<route>(payload)`. */
    readonly Page: PageConstructors<R>;
}

function createNavConfig<R extends NavRoutes>(routes: R): NavConfig<R> {
    return {
        routes,
        Route: routeVariantType(routes),
        Page: makePageConstructors(routes),
    };
}

// ============================================================================
// Navigation.bind — build the handle from the config (Record.bind-over-H pattern)
// ============================================================================

/**
 * Bind a navigation config to a reactive path-stack handle.
 *
 * Builds the concrete handle type from the config and instantiates the
 * {@link navBindPlatformFn} platform over it — so `go.<route>` keeps each route's
 * payload type, exactly as `Record.bind` keeps each `mutate.<name>`'s arg types.
 *
 * @param config - A {@link Navigation.config} value.
 * @param key - The browser-local store key the path is persisted under.
 * @param initial - The initial path (e.g. `[config.Page.overview()]`).
 * @returns A handle: `path` / `current` / `depth` / `canPop` / `pop` /
 *   `go.<route>(payload)` / `navigateTo(path)` / `labelOf(route)`.
 */
function bindNavigation<R extends NavRoutes>(
    config: NavConfig<R>,
    key: string,
    initial: SubtypeExprOrValue<ArrayType<RouteVariantOf<R>>>,
): BoundNav<R> {
    const handleType = NavBindHandleType(config.routes);
    const keyValue = East.value(key, StringType);
    return navBindPlatformFn(
        [handleType, config.Route],
        keyValue,
        initial as never,
    ) as BoundNav<R>;
}

/**
 * The `Navigation` namespace — first-class navigation config + bind handle.
 *
 * @remarks
 * `Navigation.config({...})` is the single source of truth for each route's
 * payload type + label; `Navigation.bind(config, key, initial)` returns the
 * path-stack handle UI components plug into.
 */
export const Navigation = {
    /** Build a navigation config from a routes map (types + labels). */
    config: createNavConfig,
    /** Bind a config to a reactive path-stack handle. */
    bind: bindNavigation,
} as const;

// ============================================================================
// Pages — the first-class content-switcher component
// ============================================================================

/**
 * The page registry: one body per route, receiving `($, payload, nav)` — the
 * inner block builder, the route's typed payload, and the (re-bound) handle to
 * navigate with. Typed from the config so a wrong payload arg is a compile error;
 * every route must be handled (exhaustive).
 */
export type PagesHandlers<R extends NavRoutes> = {
    [K in keyof R]: (
        $: BlockBuilder<typeof UIComponentType>,
        payload: ExprType<R[K]["value"]>,
        nav: BoundNav<R>,
    ) => SubtypeExprOrValue<typeof UIComponentType>;
};

/**
 * The input to the `<Pages>` switcher: the nav handle (bound once in the
 * enclosing `<Reactive>` via `Navigation.bind`, shared with the chrome) plus
 * the typed page registry.
 *
 * @remarks
 * Taking the **bound handle** as a prop — rather than re-binding internally
 * from a key — is what makes Pages re-render on navigation inside an e3 `ui()`
 * task (#114): one binding, subscribed via the correct store, drives both the
 * writer (`nav.go.*` / `nav.pop()`) and the Pages render (`nav.current()`).
 * `R` is fixed by `nav`, so every `pages` handler is contextually typed.
 */
export interface PagesInput<R extends NavRoutes> {
    /** The nav handle from `Navigation.bind(config, key, initial)`, bound in the enclosing `<Reactive>`. */
    nav: BoundNav<R>;
    /** One body per route — see {@link PagesHandlers}. `R` is fixed by `nav`, so the handlers are contextually typed. */
    pages: PagesHandlers<NoInfer<R>>;
}

/**
 * Build a `<Pages>` content-switcher from a bound nav handle + a typed page
 * registry.
 *
 * The nullary `render` reads `current()` on the **passed** handle (no internal
 * re-bind) and `match`es the active route to its page body. The bodies live in
 * the match arms (in the IR), so the manifest walk collects every page's binds
 * (the union) while only the matched arm executes — the renderer mounts just
 * the active page (leaf-only, visible-only). The render closes over `nav`, so
 * its `current()` read subscribes to the same store the app's handle is bound
 * to (#114).
 *
 * @param input - The {@link PagesInput} (`nav` handle + `pages` registry).
 * @returns A `Pages` `UIComponentType` value.
 */
function createPages<R extends NavRoutes>({ nav, pages }: PagesInput<R>): ExprType<typeof UIComponentType> {
    const handlers = pages as Record<string, (h: unknown, p: unknown, n: unknown) => unknown>;
    // Build the match arms in host TS (outside the East block): one arm per
    // route, forwarding the typed payload + the shared handle to the page body.
    const armsFor = (navH: BoundNav<R>): Record<string, (h: BlockBuilder<typeof UIComponentType>, payload: never) => unknown> => {
        const arms: Record<string, (h: BlockBuilder<typeof UIComponentType>, payload: never) => unknown> = {};
        for (const name of Object.keys(handlers)) {
            const fn = handlers[name]!;
            arms[name] = (h, payload) => fn(h, payload, navH);
        }
        return arms;
    };
    const render = East.function([], UIComponentType, ($) => {
        const cur = $.const(nav.current());
        return (cur as unknown as { match(h: unknown): ExprType<typeof UIComponentType> }).match(armsFor(nav));
    });
    return East.value(variant("Pages", { render, navKey: nav.key }), UIComponentType);
}

/**
 * The `Pages` namespace — the first-class navigation content-switcher.
 *
 * @remarks
 * Authored as the `<Pages nav={…} pages={{…}} />` tag; `Pages.Root({ nav,
 * pages })` is the underlying factory. Bind the handle once with
 * `Navigation.bind` in the enclosing `<Reactive>` and share it with the chrome
 * (`<Breadcrumb nav>` / `<NavList nav>`).
 */
export const Pages = {
    /** Build a `<Pages>` content-switcher from `{ nav, pages }`. See {@link createPages}. */
    Root: createPages,
} as const;
